/**
 * Stage 4 — publish. Turns the mapped, cleaned table into canonical
 * warehouse rows (coercing values into controlled vocabularies), merges them
 * with the live workbook, and returns an audit summary a reviewer or auditor
 * can replay later.
 *
 * Every silent fallback (a blank company, an unknown region, a missing date,
 * an unstated currency) is tallied here so the onboarding log can tell the
 * reviewer exactly what the warehouse assumed on their behalf.
 */
import { DASHBOARDS } from "../catalog";
import { hashRow } from "../hash";
import { mergeWorkbooks } from "../patch";
import { currencyFromHeader } from "./profile";
import { DEPARTMENTS, INDUSTRIES, type CurrencyCode, type DepartmentId, type IndustryId } from "../domain";
import type {
  AssetRow,
  ExpenseRow,
  LicenseRow,
  RevenueRow,
  SalesRow,
  SheetKey,
  TurnoverRow,
  UpcomingRow,
  Workbook,
} from "../types";
import {
  coerceChannel,
  coerceCurrency,
  coerceDepartment,
  coerceIndustry,
  coerceRegion,
} from "./semantic";
import type {
  CellValue,
  CleanedTable,
  ColumnMapping,
  IngestDomain,
  IngestRun,
  PublishResult,
  Purpose,
} from "./types";

type CoercionLog = { column: string; from: string; to: string; score: number };
type DefaultLog = { column: string; from: string; to: string; count: number };

/**
 * Answers from the interview that the warehouse must honour when the file
 * itself does not say. "Single company: Retail" means rows with no company
 * value belong to Retail — not to the technology fallback.
 */
export type CommitScope = {
  industry: IndustryId | null;
  department: DepartmentId | null;
  purpose: Purpose | null;
};

export const NO_SCOPE: CommitScope = { industry: null, department: null, purpose: null };

export type PartialPlan = {
  workbook: Workbook;
  coercions: CoercionLog[];
  committed: number;
  skipped: Array<{ reason: string; count: number }>;
  defaults: DefaultLog[];
  rowsReplaced: number;
};

/** Tidy ALL-CAPS / all-lower labels into readable title case; keep mixed case as typed. */
function smartCase(s: string): string {
  const t = s.trim();
  if (t !== t.toLowerCase() && t !== t.toUpperCase()) return t;
  return t
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

const DEPT_DEFAULT: Record<IngestDomain, DepartmentId> = {
  revenue: "sales",
  expenses: "finance",
  sales: "sales",
  assets: "executive",
  licenses: "licenses",
  upcoming: "finance",
  turnover: "supply",
};

/** Fields that identify "the same business fact" regardless of its amount. */
const KEY_FIELDS: Record<IngestDomain, string[]> = {
  revenue: ["date", "industry", "department", "product", "channel", "region"],
  expenses: ["date", "industry", "department", "category", "vendor"],
  sales: ["date", "industry", "sku", "region", "channel"],
  assets: ["name", "industry", "category"],
  licenses: ["name", "industry", "vendor"],
  upcoming: ["dueDate", "industry", "description", "type"],
  turnover: ["period", "industry", "department"],
};

export function naturalKey(domain: IngestDomain, row: object): string {
  const r = row as Record<string, unknown>;
  return KEY_FIELDS[domain].map((f) => String(r[f] ?? "")).join("|").toLowerCase();
}

export function industryLabel(id: string): string {
  return INDUSTRIES.find((i) => i.id === id)?.label ?? id;
}

export function departmentLabel(id: string): string {
  return DEPARTMENTS.find((d) => d.id === id)?.label ?? id;
}

function tallyFactory() {
  const defaults = new Map<string, DefaultLog>();
  const skipped = new Map<string, number>();
  return {
    fallback(column: string, from: string, to: string) {
      const key = `${column}\u0000${from}\u0000${to}`;
      const entry = defaults.get(key) ?? { column, from, to, count: 0 };
      entry.count += 1;
      defaults.set(key, entry);
    },
    skip(reason: string) {
      skipped.set(reason, (skipped.get(reason) ?? 0) + 1);
    },
    defaults: () => [...defaults.values()].sort((a, b) => b.count - a.count),
    skipped: () => [...skipped.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
  };
}

/**
 * For "Correct / replace data": a row whose business key matches exactly one
 * existing row (and exactly one incoming row) takes that row's id, so the
 * merge updates it in place instead of adding a second copy.
 */
function applyReplacements(domain: IngestDomain, incoming: Array<{ id: string }>, existing: Array<{ id: string }>): number {
  const existingByKey = new Map<string, string[]>();
  for (const r of existing) {
    const k = naturalKey(domain, r);
    existingByKey.set(k, [...(existingByKey.get(k) ?? []), r.id]);
  }
  const incomingCount = new Map<string, number>();
  for (const r of incoming) {
    const k = naturalKey(domain, r);
    incomingCount.set(k, (incomingCount.get(k) ?? 0) + 1);
  }
  let replaced = 0;
  for (const r of incoming) {
    const k = naturalKey(domain, r);
    const ids = existingByKey.get(k);
    if (ids?.length === 1 && incomingCount.get(k) === 1 && ids[0] !== r.id) {
      r.id = ids[0];
      replaced += 1;
    }
  }
  return replaced;
}

/**
 * Incoming rows that are NOT already in the warehouse but DO share a business
 * key with an existing row — typically a corrected figure that would now be
 * counted twice. Used by the onboarding log to warn before commit.
 */
export function keyCollisions(
  domain: IngestDomain,
  incoming: Array<{ id: string }>,
  existing: Array<{ id: string }>,
): { count: number; examples: string[] } {
  const existingIds = new Set(existing.map((r) => r.id));
  const existingKeys = new Set(existing.map((r) => naturalKey(domain, r)));
  let count = 0;
  const examples: string[] = [];
  for (const r of incoming) {
    if (existingIds.has(r.id)) continue;
    const k = naturalKey(domain, r);
    if (!existingKeys.has(k)) continue;
    count += 1;
    if (examples.length < 3) examples.push(k.split("|").filter(Boolean).slice(0, 3).join(" · "));
  }
  return { count, examples };
}

export function buildPartialWorkbook(
  table: CleanedTable,
  mappings: ColumnMapping[],
  domain: IngestDomain,
  current: Workbook,
  scope: CommitScope = NO_SCOPE,
): PartialPlan {
  const coercions: CoercionLog[] = [];
  const tally = tallyFactory();
  const idx = new Map<string, number>();
  table.headers.forEach((h, i) => idx.set(h, i));
  const target = new Map<string, number>();
  for (const m of mappings) if (m.target && idx.has(m.column)) target.set(m.target, idx.get(m.column)!);

  const val = (row: CellValue[], field: string): CellValue => {
    const i = target.get(field);
    return i === undefined ? null : (row[i] ?? null);
  };

  const asStr = (v: CellValue): string | null => (typeof v === "string" && v.trim() ? v.trim() : v === null || v === undefined ? null : String(v));
  const asNum = (v: CellValue): number | null => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
  const now = new Date().toISOString();
  const todayIso = now.slice(0, 10);

  const pickCurrency = (row: CellValue[], fallback: CurrencyCode): CurrencyCode => {
    const v = val(row, "currency");
    if (v === null) return fallback;
    const r = coerceCurrency(v);
    if (r.value) {
      if (typeof v === "string" && v.trim().toUpperCase() !== r.value && r.score < 1) {
        coercions.push({ column: "currency", from: v, to: r.value, score: r.score });
      }
      return r.value;
    }
    tally.fallback("currency", String(v), `${fallback} (default)`);
    return fallback;
  };

  const pickIndustry = (row: CellValue[]): IndustryId => {
    const fallback: IndustryId = scope.industry ?? "technology";
    const v = val(row, "industry");
    if (typeof v === "string" && v.trim()) {
      const r = coerceIndustry(v);
      if (r.value) {
        if (v.trim().toLowerCase() !== r.matched) coercions.push({ column: "entity", from: v, to: r.value, score: r.score });
        return r.value;
      }
      coercions.push({ column: "entity", from: v, to: `${industryLabel(fallback)} (default)`, score: 0 });
      tally.fallback("company", v, `${industryLabel(fallback)} (default)`);
      return fallback;
    }
    tally.fallback(
      "company",
      target.has("industry") ? "(blank)" : "(no company column)",
      `${industryLabel(fallback)}${scope.industry ? " (your answer)" : " (default)"}`,
    );
    return fallback;
  };

  const pickDepartment = (row: CellValue[], domainId: IngestDomain): DepartmentId => {
    const fallback: DepartmentId = scope.department ?? DEPT_DEFAULT[domainId];
    const v = val(row, "department");
    if (typeof v === "string" && v.trim()) {
      const r = coerceDepartment(v);
      if (r.value) {
        if (v.trim().toLowerCase() !== r.matched) coercions.push({ column: "department", from: v, to: r.value, score: r.score });
        return r.value;
      }
      coercions.push({ column: "department", from: v, to: `${departmentLabel(fallback)} (default)`, score: 0 });
      tally.fallback("department", v, `${departmentLabel(fallback)} (default)`);
      return fallback;
    }
    tally.fallback(
      "department",
      target.has("department") ? "(blank)" : "(no department column)",
      `${departmentLabel(fallback)}${scope.department ? " (your answer)" : " (default)"}`,
    );
    return fallback;
  };

  const pickDate = (row: CellValue[], fields: string[]): string => {
    for (const f of fields) {
      const v = val(row, f);
      if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
    }
    tally.fallback(fields[0] ?? "date", "(blank or unreadable)", `${todayIso} (today)`);
    return todayIso;
  };

  const measureValue = (row: CellValue[], measure: string): number | null => asNum(val(row, measure));

  /** Currency for a money value. Only called for rows that will be committed, so skipped rows are not tallied. */
  const currencyFor = (row: CellValue[], measure: string): CurrencyCode => {
    const headerOfMeasure = target.get(measure);
    const sourceColumn = headerOfMeasure !== undefined ? table.headers[headerOfMeasure]! : measure;
    let currency: CurrencyCode | null = null;
    if (headerOfMeasure !== undefined) {
      const byCol = table.currencyByColumn[sourceColumn];
      if (byCol) currency = byCol;
    }
    if (val(row, "currency") !== null) currency = pickCurrency(row, currency ?? "USD");
    if (!currency) {
      const fromHeader = currencyFromHeader(sourceColumn);
      currency = fromHeader ?? "USD";
      if (!fromHeader) tally.fallback(sourceColumn, "(no currency stated)", "USD (default)");
    }
    return currency;
  };

  const empty: Workbook = {
    meta: current.meta,
    fx: current.fx,
    departments: [],
    revenue: [],
    expenses: [],
    assets: [],
    licenses: [],
    upcoming: [],
    sales: [],
    forecast: [],
    demand: [],
    turnover: [],
  };

  if (domain === "revenue") {
    empty.revenue = table.rows.flatMap((r): RevenueRow[] => {
      const amount = measureValue(r, "amount");
      if (amount === null || amount === 0) {
        tally.skip("Amount is empty or zero");
        return [];
      }
      const currency = currencyFor(r, "amount");
      const industry = pickIndustry(r);
      const department = pickDepartment(r, domain);
      const regionRaw = val(r, "region");
      const region = coerceRegion(regionRaw);
      const regionFinal = region.value ?? "EMEA";
      if (!region.value) tally.fallback("region", typeof regionRaw === "string" && regionRaw.trim() ? regionRaw : "(blank)", `${regionFinal} (default)`);
      if (typeof regionRaw === "string" && regionRaw !== regionFinal) {
        coercions.push({ column: "region", from: regionRaw, to: region.value ? regionFinal : `${regionFinal} (default)`, score: region.score });
      }
      const channelRaw = val(r, "channel");
      const channel = coerceChannel(channelRaw);
      const channelFinal = channel.value ?? "Direct";
      if (!channel.value) tally.fallback("channel", typeof channelRaw === "string" && channelRaw.trim() ? channelRaw : "(blank)", `${channelFinal} (default)`);
      if (typeof channelRaw === "string" && channelRaw !== channelFinal) {
        coercions.push({ column: "channel", from: channelRaw, to: channel.value ? channelFinal : `${channelFinal} (default)`, score: channel.score });
      }
      const row: Omit<RevenueRow, "id"> = {
        date: pickDate(r, ["date"]),
        industry,
        department,
        product: smartCase(asStr(val(r, "product")) ?? asStr(val(r, "sku")) ?? "") || "Unspecified",
        channel: channelFinal,
        region: regionFinal,
        amount,
        currency,
        updatedAt: now,
      };
      return [{ id: `ing-${hashRow(row)}`, ...row }];
    });
  }

  if (domain === "expenses") {
    empty.expenses = table.rows.flatMap((r): ExpenseRow[] => {
      const amount = measureValue(r, "amount");
      if (amount === null || amount === 0) {
        tally.skip("Amount is empty or zero");
        return [];
      }
      const currency = currencyFor(r, "amount");
      const row: Omit<ExpenseRow, "id"> = {
        date: pickDate(r, ["date"]),
        industry: pickIndustry(r),
        department: pickDepartment(r, domain),
        category: asStr(val(r, "category")) ?? "Professional",
        vendor: smartCase(asStr(val(r, "vendor")) ?? "") || "Unspecified",
        amount,
        currency,
        recurring: val(r, "recurring") === true,
        updatedAt: now,
      };
      return [{ id: `ing-${hashRow(row)}`, ...row }];
    });
  }

  if (domain === "sales") {
    empty.sales = table.rows.flatMap((r): SalesRow[] => {
      let units = asNum(val(r, "units"));
      const unitPrice = asNum(val(r, "unit_price"));
      const amount = measureValue(r, "amount");
      // Derive missing quantities when price and value are present.
      if (units === null && unitPrice && unitPrice > 0 && amount && amount > 0) {
        units = Math.round(amount / unitPrice);
        coercions.push({ column: "units", from: "—", to: `${units} (derived = amount ÷ unit price)`, score: 1 });
      }
      if (units === null) {
        tally.skip("Quantity (units) is empty and cannot be derived");
        return [];
      }
      const currency = currencyFor(r, "amount");
      const regionRaw = val(r, "region");
      const region = coerceRegion(regionRaw);
      const regionFinal = region.value ?? "EMEA";
      if (!region.value) tally.fallback("region", typeof regionRaw === "string" && regionRaw.trim() ? regionRaw : "(blank)", `${regionFinal} (default)`);
      if (typeof regionRaw === "string" && regionRaw !== regionFinal) {
        coercions.push({ column: "region", from: regionRaw, to: regionFinal, score: region.score });
      }
      const channelRaw = val(r, "channel");
      const channel = coerceChannel(channelRaw);
      const channelFinal = channel.value ?? "Direct";
      if (!channel.value) tally.fallback("channel", typeof channelRaw === "string" && channelRaw.trim() ? channelRaw : "(blank)", `${channelFinal} (default)`);
      if (typeof channelRaw === "string" && channelRaw !== channelFinal) {
        coercions.push({ column: "channel", from: channelRaw, to: channelFinal, score: channel.score });
      }
      const sku = asStr(val(r, "sku"));
      if (!sku) tally.fallback("sku", "(blank)", "GEN-SKU (default)");
      const row: Omit<SalesRow, "id"> = {
        date: pickDate(r, ["date"]),
        industry: pickIndustry(r),
        department: pickDepartment(r, domain),
        sku: sku ?? "GEN-SKU",
        product: asStr(val(r, "product")) ?? sku ?? "General",
        units,
        unitPrice: unitPrice ?? (units ? (amount ?? 0) / units : 0),
        currency,
        region: regionFinal,
        channel: channelFinal,
        updatedAt: now,
      };
      return [{ id: `ing-${hashRow(row)}`, ...row }];
    });
  }

  if (domain === "assets") {
    empty.assets = table.rows.flatMap((r): AssetRow[] => {
      const name = asStr(val(r, "name"));
      if (!name) {
        tally.skip("Asset name is empty");
        return [];
      }
      const cost = measureValue(r, "cost");
      const currency = currencyFor(r, "cost");
      const bv = asNum(val(r, "book_value"));
      const statusRaw = (asStr(val(r, "status")) ?? "active").toLowerCase();
      const row: Omit<AssetRow, "id"> = {
        name,
        industry: pickIndustry(r),
        department: pickDepartment(r, domain),
        category: asStr(val(r, "category")) ?? "Equipment",
        acquired: pickDate(r, ["acquired"]),
        cost: cost ?? bv ?? 0,
        bookValue: bv ?? cost ?? 0,
        currency,
        status: statusRaw.startsWith("dis") ? "disposed" : statusRaw.startsWith("idle") ? "idle" : "active",
        updatedAt: now,
      };
      return [{ id: `ing-${hashRow(row)}`, ...row }];
    });
  }

  if (domain === "licenses") {
    empty.licenses = table.rows.flatMap((r): LicenseRow[] => {
      const name = asStr(val(r, "name")) ?? asStr(val(r, "product"));
      if (!name) {
        tally.skip("Licence name is empty");
        return [];
      }
      const seats = asNum(val(r, "seats")) ?? 1;
      const unitCost = asNum(val(r, "unit_price")) ?? 0;
      const cycle = (asStr(val(r, "cycle")) ?? "annual").toLowerCase();
      const row: Omit<LicenseRow, "id"> = {
        name,
        vendor: smartCase(asStr(val(r, "vendor")) ?? "") || "Unspecified",
        industry: pickIndustry(r),
        department: pickDepartment(r, domain),
        seats,
        unitCost,
        currency: pickCurrency(r, "USD"),
        start: pickDate(r, ["start"]),
        end: pickDate(r, ["end"]),
        cycle: cycle.startsWith("month") ? "monthly" : "annual",
        updatedAt: now,
      };
      return [{ id: `ing-${hashRow(row)}`, ...row }];
    });
  }

  if (domain === "upcoming") {
    empty.upcoming = table.rows.flatMap((r): UpcomingRow[] => {
      const amount = measureValue(r, "amount");
      const description = asStr(val(r, "description"));
      if (amount === null || amount === 0) {
        tally.skip("Amount is empty or zero");
        return [];
      }
      if (!description) {
        tally.skip("Description is empty");
        return [];
      }
      const currency = currencyFor(r, "amount");
      const typeRaw = (asStr(val(r, "type")) ?? "opex").toLowerCase();
      const statusRaw = (asStr(val(r, "status")) ?? "scheduled").toLowerCase();
      const row: Omit<UpcomingRow, "id"> = {
        dueDate: pickDate(r, ["due_date"]),
        industry: pickIndustry(r),
        department: pickDepartment(r, domain),
        description,
        amount,
        currency,
        type: ["opex", "capex", "license", "payroll", "tax"].includes(typeRaw) ? (typeRaw as UpcomingRow["type"]) : "opex",
        status: statusRaw.startsWith("commit") ? "committed" : statusRaw.startsWith("paid") ? "paid" : "scheduled",
        updatedAt: now,
      };
      return [{ id: `ing-${hashRow(row)}`, ...row }];
    });
  }

  if (domain === "turnover") {
    empty.turnover = table.rows.flatMap((r): TurnoverRow[] => {
      const end = asNum(val(r, "inventory_end"));
      if (end === null) {
        tally.skip("Closing stock is empty");
        return [];
      }
      const cogs = measureValue(r, "cogs");
      const currency = currencyFor(r, "cogs");
      const row: Omit<TurnoverRow, "id"> = {
        period: pickDate(r, ["period"]).slice(0, 7),
        industry: pickIndustry(r),
        department: pickDepartment(r, domain),
        inventoryStart: asNum(val(r, "inventory_start")) ?? end,
        inventoryEnd: end,
        cogs: cogs ?? 0,
        currency,
        updatedAt: now,
      };
      return [{ id: `ing-${hashRow(row)}`, ...row }];
    });
  }

  const committed =
    empty.revenue.length +
    empty.expenses.length +
    empty.sales.length +
    empty.assets.length +
    empty.licenses.length +
    empty.upcoming.length +
    empty.turnover.length;

  const rowsReplaced =
    scope.purpose === "replace_data"
      ? applyReplacements(domain, empty[domain as SheetKey] as unknown as Array<{ id: string }>, current[domain as SheetKey] as unknown as Array<{ id: string }>)
      : 0;

  return {
    workbook: empty,
    coercions,
    committed,
    skipped: tally.skipped(),
    defaults: tally.defaults(),
    rowsReplaced,
  };
}

export function boardsLit(wb: Workbook): number {
  const facts = [...wb.revenue, ...wb.expenses, ...wb.sales, ...wb.turnover, ...wb.upcoming];
  const lit = new Set<string>();
  for (const d of DASHBOARDS) {
    const hit = facts.some(
      (r) =>
        (d.industry === "all" || r.industry === d.industry) &&
        (d.department === "group" || r.department === d.department),
    );
    if (hit) lit.add(d.id);
  }
  return lit.size;
}

/** The same rewrite across many rows is one line for the reviewer, not one per row. */
function uniqueCoercions(list: CoercionLog[]): CoercionLog[] {
  const seen = new Set<string>();
  const out: CoercionLog[] = [];
  for (const c of list) {
    const key = `${c.column}\u0000${c.from}\u0000${c.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

export function publishRun(
  run: IngestRun,
  current: Workbook,
  scope: CommitScope = NO_SCOPE,
): { workbook: Workbook; result: PublishResult; tick: import("../types").TickReport } {
  if (!run.cleaned || !run.domain?.domain) throw new Error("Run is not mapped yet.");
  const plan = buildPartialWorkbook(run.cleaned, run.mappings, run.domain.domain, current, scope);
  const merged = mergeWorkbooks(current, plan.workbook);
  const mapped = run.mappings.filter((m) => m.target);
  const mappingConfidence = mapped.length ? mapped.reduce((acc, m) => acc + m.confidence, 0) / mapped.length : 0;
  const domainRows = plan.workbook[run.domain.domain as SheetKey] as unknown as unknown[];
  const rowsBySheet: PublishResult["rowsBySheet"] = {
    [run.domain.domain]: domainRows.length,
  };
  const result: PublishResult = {
    at: Date.now(),
    rowsCommitted: plan.committed,
    rowsBySheet,
    coercedValues: uniqueCoercions(plan.coercions).slice(0, 12),
    unmappedColumns: run.mappings.filter((m) => !m.target).map((m) => m.column),
    mappingConfidence,
    qualityScore: run.profile?.qualityScore ?? 0,
    report: { added: merged.report.added, updated: merged.report.updated, skipped: merged.report.skipped },
    boardsLit: boardsLit(plan.workbook),
    rowsSkipped: plan.skipped,
    defaultsApplied: plan.defaults,
    rowsReplaced: plan.rowsReplaced,
  };
  return { workbook: merged.workbook, result, tick: merged.report };
}
