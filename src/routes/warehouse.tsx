import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Boxes,
  Database,
  FileSpreadsheet,
  GitBranch,
  KeyRound,
  ShieldCheck,
} from "lucide-react";
import type { ReactNode } from "react";
import { DASHBOARD_COUNT } from "@/lib/catalog";
import { INDUSTRIES } from "@/lib/domain";
import { useIngestStore } from "@/lib/ingest/store";
import { useAppStore } from "@/lib/store";
import { workbookStats } from "@/lib/selectors";
import { formatNumber, relativeTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";

export const Route = createFileRoute("/warehouse")({ component: WarehousePage });

const MODEL: Array<{ key: string; label: string; desc: string; grain: string }> = [
  { key: "revenue", label: "Revenue", desc: "Recognized revenue lines by month, entity, department, product, region, channel.", grain: "month × entity × dept" },
  { key: "expenses", label: "Expenses", desc: "Spend by category and vendor with recurring flags for opex forecasting.", grain: "month × entity × dept" },
  { key: "sales", label: "Sales", desc: "Unit-level transactions: SKU, quantity, price — feeds ASP and demand curves.", grain: "transaction" },
  { key: "turnover", label: "Inventory turnover", desc: "Opening/closing stock and COGS per period — inventory turns and weeks of cover.", grain: "month × entity" },
  { key: "assets", label: "Assets", desc: "Register with cost, book value and status for capex and utilization boards.", grain: "asset" },
  { key: "licenses", label: "Licenses", desc: "Seats, unit cost, renewal dates — true cost of IT per department.", grain: "agreement" },
  { key: "upcoming", label: "Committed spend", desc: "Scheduled payments: opex, capex, license, payroll, tax with status.", grain: "commitment" },
  { key: "departments", label: "Entities & departments", desc: "The group org spine every board slices on.", grain: "entity × dept" },
  { key: "forecast", label: "Forecast", desc: "Expected units and amounts with method flags for accuracy scoring.", grain: "month × SKU" },
  { key: "demand", label: "Demand plan", desc: "Seasonal norms and safety stock per SKU.", grain: "month × SKU" },
];

const KPI_DICTIONARY = [
  { name: "Revenue YTD", formula: "Σ revenue.amount (Jan 1 → as-of)", home: "Command center · every board" },
  { name: "Opex YTD", formula: "Σ expenses.amount (Jan 1 → as-of)", home: "P&L boards" },
  { name: "Contribution margin", formula: "(revenue − opex) ÷ revenue", home: "Executive boards" },
  { name: "Inventory turns", formula: "COGS ÷ average inventory", home: "Supply-chain boards" },
  { name: "License cost / seat", formula: "Σ (seats × unit cost) ÷ seats", home: "IT cost boards" },
  { name: "FX exposure", formula: "Σ amounts by source currency ÷ total", home: "Treasury board" },
];

function WarehousePage() {
  const wb = useAppStore((s) => s.workbook);
  const source = useAppStore((s) => s.source);
  const fileName = useAppStore((s) => s.fileName);
  const history = useIngestStore((s) => s.history);
  const stats = workbookStats(wb);
  const committedRuns = history.filter((r) => r.result);
  const aiRows = committedRuns.reduce((acc, r) => acc + (r.result?.rowsCommitted ?? 0), 0);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs tracking-[0.16em] text-silver uppercase">Warehouse & semantic layer</p>
          <h1 className="mt-1 font-display text-3xl lg:text-4xl">One model behind every board.</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Raw files never touch the dashboards. Everything lands here first — typed, deduplicated, mapped to the
            group's entities, departments and controlled vocabularies — with lineage back to the source file.
          </p>
        </div>
        <Button asChild>
          <Link to="/ingest">Ingest a file</Link>
        </Button>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <div className="text-xs text-muted-foreground uppercase">Fact rows</div>
          <div className="mt-1 font-display text-2xl tabular">
            {formatNumber(stats.revenue + stats.expenses + stats.sales + stats.turnover)}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {formatNumber(stats.revenue)} revenue · {formatNumber(stats.expenses)} opex · {formatNumber(stats.sales)}{" "}
            sales
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground uppercase">Entities · departments</div>
          <div className="mt-1 font-display text-2xl tabular">
            {INDUSTRIES.length} × {new Set(wb.departments.map((d) => d.department)).size || 12}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">group companies × functions</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground uppercase">Boards served</div>
          <div className="mt-1 font-display text-2xl tabular">{DASHBOARD_COUNT}</div>
          <div className="mt-1 text-xs text-muted-foreground">every one reads this model</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground uppercase">Rows via AI ingest</div>
          <div className="mt-1 font-display text-2xl tabular">{formatNumber(aiRows)}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {committedRuns.length} file{committedRuns.length === 1 ? "" : "s"} · unmapped files land as reviewed
          </div>
        </Card>
      </section>

      <section>
        <h2 className="flex items-center gap-2 font-display text-xl">
          <Database className="size-4 text-silver" /> Canonical model
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Industry-agnostic by design: the same twelve tables serve retail, healthcare, energy, logistics and the rest —
          which is why a new group company costs configuration, not new code.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {MODEL.map((m) => {
            const rows = (stats as unknown as Record<string, number>)[m.key] ?? 0;
            return (
              <Card key={m.key} className="flex flex-col gap-2 p-4">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{m.label}</span>
                  <Badge variant="silver">{formatNumber(rows)} rows</Badge>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">{m.desc}</p>
                <div className="mt-auto text-[11px] text-muted-foreground">grain: {m.grain}</div>
              </Card>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="flex items-center gap-2 font-display text-xl">
          <KeyRound className="size-4 text-silver" /> KPI dictionary
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Definitions are part of the warehouse. Two entities calling margin different things is a mapping bug, not a
          board bug — fix it here once.
        </p>
        <Card className="mt-4 overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] text-muted-foreground uppercase">
                <th className="px-4 py-2.5 font-medium">KPI</th>
                <th className="px-4 py-2.5 font-medium">Definition</th>
                <th className="px-4 py-2.5 font-medium">Surfaces on</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {KPI_DICTIONARY.map((k) => (
                <tr key={k.name}>
                  <td className="px-4 py-2.5 font-medium">{k.name}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{k.formula}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{k.home}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </section>

      <section>
        <h2 className="flex items-center gap-2 font-display text-xl">
          <GitBranch className="size-4 text-silver" /> Lineage
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Any number on any board can be traced back to the file it came from and the recipe that shaped it.
        </p>
        <div className="mt-4 flex flex-col items-stretch gap-2 md:flex-row">
          <LineageNode icon={<FileSpreadsheet className="size-4" />} title="Source" value={committedRuns.length ? `${committedRuns.length} reviewed file${committedRuns.length === 1 ? "" : "s"}` : "sample workbook"} />
          <LineageArrow />
          <LineageNode icon={<Boxes className="size-4" />} title="Profile & clean" value={`${committedRuns.reduce((a, r) => a + r.cleanSteps.length, 0) || 0} recipe steps`} />
          <LineageArrow />
          <LineageNode icon={<Database className="size-4" />} title="Semantic map" value={`${committedRuns.reduce((a, r) => a + r.mappings.filter((m) => m.target).length, 0)} column mappings`} />
          <LineageArrow />
          <LineageNode icon={<ShieldCheck className="size-4" />} title="Warehouse" value={`${formatNumber(stats.revenue + stats.expenses + stats.sales + stats.turnover)} fact rows`} highlight />
        </div>
      </section>

      <section>
        <h2 className="flex items-center gap-2 font-display text-xl">
          <ShieldCheck className="size-4 text-silver" /> Source registry
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Baseline workbook plus every AI-ingested file, newest first. Status and mapping confidence are reviewable
          forever.
        </p>
        <Card className="mt-4 overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] text-muted-foreground uppercase">
                <th className="px-4 py-2.5 font-medium">Source</th>
                <th className="px-4 py-2.5 font-medium">Domain</th>
                <th className="px-4 py-2.5 font-medium">Rows</th>
                <th className="px-4 py-2.5 font-medium">Quality</th>
                <th className="px-4 py-2.5 font-medium">Mapping</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <tr>
                <td className="px-4 py-2.5 font-medium">{fileName}</td>
                <td className="px-4 py-2.5 text-muted-foreground">full workbook</td>
                <td className="px-4 py-2.5 tabular">
                  {formatNumber(stats.revenue + stats.expenses + stats.sales + stats.turnover)}
                </td>
                <td className="px-4 py-2.5">
                  <Badge variant="up">seed</Badge>
                </td>
                <td className="px-4 py-2.5 text-muted-foreground">—</td>
                <td className="px-4 py-2.5">
                  <Badge variant={source === "sample" ? "silver" : "up"}>{source}</Badge>
                </td>
                <td className="px-4 py-2.5 text-muted-foreground">baseline</td>
              </tr>
              {history.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-4 text-muted-foreground">
                    No AI-ingested files yet —{" "}
                    <Link to="/ingest" className="text-silver underline underline-offset-4">
                      run one
                    </Link>
                    .
                  </td>
                </tr>
              )}
              {history.map((r) => (
                <tr key={r.id}>
                  <td className="max-w-56 px-4 py-2.5 font-medium">
                    <span className="block truncate">{r.fileName}</span>
                    {r.onboardingProfile && (
                      <span className="block truncate text-[11px] font-normal text-muted-foreground">
                        {r.onboardingProfile.purposeLabel} ·{" "}
                        {r.onboardingProfile.entityScope === "single" ? "single" : "multiple"} company
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">{r.domain?.domain ?? "—"}</td>
                  <td className="px-4 py-2.5 tabular">{formatNumber(r.profile?.rowCount ?? 0)}</td>
                  <td className="px-4 py-2.5 tabular">{r.profile?.qualityScore ?? "—"}</td>
                  <td className="px-4 py-2.5 tabular">
                    {r.result ? `${Math.round(r.result.mappingConfidence * 100)}%` : "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    {r.result ? <Badge variant="up">committed</Badge> : <Badge variant="warn">in review</Badge>}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">{relativeTime(r.createdAt)} ago</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </section>
    </div>
  );
}

function LineageNode({
  icon,
  title,
  value,
  highlight,
}: {
  icon: ReactNode;
  title: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <Card className={cn("flex flex-col items-center gap-1.5 p-4 text-center", highlight && "border-silver/40")}>
      <span className="text-silver">{icon}</span>
      <div className="text-sm font-medium">{title}</div>
      <div className="text-xs text-muted-foreground">{value}</div>
    </Card>
  );
}

function LineageArrow() {
  return (
    <div className="hidden items-center justify-center md:flex">
      <ArrowRight className="size-4 text-muted-foreground" />
    </div>
  );
}
