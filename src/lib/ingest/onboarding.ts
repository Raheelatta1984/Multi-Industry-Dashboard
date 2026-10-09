/**
 * AI onboarding — the guided intake interview that gates every publish.
 *
 * The agent asks: why is this data arriving, whose is it (single/multiple
 * companies, single/multiple departments), and walks the field-by-field
 * review — but it does so *data-aware*: every question is pre-answered from
 * what the profiler actually found in the file, so the human confirms rather
 * than types. Nothing is committed to the warehouse until the interview is
 * confirmed (the gate is enforced in the store, not just the UI).
 */
import { DEPARTMENTS, INDUSTRIES } from "../domain";
import { coerceDepartment, coerceIndustry } from "./semantic";
import type {
  CellValue,
  CleanedTable,
  ColumnMapping,
  IngestDomain,
  IngestRun,
  OnboardingAnswers,
  OnboardingProfile,
  Purpose,
} from "./types";

export const PURPOSE_OPTIONS: Array<{ id: Purpose; label: string; blurb: string }> = [
  { id: "monthly_reporting", label: "Monthly reporting cycle", blurb: "this month's pack from an entity that already reports" },
  { id: "new_entity", label: "New entity onboarding", blurb: "first data from a company joining the group" },
  { id: "one_off_analysis", label: "One-off analysis", blurb: "an ad-hoc file answering a specific question" },
  { id: "historical_backfill", label: "Historical backfill", blurb: "older periods missing from the warehouse" },
  { id: "replace_data", label: "Correct / replace data", blurb: "fixing numbers that were already committed" },
];

/** The data types the warehouse can onboard, in plain language. */
export const DOMAIN_OPTIONS: Array<{ id: IngestDomain; label: string; blurb: string }> = [
  { id: "revenue", label: "Revenue / income", blurb: "income lines by date, company, product or channel" },
  { id: "expenses", label: "Expenses / opex", blurb: "spend lines by vendor, category and cost centre" },
  { id: "sales", label: "Sales (units & prices)", blurb: "transactions with quantity, unit price and SKU" },
  { id: "assets", label: "Fixed assets", blurb: "asset register with cost, book value and status" },
  { id: "licenses", label: "Software licences", blurb: "licences with seats, unit cost and renewal dates" },
  { id: "upcoming", label: "Upcoming payments", blurb: "scheduled or committed payments with due dates" },
  { id: "turnover", label: "Inventory & COGS", blurb: "opening and closing stock and cost of goods sold" },
];

export function domainLabel(id: IngestDomain | null | undefined): string {
  return DOMAIN_OPTIONS.find((d) => d.id === id)?.label ?? "—";
}

export const PURPOSE_LABELS: Record<Purpose, string> = Object.fromEntries(
  PURPOSE_OPTIONS.map((o) => [o.id, o.label]),
) as Record<Purpose, string>;

export type DetectedValue = { raw: string; canonical: string | null; label: string | null };

function columnIndexFor(table: CleanedTable, mappings: ColumnMapping[], target: string): number {
  for (const m of mappings) {
    if (m.target !== target) continue;
    const i = table.headers.indexOf(m.column);
    if (i >= 0) return i;
  }
  return -1;
}

function detectValues(
  table: CleanedTable,
  mappings: ColumnMapping[],
  target: string,
  coerce: (v: CellValue) => { value: string | null },
  labelOf: (canonical: string) => string | undefined,
): DetectedValue[] {
  const idx = columnIndexFor(table, mappings, target);
  if (idx === -1) return [];
  const seen = new Map<string, string | null>();
  for (const r of table.rows) {
    const v = r[idx];
    if (typeof v !== "string" || !v.trim()) continue;
    const key = v.trim();
    if (!seen.has(key)) seen.set(key, coerce(key)?.value ?? null);
  }
  return [...seen.entries()].map(([raw, canonical]) => ({
    raw,
    canonical,
    label: canonical ? (labelOf(canonical) ?? null) : null,
  }));
}

export function detectEntities(table: CleanedTable, mappings: ColumnMapping[]): DetectedValue[] {
  return detectValues(table, mappings, "industry", coerceIndustry, (c) =>
    INDUSTRIES.find((i) => i.id === c)?.label,
  );
}

export function detectDepartments(table: CleanedTable, mappings: ColumnMapping[]): DetectedValue[] {
  return detectValues(table, mappings, "department", coerceDepartment, (c) =>
    DEPARTMENTS.find((d) => d.id === c)?.label,
  );
}

export function periodRange(
  table: CleanedTable,
  mappings: ColumnMapping[],
): { from: string; to: string } | null {
  const idx =
    columnIndexFor(table, mappings, "date") !== -1
      ? columnIndexFor(table, mappings, "date")
      : columnIndexFor(table, mappings, "due_date") !== -1
        ? columnIndexFor(table, mappings, "due_date")
        : columnIndexFor(table, mappings, "period");
  if (idx === -1) return null;
  const dates = table.rows
    .map((r) => r[idx])
    .filter((v): v is string => typeof v === "string" && /^\d{4}-\d{2}(-\d{2})?$/.test(v))
    .sort();
  if (!dates.length) return null;
  return { from: dates[0]!.slice(0, 10), to: dates[dates.length - 1]!.slice(0, 10) };
}

export function currencyHint(table: CleanedTable, mappings: ColumnMapping[]): string | null {
  const idx = columnIndexFor(table, mappings, "currency");
  if (idx !== -1) {
    const codes = new Set<string>();
    for (const r of table.rows) {
      const v = r[idx];
      if (typeof v === "string" && v.trim()) codes.add(v.trim().toUpperCase());
    }
    if (codes.size) return [...codes].join(" + ");
  }
  const byCol = Object.values(table.currencyByColumn);
  if (byCol.length) return [...new Set(byCol)].join(" + ");
  return null;
}

export function mappingStats(mappings: ColumnMapping[]): {
  mapped: number;
  excluded: number;
  unmapped: number;
  lowConfidence: ColumnMapping[];
  confidence: number;
} {
  const mapped = mappings.filter((m) => m.target);
  const lowConfidence = mapped.filter((m) => m.confidence < 0.9);
  return {
    mapped: mapped.length,
    excluded: mappings.length - mapped.length,
    unmapped: mappings.filter((m) => !m.target && m.method === "none" && m.confidence > 0).length,
    lowConfidence,
    confidence: mapped.length ? mapped.reduce((a, m) => a + m.confidence, 0) / mapped.length : 0,
  };
}

export function buildProfile(run: IngestRun, answers: OnboardingAnswers): OnboardingProfile {
  const table = run.cleaned;
  const entities = table ? detectEntities(table, run.mappings) : [];
  const departments = table ? detectDepartments(table, run.mappings) : [];
  const period = table ? periodRange(table, run.mappings) : null;
  const stats = mappingStats(run.mappings);
  return {
    fileName: run.fileName,
    sourceKind: answers.sourceKind ?? "upload",
    purpose: answers.purpose ?? "one_off_analysis",
    purposeLabel: PURPOSE_LABELS[answers.purpose ?? "one_off_analysis"],
    purposeNote: answers.purposeNote,
    entityScope: answers.entityScope ?? (entities.length > 1 ? "multiple" : "single"),
    entities: answers.entities.length
      ? answers.entities
      : entities.filter((e) => e.label).map((e) => e.label!),
    departmentScope: answers.departmentScope ?? (departments.length > 1 ? "multiple" : "single"),
    departments: answers.departments.length
      ? answers.departments
      : departments.filter((d) => d.label).map((d) => d.label!),
    domain: run.domain?.domain ?? null,
    rowCount: run.profile?.rowCount ?? 0,
    columnCount: table?.headers.length ?? 0,
    mappedColumns: stats.mapped,
    excludedColumns: stats.excluded,
    lowConfidenceColumns: stats.lowConfidence.map((m) => m.column),
    mappingConfidence: stats.confidence,
    qualityScore: run.profile?.qualityScore ?? 0,
    periodFrom: period?.from ?? null,
    periodTo: period?.to ?? null,
    currency: table ? currencyHint(table, run.mappings) : null,
    completedAt: Date.now(),
  };
}

/** Keyword reading of free-text answers so the chat tolerates typed replies. */
export function matchPurpose(text: string): Purpose | null {
  const t = text.toLowerCase();
  if (/(monthly|month end|close|reporting cycle|periodic|every month)/.test(t)) return "monthly_reporting";
  if (/(new (company|entity|subsidiary)|onboard|first (data|file)|acquisition|just (bought|acquired))/.test(t)) return "new_entity";
  if (/(backfill|histor|last (year|quarter)|older periods|archive|prior year)/.test(t)) return "historical_backfill";
  if (/(replace|correct|restate|fix|amend|overwrite)/.test(t)) return "replace_data";
  if (/(one[- ]off|ad ?hoc|analysis|analyse|analyze|quick look|question)/.test(t)) return "one_off_analysis";
  return null;
}

export function matchScope(text: string): "single" | "multiple" | null {
  const t = text.toLowerCase();
  if (/(single|one company|only one|just one|one entity|one brand)/.test(t)) return "single";
  if (/(multiple|many|several|multi|group|all companies|more than one)/.test(t)) return "multiple";
  return null;
}
