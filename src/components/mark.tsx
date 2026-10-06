import { cn } from "@/lib/cn";

export function MeridianMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-6 text-foreground", className)} aria-hidden="true">
      <rect width="24" height="24" rx="6" fill="currentColor" />
      <circle cx="12" cy="12" r="6.2" fill="none" className="stroke-background" strokeWidth="1.4" />
      <path d="M12 5.6 L13.15 12 L12 18.4 L10.85 12 Z" className="fill-background" />
    </svg>
  );
}
