import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { DASHBOARD_COUNT, DASHBOARDS } from "@/lib/catalog";
import { INDUSTRIES } from "@/lib/domain";
import { formatMoney } from "@/lib/format";
import { kpisFor, upcomingRows } from "@/lib/selectors";
import { useAppStore } from "@/lib/store";
import { DashboardCanvas } from "@/components/widgets";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const wb = useAppStore((s) => s.workbook);
  const ccy = useAppStore((s) => s.displayCurrency);
  const rates = new Map(wb.fx.map((r) => [r.currency, r.rateToUsd]));
  const board = DASHBOARDS.find((d) => d.id === "group-command")!;
  const due = upcomingRows(wb, { industry: "all", department: "group" }, ccy, rates).slice(0, 4);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-8">
      <section className="stagger-in flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl">
          <p className="text-xs tracking-[0.18em] text-silver uppercase">Apex Meridian Group</p>
          <h1 className="mt-2 font-display text-4xl leading-tight lg:text-5xl">
            Every number. Every department. One live surface.
          </h1>
          <p className="mt-3 max-w-xl text-sm text-muted-foreground">
            {DASHBOARD_COUNT} boards across twelve industries. Upload <span className="text-foreground">any</span>{" "}
            spreadsheet — the AI agent onboards it through a guided interview (purpose, companies, departments,
            field-by-field review) before anything is committed, then every board, KPI and export updates. Currency
            conversion is live.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link to="/ingest">Start AI onboarding</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/catalog">Browse boards</Link>
          </Button>
        </div>
      </section>

      <DashboardCanvas board={board} />

      <section className="grid gap-3 lg:grid-cols-2">
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl">Divisions</h2>
            <Badge variant="silver">{INDUSTRIES.length}</Badge>
          </div>
          <ul className="mt-4 divide-y divide-border">
            {INDUSTRIES.map((ind) => {
              const sliceK = kpisFor(wb, { industry: ind.id, department: "group" }, ccy, rates);
              return (
                <li key={ind.id} className="flex items-center justify-between py-2.5">
                  <div>
                    <div className="text-sm">{ind.division}</div>
                    <div className="text-xs text-muted-foreground">{ind.label}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="tabular text-sm">{formatMoney(sliceK.revenue.value, ccy, { compact: true })}</span>
                    <Link
                      to="/board/$id"
                      params={{ id: `${ind.id}-executive` }}
                      className="rounded-md p-2 text-muted-foreground hover:bg-secondary hover:text-foreground"
                      aria-label={`Open ${ind.label} command`}
                    >
                      <ArrowUpRight className="size-4" />
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl">Due next</h2>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/board/$id" params={{ id: "group-upcoming" }}>
                All upcoming
              </Link>
            </Button>
          </div>
          <ul className="mt-4 space-y-3">
            {due.map((u) => (
              <li key={u.id} className="flex items-center justify-between rounded-xl bg-secondary/40 px-3 py-3">
                <div>
                  <div className="text-sm">{u.description}</div>
                  <div className="text-xs text-muted-foreground">
                    {u.dueDate} · {u.industry}
                  </div>
                </div>
                <div className="tabular text-sm">{formatMoney(u.converted, ccy, { compact: true })}</div>
              </li>
            ))}
          </ul>
        </Card>
      </section>
    </div>
  );
}
