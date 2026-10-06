import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { DASHBOARDS, DASHBOARD_COUNT } from "@/lib/catalog";
import { DEPARTMENTS, INDUSTRIES } from "@/lib/domain";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";

export const Route = createFileRoute("/catalog")({ component: CatalogPage });

function CatalogPage() {
  const [q, setQ] = useState("");
  const [industry, setIndustry] = useState<string>("all");
  const [dept, setDept] = useState<string>("all");

  const list = useMemo(() => {
    return DASHBOARDS.filter((d) => {
      if (industry !== "all" && d.industry !== industry && d.industry !== "all") return false;
      if (dept !== "all" && d.department !== dept && d.department !== "group") return false;
      if (!q.trim()) return true;
      const s = q.toLowerCase();
      return `${d.title} ${d.eyebrow} ${d.description}`.toLowerCase().includes(s);
    });
  }, [q, industry, dept]);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <header>
        <p className="text-xs tracking-[0.16em] text-silver uppercase">Catalog</p>
        <h1 className="mt-1 font-display text-3xl lg:text-4xl">{DASHBOARD_COUNT} department boards</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Twelve industries times twelve departments, plus group command views. Same Excel contract, different slice.
        </p>
      </header>

      <div className="flex flex-col gap-3 lg:flex-row">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter boards"
          className="lg:max-w-sm"
        />
        <div className="flex flex-1 flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setIndustry("all")}
            className={cn(
              "rounded-full px-3 py-1.5 text-xs",
              industry === "all" ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground",
            )}
          >
            All industries
          </button>
          {INDUSTRIES.map((ind) => (
            <button
              key={ind.id}
              type="button"
              onClick={() => setIndustry(ind.id)}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs",
                industry === ind.id ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground",
              )}
            >
              {ind.short}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setDept("all")}
          className={cn(
            "rounded-full px-3 py-1.5 text-xs",
            dept === "all" ? "bg-silver/20 text-silver" : "bg-secondary text-muted-foreground",
          )}
        >
          All departments
        </button>
        {DEPARTMENTS.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => setDept(d.id)}
            className={cn(
              "rounded-full px-3 py-1.5 text-xs",
              dept === d.id ? "bg-silver/20 text-silver" : "bg-secondary text-muted-foreground",
            )}
          >
            {d.label}
          </button>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">{list.length} boards</p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((d) => (
          <Link key={d.id} to="/board/$id" params={{ id: d.id }} className="group">
            <Card className="h-full p-4 transition-[box-shadow] duration-150 hover:shadow-[var(--shadow-border-hover)]">
              <div className="flex items-center justify-between gap-2">
                <Badge variant="outline">{d.eyebrow}</Badge>
                <span className="text-[11px] text-muted-foreground">{d.widgets.length} widgets</span>
              </div>
              <h2 className="mt-3 font-display text-xl leading-snug group-hover:text-silver">{d.title}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{d.description}</p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
