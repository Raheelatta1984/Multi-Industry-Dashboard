/**
 * Ingest session state — the staged run, the committed-source registry the
 * warehouse page renders, and the onboarding log the /ingest screen shows.
 * Human-in-the-loop: every AI mapping can be overridden before publish, and
 * overrides are marked as such.
 *
 * The publish gate lives here, so no UI path can commit around it: `publish`
 * re-evaluates readiness and refuses with the specific reasons when anything
 * is missing.
 */
import { create } from "zustand";
import { useAppStore } from "../store";
import { buildRawSheet, profileSheet, readRawSheet } from "./profile";
import { cleanSheet } from "./clean";
import { classifyDomain, DOMAIN_FIELD_LIST, FIELD_LABELS, mapColumns } from "./semantic";
import { publishRun } from "./publish";
import { buildProfile, domainLabel } from "./onboarding";
import { describeIntake, makeLogEntry, requiredFieldFix, requiredFieldNeed, numericCandidates, type LogDraft, type OnboardingLogEntry } from "./log";
import { evaluateCommit, type CommitCheck } from "./preflight";
import type { CellValue, IngestDomain, IngestRun, OnboardingAnswers } from "./types";
import { emptyOnboarding, emptyRun } from "./types";

const LOG_CAP = 400;

function advance(run: IngestRun): IngestRun {
  const profile = run.raw ? profileSheet(run.raw) : null;
  if (!profile) return run;
  const { table, steps } = cleanSheet(profile);
  const domain = classifyDomain(table);
  const mappings = domain.domain ? mapColumns(table, profile.columns, domain.domain) : mapColumns(table, profile.columns, null);
  return { ...run, profile, cleanSteps: steps, cleaned: table, domain, mappings };
}

function appendLogs(existing: OnboardingLogEntry[], drafts: LogDraft[]): OnboardingLogEntry[] {
  if (!drafts.length) return existing;
  return [...existing, ...drafts.map(makeLogEntry)].slice(-LOG_CAP);
}

export type PublishOutcome =
  | { ok: true; run: IngestRun; warnings: CommitCheck[] }
  | { ok: false; blockers: CommitCheck[]; warnings: CommitCheck[] };

export type IngestStore = {
  active: IngestRun | null;
  history: IngestRun[];
  /** The intake interview. Publish is refused until it is confirmed. */
  onboarding: OnboardingAnswers | null;
  /** Session log of intake, interview, mapping and commit events. */
  logs: OnboardingLogEntry[];
  ingestGrid: (fileName: string, sheetName: string, grid: CellValue[][]) => IngestRun;
  ingestBuffer: (fileName: string, buffer: ArrayBuffer) => IngestRun;
  setActive: (id: string) => void;
  overrideMapping: (column: string, target: string | null) => void;
  /** Reviewer picks the data model (or clears it) and the mapping is re-run. */
  setDomain: (domain: IngestDomain | null) => void;
  patchOnboarding: (partial: Partial<OnboardingAnswers>) => void;
  publish: () => PublishOutcome;
  log: (draft: LogDraft) => void;
  clearLogs: () => void;
  clearActive: () => void;
};

export const useIngestStore = create<IngestStore>((set, get) => ({
  active: null,
  history: [],
  onboarding: null,
  logs: [],
  ingestGrid: (fileName, sheetName, grid) => {
    const raw = buildRawSheet(grid, fileName, sheetName);
    const run = advance({ ...emptyRun(fileName), raw });
    set({
      active: run,
      // A new file restarts the interview, but remembers how data arrived.
      onboarding: emptyOnboarding(get().onboarding?.sourceKind ?? null),
      history: [run, ...get().history.filter((r) => r.id !== run.id)].slice(0, 24),
      logs: appendLogs(get().logs, describeIntake(run)),
    });
    return run;
  },
  ingestBuffer: (fileName, buffer) => {
    let run: IngestRun;
    try {
      const raw = readRawSheet(buffer, fileName);
      run = advance({ ...emptyRun(fileName), raw });
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error";
      set({
        logs: appendLogs(get().logs, [
          {
            level: "error",
            stage: "intake",
            title: `Could not read “${fileName}”`,
            detail: message,
            fix: "Save the file as .xlsx or .csv, keep the column headers in the first rows, and upload it again.",
            fileName,
          },
        ]),
      });
      throw err;
    }
    set({
      active: run,
      onboarding: emptyOnboarding(get().onboarding?.sourceKind ?? null),
      history: [run, ...get().history.filter((r) => r.id !== run.id)].slice(0, 24),
      logs: appendLogs(get().logs, describeIntake(run)),
    });
    return run;
  },
  setActive: (id) => {
    const found = get().history.find((r) => r.id === id);
    if (found) set({ active: found });
  },
  overrideMapping: (column, target) => {
    const active = get().active;
    if (!active || active.result) return;
    const displaced: string[] = [];
    const mappings = active.mappings.map((m) => {
      if (m.column === column) {
        return {
          ...m,
          target,
          confidence: target ? 1 : m.confidence,
          method: (target ? "manual" : "none") as (typeof m)["method"],
          reason: target ? "set by human reviewer" : "excluded by human reviewer",
          locked: true,
        };
      }
      // A field can only be fed by one column; moving it frees the other column.
      if (target && m.target === target) {
        displaced.push(m.column);
        return {
          ...m,
          target: null,
          confidence: 0,
          method: "none" as const,
          reason: `moved to ${FIELD_LABELS[target] ?? target} by human reviewer`,
          locked: true,
        };
      }
      return m;
    });
    const run = { ...active, mappings };
    const label = target ? (FIELD_LABELS[target] ?? target) : null;
    set({
      active: run,
      history: get().history.map((r) => (r.id === run.id ? run : r)),
      logs: appendLogs(get().logs, [
        {
          runId: run.id,
          fileName: run.fileName,
          level: "info",
          stage: "map",
          title: target ? `Mapping changed: “${column}” → ${label}` : `Mapping changed: “${column}” left out of the model`,
          detail: displaced.length ? `“${displaced.join("”, “")}” no longer feeds ${label} — each field takes one column.` : "Set by the reviewer.",
        },
      ]),
    });
  },
  setDomain: (domain) => {
    const active = get().active;
    if (!active?.cleaned || !active.profile || active.result) return;
    const previous = active.domain?.domain ?? null;
    if (previous === domain) return;
    const allowed = domain
      ? new Set<string>([...DOMAIN_FIELD_LIST[domain].required, ...DOMAIN_FIELD_LIST[domain].optional])
      : new Set<string>();
    const fresh = mapColumns(active.cleaned, active.profile.columns, domain);
    // Keep reviewer overrides that still fit the new model; drop the rest and say so.
    const dropped: string[] = [];
    const kept: string[] = [];
    const mappings = fresh.map((m) => {
      const old = active.mappings.find((o) => o.column === m.column && o.locked);
      if (!old) return m;
      if (old.target === null || allowed.has(old.target)) {
        kept.push(m.column);
        return old;
      }
      dropped.push(`“${m.column}” (${FIELD_LABELS[old.target] ?? old.target})`);
      return m;
    });
    const run: IngestRun = {
      ...active,
      domain: domain
        ? { domain, confidence: 1, reasons: ["chosen by reviewer"], runnerUp: null }
        : null,
      mappings,
    };
    const drafts: LogDraft[] = [
      {
        runId: run.id,
        fileName: run.fileName,
        level: "info",
        stage: "model",
        title: domain
          ? `Target model set to ${domainLabel(domain)} by reviewer`
          : "Target model cleared by reviewer",
        detail: `Was: ${previous ? domainLabel(previous) : "none"}.${kept.length ? ` Kept ${kept.length} manual mapping${kept.length === 1 ? "" : "s"}.` : ""}${dropped.length ? ` Dropped ${dropped.join(", ")} — that field does not exist in this model.` : ""}`,
      },
    ];
    if (domain) {
      for (const field of DOMAIN_FIELD_LIST[domain].required) {
        if (mappings.some((m) => m.target === field)) continue;
        drafts.push({
          runId: run.id,
          fileName: run.fileName,
          level: "warn",
          stage: "map",
          title: `Required field “${FIELD_LABELS[field] ?? field}” has no column yet`,
          detail: `${domainLabel(domain)} needs ${requiredFieldNeed(field)}.`,
          fix: requiredFieldFix(field, numericCandidates(run)),
        });
      }
    }
    set({
      active: run,
      history: get().history.map((r) => (r.id === run.id ? run : r)),
      logs: appendLogs(get().logs, drafts),
    });
  },
  patchOnboarding: (partial) => {
    const current = get().onboarding ?? emptyOnboarding();
    set({ onboarding: { ...current, ...partial } });
  },
  log: (draft) => {
    const active = get().active;
    // Entries that name their own file are not attributed to whatever run is staged.
    const enriched: LogDraft = draft.fileName ? draft : { runId: active?.id, fileName: active?.fileName, ...draft };
    set({ logs: appendLogs(get().logs, [enriched]) });
  },
  clearLogs: () => set({ logs: [] }),
  publish: () => {
    const active = get().active;
    const ob = get().onboarding;
    const app = useAppStore.getState();
    const runFields = { runId: active?.id, fileName: active?.fileName };

    if (!active) {
      get().log({
        ...runFields,
        level: "error",
        stage: "commit",
        title: "Commit refused — no file is staged",
        fix: "Upload a file or try a sample file first.",
      });
      return {
        ok: false,
        blockers: [{ id: "staged", group: "model", level: "fail", title: "No file staged", fix: "Upload a file or try a sample file first." }],
        warnings: [],
      };
    }

    get().log({ ...runFields, level: "info", stage: "commit", title: "Commit requested", detail: "Checking every condition before anything is written." });
    const evaluation = evaluateCommit(active, ob, app.workbook);
    if (!evaluation.ready) {
      const drafts: LogDraft[] = [
        {
          ...runFields,
          level: "error",
          stage: "commit",
          title: `Commit refused — ${evaluation.blockers.length} item${evaluation.blockers.length === 1 ? "" : "s"} to fix first`,
          detail: evaluation.blockers.map((b) => b.title).join(" · "),
        },
        ...evaluation.blockers.map((b): LogDraft => ({
          ...runFields,
          level: "error",
          stage: "commit",
          title: b.title,
          detail: b.detail,
          fix: b.fix,
        })),
      ];
      set({ logs: appendLogs(get().logs, drafts) });
      return { ok: false, blockers: evaluation.blockers, warnings: evaluation.warnings };
    }

    const { workbook, result, tick } = publishRun(active, app.workbook, evaluation.scope);
    const run: IngestRun = {
      ...active,
      result,
      onboardingProfile: buildProfile(active, ob ?? emptyOnboarding()),
    };
    useAppStore.setState({
      workbook,
      source: "upload",
      fileName: run.fileName,
      issues: [],
      lastReport: tick,
      reports: [tick, ...app.reports].slice(0, 24),
      dirtyUntil: Date.now() + 1400,
      liveEnabled: false,
    });
    const steps = run.cleanSteps.length;
    const drafts: LogDraft[] = [
      {
        ...runFields,
        level: "success",
        stage: "commit",
        title: `Committed ${result.rowsCommitted.toLocaleString("en-US")} row${result.rowsCommitted === 1 ? "" : "s"} to the warehouse`,
        detail: `Lineage saved: onboarding profile, cleaning recipe (${steps} step${steps === 1 ? "" : "s"}) and ${run.mappings.filter((m) => m.target).length} field mappings.`,
        facts: [
          { label: "Added", value: String(result.report.added) },
          { label: "Updated", value: String(result.report.updated) },
          { label: "Unchanged", value: String(result.report.skipped) },
          { label: "Replaced", value: String(result.rowsReplaced) },
          { label: "Boards fed", value: String(result.boardsLit) },
          { label: "Model", value: domainLabel(run.domain?.domain ?? null) },
        ],
      },
      ...(evaluation.warnings.length
        ? [
            {
              ...runFields,
              level: "info" as const,
              stage: "commit" as const,
              title: `${evaluation.warnings.length} heads-up${evaluation.warnings.length === 1 ? "" : "s"} accepted at commit`,
              detail: evaluation.warnings.map((w) => w.title).join(" · "),
            },
          ]
        : []),
    ];
    set({
      active: run,
      history: get().history.map((r) => (r.id === run.id ? run : r)),
      logs: appendLogs(get().logs, drafts),
    });
    return { ok: true, run, warnings: evaluation.warnings };
  },
  clearActive: () => set({ active: null, onboarding: null }),
}));
