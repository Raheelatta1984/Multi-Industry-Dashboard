/**
 * Stage 0 + 1 — read any spreadsheet into a raw sheet (auto header-row
 * detection) and profile every column: inferred type, fill rate, distinct
 * counts, outliers, and quality issues.
 */
import * as XLSX from "xlsx";
import { CURRENCIES, type CurrencyCode } from "../domain";
import type {
  CellValue,
  ColumnProfile,
  ColumnType,
  QualityIssue,
  RawSheet,
  SheetProfile,
} from "./types";

const CCY_CODES = new Set<string>(CURRENCIES.map((c) => c.code));
const CCY_SYMBOLS: Array<[string, CurrencyCode]> = [
  ["€", "EUR"],
  ["£", "GBP"],
  ["¥", "JPY"],
  ["₹", "INR"],
  ["R$", "BRL"],
  ["A$", "AUD"],
  ["C$", "CAD"],
  ["S$", "SGD"],
  ["$", "USD"],
];
const TOTAL_RE = /^(grand\s+)?(total|totals|subtotal|sum)\b/i;

function cell(v: unknown): CellValue {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v;
  const s = String(v);
  return s.trim() === "" ? null : s;
}

function looksLikeDate(v: CellValue): boolean {
  if (typeof v === "number") return v > 20000 && v < 60000; // Excel serial
  if (typeof v !== "string" || !v) return false;
  return /\d{4}-\d{2}-\d{2}/.test(v) || /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(v) ||
    /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[ -]?\d{0,2},?\s*\d{0,4}$/i.test(v) ||
    /^(q[1-4])[ -]?\d{0,4}$/i.test(v) || /^\d{4}-\d{2}$/.test(v);
}

/** Detect the day/month convention of a column from unambiguous samples (13+ in a day slot). */
export type DateConvention = "dmy" | "mdy" | null;

export function detectDateConvention(values: CellValue[]): DateConvention {
  let dmy = false;
  let mdy = false;
  for (const v of values) {
    if (typeof v !== "string") continue;
    const m = v.trim().match(/^(\d{1,2})[/](\d{1,2})[/](\d{2,4})$/);
    if (!m) continue;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a > 12 && b <= 12) dmy = true;
    else if (b > 12 && a <= 12) mdy = true;
  }
  if (dmy && !mdy) return "dmy";
  if (mdy && !dmy) return "mdy";
  return null;
}

function parseDateLoose(v: CellValue, convention: DateConvention = "mdy"): string | null {
  if (typeof v === "number" && v > 20000 && v < 60000) {
    const p = XLSX.SSF.parse_date_code(v);
    if (p) return new Date(Date.UTC(p.y, p.m - 1, p.d)).toISOString().slice(0, 10);
  }
  if (typeof v !== "string" || !v) return null;
  const s = v.trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const q = s.match(/^q([1-4])\s*-?\s*(\d{4})?$/i);
  if (q) {
    const year = q[2] ? Number(q[2]) : 2026;
    const m = (Number(q[1]) - 1) * 3 + 1;
    return `${year}-${String(m).padStart(2, "0")}-01`;
  }
  const monthName = s.match(/^([a-z]{3,})[ -]?(\d{1,2})?,?\s*(\d{4})?$/i);
  if (monthName) {
    const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    const mi = months.indexOf(monthName[1].slice(0, 3).toLowerCase());
    if (mi >= 0) {
      const year = monthName[3] ? Number(monthName[3]) : 2026;
      return `${year}-${String(mi + 1).padStart(2, "0")}-01`;
    }
  }
  const slash = s.match(/^(\d{1,2})[/](\d{1,2})[/](\d{2,4})$/);
  if (slash) {
    let a = Number(slash[1]);
    let b = Number(slash[2]);
    let y = Number(slash[3]);
    if (y < 100) y += 2000;
    if (convention === "dmy") {
      // Day-first file: swap so a=month, b=day.
      [a, b] = [b, a];
    } else if (a > 12 && b <= 12) {
      [a, b] = [b, a]; // unambiguous day-first value in an unclear file
    }
    return `${y}-${String(a).padStart(2, "0")}-${String(b).padStart(2, "0")}`;
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

function stripNumber(v: CellValue): { n: number | null; currency: CurrencyCode | null; percent: boolean } {
  if (typeof v === "number") return { n: v, currency: null, percent: false };
  if (typeof v !== "string") return { n: null, currency: null, percent: false };
  let s = v.trim();
  let percent = false;
  if (s.endsWith("%")) {
    percent = true;
    s = s.slice(0, -1).trim();
  }
  let currency: CurrencyCode | null = null;
  for (const [sym, code] of CCY_SYMBOLS) {
    if (s.includes(sym)) {
      currency = code;
      s = s.split(sym).join("");
      break;
    }
  }
  const codeMatch = s.match(/\b(USD|EUR|GBP|JPY|AUD|CAD|CHF|CNY|INR|SGD|AED|BRL)\b/i);
  if (codeMatch) {
    currency = codeMatch[1].toUpperCase() as CurrencyCode;
    s = s.replace(codeMatch[1], "");
  }
  const negative = /^\(.*\)$/.test(s);
  if (negative) s = s.slice(1, -1);
  s = s.replace(/,/g, "").replace(/\s/g, "");
  const n = Number(s);
  if (!Number.isFinite(n)) return { n: null, currency, percent };
  return { n: negative ? -n : n, currency, percent };
}

function normalizeHeader(h: string, index: number): string {
  const base = String(h ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "_");
  return base || `column_${index + 1}`;
}

export function prettyHeader(h: string): string {
  return h
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Stage 0 — workbook file → best raw sheet with the header row auto-detected. */
export function readRawSheet(buffer: ArrayBuffer, fileName: string, sheetIndex = 0): RawSheet {
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const names = wb.SheetNames.filter((n) => {
    const ws = wb.Sheets[n];
    return ws && (ws["!ref"] ?? "").length > 0;
  });
  if (!names.length) throw new Error("No readable sheets in that file.");
  const sheetName = names[Math.min(sheetIndex, names.length - 1)];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], {
    header: 1,
    defval: null,
    raw: true,
    blankrows: false,
  });
  const grid = rows.map((r) => (Array.isArray(r) ? r.map(cell) : []));
  return buildRawSheet(grid, fileName, sheetName);
}

/** Shared header-row detector used by file uploads and demo datasets. */
export function buildRawSheet(grid: CellValue[][], fileName: string, sheetName: string): RawSheet {
  const nonEmpty = grid.filter((r) => r.some((v) => v !== null));
  if (!nonEmpty.length) throw new Error("That sheet is empty.");
  let headerRowIndex = 0;
  let bestScore = -1;
  for (let i = 0; i < Math.min(nonEmpty.length, 12); i++) {
    const row = nonEmpty[i];
    const filled = row.filter((v) => v !== null);
    const strings = filled.filter((v) => typeof v === "string" && !looksLikeDate(v) && stripNumber(v).n === null);
    const score = filled.length + strings.length * 1.5 - i * 0.4;
    if (score > bestScore) {
      bestScore = score;
      headerRowIndex = i;
    }
  }
  const headerRow = nonEmpty[headerRowIndex];
  const width = Math.max(...nonEmpty.map((r) => r.length), headerRow.length);
  const headers: string[] = [];
  for (let c = 0; c < width; c++) {
    const v = headerRow[c];
    // Keep the human-readable original; the normalized form lives on the profile.
    headers.push(typeof v === "string" && v.trim() ? v.trim() : `Column ${c + 1}`);
  }
  const dataRows = nonEmpty.slice(headerRowIndex + 1).filter((r) => r.some((v) => v !== null));
  return {
    name: fileName,
    sheetName,
    headers,
    rows: dataRows.map((r) => {
      const out: CellValue[] = [];
      for (let c = 0; c < width; c++) out.push(r[c] ?? null);
      return out;
    }),
    headerRowIndex,
  };
}

function inferType(values: CellValue[]): { type: ColumnType; confidence: number; currency: CurrencyCode | null } {
  const vals = values.filter((v) => v !== null);
  if (!vals.length) return { type: "text", confidence: 0.3, currency: null };
  const counts = new Map<string, number>();
  const currencyHits = new Map<CurrencyCode, number>();
  for (const v of vals) {
    let t = "text";
    if (typeof v === "boolean") t = "boolean";
    else if (typeof v === "number") t = looksLikeDate(v) ? "date" : "number";
    else {
      const s = v as string;
      const num = stripNumber(s);
      if (looksLikeDate(s)) t = "date";
      else if (num.percent) t = "percent";
      else if (num.n !== null && num.currency) {
        t = "currency";
        currencyHits.set(num.currency, (currencyHits.get(num.currency) ?? 0) + 1);
      } else if (num.n !== null && /[,$]/.test(s) && /^[\s(]*[\d.,\s]+$/.test(s)) t = "number";
      else if (/^(true|false|yes|no|y|n)$/i.test(s.trim())) t = "boolean";
      else t = "text";
    }
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const [top, n] = sorted[0];
  let type = top as ColumnType;
  const confidence = n / vals.length;
  // Refine text → category / id / currency by value shape.
  if (type === "text") {
    const distinct = new Set(vals.map((v) => String(v).toLowerCase())).size;
    const ratio = distinct / vals.length;
    const allCodes = vals.every((v) => CCY_CODES.has(String(v).trim().toUpperCase()));
    if (allCodes) {
      type = "text";
      return { type, confidence: 0.99, currency: null };
    }
    if (ratio > 0.9 && vals.length > 8) type = "id";
    else if (ratio < 0.35 && distinct <= 25) type = "category";
  }
  let currency: CurrencyCode | null = null;
  if (type === "currency" && currencyHits.size) {
    currency = [...currencyHits.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }
  return { type, confidence, currency };
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[idx];
}

/** Stage 1 — full column profile + sheet-level quality score. */
export function profileSheet(raw: RawSheet): SheetProfile {
  const issues: QualityIssue[] = [];
  const seen = new Map<string, number>();
  const columns: ColumnProfile[] = raw.headers.map((h, index) => {
    const cleanHeader = normalizeHeader(h, index);
    const values = raw.rows.map((r) => r[index] ?? null);
    const nonNull = values.filter((v) => v !== null);
    const { type, confidence, currency } = inferType(values);
    const distinctSet = new Set(nonNull.map((v) => String(v)));
    const numbers =
      type === "number" || type === "currency" || type === "percent"
        ? nonNull.map((v) => (typeof v === "number" ? v : (stripNumber(v).n ?? NaN))).filter((n) => Number.isFinite(n))
        : [];
    const sorted = [...numbers].sort((a, b) => a - b);
    const p25 = percentile(sorted, 0.25);
    const p75 = percentile(sorted, 0.75);
    const iqr = p75 - p25;
    const outliers = iqr > 0 ? numbers.filter((n) => n < p25 - 3 * iqr || n > p75 + 3 * iqr).length : 0;
    const colIssues: QualityIssue[] = [];
    const nulls = values.length - nonNull.length;
    if (nulls > 0) {
      colIssues.push({
        kind: "nulls",
        severity: nulls / values.length > 0.2 ? "high" : "low",
        message: `${nulls} of ${values.length} cells empty`,
        count: nulls,
      });
    }
    if (confidence < 0.95 && nonNull.length > 3) {
      colIssues.push({
        kind: "mixed_format",
        severity: confidence < 0.8 ? "high" : "medium",
        message: `mixed formats — ${(confidence * 100).toFixed(0)}% conform to ${type}`,
      });
    }
    if (outliers > 0) {
      colIssues.push({
        kind: "outliers",
        severity: outliers > nonNull.length * 0.05 ? "high" : "low",
        message: `${outliers} statistical outlier${outliers === 1 ? "" : "s"}`,
        count: outliers,
      });
    }
    const wsCells = nonNull.filter((v) => typeof v === "string" && v !== (v as string).trim()).length;
    if (wsCells > 0) {
      colIssues.push({ kind: "whitespace", severity: "low", message: `${wsCells} cells with stray whitespace` });
    }
    const key = cleanHeader;
    seen.set(key, (seen.get(key) ?? 0) + 1);
    if ((seen.get(key) ?? 0) > 1) {
      colIssues.push({ kind: "duplicate_header", severity: "medium", message: "duplicate column name" });
    }
    return {
      index,
      rawHeader: h,
      cleanHeader,
      type,
      typeConfidence: confidence,
      fillRate: values.length ? nonNull.length / values.length : 0,
      nulls,
      distinct: distinctSet.size,
      distinctRatio: nonNull.length ? distinctSet.size / nonNull.length : 0,
      min: sorted.length ? sorted[0] : null,
      max: sorted.length ? sorted[sorted.length - 1] : null,
      samples: [...distinctSet].slice(0, 4).map((s) => (s.length > 22 ? `${s.slice(0, 20)}…` : s)),
      detectedCurrency: currency,
      issues: colIssues,
    };
  });

  const totalsRows = raw.rows.filter((r) => {
    const first = r.find((v) => v !== null);
    return typeof first === "string" && TOTAL_RE.test(first.trim());
  });
  if (totalsRows.length) {
    issues.push({
      kind: "totals_row",
      severity: "medium",
      message: `${totalsRows.length} total/subtotal row${totalsRows.length === 1 ? "" : "s"} will be dropped`,
      count: totalsRows.length,
    });
  }
  const dupRows = raw.rows.length - new Set(raw.rows.map((r) => JSON.stringify(r))).size;
  if (dupRows > 0) {
    issues.push({
      kind: "duplicate_rows",
      severity: "high",
      message: `${dupRows} duplicate row${dupRows === 1 ? "" : "s"} detected`,
      count: dupRows,
    });
  }

  const weight = (i: QualityIssue) =>
    i.kind === "duplicate_rows" ? 7 : i.kind === "totals_row" ? 2 : i.severity === "high" ? 5 : i.severity === "medium" ? 3 : 1;
  const colPenalty = columns.reduce((acc, c) => acc + c.issues.reduce((a, i) => a + weight(i), 0), 0);
  const sheetPenalty = issues.reduce((acc, i) => acc + weight(i), 0);
  const qualityScore = Math.max(45, Math.min(100, Math.round(100 - colPenalty - sheetPenalty)));

  return { sheet: raw, columns, issues, rowCount: raw.rows.length, qualityScore };
}

export { normalizeHeader, parseDateLoose, stripNumber, TOTAL_RE };
