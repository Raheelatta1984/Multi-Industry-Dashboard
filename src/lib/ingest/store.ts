/**
 * Ingest session state — the staged run plus the committed-source registry
 * the warehouse page renders. Human-in-the-loop: every AI mapping can be
 * overridden before publish, and overrides are marked as such.
 */
import { create } from "zustand";
import { useAppStore } from "../store";
import { buildRawSheet, profileSheet, readRawSheet } from "./profile";
import { cleanSheet } from "./clean";
import { classifyDomain, mapColumns } from "./semantic";
import { publishRun } from "./publish";
import { buildProfile } from "./onboarding";
import type { CellValue, IngestRun, OnboardingAnswers } from "./types";
import { emptyOnboarding, emptyRun } from "./types";

function advance(run: IngestRun): IngestRun {
  const profile = run.raw ? profileSheet(run.raw) : null;
  if (!profile) return run;
  const { table, steps } = cleanSheet(profile);
  const domain = classifyDomain(table);
  const mappings = domain.domain ? mapColumns(table, profile.columns, domain.domain) : mapColumns(table, profile.columns, null);
  return { ...run, profile, cleanSteps: steps, cleaned: table, domain, mappings };
}

export type IngestStore = {
  active: IngestRun | null;
  history: IngestRun[];
  /** The intake interview. Publish is refused until it is confirmed. */
  onboarding: OnboardingAnswers | null;
  ingestGrid: (fileName: string, sheetName: string, grid: CellValue[][]) => IngestRun;
  ingestBuffer: (fileName: string, buffer: ArrayBuffer) => IngestRun;
  setActive: (id: string) => void;
  overrideMapping: (column: string, target: string | null) => void;
  patchOnboarding: (partial: Partial<OnboardingAnswers>) => void;
  publish: () => IngestRun | null;
  clearActive: () => void;
};

export const useIngestStore = create<IngestStore>((set, get) => ({
  active: null,
  history: [],
  onboarding: null,
  ingestGrid: (fileName, sheetName, grid) => {
    const raw = buildRawSheet(grid, fileName, sheetName);
    const run = advance({ ...emptyRun(fileName), raw });
    set({
      active: run,
      // A new file restarts the interview, but remembers how data arrived.
      onboarding: emptyOnboarding(get().onboarding?.sourceKind ?? null),
      history: [run, ...get().history.filter((r) => r.id !== run.id)].slice(0, 24),
    });
    return run;
  },
  ingestBuffer: (fileName, buffer) => {
    const raw = readRawSheet(buffer, fileName);
    const run = advance({ ...emptyRun(fileName), raw });
    set({
      active: run,
      onboarding: emptyOnboarding(get().onboarding?.sourceKind ?? null),
      history: [run, ...get().history.filter((r) => r.id !== run.id)].slice(0, 24),
    });
    return run;
  },
  setActive: (id) => {
    const found = get().history.find((r) => r.id === id);
    if (found) set({ active: found });
  },
  overrideMapping: (column, target) => {
    const active = get().active;
    if (!active) return;
    const mappings = active.mappings.map((m) =>
      m.column === column
        ? {
            ...m,
            target,
            confidence: target ? 1 : m.confidence,
            method: (target ? "manual" : "none") as (typeof m)["method"],
            reason: target ? "set by human reviewer" : "excluded by human reviewer",
            locked: true,
          }
        : m,
    );
    const run = { ...active, mappings };
    set({
      active: run,
      history: get().history.map((r) => (r.id === run.id ? run : r)),
    });
  },
  patchOnboarding: (partial) => {
    const current = get().onboarding ?? emptyOnboarding();
    set({ onboarding: { ...current, ...partial } });
  },
  publish: () => {
    const active = get().active;
    const ob = get().onboarding;
    // The gate: no confirmed onboarding interview → no commit, full stop.
    if (!active || !active.domain?.domain || !active.cleaned) return null;
    if (!ob?.summaryConfirmed) return null;
    const app = useAppStore.getState();
    const { workbook, result, tick } = publishRun(active, app.workbook);
    const run: IngestRun = {
      ...active,
      result,
      onboardingProfile: buildProfile(active, ob),
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
    set({
      active: run,
      history: get().history.map((r) => (r.id === run.id ? run : r)),
    });
    return run;
  },
  clearActive: () => set({ active: null, onboarding: null }),
}));
