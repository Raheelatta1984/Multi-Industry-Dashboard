/**
 * Commit readiness — the one place that answers "can this file land in the
 * warehouse, and if not, exactly what should the reviewer do?"
 *
 * The chat, the commit panel, the store's publish gate and the tests all read
 * from `evaluateCommit`, so a refusal always names the same reasons and the
 * same fixes wherever the reviewer clicks.
 */
import { DEPARTMENTS, INDUSTRIES, type DepartmentId, type IndustryId } from "../domain";
import type { Workbook } from "../types";
import { boardsLit, buildPartialWorkbook, keyCollisions, type CommitScope, type PartialPlan } from "./publish";
import { detectDepartments, detectEntities, domainLabel, mappingStats, PURPOSE_LABELS } from "./onboarding";
import { DOMAIN_FIELD_LIST, FIELD_LABELS } from "./semantic";
import { requiredFieldFix, requiredFieldNeed } from "./log";
import type { IngestDomain, IngestRun, OnboardingAnswers } from "./types";

export type CheckLevel = "pass" | "fail" | "warn" | "info";
export type CheckGroup = "interview" | "model" | "mapping" | "rows" | "scope" | "quality";

export type CommitCheck = {
  id: string;
  group: CheckGroup;
  level: CheckLevel;
  title: string;
  detail?: string;
  /** What the reviewer should do. Always present on fail and warn. */
  fix?: string;
};

export type CommitEvaluation = {
  ready: boolean;
  checks: CommitCheck[];
  blockers: CommitCheck[];
  warnings: CommitCheck[];
  scope: CommitScope;
  plan: PartialPlan | null;
  plannedRows: number;
  boardsLit: number;
  possibleDuplicates: number;
};

export const GROUP_TITLE: Record<CheckGroup, string> = {
  interview: "Interview",
  model: "Target model",
  mapping: "Required fields",
  rows: "Rows",
  scope: "Answers vs data",
  quality: "Quality",
};

/** Interview answers → the defaults the warehouse applies to rows that lack their own value. */
export function commitScopeFor(onboarding: OnboardingAnswers | null): CommitScope {
  const company = onboarding?.entityScope === "single" ? onboarding.entities[0] : undefined;
  const department = onboarding?.departmentScope === "single" ? onboarding.departments[0] : undefined;
  return {
    industry: company ? (INDUSTRIES.find((i) => i.label === company || i.id === company)?.id as IndustryId | undefined) ?? null : null,
    department: department
      ? (DEPARTMENTS.find((d) => d.label === department || d.id === department)?.id as DepartmentId | undefined) ?? null
      : null,
    purpose: onboarding?.purpose ?? null,
  };
}

function rowsOf(wb: Workbook, domain: IngestDomain): Array<{ id: string }> {
  return wb[domain] as unknown as Array<{ id: string }>;
}

/** Existing warehouse rows (any fact sheet) that belong to one company. */
function companyRowCount(wb: Workbook, industry: string): number {
  return [wb.revenue, wb.expenses, wb.sales, wb.turnover, wb.upcoming].reduce(
    (acc, rows) => acc + (rows as unknown as Array<{ industry: string }>).filter((r) => r.industry === industry).length,
    0,
  );
}

function plural(n: number, word: string, plural = `${word}s`): string {
  return `${n} ${n === 1 ? word : plural}`;
}

function fixForSkip(reason: string): string {
  if (reason.startsWith("Amount")) return "Make sure the amount column holds numbers (not text) and that the amounts are not zero.";
  if (reason.startsWith("Quantity")) return "Map a quantity column to Units, or add unit price and amount so the quantity can be worked out.";
  if (reason.startsWith("Asset") || reason.startsWith("Licence")) return "Map a name column to Name.";
  if (reason.startsWith("Description")) return "Map a description or memo column to Description.";
  if (reason.startsWith("Closing")) return "Map the closing stock column to Closing stock and make sure it holds numbers.";
  return "Fill in the required values in the source file and re-upload it.";
}

function describeDefault(column: string, from: string, to: string, count: number): string {
  const rows = plural(count, "row");
  const assumed = to.replace(" (default)", "").replace(" (your answer)", "");
  if (from === "(no currency stated)") return `${rows}: no currency given for “${column}” → assumed ${assumed}`;
  if (from.startsWith("(")) return `${rows} with no ${column} → ${assumed}`;
  return `${rows}: ${column} “${from}” not recognised → ${assumed}`;
}

function fixForDefault(column: string): string {
  if (column === "company") return "Choose the company this file belongs to (single company answer), or add a company column with names such as “Retail”.";
  if (column === "department") return "Choose the department this file belongs to, or add a department column.";
  if (column === "region") return "Use AMER, EMEA, APAC or LATAM, or a country or US state name. For example “US East” becomes AMER.";
  if (column === "channel") return "Use Direct, Online, Partner or Wholesale, or words like e-com, retail or distributor.";
  if (column === "currency" || /\b(usd|amount|cost|cogs|spend)\b/i.test(column)) {
    return "Write the currency in the amount column or its header, for example “Amount (GBP)”.";
  }
  if (/date|period|start|end|acquired/.test(column)) return "Write these dates as YYYY-MM-DD. Rows without a usable date are dated today.";
  return "Correct these values in the source file and re-upload it.";
}

/** Candidate columns for a required field, by the kind of value it needs. */
export function candidatesFor(run: IngestRun, field: string): string[] {
  const dateFields = new Set(["date", "due_date", "period", "acquired", "start", "end"]);
  const textFields = new Set(["name"]);
  return run.mappings
    .filter((m) => !m.target)
    .filter((m) => {
      const col = run.profile?.columns.find((c) => c.cleanHeader === m.column);
      if (!col) return false;
      if (dateFields.has(field)) return col.type === "date";
      if (textFields.has(field)) return col.type === "text" || col.type === "id";
      return col.type === "number" || col.type === "currency" || col.type === "percent";
    })
    .map((m) => m.column);
}

/**
 * Evaluate every condition for committing the staged file. A check with
 * level "fail" is a blocker; the store refuses to commit while any exist.
 */
export function evaluateCommit(run: IngestRun | null, onboarding: OnboardingAnswers | null, current: Workbook): CommitEvaluation {
  const checks: CommitCheck[] = [];
  const add = (c: CommitCheck) => checks.push(c);
  const scope = commitScopeFor(onboarding);

  if (!run) {
    add({
      id: "staged",
      group: "model",
      level: "fail",
      title: "No file staged",
      fix: "Upload a file or try a sample file in the chat first.",
    });
    return finish(checks, scope, null, 0, 0, 0);
  }

  // 1 — Interview gates
  const purpose = onboarding?.purpose;
  add(
    purpose
      ? { id: "purpose", group: "interview", level: "pass", title: `Purpose: ${PURPOSE_LABELS[purpose]}` }
      : {
          id: "purpose",
          group: "interview",
          level: "fail",
          title: "Purpose not answered",
          fix: "Answer “Why are you injecting this data?” in the chat.",
        },
  );
  const companiesOk = Boolean(onboarding?.entityScope && onboarding.entitiesConfirmed);
  add(
    companiesOk
      ? {
          id: "companies",
          group: "interview",
          level: "pass",
          title:
            onboarding?.entityScope === "single"
              ? `Company: ${onboarding.entities[0] ?? "—"}`
              : `Companies: multiple (${onboarding?.entities.length ?? 0})`,
        }
      : {
          id: "companies",
          group: "interview",
          level: "fail",
          title: "Company scope not confirmed",
          fix: "Answer the company question in the chat (single or multiple) and confirm the companies.",
        },
  );
  const deptsOk = Boolean(onboarding?.departmentScope && onboarding.departmentsConfirmed);
  add(
    deptsOk
      ? {
          id: "departments",
          group: "interview",
          level: "pass",
          title:
            onboarding?.departmentScope === "single"
              ? `Department: ${onboarding.departments[0] ?? "—"}`
              : `Departments: multiple (${onboarding?.departments.length ?? 0})`,
        }
      : {
          id: "departments",
          group: "interview",
          level: "fail",
          title: "Department scope not confirmed",
          fix: "Answer the department question in the chat, then confirm.",
        },
  );
  add(
    onboarding?.fieldsConfirmed
      ? { id: "fields", group: "interview", level: "pass", title: "Field-by-field review confirmed" }
      : {
          id: "fields",
          group: "interview",
          level: "fail",
          title: "Field review not confirmed",
          fix: "Check the mapping table, then choose “Fields confirmed” in the chat.",
        },
  );
  add(
    onboarding?.summaryConfirmed
      ? { id: "summary", group: "interview", level: "pass", title: "Onboarding profile confirmed" }
      : {
          id: "summary",
          group: "interview",
          level: "fail",
          title: "Onboarding profile not confirmed",
          fix: "Choose “Confirm onboarding” in the chat once the profile looks right.",
        },
  );

  // 2 — Target model
  const domain = run.domain?.domain ?? null;
  if (domain) {
    const chosen = run.domain?.reasons.includes("chosen by reviewer");
    add({
      id: "model",
      group: "model",
      level: chosen || (run.domain?.confidence ?? 0) >= 0.5 ? "pass" : "warn",
      title: `${domainLabel(domain)}${chosen ? " (chosen by reviewer)" : ` · ${Math.round((run.domain?.confidence ?? 0) * 100)}% confidence`}`,
      fix: chosen || (run.domain?.confidence ?? 0) >= 0.5 ? undefined : "Confirm the data type under “Target model”.",
    });
  } else {
    add({
      id: "model",
      group: "model",
      level: "fail",
      title: "No target model",
      detail: "The column names don't match a known data type, so the engine doesn't know which fields to fill.",
      fix: "Choose what the file contains under “Target model” in the mapping panel.",
    });
  }

  // 3 — Required fields for the chosen model
  if (domain) {
    for (const field of DOMAIN_FIELD_LIST[domain].required) {
      const m = run.mappings.find((x) => x.target === field);
      const label = FIELD_LABELS[field] ?? field;
      if (m) {
        add({
          id: `req-${field}`,
          group: "mapping",
          level: "pass",
          title: `${label} ← “${m.column}”`,
          detail: `${Math.round(m.confidence * 100)}% · ${m.reason}`,
        });
      } else {
        const cands = candidatesFor(run, field);
        add({
          id: `req-${field}`,
          group: "mapping",
          level: "fail",
          title: `Required field “${label}” has no column`,
          detail: `${domainLabel(domain)} needs ${requiredFieldNeed(field)}.`,
          fix: requiredFieldFix(field, cands),
        });
      }
    }
    const stats = mappingStats(run.mappings);
    add({
      id: "coverage",
      group: "mapping",
      level: "info",
      title: `${stats.mapped} of ${run.mappings.length} columns mapped`,
      detail: stats.excluded ? `${stats.excluded} left out of the model.` : undefined,
    });
    if (stats.lowConfidence.length) {
      add({
        id: "low-confidence",
        group: "mapping",
        level: "warn",
        title: `${plural(stats.lowConfidence.length, "mapping")} below 90% confidence`,
        detail: stats.lowConfidence.map((m) => `“${m.column}” → ${m.target}`).join(", "),
        fix: "Check them in the mapping table and change any that look wrong.",
      });
    }
  }

  // 4 — Rows that would land
  let plan: PartialPlan | null = null;
  let plannedRows = 0;
  let possibleDuplicates = 0;
  if (domain && run.cleaned) {
    plan = buildPartialWorkbook(run.cleaned, run.mappings, domain, current, scope);
    plannedRows = plan.committed;
    const skippedTotal = plan.skipped.reduce((acc, s) => acc + s.count, 0);
    if (plannedRows === 0) {
      const top = plan.skipped[0];
      add({
        id: "rows",
        group: "rows",
        level: "fail",
        title: "No rows would be committed",
        detail: top
          ? `${plural(top.count, "row")} skipped: ${top.reason}.`
          : "The file has no usable data rows after cleaning.",
        fix: top ? fixForSkip(top.reason) : "Check that the file has data rows under its header.",
      });
    } else {
      add({
        id: "rows",
        group: "rows",
        level: "pass",
        title: `${plural(plannedRows, "row")} ready to commit`,
        detail: `${run.profile?.rowCount ?? plannedRows} source rows → ${plannedRows} committed.`,
      });
      if (skippedTotal) {
        add({
          id: "rows-skipped",
          group: "rows",
          level: "warn",
          title: `${plural(skippedTotal, "row")} will be skipped`,
          detail: plan.skipped.map((s) => `${s.count} × ${s.reason.toLowerCase()}`).join(" · "),
          fix: "Fill in the missing values in the source file if those rows matter, then re-upload.",
        });
      }
    }

    for (const d of plan.defaults.slice(0, 6)) {
      // A blank value filled from your interview answer is expected (info).
      // A value that was present but not recognised is a data problem (warn).
      const expected = d.to.includes("(your answer)") && d.from.startsWith("(");
      add({
        id: `default-${d.column}-${d.from}-${d.to}`,
        group: "rows",
        level: expected ? "info" : "warn",
        title: describeDefault(d.column, d.from, d.to, d.count),
        detail: expected ? "Your interview answer was applied to these rows." : undefined,
        fix: expected ? undefined : fixForDefault(d.column),
      });
    }

    const collisions = keyCollisions(domain, rowsOf(plan.workbook, domain), rowsOf(current, domain));
    possibleDuplicates = collisions.count;
    if (collisions.count > 0) {
      const isReplace = scope.purpose === "replace_data";
      add({
        id: "possible-duplicates",
        group: "rows",
        level: "warn",
        title: `${plural(collisions.count, "row")} match existing warehouse rows but carry different amounts`,
        detail: `For example: ${collisions.examples.join(" ; ")}.`,
        fix: isReplace
          ? "These matched more than one existing row, so they were added instead of replacing one. Remove the old copies first."
          : "If these correct figures already committed, choose “Correct / replace data” so they update those rows instead of being counted twice.",
      });
    }
    if (scope.purpose === "replace_data" && plannedRows > 0 && plan.rowsReplaced === 0) {
      add({
        id: "replace-none",
        group: "rows",
        level: "warn",
        title: "“Correct / replace” found no rows to replace",
        detail: "None of these rows match an existing warehouse row, so they will be added as new rows.",
        fix: "Check that dates, company, product and channel are spelled exactly as in the warehouse, or pick the purpose that matches this file.",
      });
    }
  }

  // 5 — Answers that disagree with the data
  const entities = run.cleaned ? detectEntities(run.cleaned, run.mappings) : [];
  const distinctCompanies = [...new Set(entities.map((e) => e.raw.toLowerCase()))];
  if (onboarding?.entityScope === "single" && distinctCompanies.length > 1) {
    add({
      id: "scope-company",
      group: "scope",
      level: "warn",
      title: `You chose a single company, but the file names ${distinctCompanies.length} companies`,
      detail: `${entities.slice(0, 5).map((e) => e.raw).join(", ")}${entities.length > 5 ? "…" : ""}. Rows keep the company written in the file.`,
      fix: "If these rows belong to different companies, go back and choose “Multiple companies”.",
    });
  }
  if (onboarding?.entityScope === "multiple" && distinctCompanies.length === 1) {
    add({
      id: "scope-company-one",
      group: "scope",
      level: "info",
      title: "Only one company appears in the file",
      fix: "“Single company” may be the more accurate answer.",
    });
  }
  const departments = run.cleaned ? detectDepartments(run.cleaned, run.mappings) : [];
  const distinctDepts = [...new Set(departments.map((d) => d.raw.toLowerCase()))];
  if (onboarding?.departmentScope === "single" && distinctDepts.length > 1) {
    add({
      id: "scope-dept",
      group: "scope",
      level: "warn",
      title: `You chose a single department, but the file names ${distinctDepts.length} functions`,
      detail: departments.slice(0, 5).map((d) => d.raw).join(", "),
      fix: "If the rows belong to several functions, go back and choose “Multiple departments”.",
    });
  }
  if (onboarding?.departmentScope === "multiple" && distinctDepts.length === 1) {
    add({
      id: "scope-dept-one",
      group: "scope",
      level: "info",
      title: "Only one department appears in the file",
      fix: "“Single department” may be the more accurate answer.",
    });
  }
  const companyIds = new Set<string>();
  if (scope.industry) companyIds.add(scope.industry);
  for (const e of entities) {
    const id = INDUSTRIES.find((i) => i.label === e.label)?.id;
    if (id) companyIds.add(id);
  }
  if (purpose === "new_entity") {
    for (const id of companyIds) {
      const existing = companyRowCount(current, id);
      if (existing > 0) {
        add({
          id: `new-entity-${id}`,
          group: "scope",
          level: "warn",
          title: `You chose “New entity”, but ${INDUSTRIES.find((i) => i.id === id)?.label ?? id} already has ${plural(existing, "row")} in the warehouse`,
          fix: "If this is the same company, choose “Monthly reporting cycle” or “Correct / replace data” instead.",
        });
      }
    }
  }
  if (purpose === "monthly_reporting" && companyIds.size && [...companyIds].every((id) => companyRowCount(current, id) === 0)) {
    add({
      id: "monthly-first",
      group: "scope",
      level: "info",
      title: "This looks like the first data for this company",
      fix: "Choose “New entity onboarding” so its history is kept separate from the rest of the group.",
    });
  }

  // 6 — Quality
  if (run.profile && run.profile.qualityScore < 70) {
    add({
      id: "quality",
      group: "quality",
      level: "warn",
      title: `Data quality ${run.profile.qualityScore}/100`,
      detail: run.profile.issues.map((i) => i.message).join(" · ") || undefined,
      fix: "Clear the high-severity findings in the Profile table and re-upload for a cleaner commit.",
    });
  }

  const boards = plan ? boardsLit(plan.workbook) : 0;
  return finish(checks, scope, plan, plannedRows, boards, possibleDuplicates);
}

function finish(
  checks: CommitCheck[],
  scope: CommitScope,
  plan: PartialPlan | null,
  plannedRows: number,
  boards: number,
  possibleDuplicates: number,
): CommitEvaluation {
  const blockers = checks.filter((c) => c.level === "fail");
  const warnings = checks.filter((c) => c.level === "warn");
  return {
    ready: blockers.length === 0,
    checks,
    blockers,
    warnings,
    scope,
    plan,
    plannedRows,
    boardsLit: boards,
    possibleDuplicates,
  };
}
