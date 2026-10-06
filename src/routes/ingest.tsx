import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  CheckCircle2,
  CircleDashed,
  Database,
  FileSpreadsheet,
  Layers,
  Sparkles,
  Upload,
  Wand2,
} from "lucide-react";
import { MESSY_SAMPLES, downloadSample } from "@/lib/ingest/samples";
import { useIngestStore } from "@/lib/ingest/store";
import { DOMAIN_FIELD_LIST, FIELD_LABELS } from "@/lib/ingest/semantic";
import type { CleanStep, ColumnMapping, IngestDomain, IngestRun } from "@/lib/ingest/types";
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

const STAGES = ["Profile", "Clean", "Map", "Publish"] as const;

function IngestPage() {
  const run = useIngestStore((s) => s.active);
  const ingestBuffer = useIngestStore((s) => s.ingestBuffer);
  const ingestGrid = useIngestStore((s) => s.ingestGrid);
  const clearActive = useIngestStore((s) => s.clearActive);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState(4);

  // Brief staged reveal so the reviewer can watch the pipeline think.
  const runId = run?.id;
  useEffect(() => {
    if (!runId) return;
    setPhase(0);
    const t1 = window.setTimeout(() => setPhase(1), 420);
    const t2 = window.setTimeout(() => setPhase(2), 900);
    const t3 = window.setTimeout(() => setPhase(3), 1400);
    const t4 = window.setTimeout(() => setPhase(4), 1850);
    return () => [t1, t2, t3, t4].forEach(window.clearTimeout);
  }, [runId]);

  async function onFile(file: File) {
    setBusy(true);
    setError(null);
    try {
      const buf = await file.arrayBuffer();
      ingestBuffer(file.name, buf);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that file.");
    } finally {
      setBusy(false);
    }
  }

  if (!run) {
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-8">
        <header>
          <p className="text-xs tracking-[0.16em] text-silver uppercase">AI data studio</p>
          <h1 className="mt-1 font-display text-3xl lg:text-4xl">Bring any file. The warehouse understands it.</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Drop <span className="text-foreground">any</span> spreadsheet — no template, no naming rules. Meridian
            profiles every column, writes a cleaning recipe, maps the file onto the group semantic model, and asks you
            to confirm before a single row lands in the warehouse.
          </p>
        </header>

        <Card
          className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border p-10 text-center"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const file = e.dataTransfer.files[0];
            if (file) void onFile(file);
          }}
        >
          <Upload className="size-6 text-silver" />
          <div className="font-display text-2xl">Drop any .xlsx / .xls / .csv</div>
          <p className="max-w-md text-sm text-muted-foreground">
            The engine detects the header row (even under title rows), infers types, and proposes a mapping. Nothing is
            committed without your review.
          </p>
          <Button disabled={busy}>{busy ? "Reading…" : "Choose file"}</Button>
          <input
            ref={inputRef}
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

        {error && <p className="text-sm text-down">{error}</p>}

        <section>
          <h2 className="font-display text-xl">Or try a realistically messy file</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The kind that lands in finance inboxes every month — the pipeline has to earn its keep on these.
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {MESSY_SAMPLES.map((s) => (
              <Card key={s.id} className="flex flex-col gap-3 p-5">
                <div className="flex items-center justify-between">
                  <FileSpreadsheet className="size-5 text-silver" />
                  <Badge variant="silver">{s.domain}</Badge>
                </div>
                <div className="font-display text-lg leading-snug">{s.label}</div>
                <p className="min-h-16 text-xs leading-relaxed text-muted-foreground">{s.blurb}</p>
                <div className="mt-auto flex gap-2">
                  <Button size="sm" onClick={() => ingestGrid(s.fileName, "Export", s.grid)}>
                    <Sparkles className="size-3.5" /> Run pipeline
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => downloadSample(s)}>
                    .xlsx
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </section>

        <p className="text-sm text-muted-foreground">
          Still using the fixed template?{" "}
          <Link to="/data" className="text-silver underline underline-offset-4 hover:text-foreground">
            The classic Excel studio
          </Link>{" "}
          keeps working — the AI studio is additive, not a replacement.
        </p>

        <section>
          <h2 className="font-display text-xl">Same pipeline, more sources</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The profile → clean → map → publish stages are source-agnostic. This prototype ships the spreadsheet path;
            the production architecture runs the identical stages over live connections.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {["PostgreSQL", "SQL Server", "Oracle", "MySQL", "SAP extracts", "Snowflake", "BigQuery", "Databricks", "REST APIs", "SFTP drops", "Google Sheets", "Email attachments"].map(
              (c) => (
                <span
                  key={c}
                  className="rounded-full border border-dashed border-border px-3 py-1 text-xs text-muted-foreground"
                >
                  {c}
                </span>
              ),
            )}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs tracking-[0.16em] text-silver uppercase">AI data studio</p>
          <h1 className="mt-1 font-display text-3xl lg:text-4xl">{run.fileName}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {run.profile ? `${formatNumber(run.profile.rowCount)} rows · ` : ""}
            {run.raw ? `${run.raw.headers.length} columns · ` : ""}
            ingested {relativeTime(run.createdAt)} ago
          </p>
        </div>
        <div className="flex items-center gap-2">
          {run.result ? (
            <Badge variant="up" className="gap-1.5">
              <CheckCircle2 className="size-3" /> committed
            </Badge>
          ) : (
            <Badge variant="silver" className="gap-1.5">
              <CircleDashed className="size-3" /> awaiting review
            </Badge>
          )}
          <Button variant="ghost" size="sm" onClick={clearActive}>
            New file
          </Button>
        </div>
      </header>

      <StageBar phase={phase} run={run} />

      {phase >= 1 && run.profile && <ProfileSection run={run} />}
      {phase >= 2 && <CleanSection run={run} />}
      {phase >= 3 && <MapSection run={run} />}
      {phase >= 4 && <PublishSection run={run} />}
    </div>
  );
}

function StageBar({ phase, run }: { phase: number; run: IngestRun }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {STAGES.map((label, i) => {
        const done = run.result ? true : phase > i + 1;
        const active = !run.result && phase === i + 1;
        return (
          <div key={label} className="flex items-center gap-2">
            <span
              className={cn(
                "flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs",
                done && "bg-secondary text-foreground",
                active && "border-silver text-silver",
                !done && !active && "text-muted-foreground",
              )}
            >
              {done ? <CheckCircle2 className="size-3.5" /> : active ? <Wand2 className="size-3.5 animate-pulse" /> : <CircleDashed className="size-3.5" />}
              {label}
            </span>
            {i < STAGES.length - 1 && <ArrowRight className="size-3 text-muted-foreground" />}
          </div>
        );
      })}
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
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-[11px] text-muted-foreground uppercase">Quality score</div>
              <div className={cn("font-display text-2xl tabular", p.qualityScore >= 80 ? "text-up" : p.qualityScore >= 60 ? "text-warn" : "text-down")}>
                {p.qualityScore}
              </div>
            </div>
          </div>
        }
      />
      <div className="grid gap-3 md:grid-cols-2">
        <Card className="overflow-hidden p-0">
          <div className="border-b border-border px-4 py-3 text-sm font-medium">Detected header row</div>
          <div className="px-4 py-3 text-sm text-muted-foreground">
            Row {run.raw!.headerRowIndex + 1} of “{run.raw!.sheetName}” —{" "}
            <span className="text-foreground">{run.raw!.headers.length} columns</span> recognized under{" "}
            {run.raw!.headerRowIndex > 0 ? "a title row" : "a plain grid"}.
          </div>
        </Card>
        <Card className="overflow-hidden p-0">
          <div className="border-b border-border px-4 py-3 text-sm font-medium">Sheet-level findings</div>
          <ul className="divide-y divide-border text-sm">
            {p.issues.length === 0 && <li className="px-4 py-3 text-muted-foreground">No sheet-level issues.</li>}
            {p.issues.map((i, idx) => (
              <li key={idx} className="flex items-center justify-between px-4 py-2.5">
                <span>{i.message}</span>
                <Badge variant={i.severity === "high" ? "down" : i.severity === "medium" ? "warn" : "silver"}>
                  {i.severity}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>
      </div>
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
      return `${s.normalized} normalized · ${s.unparseable} unparseable → null`;
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
                      {view === "raw" ? h : h}
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

function MapSection({ run }: { run: IngestRun }) {
  const override = useIngestStore((s) => s.overrideMapping);
  const domain = run.domain!;
  const fields = domain.domain ? DOMAIN_FIELD_LIST[domain.domain] : null;
  const options = fields ? [...fields.required, ...fields.optional] : [];
  return (
    <section className="flex flex-col gap-4">
      <SectionHead
        icon={<Sparkles className="size-4" />}
        title="3 · Semantic mapping"
        blurb="Source columns mapped onto the group model. Overriding a suggestion is one click — the AI learns from the correction."
      />
      <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <div className="flex items-center gap-2">
            <Database className="size-4 text-silver" />
            <span className="font-display text-xl">
              {domain.domain ? `Classified as ${domain.domain} data` : "Unclassified"}
            </span>
            {domain.domain && <Badge variant="up">{Math.round(domain.confidence * 100)}% confidence</Badge>}
          </div>
          <p className="mt-1.5 max-w-2xl text-xs text-muted-foreground">
            Evidence: {domain.reasons.join(" · ")}
            {domain.runnerUp ? ` — runner-up: ${domain.runnerUp}` : ""}
          </p>
        </div>
      </Card>
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

function PublishSection({ run }: { run: IngestRun }) {
  const publish = useIngestStore((s) => s.publish);
  const result = run.result;
  const domain = run.domain?.domain as IngestDomain | undefined;
  const required = domain ? DOMAIN_FIELD_LIST[domain].required : [];
  const missingRequired = required.filter(
    (f) => !run.mappings.some((m) => m.target === f),
  );
  const canPublish = Boolean(domain) && missingRequired.length === 0 && !result;
  const ccy = useAppStore((s) => s.displayCurrency);

  if (!result) {
    return (
      <section className="flex flex-col gap-4">
        <SectionHead
          icon={<Database className="size-4" />}
          title="4 · Publish"
          blurb="Commit writes to the warehouse with full lineage: source file → recipe → mapping → boards."
        />
        <Card className="flex flex-col items-start gap-4 p-6">
          {missingRequired.length > 0 && (
            <p className="text-sm text-warn">
              Missing required field{missingRequired.length === 1 ? "" : "s"}:{" "}
              {missingRequired.map((f) => FIELD_LABELS[f] ?? f).join(", ")} — map them above or pick another domain.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button size="lg" disabled={!canPublish} onClick={() => publish()}>
              <Database className="size-4" /> Commit {run.profile ? formatNumber(run.profile.rowCount) : ""} rows to warehouse
            </Button>
            <span className="text-xs text-muted-foreground">
              Display currency {ccy} · amounts stored in source currency
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
          <div className="border-b border-border px-4 py-3 text-sm font-medium">Kept out of the model</div>
          <ul className="divide-y divide-border text-sm">
            {result.unmappedColumns.length === 0 && (
              <li className="px-4 py-3 text-muted-foreground">Every column mapped.</li>
            )}
            {result.unmappedColumns.map((c) => (
              <li key={c} className="px-4 py-2.5">
                {c}
              </li>
            ))}
          </ul>
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

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-muted-foreground uppercase">{label}</div>
      <div className="mt-1 font-display text-xl tabular">{value}</div>
    </Card>
  );
}

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
