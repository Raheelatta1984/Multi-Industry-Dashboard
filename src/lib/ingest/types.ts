/**
 * Meridian AI Ingest — universal raw-file → canonical warehouse pipeline.
 *
 * Stages: source → profile → clean → map (semantic) → publish.
 * Every stage produces an inspectable artifact so the UI can show exactly
 * what the engine did before anything lands in the warehouse.
 */

export type CellValue = string | number | boolean | null;

export type CurrencyCode = import("../domain").CurrencyCode;

/** A raw tabular sheet after header-row detection (step 0). */
export type RawSheet = {
  name: string;
  sheetName: string;
  headers: string[];
  rows: CellValue[][];
  headerRowIndex: number;
};

export type ColumnType =
  | "text"
  | "number"
  | "currency"
  | "percent"
  | "date"
  | "boolean"
  | "category"
  | "id";

export type QualityIssueKind =
  | "nulls"
  | "mixed_format"
  | "outliers"
  | "whitespace"
  | "duplicate_header"
  | "totals_row"
  | "duplicate_rows";

export type QualityIssue = {
  kind: QualityIssueKind;
  severity: "high" | "medium" | "low";
  message: string;
  count?: number;
};

export type ColumnProfile = {
  index: number;
  rawHeader: string;
  cleanHeader: string;
  type: ColumnType;
  typeConfidence: number;
  fillRate: number;
  nulls: number;
  distinct: number;
  distinctRatio: number;
  min: number | null;
  max: number | null;
  samples: string[];
  detectedCurrency: CurrencyCode | null;
  issues: QualityIssue[];
};

export type SheetProfile = {
  sheet: RawSheet;
  columns: ColumnProfile[];
  issues: QualityIssue[];
  rowCount: number;
  qualityScore: number; // 0-100
};

export type CleanStep =
  | { op: "header_normalize"; detail: string }
  | { op: "header_dedupe"; renamed: string[] }
  | { op: "trim_whitespace"; columns: string[]; fixedCells: number }
  | { op: "coerce_dates"; column: string; to: "YYYY-MM-DD"; normalized: number; unparseable: number; convention?: "dmy" | "mdy" }
  | { op: "strip_currency"; column: string; currency: CurrencyCode; normalized: number }
  | { op: "coerce_numbers"; column: string; normalized: number; unparseable: number }
  | { op: "standardize_categories"; column: string; variants: number; map: Array<[string, string]> }
  | { op: "drop_totals_rows"; removed: number; examples: string[] }
  | { op: "dedupe_rows"; removed: number }
  | { op: "drop_empty_rows"; removed: number };

export type CleanedTable = {
  headers: string[];
  types: ColumnType[];
  rows: CellValue[][];
  /** ISO date columns end up as "YYYY-MM-DD" strings, currency as bare numbers. */
  currencyByColumn: Record<string, CurrencyCode>;
};

/** Canonical domains the semantic layer understands (subset of warehouse sheets). */
export type IngestDomain =
  | "revenue"
  | "expenses"
  | "sales"
  | "assets"
  | "licenses"
  | "upcoming"
  | "turnover";

export type DomainClassification = {
  domain: IngestDomain | null;
  confidence: number;
  reasons: string[];
  runnerUp: IngestDomain | null;
};

export type MappingMethod = "exact" | "synonym" | "value_pattern" | "fallback" | "manual" | "none";

export type ColumnMapping = {
  column: string;
  target: string | null;
  confidence: number;
  method: MappingMethod;
  reason: string;
  locked: boolean;
};

export type PublishResult = {
  at: number;
  rowsCommitted: number;
  rowsBySheet: Partial<Record<IngestDomain, number>>;
  coercedValues: Array<{ column: string; from: string; to: string; score: number }>;
  unmappedColumns: string[];
  mappingConfidence: number;
  qualityScore: number;
  report: { added: number; updated: number; skipped: number };
  boardsLit: number;
};

export type IngestRun = {
  id: string;
  fileName: string;
  createdAt: number;
  raw: RawSheet | null;
  profile: SheetProfile | null;
  cleanSteps: CleanStep[];
  cleaned: CleanedTable | null;
  domain: DomainClassification | null;
  mappings: ColumnMapping[];
  result: PublishResult | null;
  /** Set at publish time once the onboarding interview is confirmed. */
  onboardingProfile: OnboardingProfile | null;
};

// ---------------------------------------------------------------------------
// AI onboarding — the guided intake interview that gates every publish
// ---------------------------------------------------------------------------

export type SourceKind = "upload" | "integration" | "pipeline" | "mapping";

export type Purpose =
  | "monthly_reporting"
  | "new_entity"
  | "one_off_analysis"
  | "historical_backfill"
  | "replace_data";

export type OnboardingAnswers = {
  sourceKind: SourceKind | null;
  purpose: Purpose | null;
  purposeNote: string | null;
  entityScope: "single" | "multiple" | null;
  /** Canonical entity labels confirmed during onboarding. */
  entities: string[];
  entitiesConfirmed: boolean;
  departmentScope: "single" | "multiple" | null;
  /** Canonical department labels confirmed during onboarding. */
  departments: string[];
  departmentsConfirmed: boolean;
  fieldsConfirmed: boolean;
  summaryConfirmed: boolean;
};

export type OnboardingProfile = {
  fileName: string;
  sourceKind: SourceKind;
  purpose: Purpose;
  purposeLabel: string;
  purposeNote: string | null;
  entityScope: "single" | "multiple";
  entities: string[];
  departmentScope: "single" | "multiple";
  departments: string[];
  domain: string | null;
  rowCount: number;
  columnCount: number;
  mappedColumns: number;
  excludedColumns: number;
  lowConfidenceColumns: string[];
  mappingConfidence: number;
  qualityScore: number;
  periodFrom: string | null;
  periodTo: string | null;
  currency: string | null;
  completedAt: number;
};

export function emptyOnboarding(sourceKind: SourceKind | null = null): OnboardingAnswers {
  return {
    sourceKind,
    purpose: null,
    purposeNote: null,
    entityScope: null,
    entities: [],
    entitiesConfirmed: false,
    departmentScope: null,
    departments: [],
    departmentsConfirmed: false,
    fieldsConfirmed: false,
    summaryConfirmed: false,
  };
}

export function emptyRun(fileName = ""): IngestRun {
  return {
    id: `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    fileName,
    createdAt: Date.now(),
    raw: null,
    profile: null,
    cleanSteps: [],
    cleaned: null,
    domain: null,
    mappings: [],
    result: null,
    onboardingProfile: null,
  };
}
