import { cn } from "@/lib/cn";

export function Sparkline({
  points,
  className,
  tone = "neutral",
}: {
  points: number[];
  className?: string;
  tone?: "up" | "down" | "neutral";
}) {
  if (points.length < 2) return <div className={cn("h-7 w-20", className)} />;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const w = 88;
  const h = 28;
  const p = 2;
  const d = points
    .map((v, i) => {
      const x = p + (i / (points.length - 1)) * (w - p * 2);
      const y = h - p - ((v - min) / span) * (h - p * 2);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className={cn(
        "overflow-visible",
        tone === "up" && "text-up",
        tone === "down" && "text-down",
        tone === "neutral" && "text-silver",
        className,
      )}
      aria-hidden="true"
    >
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}
