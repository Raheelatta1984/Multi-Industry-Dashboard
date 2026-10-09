import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, Database, Info, Lock, XCircle } from "lucide-react";
import { GROUP_TITLE, type CheckGroup, type CommitCheck, type CommitEvaluation } from "@/lib/ingest/preflight";
import { useIngestStore } from "@/lib/ingest/store";
import { domainLabel } from "@/lib/ingest/onboarding";
import type { IngestRun } from "@/lib/ingest/types";
import { formatNumber } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";

const GROUP_ORDER: CheckGroup[] = ["interview", "model", "mapping", "rows", "scope", "quality"];

const LEVEL_ICON = {
  pass: { Icon: CheckCircle2, tone: "text-up" },
  fail: { Icon: XCircle, tone: "text-down" },
  warn: { Icon: AlertTriangle, tone: "text-warn" },
  info: { Icon: Info, tone: "text-silver" },
} as const;

function CheckRow({ check }: { check: CommitCheck }) {
  const { Icon, tone } = LEVEL_ICON[check.level];
  return (
    <li className="flex gap-2.5 py-2 text-sm" data-check={check.id} data-level={check.level}>
      <Icon className={cn("mt-0.5 size-4 shrink-0", tone)} aria-hidden />
      <div className="min-w-0">
        <div className={cn("leading-snug", check.level === "fail" && "font-medium text-foreground")}>{check.title}</div>
        {check.detail && <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{check.detail}</div>}
        {check.fix && (
          <div className={cn("mt-1 text-xs leading-relaxed", check.level === "fail" ? "text-down" : "text-warn")}>
            <span className="font-medium">Fix: </span>
            {check.fix}
          </div>
        )}
      </div>
    </li>
  );
}

/**
 * Commit readiness: what blocks the commit (with the fix, first and always
 * visible), then the heads-ups, then everything that has passed. The commit
 * button is only enabled when nothing blocks it.
 */
export function CommitPanel({ run, evaluation }: { run: IngestRun; evaluation: CommitEvaluation }) {
  const publish = useIngestStore((s) => s.publish);
  const blockers = evaluation.blockers.length;
  const warnings = evaluation.warnings;
  const ready = evaluation.ready;

  if (run.result) return <PublishedSummary run={run} warnings={warnings.length} />;

  const passed = evaluation.checks.filter((c) => c.level === "pass" || c.level === "info");
  const grouped = GROUP_ORDER.map((g) => ({ group: g, checks: passed.filter((c) => c.group === g) })).filter(
    (g) => g.checks.length > 0,
  );

  return (
    <section className="flex flex-col gap-3" id="commit-readiness">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-display text-xl">
            <span className="text-silver">
              <Database className="size-4" />
            </span>
            Commit readiness
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Every condition the warehouse checks before it writes. Red items block the commit and say how to fix them.
            Amber items are heads-ups you can accept.
          </p>
        </div>
        {ready ? (
          <Badge variant="up" className="gap-1.5">
            <CheckCircle2 className="size-3" /> ready to commit
          </Badge>
        ) : (
          <Badge variant="down" className="gap-1.5">
            <Lock className="size-3" /> {blockers} to fix
          </Badge>
        )}
      </div>

      <Card className="overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3 text-sm">
          <span className="font-medium">
            {run.domain?.domain ? domainLabel(run.domain.domain) : "No target model"}
            <span className="ml-2 font-normal text-muted-foreground">
              {evaluation.plannedRows ? `${formatNumber(evaluation.plannedRows)} rows would be committed` : "no rows would be committed yet"}
              {evaluation.boardsLit ? ` · ${evaluation.boardsLit} boards fed` : ""}
            </span>
          </span>
          <span className="text-xs text-muted-foreground">
            {blockers} blocking · {warnings.length} heads-up{warnings.length === 1 ? "" : "s"}
          </span>
        </div>

        {blockers > 0 && (
          <div className="border-b border-border bg-down/5 px-4 py-3">
            <div className="mb-1 text-[11px] font-medium tracking-wide text-down uppercase">
              To fix before you can commit
            </div>
            <ul className="divide-y divide-border/60">
              {evaluation.blockers.map((c) => (
                <CheckRow key={c.id} check={c} />
              ))}
            </ul>
          </div>
        )}

        {warnings.length > 0 && (
          <div className="border-b border-border px-4 py-3">
            <div className="mb-1 text-[11px] font-medium tracking-wide text-warn uppercase">
              Heads-ups you can accept
            </div>
            <ul className="divide-y divide-border/60">
              {warnings.map((c) => (
                <CheckRow key={c.id} check={c} />
              ))}
            </ul>
          </div>
        )}

        {grouped.length > 0 && (
          <div className="divide-y divide-border px-4">
            {grouped.map(({ group, checks }) => (
              <div key={group} className="py-2">
                <div className="pt-1 pb-0.5 text-[10px] tracking-wide text-muted-foreground uppercase">
                  {GROUP_TITLE[group]}
                </div>
                <ul className="divide-y divide-border/60">
                  {checks.map((c) => (
                    <CheckRow key={c.id} check={c} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 border-t border-border px-4 py-3">
          {ready ? (
            <Button size="lg" onClick={() => publish()} className="gap-2">
              <Database className="size-4" /> Commit {formatNumber(evaluation.plannedRows)} rows to warehouse
            </Button>
          ) : (
            <Button size="lg" disabled className="gap-2">
              <Lock className="size-4" /> Fix {blockers} item{blockers === 1 ? "" : "s"} to commit
            </Button>
          )}
          <span className="text-xs text-muted-foreground">
            {ready
              ? "Merge is incremental: rows already in the warehouse are never rewritten. Each step is in the log."
              : "Nothing is written until every red item is fixed. Each fix above says where to go."}
          </span>
        </div>
      </Card>
    </section>
  );
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex gap-2 text-xs">
      <span className="w-24 shrink-0 text-muted-foreground">{k}</span>
      <span className="min-w-0 break-words">{v}</span>
    </div>
  );
}

/** After a commit: what landed, what was assumed, and the lineage record. */
export function PublishedSummary({ run, warnings }: { run: IngestRun; warnings: number }) {
  const result = run.result!;
  const skipped = result.rowsSkipped.reduce((a, s) => a + s.count, 0);
  return (
    <section className="flex flex-col gap-3" id="commit-result">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-display text-xl">
            <span className="text-up">
              <CheckCircle2 className="size-4" />
            </span>
            Committed to the warehouse
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Landed. Every board fed by this file now includes its rows. The log above has the full trail.
          </p>
        </div>
        <Badge variant={warnings ? "warn" : "up"} className="gap-1.5">
          {warnings ? <AlertTriangle className="size-3" /> : <CheckCircle2 className="size-3" />}
          {warnings ? `${warnings} heads-up${warnings === 1 ? "" : "s"} logged` : "clean commit"}
        </Badge>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <div className="text-xs text-muted-foreground uppercase">Rows committed</div>
          <div className="mt-1 font-display text-xl tabular">{formatNumber(result.rowsCommitted)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground uppercase">Warehouse patch</div>
          <div className="mt-1 font-display text-xl tabular">
            +{result.report.added} · ~{result.report.updated} · {formatNumber(result.report.skipped)} unchanged
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground uppercase">Mapping confidence</div>
          <div className="mt-1 font-display text-xl tabular">{Math.round(result.mappingConfidence * 100)}%</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground uppercase">Boards fed by this file</div>
          <div className="mt-1 font-display text-xl tabular">{formatNumber(result.boardsLit)}</div>
        </Card>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="overflow-hidden p-0">
          <div className="border-b border-border px-4 py-3 text-sm font-medium">What the warehouse assumed</div>
          <ul className="divide-y divide-border text-sm">
            {result.defaultsApplied.length === 0 && result.coercedValues.length === 0 && (
              <li className="px-4 py-3 text-muted-foreground">Nothing assumed. Every value matched the model.</li>
            )}
            {result.defaultsApplied.map((d, i) => (
              <li key={`d${i}`} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="min-w-0 truncate">
                  <span className="text-muted-foreground">{d.column}:</span> “{d.from}” → <span className="text-foreground">{d.to}</span>
                </span>
                <Badge variant="warn" className="shrink-0">
                  {formatNumber(d.count)} row{d.count === 1 ? "" : "s"}
                </Badge>
              </li>
            ))}
            {result.coercedValues.slice(0, 8).map((c, i) => (
              <li key={`c${i}`} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="min-w-0 truncate">
                  <span className="text-muted-foreground">{c.column}:</span> “{c.from}” → <span className="text-foreground">{c.to}</span>
                </span>
                <Badge variant={c.score >= 0.9 ? "up" : c.score > 0 ? "warn" : "down"} className="shrink-0">
                  {c.score > 0 ? `${Math.round(c.score * 100)}%` : "default"}
                </Badge>
              </li>
            ))}
          </ul>
          {skipped > 0 && (
            <div className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
              {formatNumber(skipped)} source row{skipped === 1 ? "" : "s"} not committed:{" "}
              {result.rowsSkipped.map((s) => `${s.count} × ${s.reason.toLowerCase()}`).join(" · ")}.
            </div>
          )}
        </Card>

        <Card className="overflow-hidden p-0">
          <div className="border-b border-border px-4 py-3 text-sm font-medium">Onboarding record</div>
          <div className="flex flex-col gap-1.5 px-4 py-3">
            {run.onboardingProfile ? (
              <>
                <Row k="Purpose" v={run.onboardingProfile.purposeLabel} />
                <Row
                  k="Companies"
                  v={`${run.onboardingProfile.entityScope}: ${run.onboardingProfile.entities.join(", ") || "—"}`}
                />
                <Row
                  k="Departments"
                  v={`${run.onboardingProfile.departmentScope}: ${run.onboardingProfile.departments.join(", ") || "—"}`}
                />
                <Row k="Target model" v={domainLabel(run.domain?.domain ?? null)} />
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
