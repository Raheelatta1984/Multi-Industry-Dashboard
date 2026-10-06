import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { DEPARTMENTS, INDUSTRIES } from "@/lib/domain";
import { formatDate, formatMoney, formatNumber, formatPct, relativeTime } from "@/lib/format";
import {
  assetRows,
  channelMix,
  currencyExposure,
  demandCompare,
  departmentShare,
  expenseStack,
  forecastCompare,
  kpisFor,
  licenseRows,
  opexSeries,
  regionBars,
  revenueSeries,
  skuDemand,
  upcomingRows,
  vendorBars,
  type Kpi,
} from "@/lib/selectors";
import { useAppStore } from "@/lib/store";
import type { DashboardDef, WidgetDef } from "@/lib/types";
import { DualArea, DemandLines, ForecastLines, SimpleBar, SimpleDonut, StackedSpend } from "./charts";
import { Sparkline } from "./sparkline";
import { Badge } from "./ui/badge";
import { Card } from "./ui/card";
import { cn } from "@/lib/cn";

function heightClass(h?: WidgetDef["height"]) {
  if (h === "lg") return "h-72";
  if (h === "sm") return "h-40";
  return "h-56";
}

function spanClass(span: WidgetDef["span"]) {
  if (span === 4) return "lg:col-span-4";
  if (span === 5) return "lg:col-span-5";
  if (span === 6) return "lg:col-span-6";
  if (span === 7) return "lg:col-span-7";
  if (span === 8) return "lg:col-span-8";
  return "lg:col-span-12";
}

function formatKpi(kpi: Kpi, ccy: string) {
  if (kpi.format === "money") return formatMoney(kpi.value, ccy, { compact: true });
  if (kpi.format === "pct") return formatPct(kpi.value);
  if (kpi.format === "x") return `${kpi.value.toFixed(2)}x`;
  return formatNumber(kpi.value, true);
}

function KpiCard({ kpi, dirty }: { kpi: Kpi; dirty: boolean }) {
  const ccy = useAppStore((s) => s.displayCurrency);
  const up = kpi.delta >= 0;
  return (
    <Card className={cn("p-4", dirty && "kpi-dirty")}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs tracking-wide text-muted-foreground uppercase">{kpi.label}</div>
          <div className="mt-2 font-display text-3xl leading-none tabular">{formatKpi(kpi, ccy)}</div>
          <div className={cn("mt-2 text-xs tabular", up ? "text-up" : "text-down")}>
            {formatPct(kpi.delta)} vs prior
          </div>
        </div>
        <Sparkline points={kpi.spark} tone={up ? "up" : "down"} />
      </div>
    </Card>
  );
}

function Panel({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <Card className={cn("flex flex-col", className)}>
      <div className="flex items-center justify-between px-4 pt-4">
        <h3 className="text-sm text-muted-foreground">{title}</h3>
      </div>
      <div className="min-h-0 flex-1 p-2 pt-1">{children}</div>
    </Card>
  );
}

function ActivityFeed() {
  const reports = useAppStore((s) => s.reports);
  if (!reports.length) {
    return (
      <div className="px-3 py-6 text-sm text-muted-foreground">
        Waiting for the first incremental tick. Unchanged history stays put.
      </div>
    );
  }
  return (
    <ul className="space-y-2 px-3 pb-3">
      {reports.slice(0, 8).map((r) => (
        <li key={r.at} className="flex items-start justify-between gap-3 rounded-lg bg-secondary/50 px-3 py-2">
          <div>
            <div className="text-sm">
              +{r.added} / ~{r.updated} / -{r.removed}
            </div>
            <div className="text-xs text-muted-foreground">
              {r.skipped} unchanged · {r.latencyMs}ms · {r.sheetsTouched.join(", ") || "none"}
            </div>
          </div>
          <div className="text-xs text-muted-foreground tabular">{relativeTime(r.at)}</div>
        </li>
      ))}
    </ul>
  );
}

function Heatmap() {
  const wb = useAppStore((s) => s.workbook);
  const ccy = useAppStore((s) => s.displayCurrency);
  const rates = new Map(wb.fx.map((r) => [r.currency, r.rateToUsd]));
  const cells = (() => {
    const map = new Map<string, { score: number }>();
    for (const row of wb.expenses) {
      if (row.date < "2026-01-01") continue;
      const k = `${row.industry}|${row.department}`;
      map.set(k, { score: (map.get(k)?.score ?? 0) + row.amount });
    }
    const rev = new Map<string, number>();
    for (const row of wb.revenue) {
      if (row.date < "2026-01-01") continue;
      const k = `${row.industry}|all`;
      rev.set(row.industry, (rev.get(row.industry) ?? 0) + row.amount);
    }
    return { map, rev, rates, ccy };
  })();

  return (
    <div className="overflow-x-auto px-2 pb-3">
      <div className="min-w-[720px]">
        <div className="grid grid-cols-[7rem_repeat(12,minmax(0,1fr))] gap-1">
          <div />
          {DEPARTMENTS.map((d) => (
            <div key={d.id} className="truncate px-1 text-center text-[10px] text-muted-foreground">
              {d.label}
            </div>
          ))}
          {INDUSTRIES.map((ind) => (
            <div key={ind.id} className="contents">
              <div className="truncate py-1 text-xs text-muted-foreground">{ind.short}</div>
              {DEPARTMENTS.map((d) => {
                const opex = cells.map.get(`${ind.id}|${d.id}`)?.score ?? 0;
                const rev = cells.rev.get(ind.id) ?? 1;
                const share = opex / (rev / 12 + 1);
                const tone = share > 1.2 ? "bg-down/40" : share > 0.7 ? "bg-silver/25" : "bg-up/30";
                return (
                  <Link
                    key={`${ind.id}-${d.id}`}
                    to="/board/$id"
                    params={{ id: `${ind.id}-${d.id}` }}
                    className={cn("block h-8 rounded-md transition-opacity duration-150 hover:opacity-80", tone)}
                    aria-label={`${ind.label} ${d.label}`}
                  />
                );
              })}
            </div>
          ))}
        </div>
        <div className="mt-3 flex gap-4 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-up/30" /> lean
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-silver/25" /> balanced
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-down/40" /> heavy
          </span>
        </div>
      </div>
    </div>
  );
}

function WidgetBody({ widget, board }: { widget: WidgetDef; board: DashboardDef }) {
  const wb = useAppStore((s) => s.workbook);
  const ccy = useAppStore((s) => s.displayCurrency);
  const dirtyUntil = useAppStore((s) => s.dirtyUntil);
  const dirty = Date.now() < dirtyUntil;
  const rates = new Map(wb.fx.map((r) => [r.currency, r.rateToUsd]));
  const slice = { industry: board.industry, department: board.department };
  const kpis = kpisFor(wb, slice, ccy, rates);

  if (widget.kind === "kpi" && widget.metric) {
    const kpi = kpis[widget.metric];
    if (!kpi) return null;
    return <KpiCard kpi={{ ...kpi, label: widget.title }} dirty={dirty} />;
  }

  if (widget.kind === "area") {
    const rev = revenueSeries(wb, slice, ccy, rates);
    const opex = opexSeries(wb, slice, ccy, rates);
    const data = rev.map((r, i) => ({ period: r.period, revenue: r.value, opex: opex[i]?.value ?? 0 }));
    return (
      <Panel title={widget.title} className={heightClass(widget.height)}>
        <DualArea data={data} aKey="revenue" bKey="opex" aName="Revenue" bName="Expenditure" />
      </Panel>
    );
  }

  if (widget.kind === "bar") {
    const data =
      widget.metric === "licenses"
        ? vendorBars(wb, slice, ccy, rates)
        : widget.metric === "demand"
          ? skuDemand(wb, slice)
          : widget.metric === "fxExposure"
            ? currencyExposure(wb, slice, ccy, rates)
            : widget.metric === "assets"
              ? assetRows(wb, slice, ccy, rates)
                  .slice(0, 8)
                  .map((a) => ({ name: a.category, value: a.bookC }))
              : regionBars(wb, slice, ccy, rates);
    return (
      <Panel title={widget.title} className={heightClass(widget.height)}>
        <SimpleBar data={data} money={widget.metric !== "demand"} />
      </Panel>
    );
  }

  if (widget.kind === "stack") {
    return (
      <Panel title={widget.title} className={heightClass(widget.height)}>
        <StackedSpend data={expenseStack(wb, slice, ccy, rates)} />
      </Panel>
    );
  }

  if (widget.kind === "donut") {
    const data =
      widget.metric === "opex"
        ? departmentShare(wb, slice, ccy, rates)
        : widget.metric === "assets"
          ? assetRows(wb, slice, ccy, rates).reduce<Array<{ name: string; value: number }>>((acc, a) => {
              const hit = acc.find((x) => x.name === a.category);
              if (hit) hit.value += a.bookC;
              else acc.push({ name: a.category, value: a.bookC });
              return acc;
            }, [])
          : widget.metric === "licenses"
            ? [
                { name: "Annual", value: wb.licenses.filter((l) => l.cycle === "annual").length },
                { name: "Monthly", value: wb.licenses.filter((l) => l.cycle === "monthly").length },
              ]
            : channelMix(wb, slice, ccy, rates);
    return (
      <Panel title={widget.title} className={heightClass(widget.height)}>
        <SimpleDonut data={data} />
      </Panel>
    );
  }

  if (widget.kind === "forecast") {
    return (
      <Panel title={widget.title} className={heightClass(widget.height)}>
        <ForecastLines data={forecastCompare(wb, slice, ccy, rates)} />
      </Panel>
    );
  }

  if (widget.kind === "demand") {
    return (
      <Panel title={widget.title} className={heightClass(widget.height)}>
        <DemandLines data={demandCompare(wb, slice)} />
      </Panel>
    );
  }

  if (widget.kind === "upcoming") {
    const rows = upcomingRows(wb, slice, ccy, rates);
    return (
      <Panel title={widget.title} className={heightClass(widget.height)}>
        <div className="max-h-full overflow-auto px-2">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-2 font-medium">Due</th>
                <th className="font-medium">Item</th>
                <th className="font-medium">Type</th>
                <th className="text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="py-2 tabular text-muted-foreground">{formatDate(r.dueDate)}</td>
                  <td>{r.description}</td>
                  <td>
                    <Badge variant="outline">{r.type}</Badge>
                  </td>
                  <td className="text-right tabular">{formatMoney(r.converted, ccy, { compact: true })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    );
  }

  if (widget.kind === "licenses") {
    const rows = licenseRows(wb, slice, ccy, rates);
    return (
      <Panel title={widget.title} className={heightClass(widget.height)}>
        <div className="max-h-full overflow-auto px-2">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-2 font-medium">License</th>
                <th className="font-medium">Seats</th>
                <th className="font-medium">End</th>
                <th className="text-right font-medium">Annual</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="py-2">
                    {r.name}
                    <div className="text-xs text-muted-foreground">{r.vendor}</div>
                  </td>
                  <td className="tabular">{r.seats}</td>
                  <td className="tabular text-muted-foreground">{formatDate(r.end)}</td>
                  <td className="text-right tabular">{formatMoney(r.annual, ccy, { compact: true })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    );
  }

  if (widget.kind === "assets") {
    const rows = assetRows(wb, slice, ccy, rates);
    return (
      <Panel title={widget.title} className={heightClass(widget.height)}>
        <div className="max-h-full overflow-auto px-2">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-2 font-medium">Asset</th>
                <th className="font-medium">Status</th>
                <th className="text-right font-medium">Cost</th>
                <th className="text-right font-medium">Book</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="py-2">
                    {r.name}
                    <div className="text-xs text-muted-foreground">{r.category}</div>
                  </td>
                  <td>
                    <Badge variant={r.status === "active" ? "up" : r.status === "idle" ? "warn" : "outline"}>
                      {r.status}
                    </Badge>
                  </td>
                  <td className="text-right tabular">{formatMoney(r.costC, ccy, { compact: true })}</td>
                  <td className="text-right tabular">{formatMoney(r.bookC, ccy, { compact: true })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    );
  }

  if (widget.kind === "fx") {
    return (
      <Panel title={widget.title} className={heightClass(widget.height)}>
        <div className="max-h-full overflow-auto px-2">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-2 font-medium">CCY</th>
                <th className="text-right font-medium">USD per unit</th>
                <th className="text-right font-medium">As of</th>
              </tr>
            </thead>
            <tbody>
              {wb.fx.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="py-2">{r.currency}</td>
                  <td className="text-right tabular">{r.rateToUsd.toPrecision(4)}</td>
                  <td className="text-right tabular text-muted-foreground">{formatDate(r.asOf)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    );
  }

  if (widget.kind === "heatmap") {
    return (
      <Panel title={widget.title} className={heightClass(widget.height)}>
        <Heatmap />
      </Panel>
    );
  }

  if (widget.kind === "activity") {
    return (
      <Panel title={widget.title} className={heightClass(widget.height)}>
        <ActivityFeed />
      </Panel>
    );
  }

  return null;
}

export function DashboardCanvas({ board }: { board: DashboardDef }) {
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
      {board.widgets.map((w) => (
        <div key={w.id} className={cn("col-span-1", spanClass(w.span))}>
          <WidgetBody widget={w} board={board} />
        </div>
      ))}
    </div>
  );
}
