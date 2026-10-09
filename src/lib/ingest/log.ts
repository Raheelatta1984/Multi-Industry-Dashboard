/**
 * Onboarding log — a structured, human-readable trail of everything the
 * reviewer did and everything the engine decided. Every entry says what
 * happened and, when something needs attention, what to do about it.
 *
 * The log lives in the ingest store and is rendered on the /ingest screen so
 * the reviewer can follow intake → interview → commit without leaving the page.
 */
import type { CleanStep, IngestRun } from "./types";
import { DOMAIN_FIELD_LIST, FIELD_LABELS } from "./semantic";

export type LogLevel = "info" | "success" | "warn" | "error";

export type LogStage = "intake" | "profile" | "clean" | "model" | "map" | "interview" | "commit" | "import";

export type OnboardingLogEntry = {
  id: string;
  at: number;
  level: LogLevel;
  stage: LogStage;
  title: string;
  /** What the engine or the reviewer did, in plain words. */
  detail?: string;
  /** What to do next when something is wrong or could be better. */
  fix?: string;
  runId?: string;
  fileName?: string;
  /** Key facts shown as a compact grid (used by success entries). */
  facts?: Array<{ label: string; value: string }>;
};

export type LogDraft = Omit<OnboardingLogEntry, "id" | "at">;

let sequence = 0;

export function makeLogEntry(draft: LogDraft): OnboardingLogEntry {
  sequence += 1;
  return { id: `log-${Date.now().toString(36)}-${sequence}`, at: Date.now(), ...draft };
}

export const CLEAN_OP_LABEL: Record<CleanStep["op"], string> = {
  header_normalize: "Normalize headers",
  header_dedupe: "Deduplicate headers",
  trim_whitespace: "Trim whitespace",
  coerce_dates: "Standardize dates to YYYY-MM-DD",
  strip_currency: "Strip currency symbols → numeric",
  coerce_numbers: "Coerce to numeric",
  standardize_categories: "Standardize category spellings",
  drop_totals_rows: "Drop total / subtotal rows",
  dedupe_rows: "Remove duplicate rows",
  drop_empty_rows: "Drop empty rows",
};

export function cleanStepDetail(s: CleanStep): string {
  switch (s.op) {
    case "header_normalize":
      return s.detail;
    case "header_dedupe":
      return s.renamed.join(", ");
    case "trim_whitespace":
      return `${s.fixedCells} cells across ${s.columns.length} columns`;
    case "coerce_dates":
      return `${s.normalized} normalized · ${s.unparseable} unparseable → null${s.convention ? ` · ${s.convention === "dmy" ? "day-first (DD/MM)" : "month-first (MM/DD)"} detected` : ""}`;
    case "strip_currency":
      return `${s.normalized} values → plain numbers (detected ${s.currency})`;
    case "coerce_numbers":
      return `${s.normalized} converted · ${s.unparseable} unparseable → null`;
    case "standardize_categories":
      return `${s.variants} variants${s.map.length ? ` — e.g. ${s.map.slice(0, 2).map(([a, b]) => `“${a}”→“${b}”`).join(", ")}` : ""}`;
    case "drop_totals_rows":
      return `${s.removed} rows removed${s.examples.length ? ` (e.g. “${s.examples[0]}”)` : ""}`;
    case "dedupe_rows":
      return `${s.removed} exact duplicates removed`;
    case "drop_empty_rows":
      return `${s.removed} rows removed`;
  }
}

const ISSUE_FIX: Record<string, string> = {
  nulls: "Fill in the blank cells in the source file, or confirm they are genuinely empty.",
  mixed_format: "Use one format for this column (dates as YYYY-MM-DD, amounts as plain numbers).",
  outliers: "Check for typing errors such as an extra zero.",
  duplicate_header: "Give every column a unique header name.",
  duplicate_rows: "Duplicate rows were removed automatically. Check the export if you expected them.",
  whitespace: "Stray spaces were trimmed automatically.",
  totals_row: "Total rows are removed automatically, so nothing to do.",
};

const FIELD_NOUN: Record<string, string> = {
  date: "a date",
  due_date: "a due date",
  period: "a period (month or quarter)",
  amount: "an amount (numbers)",
  units: "a quantity (whole numbers)",
  name: "a name",
  cost: "a cost (numbers)",
  book_value: "a book value (numbers)",
  cogs: "cost of goods sold (numbers)",
  seats: "a seat count (whole numbers)",
  inventory_end: "a closing stock figure (numbers)",
};

/** Plain-language description of what is needed for a required model field. */
export function requiredFieldNeed(field: string): string {
  return FIELD_NOUN[field] ?? `a column for ${field.replace(/_/g, " ")}`;
}

/** What the reviewer should do about a required field that has no column. */
export function requiredFieldFix(field: string, numericCandidates: string[]): string {
  const label = FIELD_LABELS[field] ?? field.replace(/_/g, " ");
  if (numericCandidates.length) {
    return `Map “${numericCandidates[0]}” to ${label} in the mapping table (click its dropdown and choose it).`;
  }
  return `Add ${requiredFieldNeed(field)} to the file, then re-upload it. No unmapped column in this file looks like one.`;
}

/**
 * Intake log: what arrived, how it was read, what the engine decided.
 * Called once per staged file so the reviewer sees the whole pipeline.
 */
export function describeIntake(run: IngestRun): LogDraft[] {
  const base = { runId: run.id, fileName: run.fileName };
  const out: LogDraft[] = [];
  const raw = run.raw;
  if (!raw || !run.profile || !run.cleaned) return out;

  out.push({
    ...base,
    level: "info",
    stage: "intake",
    title: `Received “${run.fileName}”`,
    detail:
      `Sheet “${raw.sheetName}” · ${raw.rows.length} data rows · ${raw.headers.length} columns · header found on row ${raw.headerRowIndex + 1}` +
      (raw.headerRowIndex > 0 ? " (title rows above it were ignored)" : ""),
  });

  const q = run.profile.qualityScore;
  out.push({
    ...base,
    level: q >= 80 ? "success" : q >= 70 ? "info" : "warn",
    stage: "profile",
    title: `Profiled ${run.profile.columns.length} columns · quality ${q}/100`,
    detail: run.profile.issues.length
      ? run.profile.issues.map((i) => i.message).join(" · ")
      : "No sheet-level findings.",
    fix: q < 70 ? "Clear the high-severity findings in the Profile table, then re-upload." : undefined,
  });
  for (const col of run.profile.columns) {
    for (const issue of col.issues) {
      if (issue.severity !== "high" && issue.kind !== "mixed_format") continue;
      out.push({
        ...base,
        level: issue.severity === "high" ? "warn" : "info",
        stage: "profile",
        title: `Column “${col.rawHeader}”: ${issue.message}`,
        fix: ISSUE_FIX[issue.kind],
      });
    }
  }

  const steps = run.cleanSteps;
  out.push({
    ...base,
    level: "info",
    stage: "clean",
    title: `Cleaning recipe: ${steps.length} step${steps.length === 1 ? "" : "s"}`,
    detail: steps.map((s) => `${CLEAN_OP_LABEL[s.op]} (${cleanStepDetail(s)})`).join(" · "),
  });
  for (const s of steps) {
    if (s.op === "coerce_numbers" && s.unparseable > 0) {
      out.push({
        ...base,
        level: "warn",
        stage: "clean",
        title: `${s.unparseable} value${s.unparseable === 1 ? "" : "s"} in “${s.column}” could not be read as numbers`,
        detail: "They were left blank, so those rows may be skipped at commit.",
        fix: `Open the source file, correct the cells in “${s.column}”, and re-upload.`,
      });
    }
    if (s.op === "coerce_dates" && s.unparseable > 0) {
      out.push({
        ...base,
        level: "warn",
        stage: "clean",
        title: `${s.unparseable} date${s.unparseable === 1 ? "" : "s"} in “${s.column}” could not be read`,
        detail: "They were left blank and those rows will be dated today if the model needs a date.",
        fix: "Use YYYY-MM-DD or DD/MM/YYYY for every date in this column.",
      });
    }
    if (s.op === "coerce_dates" && s.convention) {
      out.push({
        ...base,
        level: "info",
        stage: "clean",
        title: `Dates in “${s.column}” read as ${s.convention === "dmy" ? "day-first (DD/MM)" : "month-first (MM/DD)"}`,
        detail: "Detected from the unambiguous values in the column.",
      });
    }
  }

  const dom = run.domain;
  if (dom?.domain) {
    out.push({
      ...base,
      level: dom.confidence >= 0.5 ? "info" : "warn",
      stage: "model",
      title: `Target model: ${dom.domain} (${Math.round(dom.confidence * 100)}% confidence)`,
      detail: dom.reasons.join(" · ") || undefined,
      fix: dom.confidence < 0.5 ? "Confirm the data type in the interview or under “Target model”." : undefined,
    });
  } else {
    out.push({
      ...base,
      level: "warn",
      stage: "model",
      title: "No target model detected",
      detail: "None of the column names matched a known data type (revenue, expenses, sales, assets, licences, upcoming payments, inventory).",
      fix: "Choose what the file contains under “Target model” in the mapping panel, or rename headers to words like Amount, Date, Qty, Vendor or Stock.",
    });
  }

  const mapped = run.mappings.filter((m) => m.target);
  const excluded = run.mappings.filter((m) => !m.target);
  const avg = mapped.length ? Math.round((mapped.reduce((a, m) => a + m.confidence, 0) / mapped.length) * 100) : 0;
  out.push({
    ...base,
    level: mapped.length ? "info" : "warn",
    stage: "map",
    title: `Mapped ${mapped.length} of ${run.mappings.length} columns · average confidence ${avg}%`,
    detail: mapped.map((m) => `${m.column} → ${m.target}`).join(" · ") || "Nothing mapped yet.",
  });
  if (excluded.length) {
    out.push({
      ...base,
      level: "info",
      stage: "map",
      title: `${excluded.length} column${excluded.length === 1 ? "" : "s"} left out of the model`,
      detail: excluded.map((m) => `“${m.column}”`).join(", "),
      fix: "If one of these holds data you need, map it in the mapping table.",
    });
  }
  for (const m of mapped) {
    if (m.confidence < 0.9) {
      out.push({
        ...base,
        level: "warn",
        stage: "map",
        title: `Low-confidence mapping: “${m.column}” → ${m.target} (${Math.round(m.confidence * 100)}%)`,
        detail: m.reason,
        fix: "Confirm it in the mapping table, or choose the right field.",
      });
    }
  }
  if (dom?.domain) {
    const required = DOMAIN_FIELD_LIST[dom.domain].required;
    for (const field of required) {
      if (run.mappings.some((m) => m.target === field)) continue;
      out.push({
        ...base,
        level: "warn",
        stage: "map",
        title: `Required field “${FIELD_LABELS[field] ?? field}” has no column yet`,
        detail: `${dom.domain} data needs ${requiredFieldNeed(field)}.`,
        fix: requiredFieldFix(field, numericCandidates(run)),
      });
    }
  }
  return out;
}

/** Unmapped columns whose values are numeric — candidates for a missing measure. */
export function numericCandidates(run: IngestRun): string[] {
  const numericTypes = new Set(["number", "currency", "percent"]);
  return run.mappings
    .filter((m) => !m.target)
    .filter((m) => {
      const col = run.profile?.columns.find((c) => c.cleanHeader === m.column);
      return col ? numericTypes.has(col.type) : false;
    })
    .map((m) => m.column);
}

/** Plain text export of log entries for support or audit. */
export function logToText(entries: OnboardingLogEntry[]): string {
  const lines: string[] = [];
  for (const e of entries) {
    const stamp = new Date(e.at).toISOString();
    lines.push(`${stamp} [${e.level.toUpperCase()}] (${e.stage}) ${e.fileName ? `${e.fileName} — ` : ""}${e.title}`);
    if (e.detail) lines.push(`    ${e.detail}`);
    if (e.fix) lines.push(`    Fix: ${e.fix}`);
    for (const f of e.facts ?? []) lines.push(`    ${f.label}: ${f.value}`);
  }
  return `${lines.join("\n")}\n`;
}
