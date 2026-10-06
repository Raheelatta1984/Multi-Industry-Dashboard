import { create } from "zustand";
import { CURRENCIES, type CurrencyCode, type IndustryId } from "./domain";
import { generateSampleWorkbook, SAMPLE_SEED } from "./sample-data";
import { diffWorkbooks, mergeWorkbooks } from "./patch";
import { simulateTick } from "./live-tick";
import type { DataSource, ParseIssue, TickReport, Workbook } from "./types";

const TICK_MS = 60_000;
const sampleWorkbook = generateSampleWorkbook(SAMPLE_SEED);

export type AppState = {
  workbook: Workbook;
  source: DataSource;
  fileName: string;
  displayCurrency: CurrencyCode;
  industryFilter: IndustryId | "all";
  liveEnabled: boolean;
  mergeUploads: boolean;
  tickCount: number;
  lastReport: TickReport | null;
  reports: TickReport[];
  issues: ParseIssue[];
  lastTickAt: number;
  nextTickAt: number;
  dirtyUntil: number;
  company: string;
  setCurrency: (code: CurrencyCode) => void;
  setIndustry: (id: IndustryId | "all") => void;
  setLive: (on: boolean) => void;
  setMergeUploads: (on: boolean) => void;
  tick: () => TickReport;
  loadWorkbook: (wb: Workbook, fileName: string, issues: ParseIssue[]) => TickReport;
  resetSample: () => void;
  markDirty: () => void;
};

function emptyReport(at = Date.now()): TickReport {
  return {
    at,
    added: 0,
    updated: 0,
    removed: 0,
    skipped: 0,
    ops: [],
    latencyMs: 0,
    sheetsTouched: [],
  };
}

function rememberCurrency(code: CurrencyCode) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem("meridian.currency", code);
  } catch {
    /* ignore */
  }
}

function readCurrency(): CurrencyCode {
  if (typeof window === "undefined") return "USD";
  try {
    const v = window.localStorage.getItem("meridian.currency");
    if (v && CURRENCIES.some((c) => c.code === v)) return v as CurrencyCode;
  } catch {
    /* ignore */
  }
  return "USD";
}

export const useAppStore = create<AppState>((set, get) => ({
  workbook: sampleWorkbook,
  source: "sample",
  fileName: "meridian-sample.xlsx",
  displayCurrency: "USD",
  industryFilter: "all",
  liveEnabled: true,
  mergeUploads: true,
  tickCount: 0,
  lastReport: null,
  reports: [],
  issues: [],
  lastTickAt: Date.now(),
  nextTickAt: Date.now() + TICK_MS,
  dirtyUntil: 0,
  company: sampleWorkbook.meta[0]?.company ?? "Apex Meridian Group",
  setCurrency: (code) => {
    rememberCurrency(code);
    set({ displayCurrency: code });
  },
  setIndustry: (id) => set({ industryFilter: id }),
  setLive: (on) => set({ liveEnabled: on, nextTickAt: Date.now() + TICK_MS }),
  setMergeUploads: (on) => set({ mergeUploads: on }),
  markDirty: () => set({ dirtyUntil: Date.now() + 900 }),
  tick: () => {
    const state = get();
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    const iso = new Date().toISOString();
    const nextWb = simulateTick(state.workbook, SAMPLE_SEED + state.tickCount + 1, iso);
    const report = diffWorkbooks(state.workbook, nextWb, Date.now());
    const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
    report.latencyMs = Math.round((t1 - t0) * 10) / 10;
    const now = Date.now();
    set({
      workbook: nextWb,
      tickCount: state.tickCount + 1,
      lastReport: report,
      reports: [report, ...state.reports].slice(0, 24),
      lastTickAt: now,
      nextTickAt: now + TICK_MS,
      dirtyUntil: now + 900,
    });
    return report;
  },
  loadWorkbook: (wb, fileName, issues) => {
    const state = get();
    const incoming = state.mergeUploads && state.source === "upload" ? mergeWorkbooks(state.workbook, wb) : null;
    const workbook = incoming?.workbook ?? wb;
    const report =
      incoming?.report ??
      diffWorkbooks(
        { ...sampleWorkbook, revenue: [], expenses: [], sales: [] },
        wb,
        Date.now(),
      );
    const now = Date.now();
    set({
      workbook,
      source: "upload",
      fileName,
      issues,
      lastReport: report,
      reports: [report, ...state.reports].slice(0, 24),
      lastTickAt: now,
      nextTickAt: now + TICK_MS,
      dirtyUntil: now + 1200,
      company: workbook.meta[0]?.company ?? fileName,
      liveEnabled: false,
    });
    return report;
  },
  resetSample: () => {
    const now = Date.now();
    set({
      workbook: generateSampleWorkbook(SAMPLE_SEED),
      source: "sample",
      fileName: "meridian-sample.xlsx",
      issues: [],
      lastReport: emptyReport(now),
      reports: [],
      tickCount: 0,
      lastTickAt: now,
      nextTickAt: now + TICK_MS,
      company: sampleWorkbook.meta[0]?.company ?? "Apex Meridian Group",
      liveEnabled: true,
    });
  },
}));

export const TICK_INTERVAL_MS = TICK_MS;

export function hydrateCurrency() {
  const code = readCurrency();
  if (code !== useAppStore.getState().displayCurrency) {
    useAppStore.setState({ displayCurrency: code });
  }
}
