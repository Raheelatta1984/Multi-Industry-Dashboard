import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { blankTemplateWorkbook, downloadArrayBuffer, parseWorkbook, workbookToXlsx } from "@/lib/excel";
import { generateSampleWorkbook } from "@/lib/sample-data";
import { workbookStats } from "@/lib/selectors";
import { fxMap } from "@/lib/currency";
import { useAppStore } from "@/lib/store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { formatMoney, relativeTime } from "@/lib/format";

export const Route = createFileRoute("/data")({ component: DataPage });

function DataPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const loadWorkbook = useAppStore((s) => s.loadWorkbook);
  const resetSample = useAppStore((s) => s.resetSample);
  const mergeUploads = useAppStore((s) => s.mergeUploads);
  const setMergeUploads = useAppStore((s) => s.setMergeUploads);
  const wb = useAppStore((s) => s.workbook);
  const fileName = useAppStore((s) => s.fileName);
  const source = useAppStore((s) => s.source);
  const issues = useAppStore((s) => s.issues);
  const reports = useAppStore((s) => s.reports);
  const last = useAppStore((s) => s.lastReport);
  const ccy = useAppStore((s) => s.displayCurrency);
  const stats = workbookStats(wb);

  async function onFile(file: File) {
    setBusy(true);
    setMessage(null);
    try {
      const buf = await file.arrayBuffer();
      const parsed = parseWorkbook(buf);
      const report = loadWorkbook(parsed.workbook, file.name, parsed.issues);
      setMessage(
        `Patched ${file.name}: +${report.added} new, ~${report.updated} updated, ${report.skipped} unchanged.`,
      );
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not read that workbook.");
    } finally {
      setBusy(false);
    }
  }

  function downloadSample() {
    const buf = workbookToXlsx(generateSampleWorkbook());
    downloadArrayBuffer(buf, "meridian-sample.xlsx");
  }

  function downloadTemplate() {
    const buf = workbookToXlsx(blankTemplateWorkbook());
    downloadArrayBuffer(buf, "meridian-template.xlsx");
  }

  function downloadConverted() {
    const buf = workbookToXlsx(wb, { currency: ccy, rates: fxMap(wb.fx) });
    downloadArrayBuffer(buf, `meridian-${ccy.toLowerCase()}.xlsx`);
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <header>
        <p className="text-xs tracking-[0.16em] text-silver uppercase">Data studio</p>
        <h1 className="mt-1 font-display text-3xl lg:text-4xl">Inject Excel. Patch only what changed.</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Download the filled sample or a short template, edit amounts in Excel, then drop the file here. Matching ids
          update in place. New ids append. Unchanged history is not rewritten.
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
        <div className="font-display text-2xl">Drop .xlsx here</div>
        <p className="max-w-md text-sm text-muted-foreground">
          Sheets: Meta, FX, Departments, Revenue, Expenses, Assets, Licenses, Upcoming, Sales, Forecast, Demand,
          Turnover.
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

      {message && <p className="text-sm text-silver">{message}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={downloadSample}>
          Download sample
        </Button>
        <Button variant="outline" onClick={downloadTemplate}>
          Download template
        </Button>
        <Button variant="outline" onClick={downloadConverted}>
          Export in {ccy}
        </Button>
        <Button variant="ghost" onClick={() => resetSample()}>
          Reset sample
        </Button>
        <label className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
          Merge on upload
          <Switch checked={mergeUploads} onCheckedChange={setMergeUploads} />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Object.entries(stats).map(([k, v]) => (
          <Card key={k} className="p-4">
            <div className="text-xs text-muted-foreground uppercase">{k}</div>
            <div className="mt-1 font-display text-2xl tabular">{v}</div>
          </Card>
        ))}
      </div>

      <Card className="p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl">Active workbook</h2>
          <Badge variant={source === "sample" ? "silver" : "up"}>{source}</Badge>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {fileName}
          {last ? ` · last patch ${relativeTime(last.at)} · ${last.latencyMs}ms` : null}
        </p>
        {issues.length > 0 && (
          <ul className="mt-3 space-y-1 text-sm text-warn">
            {issues.map((i, idx) => (
              <li key={idx}>
                {i.sheet}: {i.message}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="font-display text-xl">Incremental log</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Each minute the live feed mutates a thin slice of recent rows. Older months are skipped on purpose.
        </p>
        <ul className="mt-4 divide-y divide-border">
          {reports.length === 0 && <li className="py-3 text-sm text-muted-foreground">No patches yet.</li>}
          {reports.map((r) => (
            <li key={r.at} className="flex items-center justify-between py-3 text-sm">
              <span>
                +{r.added} added · ~{r.updated} updated · -{r.removed} removed · {r.skipped} unchanged
              </span>
              <span className="tabular text-muted-foreground">
                {r.latencyMs}ms · {relativeTime(r.at)}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="p-5">
        <h2 className="font-display text-xl">Column contract</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Keep a unique <span className="text-foreground">id</span> per row. Amounts stay in source currency; conversion
          happens on the board and in the {ccy} export. Forecast method may be{" "}
          <span className="text-foreground">norm</span>, <span className="text-foreground">average</span>, or{" "}
          <span className="text-foreground">blend</span> (0.55 trailing average + 0.45 seasonal norm).
        </p>
        <p className="mt-3 text-sm text-muted-foreground">
          Current display total revenue YTD is a converted figure — change currency in the header to reprice every
          widget without touching history.
        </p>
        <p className="mt-3 tabular text-sm">
          Sample converted snapshot: {formatMoney(wb.revenue.slice(0, 1)[0]?.amount ?? 0, ccy, { compact: true })} on
          first revenue row.
        </p>
      </Card>
    </div>
  );
}
