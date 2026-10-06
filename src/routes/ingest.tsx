import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  CircleDashed,
  Database,
  FileSpreadsheet,
  Layers,
  Lock,
  Send,
  Sparkles,
  Wand2,
} from "lucide-react";
import { MESSY_SAMPLES, downloadSample, type MessySample } from "@/lib/ingest/samples";
import { useIngestStore } from "@/lib/ingest/store";
import {
  PURPOSE_OPTIONS,
  buildProfile,
  currencyHint,
  detectDepartments,
  detectEntities,
  mappingStats,
  matchPurpose,
  matchScope,
  periodRange,
} from "@/lib/ingest/onboarding";
import { DOMAIN_FIELD_LIST, FIELD_LABELS } from "@/lib/ingest/semantic";
import { DEPARTMENTS, INDUSTRIES } from "@/lib/domain";
import type { CleanStep, ColumnMapping, IngestRun, OnboardingAnswers } from "@/lib/ingest/types";
import { useAppStore } from "@/lib/store";
import { formatNumber, relativeTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/cn";

export const Route = createFileRoute("/ingest")({ component: IngestPage });

function IngestPage() {
  const run = useIngestStore((s) => s.active);
  const onboarding = useIngestStore((s) => s.onboarding);
  const [phase, setPhase] = useState(4);
  const runId = run?.id;

  // Staged reveal so the reviewer can watch the pipeline think.
  useEffect(() => {
    if (!runId) return;
    setPhase(0);
    const ts = [420, 900, 1400, 1850, 2200].map((ms, i) => window.setTimeout(() => setPhase(i + 1), ms));
    return () => ts.forEach(window.clearTimeout);
  }, [runId]);

  const complete = onboarding?.summaryConfirmed === true;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs tracking-[0.16em] text-silver uppercase">AI onboarding studio</p>
          <h1 className="mt-1 font-display text-3xl lg:text-4xl">
            {run ? run.fileName : "The agent onboards every file before it lands."}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {run
              ? `${formatNumber(run.profile?.rowCount ?? 0)} rows · ${run.raw?.headers.length ?? 0} columns · ingested ${relativeTime(run.createdAt)} ago`
              : "Upload, connect, or schedule — then answer a short interview: why the data is arriving, whose it is, and what every field means. Nothing reaches the dashboards until onboarding is confirmed."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {run?.result ? (
            <Badge variant="up" className="gap-1.5">
              <CheckCircle2 className="size-3" /> committed
            </Badge>
          ) : run ? (
            complete ? (
              <Badge variant="up" className="gap-1.5">
                <CheckCircle2 className="size-3" /> onboarding complete — publish unlocked
              </Badge>
            ) : (
              <Badge variant="warn" className="gap-1.5">
                <Lock className="size-3" /> onboarding in progress
              </Badge>
            )
          ) : null}
        </div>
      </header>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(380px,440px)_1fr]">
        <OnboardingChat />
        <div className="flex min-w-0 flex-col gap-4">
          {!run && <HowOnboardingWorks />}
          {phase >= 1 && run?.profile && <ProfileSection run={run} />}
          {phase >= 2 && run && <CleanSection run={run} />}
          {phase >= 3 && run && <MapSection run={run} confirmed={onboarding?.fieldsConfirmed === true} />}
          {phase >= 4 && run && <PublishSection run={run} onboarding={onboarding} />}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The onboarding agent chat
// ---------------------------------------------------------------------------

type Chip = { label: string; value: string };
type CardKind = "fileSummary" | "fieldsReview" | "summary" | "publishCta" | "result";
type Msg = {
  id: number;
  role: "agent" | "user";
  text: string;
  chips?: Chip[];
  card?: CardKind;
  at: number;
};
type Step =
  | "source"
  | "purpose"
  | "entity_scope"
  | "entity_single"
  | "entities_confirm"
  | "dept_scope"
  | "dept_single"
  | "depts_confirm"
  | "fields"
  | "summary"
  | "publish"
  | "done";

const SAMPLES_BY_ID: Record<string, MessySample> = Object.fromEntries(MESSY_SAMPLES.map((s) => [s.id, s]));

function sleep(ms: number) {
  return new Promise<void>((r) => window.setTimeout(r, ms));
}

function OnboardingChat() {
  const run = useIngestStore((s) => s.active);
  const onboarding = useIngestStore((s) => s.onboarding);
  const ingestGrid = useIngestStore((s) => s.ingestGrid);
  const ingestBuffer = useIngestStore((s) => s.ingestBuffer);
  const patchOnboarding = useIngestStore((s) => s.patchOnboarding);
  const publish = useIngestStore((s) => s.publish);
  const clearActive = useIngestStore((s) => s.clearActive);

  const [messages, setMessages] = useState<Msg[]>([]);
  const [typing, setTyping] = useState(false);
  const [input, setInput] = useState("");
  const [step, setStep] = useState<Step>("source");
  const stepRef = useRef<Step>("source");
  const busyRef = useRef(false);
  const idRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const resultShownRef = useRef<string | null>(null);
  const pendingNoteRef = useRef<string | null>(null);

  const setStepSafe = (s: Step) => {
    stepRef.current = s;
    setStep(s);
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, typing]);

  useEffect(() => {
    void intro();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If the user publishes from the side panel, reflect it in the chat too.
  const resultAt = run?.result?.at;
  useEffect(() => {
    if (!run?.result || resultShownRef.current === run.id) return;
    resultShownRef.current = run.id;
    void agentSay(
      `Committed ${formatNumber(run.result!.rowsCommitted)} rows — patch +${run.result!.report.added} · ~${run.result!.report.updated} · ${run.result!.boardsLit} boards now carry this file's data.`,
      undefined,
      "result",
    );
    setStepSafe("done");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultAt]);

  async function agentSay(text: string, chips?: Chip[], card?: CardKind, delay = 650) {
    setTyping(true);
    await sleep(delay);
    idRef.current += 1;
    setMessages((m) => [...m, { id: idRef.current, role: "agent", text, chips, card, at: Date.now() }]);
    setTyping(false);
  }

  function userSay(text: string) {
    idRef.current += 1;
    setMessages((m) => [...m, { id: idRef.current, role: "user", text, at: Date.now() }]);
  }

  function stripChips() {
    setMessages((m) => {
      let idx = -1;
      for (let i = m.length - 1; i >= 0; i--) {
        if (m[i]!.chips?.length) {
          idx = i;
          break;
        }
      }
      if (idx === -1) return m;
      return m.map((msg, i) => (i === idx ? { ...msg, chips: undefined } : msg));
    });
  }

  async function intro() {
    await agentSay(
      "I'm the Meridian onboarding agent. Before anything reaches the warehouse, I need to understand three things: why the data is arriving, whose it is, and what every field means. How would you like to bring data in?",
      [
        { label: "📤 Upload a file", value: "src:upload" },
        { label: "🔌 Connect an integration", value: "src:integration" },
        { label: "⏱ Set up a data pipeline", value: "src:pipeline" },
        { label: "🗺 Start with data mapping", value: "src:mapping" },
        { label: "✨ Try a messy sample file", value: "src:sample" },
      ],
      undefined,
      500,
    );
  }

  function loadSample(sample: MessySample, sourceKind: "upload" | "integration" | "pipeline", note?: string) {
    const created = ingestGrid(sample.fileName, "Export", sample.grid);
    patchOnboarding({ sourceKind });
    void walkthrough(created, note);
  }

  async function walkthrough(created: IngestRun, note?: string) {
    const table = created.cleaned!;
    const ents = detectEntities(table, created.mappings);
    const depts = detectDepartments(table, created.mappings);
    const period = periodRange(table, created.mappings);
    const ccy = currencyHint(table, created.mappings);
    const dom = created.domain!;
    const bits: string[] = [];
    if (dom.domain) bits.push(`it reads as ${dom.domain} data (${Math.round(dom.confidence * 100)}% confidence)`);
    if (period) bits.push(`periods ${period.from} → ${period.to}`);
    if (ccy) bits.push(`amounts in ${ccy}`);
    if (ents.length) bits.push(`${ents.length} business unit${ents.length === 1 ? "" : "s"} mentioned`);
    if (depts.length) bits.push(`${depts.length} department${depts.length === 1 ? "" : "s"}`);
    if (note) await agentSay(note, undefined, undefined, 550);
    await agentSay(
      `I've read the file and inspected every column. In short: ${bits.join(" · ")}. Quality scores ${created.profile!.qualityScore}/100 — my cleaning recipe fixes what it can before you see the data.`,
      undefined,
      "fileSummary",
      900,
    );
    await agentSay(
      "Now the interview. First and most important: why are you injecting this data?",
      PURPOSE_OPTIONS.map((p) => ({ label: p.label, value: `purpose:${p.id}` })),
      undefined,
      750,
    );
    setStepSafe("purpose");
  }

  async function answerPurpose(purposeId: string) {
    patchOnboarding({ purpose: purposeId as never, purposeNote: pendingNoteRef.current });
    const note = pendingNoteRef.current;
    pendingNoteRef.current = null;
    const ack: Record<string, string> = {
      monthly_reporting: "Monthly cycle — I'll merge with what's already committed; unchanged history stays untouched.",
      new_entity: "New entity — I'll treat this as first-time history and keep it cleanly separated per company.",
      one_off_analysis: note ? `Noted: “${note}”. I'll keep it clearly labelled as an ad-hoc source.` : "Ad-hoc analysis — I'll keep it clearly labelled so it never silently blends into the monthly pack.",
      historical_backfill: "Backfill — older periods will slot into the existing history by month.",
      replace_data: "Correction — the patch will update matching rows in place; every change is traceable.",
    };
    await agentSay(ack[purposeId] ?? "Understood.", undefined, undefined, 600);
    await askEntityScope();
  }

  async function askEntityScope() {
    const current = useIngestStore.getState().active;
    if (!current?.cleaned) return;
    const ents = detectEntities(current.cleaned, current.mappings);
    if (ents.length === 0) {
      await agentSay(
        "I couldn't find a company or entity column in this file. Is the data for a single company or multiple companies?",
        [
          { label: "Single company", value: "entity:single" },
          { label: "Multiple companies", value: "entity:multiple" },
        ],
        undefined,
        700,
      );
      setStepSafe("entity_scope");
      return;
    }
    if (ents.length === 1) {
      const e = ents[0]!;
      patchOnboarding({
        entityScope: "single",
        entities: [e.label ?? e.raw],
        entitiesConfirmed: true,
      });
      await agentSay(
        `This file is entirely ${e.raw}${e.label && e.label.toLowerCase() !== e.raw.toLowerCase() ? ` — I'll scope it to the group entity “${e.label}”` : ""}.`,
        undefined,
        undefined,
        700,
      );
      await askDeptScope();
      return;
    }
    const list = ents
      .slice(0, 6)
      .map((e) => `${e.raw}${e.label && e.label.toLowerCase() !== e.raw.toLowerCase() ? ` → ${e.label}` : ""}`)
      .join(", ");
    await agentSay(
      `The data mentions ${ents.length} business units: ${list}. Is this file about a single company or multiple companies?`,
      [
        { label: `Multiple — the ${ents.length} I found`, value: "entity:multiple" },
        { label: "Single company", value: "entity:single" },
      ],
      undefined,
      750,
    );
    setStepSafe("entity_scope");
  }

  async function askEntitySingle() {
    const current = useIngestStore.getState().active;
    const ents = current?.cleaned ? detectEntities(current.cleaned, current.mappings) : [];
    const detected = ents.filter((e) => e.label);
    const chips: Chip[] = (detected.length ? detected.map((e) => ({ label: e.label!, value: `entityone:${e.label}` })) : INDUSTRIES.slice(0, 8).map((i) => ({ label: i.label, value: `entityone:${i.label}` })));
    await agentSay("Which company is this file about?", chips, undefined, 700);
    setStepSafe("entity_single");
  }

  async function askEntitiesConfirm() {
    const current = useIngestStore.getState().active;
    const ents = current?.cleaned ? detectEntities(current.cleaned, current.mappings).filter((e) => e.label) : [];
    const labels = ents.map((e) => e.label!);
    patchOnboarding({ entityScope: "multiple", entities: labels });
    await agentSay(
      `I'll register this file against ${labels.length} group entities: ${labels.join(", ")}. Correct? (Everything stays adjustable in the mapping panel.)`,
      [
        { label: `Yes — all ${labels.length}`, value: "entities:confirm" },
        { label: "I'll adjust during mapping", value: "entities:adjust" },
      ],
      undefined,
      700,
    );
    setStepSafe("entities_confirm");
  }

  async function askDeptScope() {
    const current = useIngestStore.getState().active;
    if (!current?.cleaned) return;
    const depts = detectDepartments(current.cleaned, current.mappings);
    if (depts.length === 0) {
      await agentSay(
        "I don't see a department column. Which department does this data mainly describe? (Recorded for governance — rows without a department column keep the domain default at publish.)",
        DEPARTMENTS.slice(0, 10).map((d) => ({ label: d.label, value: `deptone:${d.label}` })),
        undefined,
        700,
      );
      setStepSafe("dept_single");
      return;
    }
    if (depts.length === 1) {
      const d = depts[0]!;
      patchOnboarding({ departmentScope: "single", departments: [d.label ?? d.raw], departmentsConfirmed: true });
      await agentSay(
        `All rows sit under one function: ${d.raw}${d.label && d.label.toLowerCase() !== d.raw.toLowerCase() ? ` → ${d.label}` : ""}. Scoping it there.`,
        undefined,
        undefined,
        700,
      );
      await askFields();
      return;
    }
    const list = depts
      .slice(0, 8)
      .map((d) => `${d.raw}${d.label && d.label.toLowerCase() !== d.raw.toLowerCase() ? ` → ${d.label}` : ""}`)
      .join(", ");
    await agentSay(
      `I can see ${depts.length} functions in the data: ${list}. Single department or multiple?`,
      [
        { label: `Multiple — the ${depts.length} I found`, value: "dept:multiple" },
        { label: "Single department", value: "dept:single" },
      ],
      undefined,
      750,
    );
    setStepSafe("dept_scope");
  }

  async function askDeptSingle() {
    const current = useIngestStore.getState().active;
    const depts = current?.cleaned ? detectDepartments(current.cleaned, current.mappings).filter((d) => d.label) : [];
    const chips: Chip[] = depts.length
      ? depts.map((d) => ({ label: d.label!, value: `deptone:${d.label}` }))
      : DEPARTMENTS.slice(0, 10).map((d) => ({ label: d.label, value: `deptone:${d.label}` }));
    await agentSay("Which department is this file about?", chips, undefined, 700);
    setStepSafe("dept_single");
  }

  async function askDeptsConfirm() {
    const current = useIngestStore.getState().active;
    const depts = current?.cleaned ? detectDepartments(current.cleaned, current.mappings).filter((d) => d.label) : [];
    const labels = depts.map((d) => d.label!);
    patchOnboarding({ departmentScope: "multiple", departments: labels });
    await agentSay(
      `I'll tag this data for ${labels.length} departments: ${labels.join(", ")}. Correct?`,
      [
        { label: `Yes — all ${labels.length}`, value: "depts:confirm" },
        { label: "I'll adjust during mapping", value: "depts:adjust" },
      ],
      undefined,
      700,
    );
    setStepSafe("depts_confirm");
  }

  async function askFields() {
    const current = useIngestStore.getState().active;
    if (!current) return;
    const stats = mappingStats(current.mappings);
    const low = stats.lowConfidence.map((m) => m.column).slice(0, 4);
    await agentSay(
      `Now the field-by-field review. I mapped ${stats.mapped} of ${current.mappings.length} columns and excluded ${stats.excluded} as descriptive.${low.length ? ` ${low.length} mapped below 90% confidence: ${low.join(", ")} — worth a look.` : " Every mapping cleared 90% confidence."} The full table is beside this chat — override anything, I learn from corrections.`,
      undefined,
      "fieldsReview",
      800,
    );
    await agentSay(
      "How do the mappings look?",
      [
        { label: "Fields confirmed", value: "fields:confirm" },
        { label: "Let me adjust first", value: "fields:adjust" },
      ],
      undefined,
      600,
    );
    setStepSafe("fields");
  }

  async function askSummary() {
    await agentSay(
      "Here's the onboarding profile I'll attach to this file's lineage — who it's for, why it arrived, and what's inside. Confirm to unlock publish. Nothing is committed until you press the button.",
      [
        { label: "✅ Confirm onboarding", value: "summary:confirm" },
        { label: "Start the questions over", value: "summary:restart" },
      ],
      "summary",
      800,
    );
    setStepSafe("summary");
  }

  async function completeOnboarding() {
    patchOnboarding({ summaryConfirmed: true });
    await agentSay(
      "Onboarding complete — publish is unlocked. Commit when ready: it merges incrementally by stable row ids and reports exactly which boards light up.",
      [
        { label: "🚀 Publish to warehouse", value: "publish:go" },
        { label: "I'll publish from the panel", value: "publish:later" },
      ],
      "publishCta",
      700,
    );
    setStepSafe("publish");
  }

  async function doPublish() {
    const published = publish();
    if (!published?.result) {
      await agentSay(
        "The warehouse refused the commit — a required field is still unmapped. Fix the red rows in the mapping panel and try again.",
        undefined,
        undefined,
        600,
      );
      setStepSafe("publish");
      return;
    }
    const r = published.result;
    resultShownRef.current = published.id;
    await agentSay(
      `Committed ${formatNumber(r.rowsCommitted)} rows — patch +${r.report.added} · ~${r.report.updated} · ${r.boardsLit} boards now carry this file's data. Lineage records the onboarding profile alongside the recipe and mappings.`,
      [
        { label: "📂 Onboard another file", value: "chat:restart" },
        { label: "Open the boards", value: "nav:boards" },
      ],
      "result",
      850,
    );
    setStepSafe("done");
  }

  async function restartChat() {
    clearActive();
    resultShownRef.current = null;
    setMessages([]);
    setStepSafe("source");
    await intro();
  }

  async function route(value: string, label: string, opts: { silent?: boolean; skipGuard?: boolean } = {}) {
    if (!opts.skipGuard && busyRef.current) return;
    busyRef.current = true;
    try {
      stripChips();
      if (!opts.silent) userSay(label);
      const [kind, arg] = value.split(":");

      if (kind === "src") {
        if (arg === "upload") {
          fileRef.current?.click();
        } else if (arg === "integration") {
          await agentSay(
            "In production I connect to SAP, Oracle, SQL Server, Postgres, Snowflake and friends (Phase 2 — see docs/03-target-architecture.md). In this prototype I can simulate a connector pull so you see the identical flow. Which source?",
            [
              { label: "SAP-style GL extract (simulated)", value: "conn:opex-v2" },
              { label: "POS sales export (simulated)", value: "conn:sales-q3" },
              { label: "Inventory sync (simulated)", value: "conn:inventory-q3" },
              { label: "Back", value: "src:back" },
            ],
            undefined,
            650,
          );
        } else if (arg === "pipeline") {
          await agentSay(
            "Scheduled pipelines live in the production deployment — I keep pulling on a cron and merge only deltas. Here I can run a single pull now to show the flow. Run it?",
            [
              { label: "Run a pull now (simulated)", value: "pipe:run" },
              { label: "Upload my file instead", value: "src:upload" },
              { label: "Back", value: "src:back" },
            ],
            undefined,
            650,
          );
        } else if (arg === "mapping") {
          const existing = useIngestStore.getState().active;
          if (existing && !existing.result) {
            await agentSay("There's already a staged file — jumping to its field review.", undefined, undefined, 500);
            await askFields();
          } else {
            await agentSay(
              "Mapping is the heart of onboarding — but I need data first. Upload a file or try a sample.",
              [
                { label: "📤 Upload a file", value: "src:upload" },
                { label: "✨ Try a sample file", value: "src:sample" },
                { label: "Back", value: "src:back" },
              ],
              undefined,
              600,
            );
          }
        } else if (arg === "sample") {
          await agentSay("Pick one — they're the kind of files that land in finance inboxes every month:", [
            ...MESSY_SAMPLES.map((s) => ({ label: s.label, value: `sample:${s.id}` })),
            { label: "Back", value: "src:back" },
          ]);
        } else if (arg === "back") {
          await intro();
        }
        return;
      }

      if (kind === "sample") {
        const sample = SAMPLES_BY_ID[arg];
        if (sample) loadSample(sample, "upload");
        return;
      }

      if (kind === "conn") {
        const sample = SAMPLES_BY_ID[arg];
        if (sample)
          loadSample(
            sample,
            "integration",
            `Pulling ${sample.label}… ${sample.grid.length - 2} rows received. (Simulated connector — the production version pulls live with credentials you control.)`,
          );
        return;
      }

      if (kind === "pipe") {
        const sample = SAMPLES_BY_ID["opex-v2"]!;
        loadSample(sample, "pipeline", "Pipeline triggered — first pull received. (Scheduling arrives with production persistence; the ingestion flow is identical.)");
        return;
      }

      if (kind === "purpose") {
        await answerPurpose(arg);
        return;
      }

      if (kind === "entity") {
        if (arg === "multiple") await askEntitiesConfirm();
        else await askEntitySingle();
        return;
      }

      if (kind === "entityone") {
        patchOnboarding({ entityScope: "single", entities: [arg], entitiesConfirmed: true });
        await agentSay(`Scoped to ${arg}.`, undefined, undefined, 500);
        await askDeptScope();
        return;
      }

      if (kind === "entities") {
        if (arg === "confirm") patchOnboarding({ entitiesConfirmed: true });
        else patchOnboarding({ entitiesConfirmed: true });
        await agentSay(
          arg === "confirm" ? "Entities locked in." : "Fine — the mapping panel stays open through publish.",
          undefined,
          undefined,
          500,
        );
        await askDeptScope();
        return;
      }

      if (kind === "dept") {
        if (arg === "multiple") await askDeptsConfirm();
        else await askDeptSingle();
        return;
      }

      if (kind === "deptone") {
        patchOnboarding({ departmentScope: "single", departments: [arg], departmentsConfirmed: true });
        await agentSay(`Tagged as ${arg} data.`, undefined, undefined, 500);
        await askFields();
        return;
      }

      if (kind === "depts") {
        patchOnboarding({ departmentsConfirmed: true });
        await agentSay("Departments noted.", undefined, undefined, 500);
        await askFields();
        return;
      }

      if (kind === "fields") {
        if (arg === "confirm") {
          patchOnboarding({ fieldsConfirmed: true });
          await agentSay("Field review confirmed.", undefined, undefined, 500);
          await askSummary();
        } else {
          document.getElementById("mapping-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
          await agentSay("The mapping panel is on the right (or below). Take your time — confirm when done.", [
            { label: "Done adjusting", value: "fields:confirm" },
          ]);
        }
        return;
      }

      if (kind === "summary") {
        if (arg === "confirm") await completeOnboarding();
        else {
          await agentSay("No problem — starting the interview over.", undefined, undefined, 500);
          patchOnboarding({
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
          });
          await agentSay("Why are you injecting this data?", PURPOSE_OPTIONS.map((p) => ({ label: p.label, value: `purpose:${p.id}` })), undefined, 600);
          setStepSafe("purpose");
        }
        return;
      }

      if (kind === "publish") {
        if (arg === "go") await doPublish();
        else await agentSay("The publish panel is right beside this chat whenever you're ready.", undefined, undefined, 500);
        return;
      }

      if (kind === "chat") {
        if (arg === "restart") await restartChat();
        return;
      }

      if (kind === "nav") {
        if (arg === "boards") window.location.assign("/catalog");
        return;
      }
    } finally {
      busyRef.current = false;
    }
  }

  async function handleText() {
    const text = input.trim();
    if (!text || busyRef.current) return;
    setInput("");
    userSay(text);
    stripChips();
    const s = stepRef.current;
    busyRef.current = true;
    try {
      const delegate = { silent: true, skipGuard: true } as const;
      if (s === "source") {
        const t = text.toLowerCase();
        if (/(upload|file|excel|spreadsheet|drop)/.test(t)) fileRef.current?.click();
        else if (/(integration|connect|sap|oracle|connector)/.test(t)) await route("src:integration", text, delegate);
        else if (/(pipeline|schedule|cron|sync)/.test(t)) await route("src:pipeline", text, delegate);
        else if (/(mapping|map)/.test(t)) await route("src:mapping", text, delegate);
        else if (/(sample|demo|try)/.test(t)) await route("src:sample", text, delegate);
        else
          await agentSay("I can bring data in a few ways — which fits?", [
            { label: "📤 Upload a file", value: "src:upload" },
            { label: "🔌 Connect an integration", value: "src:integration" },
            { label: "⏱ Set up a data pipeline", value: "src:pipeline" },
            { label: "✨ Try a messy sample file", value: "src:sample" },
          ]);
        return;
      }
      if (s === "purpose") {
        const p = matchPurpose(text);
        if (p) {
          pendingNoteRef.current = text;
          await answerPurpose(p);
        } else {
          await agentSay(`Noted: “${text}”. Which of these is closest?`, PURPOSE_OPTIONS.map((p) => ({ label: p.label, value: `purpose:${p.id}` })));
        }
        return;
      }
      if (s === "entity_scope" || s === "dept_scope") {
        const scope = matchScope(text);
        if (scope === "single") await route(s === "entity_scope" ? "entity:single" : "dept:single", text, delegate);
        else if (scope === "multiple") await route(s === "entity_scope" ? "entity:multiple" : "dept:multiple", text, delegate);
        else await agentSay("Single or multiple — one word is enough. 😊");
        return;
      }
      if (s === "entity_single" || s === "entities_confirm" || s === "dept_single" || s === "depts_confirm") {
        await agentSay(`Recorded: “${text}”. You can also pick a suggestion.`, undefined, undefined, 500);
        return;
      }
      if (s === "fields") {
        await agentSay("Take your time in the mapping panel — confirm when done.", [
          { label: "Fields confirmed", value: "fields:confirm" },
        ]);
        return;
      }
      if (s === "summary") {
        await agentSay("Confirm the profile to unlock publish — or start over if something's off.", [
          { label: "✅ Confirm onboarding", value: "summary:confirm" },
          { label: "Start the questions over", value: "summary:restart" },
        ]);
        return;
      }
      if (s === "publish") {
        await agentSay("Press the publish button — mine or the panel's, both commit the same reviewed rows.", [
          { label: "🚀 Publish to warehouse", value: "publish:go" },
        ]);
        return;
      }
      if (s === "done") {
        await agentSay("Ready for the next file whenever you are.", [
          { label: "📂 Onboard another file", value: "chat:restart" },
        ]);
      }
    } finally {
      busyRef.current = false;
    }
  }

  async function onFile(file: File) {
    try {
      const buf = await file.arrayBuffer();
      const created = ingestBuffer(file.name, buf);
      patchOnboarding({ sourceKind: "upload" });
      await walkthrough(created);
    } catch (err) {
      await agentSay(
        `I couldn't read that file (${err instanceof Error ? err.message : "unknown error"}). Try another one?`,
        [
          { label: "📤 Upload a file", value: "src:upload" },
          { label: "✨ Try a sample file", value: "src:sample" },
        ],
      );
    }
  }

  const lastChips = [...messages].reverse().find((m) => m.role === "agent" && m.chips?.length)?.chips;

  return (
    <Card className="flex h-[620px] flex-col overflow-hidden p-0 lg:h-[calc(100dvh-190px)] lg:sticky lg:top-20">
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
        <span className="flex size-8 items-center justify-center rounded-full bg-secondary">
          <Bot className="size-4 text-silver" />
        </span>
        <div className="min-w-0">
          <div className="text-sm font-medium">Meridian onboarding agent</div>
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className={cn("size-1.5 rounded-full bg-up", typing && "live-dot")} />
            {typing ? "reviewing your data…" : step === "done" ? "file onboarded" : "interview in progress"}
          </div>
        </div>
        <Badge variant="silver" className="ml-auto shrink-0">
          {step === "source" ? "intake" : step === "publish" || step === "done" ? "gate open" : "onboarding"}
        </Badge>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.map((m) => (
          <div key={m.id} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[92%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                m.role === "user" ? "bg-secondary text-foreground" : "bg-card border border-border text-foreground",
              )}
            >
              <div>{m.text}</div>
              {m.card === "fileSummary" && run && <FileSummaryCard run={run} />}
              {m.card === "fieldsReview" && run && <FieldsReviewCard run={run} />}
              {m.card === "summary" && run && onboarding && <SummaryCard run={run} onboarding={onboarding} />}
              {m.card === "publishCta" && run && <PublishCtaCard run={run} onboarding={onboarding ?? undefined} onPublish={() => void route("publish:go", "Publish")} />}
              {m.card === "result" && run?.result && <ResultCard run={run} />}
            </div>
          </div>
        ))}
        {typing && (
          <div className="flex justify-start">
            <div className="flex items-center gap-1.5 rounded-2xl border border-border bg-card px-3.5 py-3">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="size-1.5 animate-bounce rounded-full bg-muted-foreground"
                  style={{ animationDelay: `${i * 140}ms` }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {lastChips && lastChips.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-border px-4 py-2.5">
          {lastChips.map((c) => (
            <button
              key={c.value}
              type="button"
              disabled={typing}
              onClick={() => void route(c.value, c.label)}
              className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-silver hover:text-foreground disabled:opacity-50"
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 border-t border-border px-4 py-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleText();
          }}
          placeholder={
            step === "source"
              ? "Type or pick how to bring data in…"
              : step === "done"
                ? "Anything else?"
                : "Type your answer or pick a suggestion…"
          }
          className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        <Button size="sm" className="gap-1.5" onClick={() => void handleText()} disabled={!input.trim()}>
          <Send className="size-3.5" /> Send
        </Button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void onFile(file);
          e.target.value = "";
        }}
      />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Chat cards
// ---------------------------------------------------------------------------

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-secondary/60 px-2.5 py-1.5">
      <div className="text-[10px] text-muted-foreground uppercase">{label}</div>
      <div className="mt-0.5 truncate text-xs font-medium">{value}</div>
    </div>
  );
}

function FileSummaryCard({ run }: { run: IngestRun }) {
  const table = run.cleaned!;
  const ents = detectEntities(table, run.mappings);
  const depts = detectDepartments(table, run.mappings);
  const period = periodRange(table, run.mappings);
  const ccy = currencyHint(table, run.mappings);
  return (
    <div className="mt-2.5 grid grid-cols-3 gap-1.5">
      <Stat label="Rows" value={formatNumber(run.profile?.rowCount ?? 0)} />
      <Stat label="Columns" value={String(table.headers.length)} />
      <Stat label="Quality" value={`${run.profile?.qualityScore ?? 0}/100`} />
      <Stat label="Reads as" value={`${run.domain?.domain ?? "—"} ${run.domain ? Math.round(run.domain.confidence * 100) + "%" : ""}`} />
      <Stat label="Period" value={period ? `${period.from} → ${period.to}` : "—"} />
      <Stat label="Currency" value={ccy ?? "—"} />
      <Stat label="Companies" value={ents.length ? `${ents.length} found` : "none"} />
      <Stat label="Departments" value={depts.length ? `${depts.length} found` : "none"} />
      <Stat label="Recipe" value={`${run.cleanSteps.length} steps`} />
    </div>
  );
}

function FieldsReviewCard({ run }: { run: IngestRun }) {
  const stats = mappingStats(run.mappings);
  return (
    <div className="mt-2.5 flex flex-col gap-1.5 rounded-lg bg-secondary/60 px-3 py-2.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">auto-mapped</span>
        <span className="font-medium">
          {stats.mapped}/{run.mappings.length} · avg {Math.round(stats.confidence * 100)}%
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
        <div className="h-full rounded-full bg-up" style={{ width: `${(stats.mapped / run.mappings.length) * 100}%` }} />
      </div>
      <ul className="mt-1 space-y-0.5">
        {run.mappings.slice(0, 12).map((m) => (
          <li key={m.column} className="flex items-center justify-between gap-2 text-[11px]">
            <span className="truncate text-muted-foreground">{m.column}</span>
            <span className={cn("shrink-0 font-mono", m.target ? "text-foreground" : "text-muted-foreground/60")}>
              {m.target ?? "excluded"} {m.target ? `${Math.round(m.confidence * 100)}%` : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SummaryCard({ run, onboarding }: { run: IngestRun; onboarding: OnboardingAnswers }) {
  const profile = buildProfile(run, onboarding);
  const rows: Array<[string, string]> = [
    ["Purpose", `${profile.purposeLabel}${profile.purposeNote ? ` — “${profile.purposeNote}”` : ""}`],
    ["Companies", `${profile.entityScope === "single" ? "Single" : "Multiple"}${profile.entities.length ? `: ${profile.entities.join(", ")}` : ""}`],
    ["Departments", `${profile.departmentScope === "single" ? "Single" : "Multiple"}${profile.departments.length ? `: ${profile.departments.join(", ")}` : ""}`],
    ["Domain", `${profile.domain ?? "—"} · ${formatNumber(profile.rowCount)} rows · quality ${profile.qualityScore}/100`],
    ["Fields", `${profile.mappedColumns} mapped · ${profile.excludedColumns} excluded · avg ${Math.round(profile.mappingConfidence * 100)}%`],
    ["Period", profile.periodFrom ? `${profile.periodFrom} → ${profile.periodTo}${profile.currency ? ` · ${profile.currency}` : ""}` : "—"],
  ];
  return (
    <div className="mt-2.5 flex flex-col gap-1 rounded-lg border border-border bg-secondary/40 px-3 py-2.5">
      <div className="text-[10px] tracking-wide text-silver uppercase">Onboarding profile</div>
      {rows.map(([k, v]) => (
        <div key={k} className="flex gap-2 text-[11px] leading-relaxed">
          <span className="w-20 shrink-0 text-muted-foreground">{k}</span>
          <span>{v}</span>
        </div>
      ))}
    </div>
  );
}

function PublishCtaCard({
  run,
  onboarding,
  onPublish,
}: {
  run: IngestRun;
  onboarding?: OnboardingAnswers;
  onPublish: () => void;
}) {
  const domain = run.domain?.domain;
  const required = domain ? DOMAIN_FIELD_LIST[domain].required : [];
  const missing = required.filter((f) => !run.mappings.some((m) => m.target === f));
  return (
    <div className="mt-2.5 flex flex-col items-start gap-2 rounded-lg border border-silver/30 bg-secondary/40 px-3 py-3">
      <Button size="sm" disabled={missing.length > 0} onClick={onPublish} className="gap-1.5">
        <Database className="size-3.5" />
        Commit {formatNumber(run.profile?.rowCount ?? 0)} reviewed rows
      </Button>
      <span className="text-[11px] text-muted-foreground">
        {onboarding?.entities.length ? `Scoped: ${onboarding.entities.join(", ")} · ` : ""}
        {missing.length ? `Blocked: map ${missing.join(", ")} first` : "Merge is incremental — unchanged history is never rewritten"}
      </span>
    </div>
  );
}

function ResultCard({ run }: { run: IngestRun }) {
  const r = run.result!;
  return (
    <div className="mt-2.5 flex flex-col gap-2 rounded-lg border border-border px-3 py-3">
      <div className="grid grid-cols-3 gap-1.5">
        <Stat label="Committed" value={formatNumber(r.rowsCommitted)} />
        <Stat label="Patch" value={`+${r.report.added} ~${r.report.updated}`} />
        <Stat label="Boards lit" value={formatNumber(r.boardsLit)} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm">
          <Link to="/">Command center</Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link to="/warehouse">Warehouse & lineage</Link>
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Right-hand review panels
// ---------------------------------------------------------------------------

function SectionHead({
  icon,
  title,
  blurb,
  right,
}: {
  icon: ReactNode;
  title: string;
  blurb: string;
  right?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="flex items-center gap-2 font-display text-xl">
          <span className="text-silver">{icon}</span>
          {title}
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{blurb}</p>
      </div>
      {right}
    </div>
  );
}

function typeBadgeVariant(t: string) {
  if (t === "currency" || t === "number" || t === "percent") return "up" as const;
  if (t === "date") return "warn" as const;
  if (t === "category" || t === "boolean") return "silver" as const;
  return "default" as const;
}

function ProfileSection({ run }: { run: IngestRun }) {
  const p = run.profile!;
  return (
    <section className="flex flex-col gap-4">
      <SectionHead
        icon={<Layers className="size-4" />}
        title="1 · Profile"
        blurb="Every column inferred and stress-tested before anything moves."
        right={
          <div className="text-right">
            <div className="text-[11px] text-muted-foreground uppercase">Quality score</div>
            <div className={cn("font-display text-2xl tabular", p.qualityScore >= 80 ? "text-up" : p.qualityScore >= 60 ? "text-warn" : "text-down")}>
              {p.qualityScore}
            </div>
          </div>
        }
      />
      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] text-muted-foreground uppercase">
                <th className="px-4 py-2.5 font-medium">Column</th>
                <th className="px-4 py-2.5 font-medium">Inferred type</th>
                <th className="px-4 py-2.5 font-medium">Fill</th>
                <th className="px-4 py-2.5 font-medium">Distinct</th>
                <th className="px-4 py-2.5 font-medium">Sample values</th>
                <th className="px-4 py-2.5 font-medium">Findings</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {p.columns.map((c) => (
                <tr key={c.index} className="align-top">
                  <td className="px-4 py-2.5 font-medium">{c.rawHeader}</td>
                  <td className="px-4 py-2.5">
                    <Badge variant={typeBadgeVariant(c.type)}>
                      {c.type}
                      {c.detectedCurrency ? ` ${c.detectedCurrency}` : ""}
                    </Badge>
                    <span className="ml-2 text-xs text-muted-foreground">{Math.round(c.typeConfidence * 100)}%</span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="h-1.5 w-16 overflow-hidden rounded-full bg-secondary">
                      <div
                        className={cn("h-full rounded-full", c.fillRate > 0.95 ? "bg-up" : c.fillRate > 0.8 ? "bg-warn" : "bg-down")}
                        style={{ width: `${Math.round(c.fillRate * 100)}%` }}
                      />
                    </div>
                    <span className="mt-1 block text-xs tabular text-muted-foreground">{Math.round(c.fillRate * 100)}%</span>
                  </td>
                  <td className="px-4 py-2.5 tabular">{c.distinct}</td>
                  <td className="max-w-52 px-4 py-2.5 text-xs text-muted-foreground">{c.samples.join(" · ")}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {c.issues.length === 0 && <span className="text-xs text-up">clean</span>}
                      {c.issues.map((i, idx) => (
                        <span
                          key={idx}
                          className={cn(
                            "rounded-full border border-border px-2 py-0.5 text-[11px]",
                            i.severity === "high" ? "text-down" : i.severity === "medium" ? "text-warn" : "text-muted-foreground",
                          )}
                        >
                          {i.message}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </section>
  );
}

const OP_LABEL: Record<CleanStep["op"], string> = {
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

function stepDetail(s: CleanStep): string {
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

function CleanSection({ run }: { run: IngestRun }) {
  const [view, setView] = useState<"raw" | "clean">("clean");
  const steps = run.cleanSteps;
  const raw = run.raw!;
  const table = run.cleaned!;
  const previewRows = 6;
  return (
    <section className="flex flex-col gap-4">
      <SectionHead
        icon={<Wand2 className="size-4" />}
        title="2 · Cleaning recipe"
        blurb="Generated, versioned, replayable — exactly what a data engineer would write, produced in seconds."
        right={
          <div className="flex rounded-lg border border-border p-0.5">
            {(["raw", "clean"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={cn(
                  "rounded-md px-3 py-1 text-xs",
                  view === v ? "bg-secondary text-foreground" : "text-muted-foreground",
                )}
              >
                {v === "raw" ? "Raw preview" : "Cleaned preview"}
              </button>
            ))}
          </div>
        }
      />
      <div className="grid items-start gap-3 lg:grid-cols-5">
        <Card className="overflow-hidden p-0 lg:col-span-2">
          <div className="border-b border-border px-4 py-3 text-sm font-medium">{steps.length} steps in the recipe</div>
          <ol className="divide-y divide-border">
            {steps.map((s, i) => (
              <li key={i} className="flex gap-3 px-4 py-2.5 text-sm">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-secondary text-[11px] tabular">
                  {i + 1}
                </span>
                <div>
                  <div>{OP_LABEL[s.op]}</div>
                  <div className="text-xs text-muted-foreground">{stepDetail(s)}</div>
                </div>
              </li>
            ))}
          </ol>
        </Card>
        <Card className="overflow-hidden p-0 lg:col-span-3">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] text-muted-foreground uppercase">
                  {(view === "raw" ? raw.headers : table.headers).slice(0, 8).map((h, i) => (
                    <th key={i} className="max-w-32 truncate px-3 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(view === "raw" ? raw.rows : table.rows).slice(0, previewRows).map((r, ri) => (
                  <tr key={ri}>
                    {r.slice(0, 8).map((c, ci) => (
                      <td key={ci} className="max-w-32 truncate px-3 py-2 tabular">
                        {c === null ? <span className="text-muted-foreground/50">—</span> : String(c)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
            First {previewRows} rows ·{" "}
            {view === "raw"
              ? "exactly as uploaded"
              : "after the recipe: dates ISO, currencies numeric, totals and duplicates gone"}
          </div>
        </Card>
      </div>
    </section>
  );
}

function MapSection({ run, confirmed }: { run: IngestRun; confirmed: boolean }) {
  const override = useIngestStore((s) => s.overrideMapping);
  const domain = run.domain!;
  const fields = domain.domain ? DOMAIN_FIELD_LIST[domain.domain] : null;
  const options = fields ? [...fields.required, ...fields.optional] : [];
  return (
    <section id="mapping-panel" className="flex scroll-mt-20 flex-col gap-4">
      <SectionHead
        icon={<Sparkles className="size-4" />}
        title="3 · Semantic mapping"
        blurb="Source columns mapped onto the group model. Overriding a suggestion is one click — the agent learns from the correction."
        right={confirmed ? <Badge variant="up" className="gap-1"><CheckCircle2 className="size-3" /> confirmed in onboarding</Badge> : undefined}
      />
      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] text-muted-foreground uppercase">
                <th className="px-4 py-2.5 font-medium">Source column</th>
                <th className="px-4 py-2.5 font-medium">Maps to</th>
                <th className="px-4 py-2.5 font-medium">Confidence</th>
                <th className="px-4 py-2.5 font-medium">Why</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {run.mappings.map((m) => (
                <MappingRow key={m.column} m={m} options={options} onOverride={override} locked={Boolean(run.result)} />
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </section>
  );
}

function MappingRow({
  m,
  options,
  onOverride,
  locked,
}: {
  m: ColumnMapping;
  options: string[];
  onOverride: (column: string, target: string | null) => void;
  locked: boolean;
}) {
  const pct = Math.round(m.confidence * 100);
  return (
    <tr className={cn(!m.target && m.method === "none" && "text-muted-foreground")}>
      <td className="px-4 py-2.5 font-medium">{m.column}</td>
      <td className="px-4 py-2.5">
        {locked ? (
          m.target ? (
            <Badge variant="silver">{FIELD_LABELS[m.target] ?? m.target}</Badge>
          ) : (
            <span className="text-xs">excluded</span>
          )
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  "flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm hover:border-silver",
                  m.target ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {m.target ? (FIELD_LABELS[m.target] ?? m.target) : "excluded"}
                <ArrowRight className="size-3 rotate-90 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
              {options.map((f) => (
                <DropdownMenuItem key={f} onSelect={() => onOverride(m.column, f)}>
                  {FIELD_LABELS[f] ?? f}
                  {m.target === f && <CheckCircle2 className="ml-2 size-3.5 text-up" />}
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem onSelect={() => onOverride(m.column, null)}>
                <span className="text-muted-foreground">Exclude from model</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </td>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-14 overflow-hidden rounded-full bg-secondary">
            <div
              className={cn("h-full rounded-full", pct >= 85 ? "bg-up" : pct >= 60 ? "bg-warn" : "bg-down")}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-xs tabular text-muted-foreground">{pct}%</span>
        </div>
      </td>
      <td className="px-4 py-2.5 text-xs text-muted-foreground">
        {m.method === "manual" && <Badge variant="up" className="mr-1.5">human</Badge>}
        {m.reason}
      </td>
    </tr>
  );
}

const ONBOARDING_STEPS: Array<{ key: string; label: string; done: (o: OnboardingAnswers) => boolean }> = [
  { key: "purpose", label: "Purpose — why the data is arriving", done: (o) => Boolean(o.purpose) },
  { key: "entities", label: "Companies — single or multiple", done: (o) => Boolean(o.entityScope) && o.entitiesConfirmed },
  { key: "depts", label: "Departments — single or multiple", done: (o) => Boolean(o.departmentScope) && o.departmentsConfirmed },
  { key: "fields", label: "Field-by-field review", done: (o) => o.fieldsConfirmed },
  { key: "summary", label: "Onboarding profile confirmed", done: (o) => o.summaryConfirmed },
];

function OnboardingChecklist({ onboarding }: { onboarding: OnboardingAnswers | null }) {
  const answers = onboarding ?? {
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
    sourceKind: null,
  };
  const firstPending = ONBOARDING_STEPS.find((s) => !s.done(answers))?.key;
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2">
        <Lock className="size-4 text-warn" />
        <h3 className="font-display text-lg">Onboarding gate</h3>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        The warehouse stays closed until the interview is confirmed. Answer with the agent in the chat.
      </p>
      <ul className="mt-4 space-y-2.5">
        {ONBOARDING_STEPS.map((s) => {
          const done = s.done(answers);
          const active = s.key === firstPending;
          return (
            <li key={s.key} className="flex items-center gap-2.5 text-sm">
              {done ? (
                <CheckCircle2 className="size-4 shrink-0 text-up" />
              ) : (
                <CircleDashed className={cn("size-4 shrink-0", active ? "text-silver" : "text-muted-foreground/50")} />
              )}
              <span className={cn(done ? "text-foreground" : active ? "text-foreground" : "text-muted-foreground")}>
                {s.label}
              </span>
              {active && <Badge variant="silver" className="ml-auto">now</Badge>}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function PublishSection({ run, onboarding }: { run: IngestRun; onboarding: OnboardingAnswers | null }) {
  const publish = useIngestStore((s) => s.publish);
  const result = run.result;
  const domain = run.domain?.domain;
  const required = domain ? DOMAIN_FIELD_LIST[domain].required : [];
  const missingRequired = required.filter((f) => !run.mappings.some((m) => m.target === f));
  const complete = onboarding?.summaryConfirmed === true;
  const ccy = useAppStore((s) => s.displayCurrency);

  if (!result && !complete) {
    return (
      <section className="flex flex-col gap-4">
        <SectionHead
          icon={<Database className="size-4" />}
          title="4 · Publish"
          blurb="Commit writes to the warehouse with full lineage: interview → source file → recipe → mapping → boards."
        />
        <OnboardingChecklist onboarding={onboarding} />
      </section>
    );
  }

  if (!result) {
    return (
      <section className="flex flex-col gap-4">
        <SectionHead
          icon={<Database className="size-4" />}
          title="4 · Publish"
          blurb="Commit writes to the warehouse with full lineage: interview → source file → recipe → mapping → boards."
        />
        <Card className="flex flex-col items-start gap-4 p-6">
          {missingRequired.length > 0 && (
            <p className="text-sm text-warn">
              Missing required field{missingRequired.length === 1 ? "" : "s"}:{" "}
              {missingRequired.map((f) => FIELD_LABELS[f] ?? f).join(", ")} — map them in the panel above.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button size="lg" disabled={missingRequired.length > 0} onClick={() => publish()}>
              <Database className="size-4" /> Commit {formatNumber(run.profile?.rowCount ?? 0)} rows to warehouse
            </Button>
            <span className="text-xs text-muted-foreground">
              Display currency {ccy} · amounts stored in source currency · onboarding profile attached to lineage
            </span>
          </div>
        </Card>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <SectionHead
        icon={<CheckCircle2 className="size-4" />}
        title="4 · Published"
        blurb="Landed. Every board, KPI and export now includes this file's rows."
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Rows committed" value={formatNumber(result.rowsCommitted)} />
        <StatCard label="Warehouse patch" value={`+${result.report.added} · ~${result.report.updated} · ${result.report.skipped} unchanged`} />
        <StatCard label="Mapping confidence" value={`${Math.round(result.mappingConfidence * 100)}%`} />
        <StatCard label="Boards with data" value={formatNumber(result.boardsLit)} />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="overflow-hidden p-0">
          <div className="border-b border-border px-4 py-3 text-sm font-medium">Value coercions applied</div>
          <ul className="divide-y divide-border text-sm">
            {result.coercedValues.length === 0 && (
              <li className="px-4 py-3 text-muted-foreground">None needed — values already matched the model.</li>
            )}
            {result.coercedValues.map((c, i) => (
              <li key={i} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="truncate">
                  <span className="text-muted-foreground">{c.column}:</span> “{c.from}” → <span className="text-foreground">{c.to}</span>
                </span>
                <Badge variant={c.score >= 0.9 ? "up" : c.score > 0 ? "warn" : "down"} className="shrink-0">
                  {c.score > 0 ? `${Math.round(c.score * 100)}%` : "default"}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="overflow-hidden p-0">
          <div className="border-b border-border px-4 py-3 text-sm font-medium">Onboarding record</div>
          <div className="flex flex-col gap-1.5 px-4 py-3 text-sm">
            {run.onboardingProfile ? (
              <>
                <Row k="Purpose" v={run.onboardingProfile.purposeLabel} />
                <Row k="Companies" v={`${run.onboardingProfile.entityScope}: ${run.onboardingProfile.entities.join(", ") || "—"}`} />
                <Row k="Departments" v={`${run.onboardingProfile.departmentScope}: ${run.onboardingProfile.departments.join(", ") || "—"}`} />
                <Row k="Source" v={run.onboardingProfile.sourceKind} />
              </>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </div>
          <div className="border-t border-border px-4 py-3">
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm">
                <Link to="/">Open command center</Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link to="/catalog">Browse boards</Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link to="/warehouse">Warehouse & lineage</Link>
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </section>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2 text-xs">
      <span className="w-24 shrink-0 text-muted-foreground">{k}</span>
      <span className="min-w-0 truncate">{v}</span>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-muted-foreground uppercase">{label}</div>
      <div className="mt-1 font-display text-xl tabular">{value}</div>
    </Card>
  );
}

function HowOnboardingWorks() {
  return (
    <Card className="flex flex-col gap-4 p-6">
      <div className="flex items-center gap-2">
        <Bot className="size-5 text-silver" />
        <h2 className="font-display text-xl">How AI onboarding works</h2>
      </div>
      <ol className="space-y-3">
        {[
          ["Bring data in", "Upload any spreadsheet, connect an integration, or trigger a pipeline — the agent accepts them all."],
          ["The agent inspects", "Header row, types, currencies, dates, quality findings, company and department signals — before asking you anything."],
          ["The interview", "Why is this data arriving? One company or many? Which departments? Every answer is pre-filled from what the data shows."],
          ["Field-by-field review", "Every column mapped to the group model with confidence and reasons. Override anything — the agent learns."],
          ["The gate opens", "Only a confirmed onboarding profile unlocks publish. Dashboards never show un-onboarded data."],
        ].map(([title, body], i) => (
          <li key={title} className="flex gap-3">
            <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-[11px] tabular">
              {i + 1}
            </span>
            <div>
              <div className="text-sm font-medium">{title}</div>
              <div className="text-xs text-muted-foreground">{body}</div>
            </div>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-1.5 border-t border-border pt-4">
        {MESSY_SAMPLES.map((s) => (
          <Button key={s.id} size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={() => downloadSample(s)}>
            <FileSpreadsheet className="size-3" /> {s.fileName}
          </Button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Sample files download as real .xlsx — re-upload them, or bring your own. The classic template studio still lives
        under <Link to="/data" className="text-silver underline underline-offset-4">Excel (template)</Link>.
      </p>
    </Card>
  );
}
