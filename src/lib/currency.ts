import { FX_TO_USD, type CurrencyCode } from "./domain";
import type { FxRow } from "./types";

export function fxMap(rows: FxRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) map.set(row.currency, row.rateToUsd);
  if (!map.has("USD")) map.set("USD", 1);
  return map;
}

export function convertAmount(
  amount: number,
  from: string,
  to: string,
  rates: Map<string, number>,
): number {
  if (!Number.isFinite(amount)) return 0;
  if (from === to) return amount;
  const fromUsd = rates.get(from) ?? FX_TO_USD[from as CurrencyCode] ?? 1;
  const toUsd = rates.get(to) ?? FX_TO_USD[to as CurrencyCode] ?? 1;
  if (!toUsd) return amount * fromUsd;
  return (amount * fromUsd) / toUsd;
}

export function convertMany(
  rows: Array<{ amount: number; currency: string }>,
  to: string,
  rates: Map<string, number>,
): number {
  let sum = 0;
  for (const row of rows) sum += convertAmount(row.amount, row.currency, to, rates);
  return sum;
}
