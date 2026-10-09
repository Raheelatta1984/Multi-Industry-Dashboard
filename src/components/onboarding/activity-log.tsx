import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, Info, ScrollText, XCircle } from "lucide-react";
import { useIngestStore } from "@/lib/ingest/store";
import { logToText, type LogLevel, type LogStage, type OnboardingLogEntry } from "@/lib/ingest/log";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";

const LEVEL_ICON: Record<LogLevel, typeof Info> = {
  success: CheckCircle2,
  info: Info,
  warn: AlertTriangle,
  error: XCircle,
};

const LEVEL_TONE: Record<LogLevel, string> = {
  success: "text-up",
  info: "text-silver",
  warn: "text-warn",
  error: "text-down",
};

const FIX_TONE: Record<LogLevel, string> = {
  success: "text-muted-foreground",
  info: "text-muted-foreground",
  warn: "text-warn",
  error: "text-down",
};

const STAGE_LABEL: Record<LogStage, string> = {
  intake: "Intake",
  profile: "Profile",
  clean: "Clean",
  model: "Model",
  map: "Mapping",
  interview: "Interview",
  commit: "Commit",
  import: "Import",
};

function clock(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/**
 * The on-screen onboarding log: every intake step, interview answer, mapping
 * change and commit outcome, newest at the bottom, each with what to fix.
 */
export function ActivityLog({
  title = "Onboarding log",
  stages,
  emptyText = "Nothing yet. The log records each step once you upload a file or try a sample.",
}: {
  title?: string;
  stages?: LogStage[];
  emptyText?: string;
}) {
  const logs = useIngestStore((s) => s.logs);
  const [filter, setFilter] = useState<"all" | "attention">("all");
  const scopedLogs = useMemo(() => (stages ? logs.filter((e) => stages.includes(e.stage)) : logs), [logs, stages]);
  const attention = scopedLogs.filter((e) => e.level === "warn" || e.level === "error").length;
  const visible = filter === "attention" ? scopedLogs.filter((e) => e.level === "warn" || e.level === "error") : scopedLogs;
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [visible.length]);

  function save() {
    const blob = new Blob([logToText(scopedLogs)], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "meridian-onboarding-log.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Card className="flex flex-col overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <ScrollText className="size-4 text-silver" />
          <span className="text-sm font-medium">{title}</span>
          <Badge variant="silver">{scopedLogs.length} events</Badge>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex rounded-md border border-border p-0.5 text-xs">
            {(
              [
                ["all", "All"],
                ["attention", `Needs attention · ${attention}`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={cn(
                  "rounded px-2 py-1",
                  filter === key ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={save} disabled={!scopedLogs.length}>
            <Download className="size-3" /> Save log
          </Button>
        </div>
      </div>
      <div ref={scrollRef} className="max-h-[380px] min-h-[120px] overflow-y-auto">
        {visible.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            {filter === "attention" && scopedLogs.length ? "Nothing needs attention. Every check so far passed." : emptyText}
          </p>
        ) : (
          <ol className="divide-y divide-border">
            {visible.map((e) => (
              <LogRow key={e.id} entry={e} />
            ))}
          </ol>
        )}
      </div>
    </Card>
  );
}

function LogRow({ entry: e }: { entry: OnboardingLogEntry }) {
  const Icon = LEVEL_ICON[e.level];
  return (
    <li className="flex gap-3 px-4 py-2.5 text-sm" data-level={e.level} data-stage={e.stage}>
      <Icon className={cn("mt-0.5 size-4 shrink-0", LEVEL_TONE[e.level])} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="font-medium leading-snug">{e.title}</span>
          <span className="text-[11px] tabular text-muted-foreground">{clock(e.at)}</span>
          <span className="text-[10px] tracking-wide text-muted-foreground uppercase">
            {STAGE_LABEL[e.stage]}
            {e.fileName ? ` · ${e.fileName}` : ""}
          </span>
        </div>
        {e.detail && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{e.detail}</p>}
        {e.fix && (
          <p className={cn("mt-1 text-xs leading-relaxed", FIX_TONE[e.level])}>
            <span className="font-medium">Fix: </span>
            {e.fix}
          </p>
        )}
        {e.facts && e.facts.length > 0 && (
          <dl className="mt-2 grid grid-cols-3 gap-1.5 sm:grid-cols-6">
            {e.facts.map((f) => (
              <div key={f.label} className="rounded-md bg-secondary/60 px-2 py-1">
                <dt className="text-[10px] text-muted-foreground uppercase">{f.label}</dt>
                <dd className="truncate text-xs font-medium tabular">{f.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </li>
  );
}
