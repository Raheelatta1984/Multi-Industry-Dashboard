import {
  ASSET_CATEGORIES,
  BASE_MONTHLY_REVENUE,
  CHANNELS,
  COMPANY,
  CURRENCIES,
  DEPARTMENTS,
  EXPENSE_CATEGORIES,
  FX_TO_USD,
  INDUSTRIES,
  LICENSE_VENDORS,
  PRODUCTS,
  REGIONS,
  SEASONALITY,
  type CurrencyCode,
  type DepartmentId,
  type IndustryId,
} from "./domain";
import type {
  AssetRow,
  DemandRow,
  DepartmentRow,
  ExpenseRow,
  ForecastRow,
  FxRow,
  LicenseRow,
  MetaRow,
  RevenueRow,
  SalesRow,
  TurnoverRow,
  UpcomingRow,
  Workbook,
} from "./types";

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function isoDay(year: number, monthIndex: number, day = 1): string {
  const d = new Date(Date.UTC(year, monthIndex, day));
  return d.toISOString().slice(0, 10);
}

function monthList(start: Date, count: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.push(isoDay(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
  }
  return out;
}

function jitter(rng: () => number, n: number, p = 0.1): number {
  return n * (1 + (rng() * 2 - 1) * p);
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

function monthIndex(iso: string): number {
  return new Date(iso).getUTCMonth();
}

const DEPT_OPEX_SHARE: Record<DepartmentId, number> = {
  executive: 0.04,
  finance: 0.06,
  sales: 0.14,
  marketing: 0.11,
  operations: 0.16,
  procurement: 0.08,
  assets: 0.05,
  licenses: 0.07,
  treasury: 0.03,
  supply: 0.09,
  hrcost: 0.12,
  floor: 0.05,
};

const INDUSTRY_CCY: Record<IndustryId, CurrencyCode> = {
  retail: "USD",
  wholesale: "USD",
  manufacturing: "EUR",
  healthcare: "GBP",
  hospitality: "AUD",
  logistics: "USD",
  financial: "CHF",
  technology: "USD",
  energy: "EUR",
  education: "GBP",
  realestate: "SGD",
  cpg: "USD",
};

export const SAMPLE_AS_OF = "2026-08-31";

export function generateSampleWorkbook(seed = 20260831): Workbook {
  const rng = mulberry32(seed);
  const now = `${SAMPLE_AS_OF}T08:00:00.000Z`;
  const months = monthList(new Date(Date.UTC(2025, 2, 1)), 18);
  const future = monthList(new Date(Date.UTC(2026, 8, 1)), 6);

  const meta: MetaRow[] = [
    {
      id: "meta",
      company: COMPANY.name,
      industry: "all",
      fiscalYearStart: COMPANY.fiscalYearStart,
      baseCurrency: COMPANY.baseCurrency,
      timezone: COMPANY.timezone,
      updatedAt: now,
    },
  ];

  const fx: FxRow[] = CURRENCIES.map((c) => ({
    id: `fx-${c.code}`,
    currency: c.code,
    rateToUsd: FX_TO_USD[c.code],
    asOf: SAMPLE_AS_OF,
    updatedAt: now,
  }));

  const departments: DepartmentRow[] = [];
  for (const ind of INDUSTRIES) {
    for (const dept of DEPARTMENTS) {
      departments.push({
        id: `${ind.id}-${dept.id}`,
        name: `${ind.division} ${dept.label}`,
        industry: ind.id,
        department: dept.id,
        owner: `${dept.ownerTitle}`,
        costCenter: `${ind.short.slice(0, 3).toUpperCase()}-${dept.id.slice(0, 3).toUpperCase()}`,
        updatedAt: now,
      });
    }
  }

  const revenue: RevenueRow[] = [];
  const sales: SalesRow[] = [];
  const expenses: ExpenseRow[] = [];
  const assets: AssetRow[] = [];
  const licenses: LicenseRow[] = [];
  const upcoming: UpcomingRow[] = [];
  const forecast: ForecastRow[] = [];
  const demand: DemandRow[] = [];
  const turnover: TurnoverRow[] = [];

  const salesBySkuMonth = new Map<string, number>();

  for (const ind of INDUSTRIES) {
    const ccy = INDUSTRY_CCY[ind.id];
    const products = PRODUCTS[ind.id];
    const seasonal = SEASONALITY[ind.id];
    const base = BASE_MONTHLY_REVENUE[ind.id];

    for (const month of months) {
      const m = monthIndex(month);
      const season = seasonal[m] ?? 1;
      const monthRev = jitter(rng, base * season, 0.08);

      for (const region of REGIONS) {
        const regionShare = region === "AMER" ? 0.38 : region === "EMEA" ? 0.28 : region === "APAC" ? 0.24 : 0.1;
        for (const channel of CHANNELS) {
          const chShare = channel === "Direct" ? 0.34 : channel === "Online" ? 0.3 : channel === "Partner" ? 0.2 : 0.16;
          const amount = monthRev * regionShare * chShare;
          const dept: DepartmentId = channel === "Online" || channel === "Direct" ? "floor" : "sales";
          revenue.push({
            id: `rev-${ind.id}-${month}-${region}-${channel}`,
            date: month,
            industry: ind.id,
            department: dept,
            product: `${ind.short} mix`,
            channel,
            region,
            amount: Math.round(amount * 100) / 100,
            currency: ccy,
            updatedAt: now,
          });
        }
      }

      for (const product of products) {
        const skuShare = 0.08 + rng() * 0.08;
        const units = Math.max(4, Math.round(jitter(rng, (monthRev * skuShare) / product.price, 0.15)));
        const key = `${ind.id}|${product.sku}|${month}`;
        salesBySkuMonth.set(key, (salesBySkuMonth.get(key) ?? 0) + units);
        sales.push({
          id: `sal-${ind.id}-${product.sku}-${month}`,
          date: month,
          industry: ind.id,
          department: rng() > 0.45 ? "sales" : "floor",
          sku: product.sku,
          product: product.name,
          units,
          unitPrice: Math.round(jitter(rng, product.price, 0.04) * 100) / 100,
          currency: ccy,
          region: pick(rng, REGIONS),
          channel: pick(rng, CHANNELS),
          updatedAt: now,
        });
      }

      const opexRatio = 0.62 + rng() * 0.1;
      const monthOpex = monthRev * opexRatio;
      for (const dept of DEPARTMENTS) {
        const share = DEPT_OPEX_SHARE[dept.id];
        const cat = pick(rng, EXPENSE_CATEGORIES);
        expenses.push({
          id: `exp-${ind.id}-${dept.id}-${month}`,
          date: month,
          industry: ind.id,
          department: dept.id,
          category: cat,
          vendor: pick(rng, LICENSE_VENDORS),
          amount: Math.round(monthOpex * share * 100) / 100,
          currency: ccy,
          recurring: dept.id === "hrcost" || dept.id === "licenses" || rng() > 0.35,
          updatedAt: now,
        });
      }

      const invStart = jitter(rng, monthRev * 0.45, 0.1);
      const invEnd = jitter(rng, monthRev * 0.42, 0.1);
      const cogs = monthRev * (0.46 + rng() * 0.08);
      turnover.push({
        id: `trn-${ind.id}-${month}`,
        period: month,
        industry: ind.id,
        department: "supply",
        inventoryStart: Math.round(invStart),
        inventoryEnd: Math.round(invEnd),
        cogs: Math.round(cogs),
        currency: ccy,
        updatedAt: now,
      });
    }

    for (let a = 0; a < 14; a++) {
      const cost = jitter(rng, 80_000 + a * 40_000, 0.35);
      const age = rng() * 6;
      assets.push({
        id: `ast-${ind.id}-${a}`,
        name: `${ind.short} ${pick(rng, ASSET_CATEGORIES)} ${a + 1}`,
        industry: ind.id,
        department: pick(rng, ["assets", "operations", "floor", "licenses"] as const),
        category: pick(rng, ASSET_CATEGORIES),
        acquired: isoDay(2020 + Math.floor(age), Math.floor(rng() * 12), 1 + Math.floor(rng() * 27)),
        cost: Math.round(cost),
        bookValue: Math.round(cost * (0.35 + rng() * 0.5)),
        currency: ccy,
        status: rng() > 0.08 ? "active" : rng() > 0.5 ? "idle" : "disposed",
        updatedAt: now,
      });
    }

    for (let l = 0; l < 8; l++) {
      const vendor = LICENSE_VENDORS[l % LICENSE_VENDORS.length]!;
      const seats = Math.round(jitter(rng, 40 + l * 18, 0.3));
      const unit = [18, 32, 48, 72, 96, 120, 160, 240][l % 8]!;
      const start = isoDay(2025, l % 12, 1);
      const end = isoDay(2026, (l + 8) % 12, 28);
      licenses.push({
        id: `lic-${ind.id}-${l}`,
        name: `${vendor} ${ind.short}`,
        vendor,
        industry: ind.id,
        department: l % 3 === 0 ? "licenses" : l % 3 === 1 ? "finance" : "sales",
        seats,
        unitCost: unit,
        currency: ccy,
        start,
        end,
        cycle: l % 4 === 0 ? "monthly" : "annual",
        updatedAt: now,
      });
    }

    const upcomingTypes = ["opex", "capex", "license", "payroll", "tax"] as const;
    for (let u = 0; u < 10; u++) {
      const due = isoDay(2026, 8 + (u % 4), 2 + u * 2);
      upcoming.push({
        id: `upc-${ind.id}-${u}`,
        dueDate: due,
        industry: ind.id,
        department: pick(rng, DEPARTMENTS).id,
        description: `${pick(rng, EXPENSE_CATEGORIES)} commitment`,
        amount: Math.round(jitter(rng, 18_000 + u * 7_500, 0.4)),
        currency: ccy,
        type: upcomingTypes[u % upcomingTypes.length]!,
        status: u % 7 === 0 ? "paid" : u % 3 === 0 ? "committed" : "scheduled",
        updatedAt: now,
      });
    }

    for (const product of products) {
      const hist: number[] = [];
      for (const month of months) {
        hist.push(salesBySkuMonth.get(`${ind.id}|${product.sku}|${month}`) ?? 0);
      }
      const last3 = hist.slice(-3);
      const avg = last3.reduce((s, n) => s + n, 0) / Math.max(1, last3.length);
      const yearlyAvg = hist.reduce((s, n) => s + n, 0) / Math.max(1, hist.length);
      const stdev = Math.sqrt(
        last3.reduce((s, n) => s + (n - avg) ** 2, 0) / Math.max(1, last3.length),
      );

      for (const period of future) {
        const m = monthIndex(period);
        const norm = yearlyAvg * (seasonal[m] ?? 1);
        const expected = 0.55 * avg + 0.45 * norm;
        demand.push({
          id: `dem-${ind.id}-${product.sku}-${period}`,
          period,
          industry: ind.id,
          sku: product.sku,
          avgUnits: Math.round(avg * 10) / 10,
          normUnits: Math.round(norm * 10) / 10,
          expectedUnits: Math.round(expected * 10) / 10,
          safetyStock: Math.round((stdev * 1.65 + avg * 0.12) * 10) / 10,
          updatedAt: now,
        });
        const method = expected > norm ? "average" : expected < avg ? "norm" : "blend";
        forecast.push({
          id: `for-${ind.id}-${product.sku}-${period}`,
          period,
          industry: ind.id,
          department: "sales",
          sku: product.sku,
          expectedUnits: Math.round(expected * 10) / 10,
          expectedAmount: Math.round(expected * product.price * 100) / 100,
          currency: ccy,
          method,
          updatedAt: now,
        });
      }
    }
  }

  return {
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
  };
}

export const SAMPLE_SEED = 20260831;
