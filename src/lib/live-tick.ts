import { CHANNELS, PRODUCTS, REGIONS, type IndustryId } from "./domain";
import { mulberry32 } from "./sample-data";
import { applyRowMutations } from "./patch";
import type { FxRow, SalesRow, SheetKey, UpcomingRow, Workbook } from "./types";

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

type Mut = {
  sheet: SheetKey;
  row: { id: string; updatedAt: string } & Record<string, unknown>;
  op: "add" | "update" | "remove";
};

export function simulateTick(wb: Workbook, seed: number, atIso: string): Workbook {
  const rng = mulberry32(seed);
  const mutations: Mut[] = [];

  const sales = wb.sales;
  const nUpdate = Math.min(10, Math.max(3, Math.round(sales.length * 0.004)));
  for (let i = 0; i < nUpdate; i++) {
    const row = sales[Math.floor(rng() * sales.length)];
    if (!row) continue;
    const factor = 1 + (rng() * 0.03 - 0.01);
    mutations.push({
      sheet: "sales",
      op: "update",
      row: {
        ...row,
        units: Math.max(1, Math.round(row.units * factor)),
        updatedAt: atIso,
      },
    });
  }

  const revenue = wb.revenue;
  const nRev = Math.min(8, Math.max(2, Math.round(revenue.length * 0.003)));
  for (let i = 0; i < nRev; i++) {
    const row = revenue[Math.floor(rng() * revenue.length)];
    if (!row) continue;
    if (row.date < "2026-07-01") continue;
    const factor = 1 + (rng() * 0.02 - 0.005);
    mutations.push({
      sheet: "revenue",
      op: "update",
      row: { ...row, amount: Math.round(row.amount * factor * 100) / 100, updatedAt: atIso },
    });
  }

  const expenses = wb.expenses;
  for (let i = 0; i < 4; i++) {
    const row = expenses[Math.floor(rng() * expenses.length)];
    if (!row) continue;
    if (row.date < "2026-07-01") continue;
    const factor = 1 + (rng() * 0.025 - 0.01);
    mutations.push({
      sheet: "expenses",
      op: "update",
      row: { ...row, amount: Math.round(row.amount * factor * 100) / 100, updatedAt: atIso },
    });
  }

  const industries = Object.keys(PRODUCTS) as IndustryId[];
  const addCount = 2 + Math.floor(rng() * 4);
  for (let i = 0; i < addCount; i++) {
    const industry = pick(rng, industries);
    const product = pick(rng, PRODUCTS[industry]);
    const id = `sal-live-${seed}-${i}`;
    const row: SalesRow = {
      id,
      date: atIso.slice(0, 10),
      industry,
      department: rng() > 0.5 ? "sales" : "floor",
      sku: product.sku,
      product: product.name,
      units: Math.max(1, Math.round(4 + rng() * 40)),
      unitPrice: product.price,
      currency: "USD",
      region: pick(rng, REGIONS),
      channel: pick(rng, CHANNELS),
      updatedAt: atIso,
    };
    mutations.push({ sheet: "sales", op: "add", row });
  }

  const open = wb.upcoming.filter((u) => u.status !== "paid");
  if (open.length && rng() > 0.55) {
    const row = pick(rng, open) as UpcomingRow;
    mutations.push({
      sheet: "upcoming",
      op: "update",
      row: { ...row, status: rng() > 0.5 ? "committed" : "paid", updatedAt: atIso },
    });
  }

  if (rng() > 0.4) {
    const fxRow = pick(rng, wb.fx) as FxRow;
    if (fxRow.currency !== "USD") {
      const nudged = fxRow.rateToUsd * (1 + (rng() * 0.003 - 0.0015));
      mutations.push({
        sheet: "fx",
        op: "update",
        row: { ...fxRow, rateToUsd: Math.round(nudged * 1e6) / 1e6, updatedAt: atIso },
      });
    }
  }

  const fc = wb.forecast.filter((f) => f.period >= "2026-09-01");
  for (let i = 0; i < 3; i++) {
    const row = fc[Math.floor(rng() * fc.length)];
    if (!row) continue;
    const factor = 1 + (rng() * 0.02 - 0.008);
    mutations.push({
      sheet: "forecast",
      op: "update",
      row: {
        ...row,
        expectedUnits: Math.round(row.expectedUnits * factor * 10) / 10,
        expectedAmount: Math.round(row.expectedAmount * factor * 100) / 100,
        updatedAt: atIso,
      },
    });
  }

  return applyRowMutations(wb, mutations);
}
