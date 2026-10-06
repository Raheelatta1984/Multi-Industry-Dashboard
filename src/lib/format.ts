import { CURRENCIES, type CurrencyCode } from "./domain";

export function formatMoney(
  amount: number,
  currency: string,
  opts?: { compact?: boolean; digits?: number },
): string {
  const compact = opts?.compact ?? Math.abs(amount) >= 10_000;
  const digits = opts?.digits;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      notation: compact ? "compact" : "standard",
      maximumFractionDigits: digits ?? (compact ? 1 : 0),
      minimumFractionDigits: compact ? 0 : digits ?? 0,
    }).format(amount);
  } catch {
    const code = currency || "USD";
    const n = compact
      ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(amount)
      : new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(amount);
    return `${n} ${code}`;
  }
}

export function formatNumber(n: number, compact = false): string {
  return new Intl.NumberFormat("en-US", {
    notation: compact && Math.abs(n) >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: compact ? 1 : 0,
  }).format(n);
}

export function formatPct(n: number, digits = 1): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${(n * 100).toFixed(digits)}%`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}

export function formatMonth(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  }).format(d);
}

export function currencyMeta(code: string) {
  return CURRENCIES.find((c) => c.code === code) ?? { code: code as CurrencyCode, name: code, symbol: code };
}

export function relativeTime(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return `${h}h ago`;
}
