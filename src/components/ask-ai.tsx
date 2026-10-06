/**
 * Ask Meridian — natural-language Q&A over the warehouse.
 *
 * The demo engine is a deterministic intent matcher over the same selectors
 * the boards use (so every answer is a real number from the live workbook).
 * In production this front-end ships unchanged; the matcher is swapped for
 * an LLM + semantic-layer tool call — the trust boundary stays the same:
 * the model can only answer from governed data.
 */
import { useState } from "react";
import { Sparkles } from "lucide-react";
import { INDUSTRIES, type IndustryId } from "@/lib/domain";
import { fxMap } from "@/lib/currency";
import { kpisFor, vendorBars, regionBars } from "@/lib/selectors";
import { useAppStore } from "@/lib/store";
import type { Slice } from "@/lib/types";
import { formatMoney, formatPct } from "@/lib/format";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";
import { cn } from "@/lib/cn";

type Answer = {
  title: string;
  lines: Array<{ label: string; value: string; sub?: string }>;
  note: string;
};

const SUGGESTED = [
  "What is group revenue YTD?",
  "How is retail doing?",
  "Which entity has the best margin?",
  "Top vendors by spend",
  "Revenue by region",
  "What is our license spend?",
];

function detectIndustry(q: string): IndustryId | "all" {
  const lower = q.toLowerCase();
  for (const ind of INDUSTRIES) {
    if (lower.includes(ind.label.toLowerCase()) || lower.includes(ind.division.toLowerCase())) return ind.id;
  }
  for (const ind of INDUSTRIES) {
    if (lower.includes(ind.short.toLowerCase()) && ind.short.length > 4) return ind.id;
  }
  return "all";
}

function answer(q: string): Answer | null {
  const wb = useAppStore.getState().workbook;
  const ccy = useAppStore.getState().displayCurrency;
  const rates = fxMap(wb.fx);
  const lower = q.toLowerCase().trim();
  const industry = detectIndustry(lower);
  const slice: Slice = { industry, department: "group" };
  const scope = industry === "all" ? "the group" : INDUSTRIES.find((i) => i.id === industry)!.label;
  const kpis = kpisFor(wb, slice, ccy, rates);

  if (/margin|profit/.test(lower)) {
    if (/best|highest|top|strongest|which/.test(lower) && industry === "all") {
      const ranked = INDUSTRIES.map((i) => ({
        ind: i,
        margin: kpisFor(wb, { industry: i.id, department: "group" }, ccy, rates).margin?.value ?? 0,
      })).sort((a, b) => b.margin - a.margin);
      return {
        title: "Entities ranked by contribution margin (YTD)",
        lines: ranked.slice(0, 5).map((r, i) => ({
          label: `${i + 1}. ${r.ind.label}`,
          value: formatPct(r.margin),
          sub: r.ind.division,
        })),
        note: "Margin = (revenue − opex) ÷ revenue, converted to your display currency.",
      };
    }
    return {
      title: `Margin for ${scope} (YTD)`,
      lines: [
        { label: "Contribution margin", value: formatPct(kpis.margin!.value), sub: `${kpis.margin!.delta >= 0 ? "+" : ""}${formatPct(kpis.margin!.delta)} vs last year` },
        { label: "Revenue", value: formatMoney(kpis.revenue!.value, ccy, { compact: true }) },
        { label: "Opex", value: formatMoney(kpis.opex!.value, ccy, { compact: true }) },
      ],
      note: "Computed from the revenue and expenses tables in the warehouse.",
    };
  }

  if (/vendor|supplier/.test(lower)) {
    const vendors = vendorBars(wb, slice, ccy, rates).slice(0, 5);
    return {
      title: `Top vendors by spend — ${scope}`,
      lines: vendors.map((v) => ({ label: v.name, value: formatMoney(v.value, ccy, { compact: true }) })),
      note: "From the expenses table, year to date.",
    };
  }

  if (/region|country|geography|market/.test(lower)) {
    const regions = regionBars(wb, slice, ccy, rates);
    return {
      title: `Revenue by region — ${scope}`,
      lines: regions.map((r) => ({ label: r.name, value: formatMoney(r.value, ccy, { compact: true }) })),
      note: "From the revenue table, year to date.",
    };
  }

  if (/license|seat|subscription|saas|it cost/.test(lower)) {
    return {
      title: `License spend — ${scope}`,
      lines: [
        { label: "Annualized license cost", value: formatMoney(kpis.licenses!.value, ccy, { compact: true }) },
        { label: "Expiring within 90 days", value: String(kpis.expiring?.value ?? 0) },
      ],
      note: "From the licenses table; monthly cycles annualized ×12.",
    };
  }

  if (/opex|spend|cost|expense/.test(lower)) {
    return {
      title: `Opex — ${scope} (YTD)`,
      lines: [
        { label: "Opex YTD", value: formatMoney(kpis.opex!.value, ccy, { compact: true }), sub: `${kpis.opex!.delta >= 0 ? "+" : ""}${formatPct(kpis.opex!.delta)} vs last year` },
        { label: "Committed next 90 days", value: formatMoney(kpis.upcoming!.value, ccy, { compact: true }) },
      ],
      note: "From the expenses and committed-spend tables.",
    };
  }

  if (/revenue|sales|top line|income|doing|performance|how is/.test(lower)) {
    return {
      title: `${industry === "all" ? "Group" : scope} performance (YTD)`,
      lines: [
        { label: "Revenue", value: formatMoney(kpis.revenue!.value, ccy, { compact: true }), sub: `${kpis.revenue!.delta >= 0 ? "+" : ""}${formatPct(kpis.revenue!.delta)} vs last year` },
        { label: "Opex", value: formatMoney(kpis.opex!.value, ccy, { compact: true }), sub: `${kpis.opex!.delta >= 0 ? "+" : ""}${formatPct(kpis.opex!.delta)} vs last year` },
        { label: "Contribution", value: formatMoney(kpis.contribution!.value, ccy, { compact: true }) },
        { label: "Margin", value: formatPct(kpis.margin!.value) },
      ],
      note: "Every figure is computed live from warehouse rows — not cached, not guessed.",
    };
  }

  return null;
}

export function AskAiButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [a, setA] = useState<Answer | null>(null);
  const [missed, setMissed] = useState(false);

  function ask(question: string) {
    setQ(question);
    const result = answer(question);
    setA(result);
    setMissed(!result);
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className={cn("gap-2", className)}
        onClick={() => setOpen(true)}
      >
        <Sparkles className="size-3.5 text-silver" />
        Ask AI
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg gap-0 p-0">
          <DialogTitle className="flex items-center gap-2 border-b border-border px-4 py-3 font-display text-lg">
            <Sparkles className="size-4 text-silver" /> Ask Meridian
          </DialogTitle>
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") ask(q);
              }}
              placeholder="Ask anything about the group's numbers…"
              className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            <Button size="sm" onClick={() => ask(q)}>
              Ask
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5 border-b border-border px-4 py-3">
            {SUGGESTED.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => ask(s)}
                className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-silver hover:text-foreground"
              >
                {s}
              </button>
            ))}
          </div>
          <div className="max-h-80 overflow-y-auto px-4 py-4">
            {a && (
              <div className="flex flex-col gap-3">
                <div className="text-sm font-medium">{a.title}</div>
                <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
                  {a.lines.map((l, i) => (
                    <li key={i} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <span className="min-w-0 truncate text-muted-foreground">
                        {l.label}
                        {l.sub && <span className="ml-2 text-xs text-silver">{l.sub}</span>}
                      </span>
                      <span className="shrink-0 font-medium tabular">{l.value}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">{a.note}</p>
              </div>
            )}
            {missed && !a && (
              <p className="text-sm text-muted-foreground">
                I couldn't map that to the warehouse yet. Try asking about revenue, margin, opex, vendors, regions or
                licenses — per entity or for the whole group.
              </p>
            )}
            {!a && !missed && (
              <p className="text-sm text-muted-foreground">
                Answers are computed live from the warehouse the boards read. In production this box is backed by an
                LLM over the same governed semantic layer — same data, same trust boundary.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
