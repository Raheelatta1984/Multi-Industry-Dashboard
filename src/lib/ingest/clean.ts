/**
 * Stage 2 — generate and apply a cleaning recipe to a profiled sheet.
 * Every transformation is recorded as an auditable step the reviewer can
 * inspect before publish (Alteryx-style, but generated instead of hand-built).
 */
import type { CurrencyCode } from "../domain";
import { normalizeHeader, parseDateLoose, stripNumber, TOTAL_RE } from "./profile";
import type { CellValue, CleanStep, CleanedTable, ColumnProfile, SheetProfile } from "./types";

export function cleanSheet(profile: SheetProfile): { table: CleanedTable; steps: CleanStep[] } {
  const raw = profile.sheet;
  const steps: CleanStep[] = [];

  // ---- Header normalization + dedupe -------------------------------------
  const used = new Map<string, number>();
  const headers: string[] = [];
  const renamed: string[] = [];
  raw.headers.forEach((h, i) => {
    let n = normalizeHeader(h, i);
    const count = used.get(n) ?? 0;
    used.set(n, count + 1);
    if (count > 0) {
      const next = `${n}_${count + 1}`;
      renamed.push(`${h} → ${next}`);
      n = next;
    }
    headers.push(n);
  });
  steps.push({
    op: "header_normalize",
    detail: `normalized ${headers.length} header${headers.length === 1 ? "" : "s"} to snake_case canonical names`,
  });
  if (renamed.length) steps.push({ op: "header_dedupe", renamed });

  // ---- Row-level passes ---------------------------------------------------
  let rows = raw.rows.filter((r) => r.some((v) => v !== null));
  const totals = rows.filter((r) => {
    const first = r.find((v) => v !== null);
    return typeof first === "string" && TOTAL_RE.test(first.trim());
  });
  if (totals.length) {
    rows = rows.filter((r) => !totals.includes(r));
    steps.push({
      op: "drop_totals_rows",
      removed: totals.length,
      examples: totals.slice(0, 2).map((r) => String(r.find((v) => v !== null) ?? "")),
    });
  }
  const seenRow = new Set<string>();
  const deduped: CellValue[][] = [];
  for (const r of rows) {
    const key = JSON.stringify(r);
    if (seenRow.has(key)) continue;
    seenRow.add(key);
    deduped.push(r);
  }
  if (deduped.length !== rows.length) {
    steps.push({ op: "dedupe_rows", removed: rows.length - deduped.length });
    rows = deduped;
  }

  // ---- Cell-level passes per column ---------------------------------------
  let wsFixed = 0;
  const wsColumns: string[] = [];
  const currencyByColumn: Record<string, CurrencyCode> = {};
  const types = profile.columns.map((c) => c.type);
  const out: CellValue[][] = rows.map((r) => [...r]);

  profile.columns.forEach((col, index) => {
    const name = headers[index] ?? col.cleanHeader;
    const type = col.type;

    // whitespace
    let ws = 0;
    for (const r of out) {
      const v = r[index];
      if (typeof v === "string" && v !== v.trim()) {
        r[index] = v.trim();
        ws++;
      }
    }
    if (ws) {
      wsFixed += ws;
      wsColumns.push(name);
    }

    if (type === "date") {
      let normalized = 0;
      let bad = 0;
      for (const r of out) {
        const v = r[index];
        if (v === null) continue;
        const iso = parseDateLoose(v);
        if (iso) {
          if (iso !== v) normalized++;
          r[index] = iso;
        } else {
          bad++;
          r[index] = null;
        }
      }
      steps.push({ op: "coerce_dates", column: name, to: "YYYY-MM-DD", normalized, unparseable: bad });
    }

    if (type === "currency" || type === "number" || type === "percent") {
      let normalized = 0;
      let bad = 0;
      const ccyHits = new Map<CurrencyCode, number>();
      for (const r of out) {
        const v = r[index];
        if (v === null) continue;
        const { n, currency } = stripNumber(v);
        if (n !== null) {
          if (v !== n) normalized++;
          let value = n;
          if (type === "percent") value = n / 100;
          r[index] = value;
          if (currency) ccyHits.set(currency, (ccyHits.get(currency) ?? 0) + 1);
        } else {
          bad++;
          r[index] = null;
        }
      }
      if (ccyHits.size) {
        const ccy = [...ccyHits.entries()].sort((a, b) => b[1] - a[1])[0][0];
        currencyByColumn[name] = ccy;
        steps.push({ op: "strip_currency", column: name, currency: ccy, normalized });
      } else {
        steps.push({ op: "coerce_numbers", column: name, normalized, unparseable: bad });
      }
    }

    if (type === "category" || (type === "text" && col.distinctRatio < 0.3 && col.distinct <= 40)) {
      // Standardize each value to the most frequent original form of its case-insensitive key.
      const byKey = new Map<string, Map<string, number>>();
      for (const r of out) {
        const v = r[index];
        if (typeof v !== "string") continue;
        const key = v.toLowerCase().replace(/\s+/g, " ").trim();
        const forms = byKey.get(key) ?? new Map<string, number>();
        forms.set(v, (forms.get(v) ?? 0) + 1);
        byKey.set(key, forms);
      }
      const winner = new Map<string, string>();
      for (const [key, forms] of byKey) {
        winner.set(key, [...forms.entries()].sort((a, b) => b[1] - a[1])[0][0]);
      }
      let variants = 0;
      const map: Array<[string, string]> = [];
      for (const r of out) {
        const v = r[index];
        if (typeof v !== "string") continue;
        const key = v.toLowerCase().replace(/\s+/g, " ").trim();
        const want = winner.get(key) ?? v;
        if (v !== want) {
          r[index] = want;
          variants++;
          if (!map.some(([f]) => f === v)) map.push([v, want]);
        }
      }
      if (variants) steps.push({ op: "standardize_categories", column: name, variants, map: map.slice(0, 5) });
    }

    if (type === "boolean") {
      for (const r of out) {
        const v = r[index];
        if (typeof v === "string") {
          const s = v.toLowerCase();
          r[index] = s === "true" || s === "yes" || s === "y" || s === "1";
        }
      }
    }
  });

  if (wsFixed) steps.push({ op: "trim_whitespace", columns: wsColumns, fixedCells: wsFixed });

  return { table: { headers, types, rows: out, currencyByColumn }, steps };
}

export function profileByHeader(profile: SheetProfile, header: string): ColumnProfile | undefined {
  return profile.columns.find((c) => c.cleanHeader === header);
}
