import { convertAmount, fxMap } from "./currency";
import type { CurrencyCode, DepartmentId, IndustryId } from "./domain";
import type { DashboardDef, Slice, Workbook } from "./types";

export type Kpi = {
  key: string;
  label: string;
  value: number;
  delta: number;
  spark: number[];
  format: "money" | "pct" | "number" | "x";
};

function inSlice<T extends { industry?: string; department?: string }>(row: T, slice: Slice): boolean {
  if (slice.industry && slice.industry !== "all" && row.industry && row.industry !== slice.industry) return false;
  if (slice.department && slice.department !== "group" && row.department && row.department !== slice.department) {
    return false;
  }
  return true;
}

function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

const YTD_START = "2026-01-01";
const PREV_YTD_START = "2025-01-01";
const PREV_YTD_END = "2025-08-31";
const YTD_END = "2026-08-31";

export function sliceFromBoard(board: DashboardDef): Slice {
  return { industry: board.industry, department: board.department };
}

export function buildFx(wb: Workbook) {
  return fxMap(wb.fx);
}

export function toDisplay(amount: number, from: string, display: string, rates: Map<string, number>) {
  return convertAmount(amount, from, display, rates);
}

export function revenueSeries(wb: Workbook, slice: Slice, display: CurrencyCode, rates: Map<string, number>) {
  const map = new Map<string, number>();
  for (const row of wb.revenue) {
    if (!inSlice(row, slice)) continue;
    const k = monthKey(row.date);
    map.set(k, (map.get(k) ?? 0) + toDisplay(row.amount, row.currency, display, rates));
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([period, value]) => ({ period, value }));
}

export function opexSeries(wb: Workbook, slice: Slice, display: CurrencyCode, rates: Map<string, number>) {
  const map = new Map<string, number>();
  for (const row of wb.expenses) {
    if (!inSlice(row, slice)) continue;
    const k = monthKey(row.date);
    map.set(k, (map.get(k) ?? 0) + toDisplay(row.amount, row.currency, display, rates));
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([period, value]) => ({ period, value }));
}

function sumRange(
  rows: Array<{ date?: string; period?: string; amount?: number; currency: string; industry?: string; department?: string }>,
  slice: Slice,
  display: CurrencyCode,
  rates: Map<string, number>,
  start: string,
  end: string,
  amountFn: (r: (typeof rows)[number]) => number = (r) => r.amount ?? 0,
) {
  let s = 0;
  for (const row of rows) {
    if (!inSlice(row, slice)) continue;
    const d = row.date ?? row.period ?? "";
    if (d < start || d > end) continue;
    s += toDisplay(amountFn(row), row.currency, display, rates);
  }
  return s;
}

export function kpisFor(wb: Workbook, slice: Slice, display: CurrencyCode, rates: Map<string, number>): Record<string, Kpi> {
  const revYtd = sumRange(wb.revenue, slice, display, rates, YTD_START, YTD_END);
  const revPrev = sumRange(wb.revenue, slice, display, rates, PREV_YTD_START, PREV_YTD_END);
  const opexYtd = sumRange(wb.expenses, slice, display, rates, YTD_START, YTD_END);
  const opexPrev = sumRange(wb.expenses, slice, display, rates, PREV_YTD_START, PREV_YTD_END);
  const contribution = revYtd - opexYtd;
  const margin = revYtd ? contribution / revYtd : 0;
  const prevMargin = revPrev ? (revPrev - opexPrev) / revPrev : 0;

  const revSpark = revenueSeries(wb, slice, display, rates).map((d) => d.value);
  const opexSpark = opexSeries(wb, slice, display, rates).map((d) => d.value);

  let book = 0;
  let gross = 0;
  for (const a of wb.assets) {
    if (!inSlice(a, slice)) continue;
    if (a.status === "disposed") continue;
    book += toDisplay(a.bookValue, a.currency, display, rates);
    gross += toDisplay(a.cost, a.currency, display, rates);
  }

  let license = 0;
  let seats = 0;
  let expiring = 0;
  for (const l of wb.licenses) {
    if (!inSlice(l, slice)) continue;
    const annual = l.cycle === "monthly" ? l.unitCost * l.seats * 12 : l.unitCost * l.seats;
    license += toDisplay(annual, l.currency, display, rates);
    seats += l.seats;
    if (l.end >= "2026-08-31" && l.end <= "2026-11-30") expiring += 1;
  }

  let upcoming = 0;
  for (const u of wb.upcoming) {
    if (!inSlice(u, slice)) continue;
    if (u.status === "paid") continue;
    if (u.dueDate > "2026-11-30") continue;
    upcoming += toDisplay(u.amount, u.currency, display, rates);
  }

  let forecast = 0;
  for (const f of wb.forecast) {
    if (!inSlice(f, slice)) continue;
    if (f.period > "2026-11-30") continue;
    forecast += toDisplay(f.expectedAmount, f.currency, display, rates);
  }

  let demandAmt = 0;
  let demandUnits = 0;
  let normUnits = 0;
  for (const d of wb.demand) {
    if (slice.industry && slice.industry !== "all" && d.industry !== slice.industry) continue;
    if (d.period > "2026-11-30") continue;
    demandUnits += d.expectedUnits;
    normUnits += d.normUnits;
    const sale = wb.sales.find((s) => s.sku === d.sku && s.industry === d.industry);
    const px = sale?.unitPrice ?? 0;
    const ccy = sale?.currency ?? display;
    demandAmt += toDisplay(d.expectedUnits * px, ccy, display, rates);
  }

  let units = 0;
  let salesValue = 0;
  for (const s of wb.sales) {
    if (!inSlice(s, slice)) continue;
    if (s.date < YTD_START || s.date > YTD_END) continue;
    units += s.units;
    salesValue += toDisplay(s.units * s.unitPrice, s.currency, display, rates);
  }
  const asp = units ? salesValue / units : 0;

  let cogs = 0;
  let inv = 0;
  let tCount = 0;
  for (const t of wb.turnover) {
    if (!inSlice(t, slice)) continue;
    if (t.period < YTD_START) continue;
    cogs += toDisplay(t.cogs, t.currency, display, rates);
    inv += toDisplay((t.inventoryStart + t.inventoryEnd) / 2, t.currency, display, rates);
    tCount += 1;
  }
  const turnover = inv ? cogs / (inv / Math.max(1, tCount)) : 0;

  let exposure = 0;
  const byCcy = new Map<string, number>();
  for (const r of wb.revenue) {
    if (!inSlice(r, slice)) continue;
    if (r.date < YTD_START) continue;
    if (r.currency === display) continue;
    const v = toDisplay(r.amount, r.currency, display, rates);
    exposure += v;
    byCcy.set(r.currency, (byCcy.get(r.currency) ?? 0) + v);
  }

  const lastRev = revSpark[revSpark.length - 1] ?? 0;
  const prevRev = revSpark[revSpark.length - 2] ?? lastRev;
  const lastOpex = opexSpark[opexSpark.length - 1] ?? 0;
  const prevOpex = opexSpark[opexSpark.length - 2] ?? lastOpex;

  const actualLast = lastRev;
  const fcMonth = wb.forecast
    .filter((f) => inSlice(f, slice) && f.period.startsWith("2026-08"))
    .reduce((s, f) => s + toDisplay(f.expectedAmount, f.currency, display, rates), 0);
  const accuracy = fcMonth ? 1 - Math.min(1, Math.abs(actualLast - fcMonth) / fcMonth) : 0.92;

  return {
    revenue: {
      key: "revenue",
      label: "Revenue YTD",
      value: revYtd,
      delta: revPrev ? (revYtd - revPrev) / revPrev : lastRev && prevRev ? (lastRev - prevRev) / prevRev : 0,
      spark: revSpark,
      format: "money",
    },
    opex: {
      key: "opex",
      label: "Expenditure YTD",
      value: opexYtd,
      delta: opexPrev ? (opexYtd - opexPrev) / opexPrev : lastOpex && prevOpex ? (lastOpex - prevOpex) / prevOpex : 0,
      spark: opexSpark,
      format: "money",
    },
    contribution: {
      key: "contribution",
      label: "Contribution",
      value: contribution,
      delta: margin - prevMargin,
      spark: revSpark.map((v, i) => v - (opexSpark[i] ?? 0)),
      format: "money",
    },
    margin: {
      key: "margin",
      label: "Margin",
      value: margin,
      delta: margin - prevMargin,
      spark: revSpark.map((v, i) => (v ? (v - (opexSpark[i] ?? 0)) / v : 0)),
      format: "pct",
    },
    assets: {
      key: "assets",
      label: "Gross assets",
      value: gross,
      delta: gross ? (book - gross) / gross : 0,
      spark: [gross * 0.7, gross * 0.78, gross * 0.86, book],
      format: "money",
    },
    bookValue: {
      key: "bookValue",
      label: "Book value",
      value: book,
      delta: gross ? (book - gross) / gross : 0,
      spark: [book * 0.92, book * 0.95, book * 0.98, book],
      format: "money",
    },
    licenses: {
      key: "licenses",
      label: "License run-rate",
      value: license,
      delta: 0.03,
      spark: [license * 0.9, license * 0.94, license * 0.98, license],
      format: "money",
    },
    seats: {
      key: "seats",
      label: "Seats",
      value: seats,
      delta: 0.02,
      spark: [seats * 0.9, seats * 0.94, seats * 0.97, seats],
      format: "number",
    },
    expiring: {
      key: "expiring",
      label: "Expiring 90d",
      value: expiring,
      delta: 0,
      spark: [expiring],
      format: "number",
    },
    upcoming: {
      key: "upcoming",
      label: "Upcoming 90d",
      value: upcoming,
      delta: 0.04,
      spark: [upcoming * 0.7, upcoming * 0.85, upcoming],
      format: "money",
    },
    forecast: {
      key: "forecast",
      label: "Expected sales 90d",
      value: forecast,
      delta: revYtd ? forecast / (revYtd / 8) - 1 : 0,
      spark: [forecast * 0.9, forecast * 0.96, forecast],
      format: "money",
    },
    demand: {
      key: "demand",
      label: "Expected demand",
      value: demandAmt,
      delta: normUnits ? demandUnits / normUnits - 1 : 0,
      spark: [demandAmt * 0.88, demandAmt * 0.94, demandAmt],
      format: "money",
    },
    turnover: {
      key: "turnover",
      label: "Turnover",
      value: turnover,
      delta: 0.05,
      spark: [turnover * 0.9, turnover * 0.95, turnover],
      format: "x",
    },
    units: {
      key: "units",
      label: "Units YTD",
      value: units,
      delta: 0.06,
      spark: revSpark,
      format: "number",
    },
    asp: {
      key: "asp",
      label: "Average price",
      value: asp,
      delta: 0.01,
      spark: [asp * 0.97, asp * 0.99, asp],
      format: "money",
    },
    yoy: {
      key: "yoy",
      label: "vs prior period",
      value: revPrev ? (revYtd - revPrev) / revPrev : 0,
      delta: 0,
      spark: revSpark,
      format: "pct",
    },
    accuracy: {
      key: "accuracy",
      label: "Forecast accuracy",
      value: accuracy,
      delta: 0.01,
      spark: [0.86, 0.89, accuracy],
      format: "pct",
    },
    fxExposure: {
      key: "fxExposure",
      label: "FX exposure",
      value: exposure,
      delta: 0.002,
      spark: [exposure * 0.96, exposure * 0.99, exposure],
      format: "money",
    },
  };
}

export function regionBars(wb: Workbook, slice: Slice, display: CurrencyCode, rates: Map<string, number>) {
  const map = new Map<string, number>();
  for (const row of wb.revenue) {
    if (!inSlice(row, slice)) continue;
    if (row.date < YTD_START) continue;
    map.set(row.region, (map.get(row.region) ?? 0) + toDisplay(row.amount, row.currency, display, rates));
  }
  return [...map.entries()].map(([name, value]) => ({ name, value }));
}

export function channelMix(wb: Workbook, slice: Slice, display: CurrencyCode, rates: Map<string, number>) {
  const map = new Map<string, number>();
  for (const row of wb.revenue) {
    if (!inSlice(row, slice)) continue;
    if (row.date < YTD_START) continue;
    map.set(row.channel, (map.get(row.channel) ?? 0) + toDisplay(row.amount, row.currency, display, rates));
  }
  return [...map.entries()].map(([name, value]) => ({ name, value }));
}

export function expenseStack(wb: Workbook, slice: Slice, display: CurrencyCode, rates: Map<string, number>) {
  const months = new Map<string, Record<string, number>>();
  for (const row of wb.expenses) {
    if (!inSlice(row, slice)) continue;
    const m = monthKey(row.date);
    const rec = months.get(m) ?? { period: 0 };
    const cat = row.category;
    rec[cat] = (rec[cat] ?? 0) + toDisplay(row.amount, row.currency, display, rates);
    months.set(m, rec);
  }
  return [...months.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, cats]) => ({ period, ...cats }));
}

export function departmentShare(wb: Workbook, slice: Slice, display: CurrencyCode, rates: Map<string, number>) {
  const map = new Map<string, number>();
  for (const row of wb.expenses) {
    if (slice.industry && slice.industry !== "all" && row.industry !== slice.industry) continue;
    if (row.date < YTD_START) continue;
    map.set(row.department, (map.get(row.department) ?? 0) + toDisplay(row.amount, row.currency, display, rates));
  }
  return [...map.entries()].map(([name, value]) => ({ name, value }));
}

export function vendorBars(wb: Workbook, slice: Slice, display: CurrencyCode, rates: Map<string, number>) {
  const map = new Map<string, number>();
  for (const row of wb.licenses) {
    if (!inSlice(row, slice)) continue;
    const annual = row.cycle === "monthly" ? row.unitCost * row.seats * 12 : row.unitCost * row.seats;
    map.set(row.vendor, (map.get(row.vendor) ?? 0) + toDisplay(annual, row.currency, display, rates));
  }
  return [...map.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);
}

export function currencyExposure(wb: Workbook, slice: Slice, display: CurrencyCode, rates: Map<string, number>) {
  const map = new Map<string, number>();
  for (const row of wb.revenue) {
    if (!inSlice(row, slice)) continue;
    if (row.date < YTD_START) continue;
    map.set(row.currency, (map.get(row.currency) ?? 0) + toDisplay(row.amount, row.currency, display, rates));
  }
  return [...map.entries()].map(([name, value]) => ({ name, value }));
}

export function forecastCompare(wb: Workbook, slice: Slice, display: CurrencyCode, rates: Map<string, number>) {
  const actual = new Map<string, number>();
  for (const row of wb.revenue) {
    if (!inSlice(row, slice)) continue;
    const k = monthKey(row.date);
    actual.set(k, (actual.get(k) ?? 0) + toDisplay(row.amount, row.currency, display, rates));
  }
  const expected = new Map<string, number>();
  for (const row of wb.forecast) {
    if (!inSlice(row, slice)) continue;
    const k = monthKey(row.period);
    expected.set(k, (expected.get(k) ?? 0) + toDisplay(row.expectedAmount, row.currency, display, rates));
  }
  const keys = new Set([...actual.keys(), ...expected.keys()]);
  return [...keys]
    .sort()
    .slice(-12)
    .map((period) => ({
      period,
      actual: actual.get(period) ?? 0,
      expected: expected.get(period) ?? 0,
    }));
}

export function demandCompare(wb: Workbook, slice: Slice) {
  const map = new Map<string, { avg: number; norm: number; expected: number; safety: number }>();
  for (const row of wb.demand) {
    if (slice.industry && slice.industry !== "all" && row.industry !== slice.industry) continue;
    const k = monthKey(row.period);
    const rec = map.get(k) ?? { avg: 0, norm: 0, expected: 0, safety: 0 };
    rec.avg += row.avgUnits;
    rec.norm += row.normUnits;
    rec.expected += row.expectedUnits;
    rec.safety += row.safetyStock;
    map.set(k, rec);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, v]) => ({ period, ...v }));
}

export function skuDemand(wb: Workbook, slice: Slice) {
  const map = new Map<string, number>();
  for (const row of wb.demand) {
    if (slice.industry && slice.industry !== "all" && row.industry !== slice.industry) continue;
    map.set(row.sku, (map.get(row.sku) ?? 0) + row.safetyStock);
  }
  return [...map.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);
}

export function upcomingRows(wb: Workbook, slice: Slice, display: CurrencyCode, rates: Map<string, number>) {
  return wb.upcoming
    .filter((u) => inSlice(u, slice) && u.status !== "paid")
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 12)
    .map((u) => ({
      ...u,
      converted: toDisplay(u.amount, u.currency, display, rates),
    }));
}

export function licenseRows(wb: Workbook, slice: Slice, display: CurrencyCode, rates: Map<string, number>) {
  return wb.licenses
    .filter((l) => inSlice(l, slice))
    .map((l) => {
      const annual = l.cycle === "monthly" ? l.unitCost * l.seats * 12 : l.unitCost * l.seats;
      return { ...l, annual: toDisplay(annual, l.currency, display, rates) };
    })
    .sort((a, b) => b.annual - a.annual)
    .slice(0, 12);
}

export function assetRows(wb: Workbook, slice: Slice, display: CurrencyCode, rates: Map<string, number>) {
  return wb.assets
    .filter((a) => inSlice(a, slice))
    .map((a) => ({
      ...a,
      costC: toDisplay(a.cost, a.currency, display, rates),
      bookC: toDisplay(a.bookValue, a.currency, display, rates),
    }))
    .sort((a, b) => b.bookC - a.bookC)
    .slice(0, 12);
}

export function healthMatrix(wb: Workbook, display: CurrencyCode, rates: Map<string, number>) {
  const cells: Array<{ industry: IndustryId; department: DepartmentId; score: number; revenue: number }> = [];
  const rev = new Map<string, number>();
  const opex = new Map<string, number>();
  for (const row of wb.revenue) {
    if (row.date < YTD_START) continue;
    const k = `${row.industry}|${row.department}`;
    rev.set(k, (rev.get(k) ?? 0) + toDisplay(row.amount, row.currency, display, rates));
  }
  for (const row of wb.expenses) {
    if (row.date < YTD_START) continue;
    const k = `${row.industry}|${row.department}`;
    opex.set(k, (opex.get(k) ?? 0) + toDisplay(row.amount, row.currency, display, rates));
  }
  const industries = new Set<IndustryId>();
  const depts = new Set<DepartmentId>();
  for (const row of wb.departments) {
    industries.add(row.industry);
    depts.add(row.department);
  }
  for (const industry of industries) {
    for (const department of depts) {
      const k = `${industry}|${department}`;
      const r = rev.get(k) ?? 0;
      const o = opex.get(k) ?? 0;
      const score = r ? (r - o) / r : o ? -0.2 : 0.1;
      cells.push({ industry, department, score, revenue: r });
    }
  }
  return cells;
}

export function workbookStats(wb: Workbook) {
  return {
    revenue: wb.revenue.length,
    expenses: wb.expenses.length,
    sales: wb.sales.length,
    assets: wb.assets.length,
    licenses: wb.licenses.length,
    upcoming: wb.upcoming.length,
    forecast: wb.forecast.length,
    demand: wb.demand.length,
    turnover: wb.turnover.length,
    departments: wb.departments.length,
    fx: wb.fx.length,
  };
}
