import { Link, useRouterState } from "@tanstack/react-router";
import { Database, LayoutGrid, Menu, RefreshCw, Search, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { DASHBOARD_COUNT, DASHBOARDS } from "@/lib/catalog";
import { CURRENCIES, INDUSTRIES } from "@/lib/domain";
import { hydrateCurrency, useAppStore } from "@/lib/store";
import { AskAiButton } from "./ask-ai";
import { CommandPalette } from "./command-palette";
import { LiveEngine, useCountdown } from "./live-engine";
import { MeridianMark } from "./mark";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { ScrollArea } from "./ui/scroll-area";
import { Sheet, SheetContent } from "./ui/sheet";
import { Switch } from "./ui/switch";
import { cn } from "@/lib/cn";

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const industry = useAppStore((s) => s.industryFilter);
  const setIndustry = useAppStore((s) => s.setIndustry);
  const items = [
    { to: "/", label: "Command" },
    { to: "/ingest", label: "AI Onboarding Studio" },
    { to: "/warehouse", label: "Warehouse" },
    { to: "/catalog", label: "Boards" },
    { to: "/data", label: "Excel (template)" },
    { to: "/fx", label: "FX" },
  ] as const;

  const boards = DASHBOARDS.filter((d) => d.industry === industry).slice(0, 12);

  return (
    <div className="flex flex-col gap-6 px-3 py-4">
      <nav className="flex flex-col gap-1">
        {items.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            className={cn(
              "rounded-lg px-3 py-2 text-sm transition-colors duration-150",
              path === item.to ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <div>
        <div className="px-3 pb-2 text-[11px] tracking-wide text-muted-foreground uppercase">Industry</div>
        <div className="flex flex-col">
          <button
            type="button"
            onClick={() => setIndustry("all")}
            className={cn(
              "rounded-lg px-3 py-2 text-left text-sm",
              industry === "all" ? "bg-secondary" : "text-muted-foreground hover:bg-secondary/60",
            )}
          >
            All divisions
          </button>
          {INDUSTRIES.map((ind) => (
            <button
              key={ind.id}
              type="button"
              onClick={() => setIndustry(ind.id)}
              className={cn(
                "rounded-lg px-3 py-2 text-left text-sm",
                industry === ind.id ? "bg-secondary" : "text-muted-foreground hover:bg-secondary/60",
              )}
            >
              {ind.label}
            </button>
          ))}
        </div>
      </div>
      {industry !== "all" && (
        <div>
          <div className="px-3 pb-2 text-[11px] tracking-wide text-muted-foreground uppercase">Department boards</div>
          <div className="flex flex-col">
            {boards.map((b) => (
              <Link
                key={b.id}
                to="/board/$id"
                params={{ id: b.id }}
                onClick={onNavigate}
                className={cn(
                  "rounded-lg px-3 py-2 text-sm",
                  path === `/board/${b.id}` ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary/60",
                )}
              >
                {b.title.replace(/^[^\s]+ /, "")}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Sidebar() {
  return (
    <aside className="hidden h-dvh w-64 shrink-0 flex-col border-r border-border bg-card lg:flex">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <MeridianMark />
        <div>
          <div className="font-display text-lg leading-none">Meridian</div>
          <div className="mt-1 text-[11px] text-muted-foreground">{DASHBOARD_COUNT} live boards</div>
        </div>
      </div>
      <ScrollArea className="flex-1">
        <NavLinks />
      </ScrollArea>
    </aside>
  );
}

function Topbar() {
  const company = useAppStore((s) => s.company);
  const source = useAppStore((s) => s.source);
  const live = useAppStore((s) => s.liveEnabled);
  const setLive = useAppStore((s) => s.setLive);
  const ccy = useAppStore((s) => s.displayCurrency);
  const setCurrency = useAppStore((s) => s.setCurrency);
  const tick = useAppStore((s) => s.tick);
  const last = useAppStore((s) => s.lastReport);
  const countdown = useCountdown();
  const [menu, setMenu] = useState(false);

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background/90 px-3 backdrop-blur-sm lg:px-6">
      <Sheet open={menu} onOpenChange={setMenu}>
        <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMenu(true)} aria-label="Open menu">
          <Menu className="size-5" />
        </Button>
        <SheetContent>
          <div className="flex items-center gap-2 px-5 py-5">
            <MeridianMark />
            <span className="font-display text-lg">Meridian</span>
          </div>
          <ScrollArea className="flex-1">
            <NavLinks onNavigate={() => setMenu(false)} />
          </ScrollArea>
        </SheetContent>
      </Sheet>

      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{company}</div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className={cn("size-1.5 rounded-full bg-up", live && "live-dot")} />
          {source === "sample" ? "Sample workbook" : "Uploaded workbook"}
          {last ? ` · +${last.added}/~${last.updated} last patch` : null}
        </div>
      </div>

      <Button
        variant="outline"
        size="sm"
        className="hidden gap-2 md:inline-flex"
        onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))}
      >
        <Search className="size-3.5" />
        Jump
        <kbd className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">⌘K</kbd>
      </Button>

      <AskAiButton className="hidden sm:inline-flex" />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="tabular">
            {ccy}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
          {CURRENCIES.map((c) => (
            <DropdownMenuItem key={c.code} onSelect={() => setCurrency(c.code)}>
              <span className="w-10 tabular">{c.code}</span>
              <span className="text-muted-foreground">{c.name}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="hidden items-center gap-2 sm:flex">
        <span className="text-[11px] text-muted-foreground tabular">{countdown}</span>
        <Switch checked={live} onCheckedChange={setLive} aria-label="Live feed" />
      </div>

      <Button variant="ghost" size="icon" onClick={() => tick()} aria-label="Refresh now">
        <RefreshCw className="size-4" />
      </Button>

      <Button variant="ghost" size="icon" asChild className="lg:hidden">
        <Link to="/data" aria-label="Excel data">
          <Upload className="size-4" />
        </Link>
      </Button>
      <Button variant="ghost" size="icon" asChild className="hidden lg:inline-flex">
        <Link to="/catalog" aria-label="Board catalog">
          <LayoutGrid className="size-4" />
        </Link>
      </Button>
      <Button variant="ghost" size="icon" asChild className="hidden lg:inline-flex">
        <Link to="/data" aria-label="Data studio">
          <Database className="size-4" />
        </Link>
      </Button>
    </header>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    hydrateCurrency();
  }, []);

  return (
    <div className="flex min-h-dvh">
      <LiveEngine />
      <CommandPalette />
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="flex-1 px-3 py-5 lg:px-6 lg:py-6">{children}</main>
      </div>
    </div>
  );
}
