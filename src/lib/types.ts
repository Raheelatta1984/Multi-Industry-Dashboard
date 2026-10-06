import type { ChannelId, CurrencyCode, DepartmentId, IndustryId, RegionId } from "./domain";

export type SheetKey =
  | "meta"
  | "fx"
  | "departments"
  | "revenue"
  | "expenses"
  | "assets"
  | "licenses"
  | "upcoming"
  | "sales"
  | "forecast"
  | "demand"
  | "turnover";

export type MetaRow = {
  id: string;
  company: string;
  industry: string;
  fiscalYearStart: string;
  baseCurrency: CurrencyCode;
  timezone: string;
  updatedAt: string;
};

export type FxRow = {
  id: string;
  currency: CurrencyCode;
  rateToUsd: number;
  asOf: string;
  updatedAt: string;
};

export type DepartmentRow = {
  id: string;
  name: string;
  industry: IndustryId;
  department: DepartmentId;
  owner: string;
  costCenter: string;
  updatedAt: string;
};

export type RevenueRow = {
  id: string;
  date: string;
  industry: IndustryId;
  department: DepartmentId;
  product: string;
  channel: ChannelId;
  region: RegionId;
  amount: number;
  currency: CurrencyCode;
  updatedAt: string;
};

export type ExpenseRow = {
  id: string;
  date: string;
  industry: IndustryId;
  department: DepartmentId;
  category: string;
  vendor: string;
  amount: number;
  currency: CurrencyCode;
  recurring: boolean;
  updatedAt: string;
};

export type AssetRow = {
  id: string;
  name: string;
  industry: IndustryId;
  department: DepartmentId;
  category: string;
  acquired: string;
  cost: number;
  bookValue: number;
  currency: CurrencyCode;
  status: "active" | "idle" | "disposed";
  updatedAt: string;
};

export type LicenseRow = {
  id: string;
  name: string;
  vendor: string;
  industry: IndustryId;
  department: DepartmentId;
  seats: number;
  unitCost: number;
  currency: CurrencyCode;
  start: string;
  end: string;
  cycle: "monthly" | "annual";
  updatedAt: string;
};

export type UpcomingRow = {
  id: string;
  dueDate: string;
  industry: IndustryId;
  department: DepartmentId;
  description: string;
  amount: number;
  currency: CurrencyCode;
  type: "opex" | "capex" | "license" | "payroll" | "tax";
  status: "scheduled" | "committed" | "paid";
  updatedAt: string;
};

export type SalesRow = {
  id: string;
  date: string;
  industry: IndustryId;
  department: DepartmentId;
  sku: string;
  product: string;
  units: number;
  unitPrice: number;
  currency: CurrencyCode;
  region: RegionId;
  channel: ChannelId;
  updatedAt: string;
};

export type ForecastRow = {
  id: string;
  period: string;
  industry: IndustryId;
  department: DepartmentId;
  sku: string;
  expectedUnits: number;
  expectedAmount: number;
  currency: CurrencyCode;
  method: "norm" | "average" | "blend";
  updatedAt: string;
};

export type DemandRow = {
  id: string;
  period: string;
  industry: IndustryId;
  sku: string;
  avgUnits: number;
  normUnits: number;
  expectedUnits: number;
  safetyStock: number;
  updatedAt: string;
};

export type TurnoverRow = {
  id: string;
  period: string;
  industry: IndustryId;
  department: DepartmentId;
  inventoryStart: number;
  inventoryEnd: number;
  cogs: number;
  currency: CurrencyCode;
  updatedAt: string;
};

export type Workbook = {
  meta: MetaRow[];
  fx: FxRow[];
  departments: DepartmentRow[];
  revenue: RevenueRow[];
  expenses: ExpenseRow[];
  assets: AssetRow[];
  licenses: LicenseRow[];
  upcoming: UpcomingRow[];
  sales: SalesRow[];
  forecast: ForecastRow[];
  demand: DemandRow[];
  turnover: TurnoverRow[];
};

export type PatchOp = {
  sheet: SheetKey;
  op: "add" | "update" | "remove";
  id: string;
  at: number;
  fields?: string[];
};

export type TickReport = {
  at: number;
  added: number;
  updated: number;
  removed: number;
  skipped: number;
  ops: PatchOp[];
  latencyMs: number;
  sheetsTouched: SheetKey[];
};

export type DataSource = "sample" | "upload";

export const DATA_SHEETS: SheetKey[] = [
  "meta",
  "fx",
  "departments",
  "revenue",
  "expenses",
  "assets",
  "licenses",
  "upcoming",
  "sales",
  "forecast",
  "demand",
  "turnover",
];

export type ParseIssue = {
  sheet: string;
  row: number;
  message: string;
};

export type WidgetKind =
  | "kpi"
  | "area"
  | "bar"
  | "stack"
  | "donut"
  | "table"
  | "forecast"
  | "demand"
  | "upcoming"
  | "licenses"
  | "assets"
  | "fx"
  | "heatmap"
  | "activity";

export type WidgetMetric =
  | "revenue"
  | "opex"
  | "contribution"
  | "margin"
  | "assets"
  | "licenses"
  | "upcoming"
  | "forecast"
  | "demand"
  | "turnover"
  | "units"
  | "asp"
  | "seats"
  | "expiring"
  | "fxExposure"
  | "bookValue"
  | "yoy"
  | "accuracy";

export type WidgetDef = {
  id: string;
  kind: WidgetKind;
  title: string;
  metric?: WidgetMetric;
  span: 4 | 5 | 6 | 7 | 8 | 12;
  height?: "sm" | "md" | "lg";
};

export type DashboardDef = {
  id: string;
  title: string;
  eyebrow: string;
  description: string;
  industry: IndustryId | "all";
  department: DepartmentId | "group";
  widgets: WidgetDef[];
};

export type Slice = {
  industry?: IndustryId | "all";
  department?: DepartmentId | "group";
};
