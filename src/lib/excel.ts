import * as XLSX from "xlsx";
import { CURRENCIES, type CurrencyCode, type DepartmentId, type IndustryId } from "./domain";
import { generateSampleWorkbook } from "./sample-data";
import type {
  AssetRow,
  DemandRow,
  DepartmentRow,
  ExpenseRow,
  ForecastRow,
  FxRow,
  LicenseRow,
  MetaRow,
  ParseIssue,
  RevenueRow,
  SalesRow,
  TurnoverRow,
  UpcomingRow,
  Workbook,
} from "./types";

const HEADER_ALIASES: Record<string, string> = {
  amt: "amount",
  amount: "amount",
  value: "amount",
  ccy: "currency",
  curr: "currency",
  currency: "currency",
  dept: "department",
  department: "department",
  department_id: "department",
  industry: "industry",
  date: "date",
  period: "period",
  due: "dueDate",
  due_date: "dueDate",
  duedate: "dueDate",
  updated: "updatedAt",
  updated_at: "updatedAt",
  updatedat: "updatedAt",
  rate: "rateToUsd",
  rate_to_usd: "rateToUsd",
  ratetousd: "rateToUsd",
  as_of: "asOf",
  asof: "asOf",
  unit_cost: "unitCost",
  unitcost: "unitCost",
  unit_price: "unitPrice",
  unitprice: "unitPrice",
  book_value: "bookValue",
  bookvalue: "bookValue",
  expected_units: "expectedUnits",
  expectedunits: "expectedUnits",
  expected_amount: "expectedAmount",
  expectedamount: "expectedAmount",
  avg_units: "avgUnits",
  avgunits: "avgUnits",
  norm_units: "normUnits",
  normunits: "normUnits",
  safety_stock: "safetyStock",
  safetystock: "safetyStock",
  inventory_start: "inventoryStart",
  inventorystart: "inventoryStart",
  inventory_end: "inventoryEnd",
  inventoryend: "inventoryEnd",
  cost_center: "costCenter",
  costcenter: "costCenter",
  fiscal_year_start: "fiscalYearStart",
  fiscalyearstart: "fiscalYearStart",
  base_currency: "baseCurrency",
  basecurrency: "baseCurrency",
  product: "product",
  sku: "sku",
  channel: "channel",
  region: "region",
  category: "category",
  vendor: "vendor",
  name: "name",
  owner: "owner",
  seats: "seats",
  units: "units",
  start: "start",
  end: "end",
  cycle: "cycle",
  status: "status",
  type: "type",
  method: "method",
  recurring: "recurring",
  acquired: "acquired",
  cost: "cost",
  cogs: "cogs",
  company: "company",
  timezone: "timezone",
  description: "description",
  id: "id",
};

function normHeader(h: unknown): string {
  const raw = String(h ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  return HEADER_ALIASES[raw] ?? raw;
}

function asString(v: unknown, fallback = ""): string {
  if (v === null || v === undefined) return fallback;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number" && Number.isFinite(v)) {
    if (v > 20000 && v < 60000) {
      const parsed = XLSX.SSF.parse_date_code(v);
      if (parsed) {
        const d = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
        return d.toISOString().slice(0, 10);
      }
    }
    return String(v);
  }
  return String(v).trim();
}

function asNumber(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function asBool(v: unknown): boolean {
  const s = String(v ?? "").toLowerCase();
  return s === "true" || s === "1" || s === "yes" || s === "y";
}

function sheetToObjects(wb: XLSX.WorkBook, names: string[]): Record<string, unknown>[] {
  const name = names.find((n) => wb.SheetNames.some((s) => s.toLowerCase() === n.toLowerCase()));
  if (!name) return [];
  const real = wb.SheetNames.find((s) => s.toLowerCase() === name.toLowerCase())!;
  const sheet = wb.Sheets[real];
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
    header: 1,
    defval: "",
    raw: true,
  });
  if (!rows.length) return [];
  const headers = (rows[0] ?? []).map(normHeader);
  const out: Record<string, unknown>[] = [];
  for (let i = 1; i < rows.length; i++) {
    const line = rows[i] ?? [];
    const obj: Record<string, unknown> = {};
    let empty = true;
    headers.forEach((h, idx) => {
      if (!h) return;
      const val = line[idx];
      if (val !== "" && val !== null && val !== undefined) empty = false;
      obj[h] = val;
    });
    if (!empty) out.push(obj);
  }
  return out;
}

const CCY = new Set(CURRENCIES.map((c) => c.code));

function ccy(v: unknown, fallback: CurrencyCode = "USD"): CurrencyCode {
  const s = asString(v, fallback).toUpperCase();
  return (CCY.has(s as CurrencyCode) ? s : fallback) as CurrencyCode;
}

function stamp(v: unknown, fallback: string): string {
  const s = asString(v, fallback);
  return s || fallback;
}

export function parseWorkbook(buffer: ArrayBuffer): { workbook: Workbook; issues: ParseIssue[] } {
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const issues: ParseIssue[] = [];
  const now = new Date().toISOString();

  const metaRaw = sheetToObjects(wb, ["Meta", "meta"]);
  const meta: MetaRow[] = metaRaw.map((r, i) => ({
    id: asString(r.id, `meta-${i}`),
    company: asString(r.company, "Uploaded company"),
    industry: asString(r.industry, "all"),
    fiscalYearStart: asString(r.fiscalYearStart, "2026-01-01"),
    baseCurrency: ccy(r.baseCurrency),
    timezone: asString(r.timezone, "UTC"),
    updatedAt: stamp(r.updatedAt, now),
  }));
  if (!meta.length) {
    meta.push({
      id: "meta",
      company: "Uploaded workbook",
      industry: "all",
      fiscalYearStart: "2026-01-01",
      baseCurrency: "USD",
      timezone: "UTC",
      updatedAt: now,
    });
  }

  const fx: FxRow[] = sheetToObjects(wb, ["FX", "fx", "Rates"]).map((r, i) => ({
    id: asString(r.id, `fx-${asString(r.currency, String(i))}`),
    currency: ccy(r.currency),
    rateToUsd: asNumber(r.rateToUsd) || 1,
    asOf: asString(r.asOf, now.slice(0, 10)),
    updatedAt: stamp(r.updatedAt, now),
  }));

  const departments: DepartmentRow[] = sheetToObjects(wb, ["Departments", "Department"]).map((r, i) => ({
    id: asString(r.id, `dept-${i}`),
    name: asString(r.name, "Department"),
    industry: asString(r.industry, "retail") as IndustryId,
    department: asString(r.department, "finance") as DepartmentId,
    owner: asString(r.owner, ""),
    costCenter: asString(r.costCenter, ""),
    updatedAt: stamp(r.updatedAt, now),
  }));

  const revenue: RevenueRow[] = sheetToObjects(wb, ["Revenue"]).map((r, i) => ({
    id: asString(r.id, `rev-${i}`),
    date: asString(r.date, now.slice(0, 10)),
    industry: asString(r.industry, "retail") as IndustryId,
    department: asString(r.department, "sales") as DepartmentId,
    product: asString(r.product, ""),
    channel: (asString(r.channel, "Direct") as RevenueRow["channel"]),
    region: (asString(r.region, "AMER") as RevenueRow["region"]),
    amount: asNumber(r.amount),
    currency: ccy(r.currency),
    updatedAt: stamp(r.updatedAt, now),
  }));

  const expenses: ExpenseRow[] = sheetToObjects(wb, ["Expenses", "Expenditure"]).map((r, i) => ({
    id: asString(r.id, `exp-${i}`),
    date: asString(r.date, now.slice(0, 10)),
    industry: asString(r.industry, "retail") as IndustryId,
    department: asString(r.department, "finance") as DepartmentId,
    category: asString(r.category, "Other"),
    vendor: asString(r.vendor, ""),
    amount: asNumber(r.amount),
    currency: ccy(r.currency),
    recurring: asBool(r.recurring),
    updatedAt: stamp(r.updatedAt, now),
  }));

  const assets: AssetRow[] = sheetToObjects(wb, ["Assets"]).map((r, i) => ({
    id: asString(r.id, `ast-${i}`),
    name: asString(r.name, `Asset ${i + 1}`),
    industry: asString(r.industry, "retail") as IndustryId,
    department: asString(r.department, "assets") as DepartmentId,
    category: asString(r.category, "Other"),
    acquired: asString(r.acquired, now.slice(0, 10)),
    cost: asNumber(r.cost),
    bookValue: asNumber(r.bookValue) || asNumber(r.cost),
    currency: ccy(r.currency),
    status: (asString(r.status, "active") as AssetRow["status"]) || "active",
    updatedAt: stamp(r.updatedAt, now),
  }));

  const licenses: LicenseRow[] = sheetToObjects(wb, ["Licenses", "Licence", "Licences"]).map((r, i) => ({
    id: asString(r.id, `lic-${i}`),
    name: asString(r.name, `License ${i + 1}`),
    vendor: asString(r.vendor, ""),
    industry: asString(r.industry, "retail") as IndustryId,
    department: asString(r.department, "licenses") as DepartmentId,
    seats: asNumber(r.seats),
    unitCost: asNumber(r.unitCost),
    currency: ccy(r.currency),
    start: asString(r.start, now.slice(0, 10)),
    end: asString(r.end, now.slice(0, 10)),
    cycle: asString(r.cycle, "annual") === "monthly" ? "monthly" : "annual",
    updatedAt: stamp(r.updatedAt, now),
  }));

  const upcoming: UpcomingRow[] = sheetToObjects(wb, ["Upcoming", "UpcomingExpenses"]).map((r, i) => ({
    id: asString(r.id, `upc-${i}`),
    dueDate: asString(r.dueDate, now.slice(0, 10)),
    industry: asString(r.industry, "retail") as IndustryId,
    department: asString(r.department, "finance") as DepartmentId,
    description: asString(r.description, asString(r.name, "Upcoming")),
    amount: asNumber(r.amount),
    currency: ccy(r.currency),
    type: (asString(r.type, "opex") as UpcomingRow["type"]) || "opex",
    status: (asString(r.status, "scheduled") as UpcomingRow["status"]) || "scheduled",
    updatedAt: stamp(r.updatedAt, now),
  }));

  const sales: SalesRow[] = sheetToObjects(wb, ["Sales"]).map((r, i) => ({
    id: asString(r.id, `sal-${i}`),
    date: asString(r.date, now.slice(0, 10)),
    industry: asString(r.industry, "retail") as IndustryId,
    department: asString(r.department, "sales") as DepartmentId,
    sku: asString(r.sku, `SKU-${i}`),
    product: asString(r.product, ""),
    units: asNumber(r.units),
    unitPrice: asNumber(r.unitPrice),
    currency: ccy(r.currency),
    region: (asString(r.region, "AMER") as SalesRow["region"]),
    channel: (asString(r.channel, "Direct") as SalesRow["channel"]),
    updatedAt: stamp(r.updatedAt, now),
  }));

  const forecast: ForecastRow[] = sheetToObjects(wb, ["Forecast"]).map((r, i) => ({
    id: asString(r.id, `for-${i}`),
    period: asString(r.period, asString(r.date, now.slice(0, 10))),
    industry: asString(r.industry, "retail") as IndustryId,
    department: asString(r.department, "sales") as DepartmentId,
    sku: asString(r.sku, `SKU-${i}`),
    expectedUnits: asNumber(r.expectedUnits),
    expectedAmount: asNumber(r.expectedAmount),
    currency: ccy(r.currency),
    method: (asString(r.method, "blend") as ForecastRow["method"]) || "blend",
    updatedAt: stamp(r.updatedAt, now),
  }));

  const demand: DemandRow[] = sheetToObjects(wb, ["Demand"]).map((r, i) => ({
    id: asString(r.id, `dem-${i}`),
    period: asString(r.period, asString(r.date, now.slice(0, 10))),
    industry: asString(r.industry, "retail") as IndustryId,
    sku: asString(r.sku, `SKU-${i}`),
    avgUnits: asNumber(r.avgUnits),
    normUnits: asNumber(r.normUnits),
    expectedUnits: asNumber(r.expectedUnits),
    safetyStock: asNumber(r.safetyStock),
    updatedAt: stamp(r.updatedAt, now),
  }));

  const turnover: TurnoverRow[] = sheetToObjects(wb, ["Turnover"]).map((r, i) => ({
    id: asString(r.id, `trn-${i}`),
    period: asString(r.period, asString(r.date, now.slice(0, 10))),
    industry: asString(r.industry, "retail") as IndustryId,
    department: asString(r.department, "supply") as DepartmentId,
    inventoryStart: asNumber(r.inventoryStart),
    inventoryEnd: asNumber(r.inventoryEnd),
    cogs: asNumber(r.cogs),
    currency: ccy(r.currency),
    updatedAt: stamp(r.updatedAt, now),
  }));

  if (!revenue.length && !sales.length && !expenses.length) {
    issues.push({
      sheet: "Workbook",
      row: 0,
      message: "No Revenue, Sales, or Expenses rows found. Check sheet names match the template.",
    });
  }

  return {
    workbook: {
      meta,
      fx,
      departments,
      revenue,
      expenses,
      assets,
      licenses,
      upcoming,
      sales,
      forecast,
      demand,
      turnover,
    },
    issues,
  };
}

function aoa(headers: string[], rows: Array<Record<string, unknown>>): XLSX.WorkSheet {
  const data = [headers, ...rows.map((r) => headers.map((h) => r[h] ?? ""))];
  return XLSX.utils.aoa_to_sheet(data);
}

export function workbookToXlsx(data: Workbook, converted?: { currency: string; rates: Map<string, number> }): ArrayBuffer {
  const book = XLSX.utils.book_new();
  const conv = converted
    ? (amount: number, from: string) => {
        const fromUsd = converted.rates.get(from) ?? 1;
        const toUsd = converted.rates.get(converted.currency) ?? 1;
        return toUsd ? (amount * fromUsd) / toUsd : amount;
      }
    : (amount: number) => amount;
  const ccyCol = converted?.currency;

  const instructions = [
    ["Meridian Excel contract"],
    ["Fill these sheets, keep column headers, keep unique id values."],
    ["Re-upload to merge: only new or changed ids are patched. Unchanged history is left alone."],
    ["Amounts may be in any ISO currency listed on FX. Dashboards convert live."],
    ["Required sheets: Meta, FX, Revenue or Sales, Expenses. Others optional."],
    ["Dates: YYYY-MM-DD. Booleans: true/false. cycle: monthly|annual."],
    ["method on Forecast: norm | average | blend (0.55 trailing average + 0.45 seasonal norm)."],
  ];
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(instructions), "Instructions");

  XLSX.utils.book_append_sheet(
    book,
    aoa(
      ["id", "company", "industry", "fiscalYearStart", "baseCurrency", "timezone", "updatedAt"],
      data.meta as unknown as Array<Record<string, unknown>>,
    ),
    "Meta",
  );
  XLSX.utils.book_append_sheet(
    book,
    aoa(
      ["id", "currency", "rateToUsd", "asOf", "updatedAt"],
      data.fx as unknown as Array<Record<string, unknown>>,
    ),
    "FX",
  );
  XLSX.utils.book_append_sheet(
    book,
    aoa(
      ["id", "name", "industry", "department", "owner", "costCenter", "updatedAt"],
      data.departments as unknown as Array<Record<string, unknown>>,
    ),
    "Departments",
  );

  const moneyHeaders = (extra: string[]) =>
    converted
      ? [...extra, "amount", "currency", "amountConverted", "displayCurrency", "updatedAt"]
      : [...extra, "amount", "currency", "updatedAt"];

  const withMoney = (
    rows: Array<{ amount: number; currency: string; updatedAt: string } & Record<string, unknown>>,
    extraKeys: string[],
  ) =>
    rows.map((r) => ({
      ...r,
      amountConverted: converted ? Math.round(conv(r.amount, r.currency) * 100) / 100 : undefined,
      displayCurrency: ccyCol,
    }));

  XLSX.utils.book_append_sheet(
    book,
    aoa(
      moneyHeaders(["id", "date", "industry", "department", "product", "channel", "region"]),
      withMoney(data.revenue, []),
    ),
    "Revenue",
  );
  XLSX.utils.book_append_sheet(
    book,
    aoa(
      moneyHeaders(["id", "date", "industry", "department", "category", "vendor", "recurring"]),
      withMoney(data.expenses, []),
    ),
    "Expenses",
  );
  XLSX.utils.book_append_sheet(
    book,
    aoa(
      [
        "id",
        "name",
        "industry",
        "department",
        "category",
        "acquired",
        "cost",
        "bookValue",
        "currency",
        "status",
        "updatedAt",
      ],
      data.assets as unknown as Array<Record<string, unknown>>,
    ),
    "Assets",
  );
  XLSX.utils.book_append_sheet(
    book,
    aoa(
      [
        "id",
        "name",
        "vendor",
        "industry",
        "department",
        "seats",
        "unitCost",
        "currency",
        "start",
        "end",
        "cycle",
        "updatedAt",
      ],
      data.licenses as unknown as Array<Record<string, unknown>>,
    ),
    "Licenses",
  );
  XLSX.utils.book_append_sheet(
    book,
    aoa(
      moneyHeaders(["id", "dueDate", "industry", "department", "description", "type", "status"]),
      withMoney(data.upcoming, []),
    ),
    "Upcoming",
  );
  XLSX.utils.book_append_sheet(
    book,
    aoa(
      [
        "id",
        "date",
        "industry",
        "department",
        "sku",
        "product",
        "units",
        "unitPrice",
        "currency",
        "region",
        "channel",
        "updatedAt",
      ],
      data.sales as unknown as Array<Record<string, unknown>>,
    ),
    "Sales",
  );
  XLSX.utils.book_append_sheet(
    book,
    aoa(
      [
        "id",
        "period",
        "industry",
        "department",
        "sku",
        "expectedUnits",
        "expectedAmount",
        "currency",
        "method",
        "updatedAt",
      ],
      data.forecast as unknown as Array<Record<string, unknown>>,
    ),
    "Forecast",
  );
  XLSX.utils.book_append_sheet(
    book,
    aoa(
      [
        "id",
        "period",
        "industry",
        "sku",
        "avgUnits",
        "normUnits",
        "expectedUnits",
        "safetyStock",
        "updatedAt",
      ],
      data.demand as unknown as Array<Record<string, unknown>>,
    ),
    "Demand",
  );
  XLSX.utils.book_append_sheet(
    book,
    aoa(
      [
        "id",
        "period",
        "industry",
        "department",
        "inventoryStart",
        "inventoryEnd",
        "cogs",
        "currency",
        "updatedAt",
      ],
      data.turnover as unknown as Array<Record<string, unknown>>,
    ),
    "Turnover",
  );

  return XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

export function blankTemplateWorkbook(): Workbook {
  const sample = generateSampleWorkbook();
  const take = <T>(rows: T[], n: number) => rows.slice(0, n);
  return {
    meta: sample.meta,
    fx: sample.fx,
    departments: take(sample.departments, 12),
    revenue: take(sample.revenue, 8),
    expenses: take(sample.expenses, 8),
    assets: take(sample.assets, 6),
    licenses: take(sample.licenses, 6),
    upcoming: take(sample.upcoming, 6),
    sales: take(sample.sales, 8),
    forecast: take(sample.forecast, 8),
    demand: take(sample.demand, 8),
    turnover: take(sample.turnover, 6),
  };
}

export function downloadArrayBuffer(buf: ArrayBuffer, filename: string) {
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
