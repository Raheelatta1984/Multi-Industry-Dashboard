import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { CURRENCIES } from "@/lib/domain";
import { convertAmount, fxMap } from "@/lib/currency";
import { formatMoney } from "@/lib/format";
import { currencyExposure, kpisFor } from "@/lib/selectors";
import { useAppStore } from "@/lib/store";
import { downloadArrayBuffer, workbookToXlsx } from "@/lib/excel";
import { SimpleBar } from "@/components/charts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/fx")({ component: FxPage });

function FxPage() {
  const wb = useAppStore((s) => s.workbook);
  const display = useAppStore((s) => s.displayCurrency);
  const setCurrency = useAppStore((s) => s.setCurrency);
  const rates = fxMap(wb.fx);
  const [amount, setAmount] = useState("1000000");
  const [from, setFrom] = useState("EUR");
  const n = Number(amount) || 0;
  const converted = convertAmount(n, from, display, rates);
  const exposure = currencyExposure(wb, { industry: "all", department: "group" }, display, rates);
  const kpis = kpisFor(wb, { industry: "all", department: "group" }, display, rates);

  const table = useMemo(() => {
    return wb.fx.map((row) => ({
      ...row,
      oneDisplay: convertAmount(1, row.currency, display, rates),
    }));
  }, [wb.fx, display, rates]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <header>
        <p className="text-xs tracking-[0.16em] text-silver uppercase">Treasury</p>
        <h1 className="mt-1 font-display text-3xl lg:text-4xl">Multi-currency conversion</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Every board reads source amounts in native currency, then converts with the FX sheet. Export a converted
          workbook for Excel without mutating stored history.
        </p>
      </header>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="p-4">
          <div className="text-xs text-muted-foreground uppercase">Display</div>
          <div className="mt-2 font-display text-3xl">{display}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground uppercase">Converted revenue YTD</div>
          <div className="mt-2 font-display text-3xl tabular">{formatMoney(kpis.revenue.value, display, { compact: true })}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground uppercase">FX exposure</div>
          <div className="mt-2 font-display text-3xl tabular">{formatMoney(kpis.fxExposure.value, display, { compact: true })}</div>
        </Card>
      </div>

      <Card className="p-5">
        <h2 className="font-display text-xl">Converter</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <label className="text-sm">
            Amount
            <Input className="mt-1" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
          </label>
          <label className="text-sm">
            From
            <select
              className="mt-1 flex h-10 w-full rounded-md border border-input bg-card px-3 text-sm"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            >
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} · {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            To
            <select
              className="mt-1 flex h-10 w-full rounded-md border border-input bg-card px-3 text-sm"
              value={display}
              onChange={(e) => setCurrency(e.target.value as typeof display)}
            >
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} · {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-4 font-display text-3xl tabular">{formatMoney(converted, display)}</div>
      </Card>

      <Card className="h-72 p-4">
        <h2 className="px-2 text-sm text-muted-foreground">Revenue exposure by currency</h2>
        <div className="h-60">
          <SimpleBar data={exposure} />
        </div>
      </Card>

      <Card className="p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl">Rate card</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              downloadArrayBuffer(
                workbookToXlsx(wb, { currency: display, rates }),
                `meridian-converted-${display.toLowerCase()}.xlsx`,
              )
            }
          >
            Export converted Excel
          </Button>
        </div>
        <table className="mt-4 w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-2 font-medium">Currency</th>
              <th className="text-right font-medium">USD per unit</th>
              <th className="text-right font-medium">1 unit in {display}</th>
            </tr>
          </thead>
          <tbody>
            {table.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="py-2">{r.currency}</td>
                <td className="text-right tabular">{r.rateToUsd.toPrecision(4)}</td>
                <td className="text-right tabular">{r.oneDisplay.toPrecision(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
