import { useEffect, useState } from "react";
import { TICK_INTERVAL_MS, useAppStore } from "@/lib/store";

export function LiveEngine() {
  const live = useAppStore((s) => s.liveEnabled);
  const tick = useAppStore((s) => s.tick);

  useEffect(() => {
    if (!live) return;
    const first = window.setTimeout(() => tick(), 12_000);
    const id = window.setInterval(() => tick(), TICK_INTERVAL_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [live, tick]);

  return null;
}

export function useCountdown() {
  const next = useAppStore((s) => s.nextTickAt);
  const live = useAppStore((s) => s.liveEnabled);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);
  if (!live) return "paused";
  if (now === null) return "1:00";
  const s = Math.max(0, Math.ceil((next - now) / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}
