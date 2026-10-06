/**
 * Stage 4 — publish. Turns the mapped, cleaned table into canonical
 * warehouse rows (coercing values into controlled vocabularies), merges them
 * with the live workbook, and returns an audit summary a reviewer or auditor
 * can replay later.
 */
import { DASHBOARDS } from "../catalog";
import { hashRow } from "../hash";
import { mergeWorkbooks } from "../patch";
import type {
  AssetRow,
  ExpenseRow,
  LicenseRow,
  RevenueRow,
  SalesRow,
  TurnoverRow,
  UpcomingRow,
  Workbook,
} from "../types";
import type { CurrencyCode, DepartmentId, IndustryId } from "../domain";
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
} from "./types";

type CoercionLog = { column: string; from: string; to: string; score: number };

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

export function buildPartialWorkbook(
  table: CleanedTable,
  mappings: ColumnMapping[],
  domain: IngestDomain,
  current: Workbook,
): { workbook: Workbook; coercions: CoercionLog[]; committed: number; skippedRows: number } {
  const coercions: CoercionLog[] = [];
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
    return fallback;
  };

  const pickIndustry = (row: CellValue[]): IndustryId => {
    const v = val(row, "industry");
    if (typeof v === "string") {
      const r = coerceIndustry(v);
      if (r.value) {
        if (v.trim().toLowerCase() !== r.matched) coercions.push({ column: "entity", from: v, to: r.value, score: r.score });
        return r.value;
      }
      coercions.push({ column: "entity", from: v, to: "technology (default)", score: 0 });
    }
    return "technology";
  };

  const pickDepartment = (row: CellValue[], domain: IngestDomain): DepartmentId => {
    const v = val(row, "department");
    if (typeof v === "string") {
      const r = coerceDepartment(v);
      if (r.value) {
        if (v.trim().toLowerCase() !== r.matched) coercions.push({ column: "department", from: v, to: r.value, score: r.score });
        return r.value;
      }
      coercions.push({ column: "department", from: v, to: `${DEPT_DEFAULT[domain]} (default)`, score: 0 });
    }
    return DEPT_DEFAULT[domain];
  };

  const pickDate = (row: CellValue[], fields: string[]): string => {
    for (const f of fields) {
      const v = val(row, f);
      if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
    }
    return now.slice(0, 10);
  };

  const amountCurrency = (row: CellValue[], measure: string): { amount: number | null; currency: CurrencyCode } => {
    const amount = asNum(val(row, measure));
    let currency: CurrencyCode = "USD";
    const headerOfMeasure = target.get(measure);
    if (headerOfMeasure !== undefined) {
      const byCol = table.currencyByColumn[table.headers[headerOfMeasure]];
      if (byCol) currency = byCol;
    }
    const explicit = val(row, "currency");
    if (explicit !== null) currency = pickCurrency(row, currency);
    return { amount, currency };
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

  let skippedRows = 0;

  if (domain === "revenue") {
    empty.revenue = table.rows.flatMap((r): RevenueRow[] => {
      const { amount, currency } = amountCurrency(r, "amount");
      if (amount === null || amount === 0) {
        skippedRows++;
        return [];
      }
      const industry = pickIndustry(r);
      const department = pickDepartment(r, domain);
      const regionRaw = val(r, "region");
      const region = coerceRegion(regionRaw);
      const regionFinal = region.value ?? "EMEA";
      if (typeof regionRaw === "string" && regionRaw !== regionFinal) {
        coercions.push({
          column: "region",
          from: regionRaw,
          to: region.value ? regionFinal : `${regionFinal} (default)`,
          score: region.score,
        });
      }
      const channelRaw = val(r, "channel");
      const channel = coerceChannel(channelRaw);
      const channelFinal = channel.value ?? "Direct";
      if (typeof channelRaw === "string" && channelRaw !== channelFinal) {
        coercions.push({
          column: "channel",
          from: channelRaw,
          to: channel.value ? channelFinal : `${channelFinal} (default)`,
          score: channel.score,
        });
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
      const { amount, currency } = amountCurrency(r, "amount");
      if (amount === null || amount === 0) {
        skippedRows++;
        return [];
      }
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
      const { amount, currency } = amountCurrency(r, "amount");
      // Derive missing quantities when price and value are present.
      if (units === null && unitPrice && unitPrice > 0 && amount && amount > 0) {
        units = Math.round(amount / unitPrice);
        coercions.push({ column: "units", from: "—", to: `${units} (derived = amount ÷ unit price)`, score: 1 });
      }
      if (units === null) {
        skippedRows++;
        return [];
      }
      const regionRaw = val(r, "region");
      const region = coerceRegion(regionRaw);
      const regionFinal = region.value ?? "EMEA";
      if (typeof regionRaw === "string" && regionRaw !== regionFinal) {
        coercions.push({ column: "region", from: regionRaw, to: regionFinal, score: region.score });
      }
      const channelRaw = val(r, "channel");
      const channel = coerceChannel(channelRaw);
      const channelFinal = channel.value ?? "Direct";
      if (typeof channelRaw === "string" && channelRaw !== channelFinal) {
        coercions.push({ column: "channel", from: channelRaw, to: channelFinal, score: channel.score });
      }
      const sku = asStr(val(r, "sku"));
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
        skippedRows++;
        return [];
      }
      const { amount: cost, currency } = amountCurrency(r, "cost");
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
        skippedRows++;
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
      const { amount, currency } = amountCurrency(r, "amount");
      const description = asStr(val(r, "description"));
      if (amount === null || amount === 0 || !description) {
        skippedRows++;
        return [];
      }
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
        skippedRows++;
        return [];
      }
      const { amount: cogs, currency } = amountCurrency(r, "cogs");
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

  return { workbook: empty, coercions, committed, skippedRows };
}

function boardsLit(wb: Workbook): number {
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

export function publishRun(
  run: IngestRun,
  current: Workbook,
): { workbook: Workbook; result: PublishResult; tick: import("../types").TickReport } {
  if (!run.cleaned || !run.domain?.domain) throw new Error("Run is not mapped yet.");
  const { workbook: partial, coercions, committed, skippedRows } = buildPartialWorkbook(
    run.cleaned,
    run.mappings,
    run.domain.domain,
    current,
  );
  const merged = mergeWorkbooks(current, partial);
  const mapped = run.mappings.filter((m) => m.target);
  const mappingConfidence = mapped.length
    ? mapped.reduce((acc, m) => acc + m.confidence, 0) / mapped.length
    : 0;
  const domainRows = partial[run.domain.domain] as unknown as unknown[];
  const rowsBySheet: PublishResult["rowsBySheet"] = {
    [run.domain.domain]: domainRows.length,
  };
  void skippedRows;
  const result: PublishResult = {
    at: Date.now(),
    rowsCommitted: committed,
    rowsBySheet,
    coercedValues: coercions.slice(0, 12),
    unmappedColumns: run.mappings.filter((m) => !m.target).map((m) => m.column),
    mappingConfidence,
    qualityScore: run.profile?.qualityScore ?? 0,
    report: { added: merged.report.added, updated: merged.report.updated, skipped: merged.report.skipped },
    boardsLit: boardsLit(merged.workbook),
  };
  return { workbook: merged.workbook, result, tick: merged.report };
}
