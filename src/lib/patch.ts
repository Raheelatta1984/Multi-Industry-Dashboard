import { hashRow } from "./hash";
import type { PatchOp, SheetKey, TickReport, Workbook } from "./types";
import { DATA_SHEETS } from "./types";

type AnyRow = { id: string; updatedAt: string } & Record<string, unknown>;

function sheetRows(wb: Workbook, sheet: SheetKey): AnyRow[] {
  return wb[sheet] as unknown as AnyRow[];
}

export function fingerprintWorkbook(wb: Workbook): Record<SheetKey, Map<string, string>> {
  const out = {} as Record<SheetKey, Map<string, string>>;
  for (const sheet of DATA_SHEETS) {
    const map = new Map<string, string>();
    for (const row of sheetRows(wb, sheet)) map.set(row.id, hashRow(row));
    out[sheet] = map;
  }
  return out;
}

export function diffWorkbooks(prev: Workbook, next: Workbook, at = Date.now()): TickReport {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const ops: PatchOp[] = [];
  const sheetsTouched = new Set<SheetKey>();
  let added = 0;
  let updated = 0;
  let removed = 0;
  let skipped = 0;

  for (const sheet of DATA_SHEETS) {
    const prevRows = sheetRows(prev, sheet);
    const nextRows = sheetRows(next, sheet);
    const prevMap = new Map(prevRows.map((r) => [r.id, r]));
    const nextMap = new Map(nextRows.map((r) => [r.id, r]));

    for (const [id, row] of nextMap) {
      const before = prevMap.get(id);
      if (!before) {
        added += 1;
        sheetsTouched.add(sheet);
        ops.push({ sheet, op: "add", id, at });
        continue;
      }
      const h1 = hashRow(before);
      const h2 = hashRow(row);
      if (h1 === h2) {
        skipped += 1;
        continue;
      }
      const fields = Object.keys(row).filter((k) => {
        if (k === "updatedAt") return false;
        return JSON.stringify((before as Record<string, unknown>)[k]) !== JSON.stringify((row as Record<string, unknown>)[k]);
      });
      updated += 1;
      sheetsTouched.add(sheet);
      ops.push({ sheet, op: "update", id, at, fields });
    }

    for (const id of prevMap.keys()) {
      if (!nextMap.has(id)) {
        removed += 1;
        sheetsTouched.add(sheet);
        ops.push({ sheet, op: "remove", id, at });
      }
    }
  }

  const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
  return {
    at,
    added,
    updated,
    removed,
    skipped,
    ops,
    latencyMs: Math.round((t1 - t0) * 10) / 10,
    sheetsTouched: [...sheetsTouched],
  };
}

export function mergeWorkbooks(base: Workbook, incoming: Workbook): { workbook: Workbook; report: TickReport } {
  const at = Date.now();
  const next: Workbook = { ...base };
  const ops: PatchOp[] = [];
  const sheetsTouched = new Set<SheetKey>();
  let added = 0;
  let updated = 0;
  let removed = 0;
  let skipped = 0;

  for (const sheet of DATA_SHEETS) {
    const current = sheetRows(base, sheet);
    const inc = sheetRows(incoming, sheet);
    if (!inc.length && sheet !== "meta" && sheet !== "fx") {
      next[sheet] = current as never;
      skipped += current.length;
      continue;
    }
    const index = new Map(current.map((r, i) => [r.id, i]));
    const rows = current.slice();
    for (const row of inc) {
      const i = index.get(row.id);
      if (i === undefined) {
        rows.push(row);
        added += 1;
        sheetsTouched.add(sheet);
        ops.push({ sheet, op: "add", id: row.id, at });
      } else {
        const prev = rows[i]!;
        if (hashRow(prev) === hashRow(row)) {
          skipped += 1;
        } else {
          rows[i] = row;
          updated += 1;
          sheetsTouched.add(sheet);
          ops.push({ sheet, op: "update", id: row.id, at });
        }
      }
    }
    next[sheet] = rows as never;
  }

  return {
    workbook: next,
    report: {
      at,
      added,
      updated,
      removed,
      skipped,
      ops,
      latencyMs: 0,
      sheetsTouched: [...sheetsTouched],
    },
  };
}

export function applyRowMutations(
  wb: Workbook,
  mutations: Array<{ sheet: SheetKey; row: AnyRow; op: "add" | "update" | "remove" }>,
): Workbook {
  const next: Workbook = { ...wb };
  const cloned = new Set<SheetKey>();
  const ensure = (sheet: SheetKey) => {
    if (!cloned.has(sheet)) {
      next[sheet] = (wb[sheet] as unknown as AnyRow[]).slice() as never;
      cloned.add(sheet);
    }
    return next[sheet] as unknown as AnyRow[];
  };

  for (const m of mutations) {
    const rows = ensure(m.sheet);
    if (m.op === "add") {
      rows.push(m.row);
    } else if (m.op === "remove") {
      const i = rows.findIndex((r) => r.id === m.row.id);
      if (i >= 0) rows.splice(i, 1);
    } else {
      const i = rows.findIndex((r) => r.id === m.row.id);
      if (i >= 0) rows[i] = m.row;
    }
  }
  return next;
}
