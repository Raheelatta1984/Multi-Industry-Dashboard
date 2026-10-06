import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { DASHBOARDS } from "@/lib/catalog";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "./ui/command";

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="p-0">
        <DialogTitle className="sr-only">Jump to a board</DialogTitle>
        <Command>
          <CommandInput placeholder="Search 150+ boards, data, FX…" />
          <CommandList>
            <CommandEmpty>No board matches.</CommandEmpty>
            <CommandGroup heading="Places">
              <CommandItem
                onSelect={() => {
                  setOpen(false);
                  void navigate({ to: "/" });
                }}
              >
                Command center
              </CommandItem>
              <CommandItem
                onSelect={() => {
                  setOpen(false);
                  void navigate({ to: "/catalog" });
                }}
              >
                All boards
              </CommandItem>
              <CommandItem
                onSelect={() => {
                  setOpen(false);
                  void navigate({ to: "/ingest" });
                }}
              >
                AI Ingest Studio
              </CommandItem>
              <CommandItem
                onSelect={() => {
                  setOpen(false);
                  void navigate({ to: "/warehouse" });
                }}
              >
                Warehouse & semantic layer
              </CommandItem>
              <CommandItem
                onSelect={() => {
                  setOpen(false);
                  void navigate({ to: "/data" });
                }}
              >
                Excel data studio (template)
              </CommandItem>
              <CommandItem
                onSelect={() => {
                  setOpen(false);
                  void navigate({ to: "/fx" });
                }}
              >
                Currency conversion
              </CommandItem>
            </CommandGroup>
            <CommandGroup heading="Boards">
              {DASHBOARDS.map((d) => (
                <CommandItem
                  key={d.id}
                  value={`${d.title} ${d.eyebrow} ${d.industry} ${d.department}`}
                  onSelect={() => {
                    setOpen(false);
                    void navigate({ to: "/board/$id", params: { id: d.id } });
                  }}
                >
                  <span className="text-foreground">{d.title}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{d.eyebrow}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

export function openCommandPalette() {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
}
