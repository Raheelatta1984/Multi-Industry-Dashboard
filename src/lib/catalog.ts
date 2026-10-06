import { DEPARTMENTS, INDUSTRIES, type DepartmentId, type IndustryId } from "./domain";
import type { DashboardDef, WidgetDef } from "./types";

function layoutFor(dept: DepartmentId | "group"): WidgetDef[] {
  switch (dept) {
    case "executive":
      return [
        { id: "k-rev", kind: "kpi", title: "Revenue", metric: "revenue", span: 4 },
        { id: "k-opex", kind: "kpi", title: "Expenditure", metric: "opex", span: 4 },
        { id: "k-margin", kind: "kpi", title: "Contribution margin", metric: "margin", span: 4 },
        { id: "k-fc", kind: "kpi", title: "Expected sales", metric: "forecast", span: 4 },
        { id: "k-up", kind: "kpi", title: "Upcoming 90d", metric: "upcoming", span: 4 },
        { id: "k-lic", kind: "kpi", title: "License run-rate", metric: "licenses", span: 4 },
        { id: "c-trend", kind: "area", title: "Revenue vs expenditure", metric: "revenue", span: 8, height: "lg" },
        { id: "c-bar", kind: "bar", title: "Revenue by region", metric: "revenue", span: 4, height: "lg" },
        { id: "t-up", kind: "upcoming", title: "Commitments due", metric: "upcoming", span: 6, height: "md" },
        { id: "t-act", kind: "activity", title: "Incremental feed", span: 6, height: "md" },
      ];
    case "finance":
      return [
        { id: "k-opex", kind: "kpi", title: "YTD expenditure", metric: "opex", span: 4 },
        { id: "k-rev", kind: "kpi", title: "YTD revenue", metric: "revenue", span: 4 },
        { id: "k-cont", kind: "kpi", title: "Contribution", metric: "contribution", span: 4 },
        { id: "k-up", kind: "kpi", title: "Upcoming expenses", metric: "upcoming", span: 4 },
        { id: "k-ast", kind: "kpi", title: "Asset book", metric: "assets", span: 4 },
        { id: "k-lic", kind: "kpi", title: "License cost", metric: "licenses", span: 4 },
        { id: "c-stack", kind: "stack", title: "Spend mix by category", metric: "opex", span: 8, height: "lg" },
        { id: "c-donut", kind: "donut", title: "Department share", metric: "opex", span: 4, height: "lg" },
        { id: "t-up", kind: "upcoming", title: "Expenditure calendar", metric: "upcoming", span: 12, height: "md" },
      ];
    case "sales":
      return [
        { id: "k-rev", kind: "kpi", title: "Revenue", metric: "revenue", span: 4 },
        { id: "k-units", kind: "kpi", title: "Units", metric: "units", span: 4 },
        { id: "k-asp", kind: "kpi", title: "Average price", metric: "asp", span: 4 },
        { id: "k-fc", kind: "kpi", title: "Expected future sales", metric: "forecast", span: 4 },
        { id: "k-acc", kind: "kpi", title: "Forecast accuracy", metric: "accuracy", span: 4 },
        { id: "k-yoy", kind: "kpi", title: "Run-rate vs prior", metric: "yoy", span: 4 },
        { id: "c-area", kind: "area", title: "Trading trend", metric: "revenue", span: 8, height: "lg" },
        { id: "c-donut", kind: "donut", title: "Channel mix", metric: "revenue", span: 4, height: "lg" },
        { id: "c-fc", kind: "forecast", title: "Actual vs expected vs norm", metric: "forecast", span: 12, height: "lg" },
      ];
    case "marketing":
      return [
        { id: "k-opex", kind: "kpi", title: "Growth spend", metric: "opex", span: 4 },
        { id: "k-rev", kind: "kpi", title: "Attributed revenue", metric: "revenue", span: 4 },
        { id: "k-up", kind: "kpi", title: "Booked campaigns", metric: "upcoming", span: 4 },
        { id: "k-margin", kind: "kpi", title: "Efficiency", metric: "margin", span: 4 },
        { id: "c-area", kind: "area", title: "Spend against revenue", metric: "opex", span: 8, height: "lg" },
        { id: "c-bar", kind: "bar", title: "Channel contribution", metric: "revenue", span: 4, height: "lg" },
        { id: "c-stack", kind: "stack", title: "Category spend", metric: "opex", span: 12, height: "md" },
      ];
    case "operations":
      return [
        { id: "k-trn", kind: "kpi", title: "Inventory turnover", metric: "turnover", span: 4 },
        { id: "k-dem", kind: "kpi", title: "Expected demand", metric: "demand", span: 4 },
        { id: "k-opex", kind: "kpi", title: "Run cost", metric: "opex", span: 4 },
        { id: "k-rev", kind: "kpi", title: "Throughput value", metric: "revenue", span: 4 },
        { id: "c-area", kind: "area", title: "Turnover and COGS", metric: "turnover", span: 8, height: "lg" },
        { id: "c-bar", kind: "bar", title: "Region throughput", metric: "revenue", span: 4, height: "lg" },
        { id: "c-dem", kind: "demand", title: "Demand vs average vs norm", metric: "demand", span: 12, height: "lg" },
      ];
    case "procurement":
      return [
        { id: "k-opex", kind: "kpi", title: "Vendor spend", metric: "opex", span: 4 },
        { id: "k-up", kind: "kpi", title: "Open commitments", metric: "upcoming", span: 4 },
        { id: "k-lic", kind: "kpi", title: "Contracted licenses", metric: "licenses", span: 4 },
        { id: "k-ast", kind: "kpi", title: "Capital purchases", metric: "assets", span: 4 },
        { id: "c-stack", kind: "stack", title: "Spend by category", metric: "opex", span: 8, height: "lg" },
        { id: "c-donut", kind: "donut", title: "Vendor concentration", metric: "opex", span: 4, height: "lg" },
        { id: "t-up", kind: "upcoming", title: "Purchase calendar", metric: "upcoming", span: 12, height: "md" },
      ];
    case "assets":
      return [
        { id: "k-book", kind: "kpi", title: "Book value", metric: "bookValue", span: 4 },
        { id: "k-ast", kind: "kpi", title: "Gross cost", metric: "assets", span: 4 },
        { id: "k-opex", kind: "kpi", title: "Holding cost", metric: "opex", span: 4 },
        { id: "k-up", kind: "kpi", title: "Capex upcoming", metric: "upcoming", span: 4 },
        { id: "c-donut", kind: "donut", title: "Category mix", metric: "assets", span: 4, height: "lg" },
        { id: "c-bar", kind: "bar", title: "Book value by industry slice", metric: "assets", span: 8, height: "lg" },
        { id: "t-ast", kind: "assets", title: "Asset register", metric: "assets", span: 12, height: "lg" },
      ];
    case "licenses":
      return [
        { id: "k-lic", kind: "kpi", title: "Annualized license cost", metric: "licenses", span: 4 },
        { id: "k-seats", kind: "kpi", title: "Seats", metric: "seats", span: 4 },
        { id: "k-exp", kind: "kpi", title: "Expiring 90d", metric: "expiring", span: 4 },
        { id: "k-up", kind: "kpi", title: "Renewal cash", metric: "upcoming", span: 4 },
        { id: "c-bar", kind: "bar", title: "Cost by vendor", metric: "licenses", span: 8, height: "lg" },
        { id: "c-donut", kind: "donut", title: "Cycle mix", metric: "licenses", span: 4, height: "lg" },
        { id: "t-lic", kind: "licenses", title: "License book", metric: "licenses", span: 12, height: "lg" },
      ];
    case "treasury":
      return [
        { id: "k-fx", kind: "kpi", title: "FX exposure", metric: "fxExposure", span: 4 },
        { id: "k-rev", kind: "kpi", title: "Converted revenue", metric: "revenue", span: 4 },
        { id: "k-opex", kind: "kpi", title: "Converted opex", metric: "opex", span: 4 },
        { id: "k-up", kind: "kpi", title: "Settlements due", metric: "upcoming", span: 4 },
        { id: "c-fx", kind: "fx", title: "Rates and conversion", metric: "fxExposure", span: 6, height: "lg" },
        { id: "c-bar", kind: "bar", title: "Exposure by currency", metric: "fxExposure", span: 6, height: "lg" },
        { id: "c-area", kind: "area", title: "Converted P&L", metric: "revenue", span: 12, height: "md" },
      ];
    case "supply":
      return [
        { id: "k-dem", kind: "kpi", title: "Expected demand", metric: "demand", span: 4 },
        { id: "k-fc", kind: "kpi", title: "Expected sales", metric: "forecast", span: 4 },
        { id: "k-trn", kind: "kpi", title: "Turnover", metric: "turnover", span: 4 },
        { id: "k-units", kind: "kpi", title: "Units moved", metric: "units", span: 4 },
        { id: "c-dem", kind: "demand", title: "Norms vs average vs expected", metric: "demand", span: 8, height: "lg" },
        { id: "c-bar", kind: "bar", title: "Safety stock by SKU", metric: "demand", span: 4, height: "lg" },
        { id: "c-fc", kind: "forecast", title: "Forward sales", metric: "forecast", span: 12, height: "md" },
      ];
    case "hrcost":
      return [
        { id: "k-opex", kind: "kpi", title: "People cost", metric: "opex", span: 4 },
        { id: "k-up", kind: "kpi", title: "Payroll upcoming", metric: "upcoming", span: 4 },
        { id: "k-lic", kind: "kpi", title: "HR systems", metric: "licenses", span: 4 },
        { id: "k-yoy", kind: "kpi", title: "Cost trajectory", metric: "yoy", span: 4 },
        { id: "c-stack", kind: "stack", title: "Cost composition", metric: "opex", span: 8, height: "lg" },
        { id: "c-area", kind: "area", title: "Monthly people spend", metric: "opex", span: 4, height: "lg" },
        { id: "t-up", kind: "upcoming", title: "Payroll and benefits calendar", metric: "upcoming", span: 12, height: "md" },
      ];
    case "floor":
      return [
        { id: "k-rev", kind: "kpi", title: "Frontline revenue", metric: "revenue", span: 4 },
        { id: "k-units", kind: "kpi", title: "Units", metric: "units", span: 4 },
        { id: "k-asp", kind: "kpi", title: "Average ticket", metric: "asp", span: 4 },
        { id: "k-fc", kind: "kpi", title: "Expected take", metric: "forecast", span: 4 },
        { id: "c-area", kind: "area", title: "Trading pulse", metric: "revenue", span: 8, height: "lg" },
        { id: "c-bar", kind: "bar", title: "Region mix", metric: "revenue", span: 4, height: "lg" },
        { id: "c-donut", kind: "donut", title: "Channel", metric: "revenue", span: 4, height: "md" },
        { id: "c-fc", kind: "forecast", title: "Demand-led forecast", metric: "forecast", span: 8, height: "md" },
      ];
    case "group":
      return [
        { id: "k-rev", kind: "kpi", title: "Group revenue", metric: "revenue", span: 4 },
        { id: "k-opex", kind: "kpi", title: "Group expenditure", metric: "opex", span: 4 },
        { id: "k-margin", kind: "kpi", title: "Margin", metric: "margin", span: 4 },
        { id: "k-fc", kind: "kpi", title: "Expected sales", metric: "forecast", span: 4 },
        { id: "k-dem", kind: "kpi", title: "Expected demand", metric: "demand", span: 4 },
        { id: "k-up", kind: "kpi", title: "Upcoming", metric: "upcoming", span: 4 },
        { id: "c-heat", kind: "heatmap", title: "Department map", span: 12, height: "lg" },
        { id: "c-area", kind: "area", title: "Consolidated trend", metric: "revenue", span: 8, height: "md" },
        { id: "t-act", kind: "activity", title: "Live patches", span: 4, height: "md" },
      ];
  }
}

const GROUP_BOARDS: Array<Omit<DashboardDef, "widgets">> = [
  {
    id: "group-command",
    title: "Group Command",
    eyebrow: "Apex Meridian",
    description: "Live holding-company pulse across every industry and department.",
    industry: "all",
    department: "group",
  },
  {
    id: "group-revenue",
    title: "Group Revenue",
    eyebrow: "Turnover",
    description: "Consolidated revenue, units, and average selling price.",
    industry: "all",
    department: "group",
  },
  {
    id: "group-expenditure",
    title: "Group Expenditure",
    eyebrow: "Cost",
    description: "Operating spend, vendors, and upcoming cash.",
    industry: "all",
    department: "group",
  },
  {
    id: "group-assets",
    title: "Group Assets",
    eyebrow: "Register",
    description: "Book value, gross cost, and idle assets across divisions.",
    industry: "all",
    department: "group",
  },
  {
    id: "group-licenses",
    title: "Group License Cost",
    eyebrow: "SaaS",
    description: "Annualized software cost, seats, and renewals.",
    industry: "all",
    department: "group",
  },
  {
    id: "group-upcoming",
    title: "Upcoming Expenses",
    eyebrow: "90-day cash",
    description: "Committed and scheduled outflows by type and department.",
    industry: "all",
    department: "group",
  },
  {
    id: "group-forecast",
    title: "Expected Future Sales",
    eyebrow: "Forward",
    description: "Blend of seasonal norms and trailing average sales.",
    industry: "all",
    department: "group",
  },
  {
    id: "group-demand",
    title: "Expected Demand",
    eyebrow: "Planning",
    description: "Demand vs norms vs average, with safety stock.",
    industry: "all",
    department: "group",
  },
  {
    id: "group-turnover",
    title: "Inventory Turnover",
    eyebrow: "Working capital",
    description: "COGS against average inventory by industry.",
    industry: "all",
    department: "group",
  },
  {
    id: "group-fx",
    title: "Multi-currency Conversion",
    eyebrow: "Treasury",
    description: "FX rates, exposure, and converted ledgers.",
    industry: "all",
    department: "group",
  },
];

const GROUP_LAYOUT: Record<string, DepartmentId | "group"> = {
  "group-command": "group",
  "group-revenue": "sales",
  "group-expenditure": "finance",
  "group-assets": "assets",
  "group-licenses": "licenses",
  "group-upcoming": "finance",
  "group-forecast": "sales",
  "group-demand": "supply",
  "group-turnover": "operations",
  "group-fx": "treasury",
};

function industryBoards(): DashboardDef[] {
  const boards: DashboardDef[] = [];
  for (const ind of INDUSTRIES) {
    for (const dept of DEPARTMENTS) {
      boards.push({
        id: `${ind.id}-${dept.id}`,
        title: `${ind.label} ${dept.board}`,
        eyebrow: ind.division,
        description: `${dept.label} view for ${ind.division}, sliced from the live workbook.`,
        industry: ind.id,
        department: dept.id,
        widgets: layoutFor(dept.id),
      });
    }
  }
  return boards;
}

export const DASHBOARDS: DashboardDef[] = [
  ...GROUP_BOARDS.map((b) => ({
    ...b,
    widgets: layoutFor(GROUP_LAYOUT[b.id] ?? "group"),
  })),
  ...industryBoards(),
];

export const DASHBOARD_COUNT = DASHBOARDS.length;

export function dashboardById(id: string): DashboardDef | undefined {
  return DASHBOARDS.find((d) => d.id === id);
}

export function dashboardsForIndustry(industry: IndustryId | "all"): DashboardDef[] {
  if (industry === "all") return DASHBOARDS;
  return DASHBOARDS.filter((d) => d.industry === industry || d.industry === "all");
}

export function searchDashboards(q: string): DashboardDef[] {
  const s = q.trim().toLowerCase();
  if (!s) return DASHBOARDS;
  return DASHBOARDS.filter((d) =>
    `${d.title} ${d.eyebrow} ${d.description} ${d.industry} ${d.department}`.toLowerCase().includes(s),
  );
}
