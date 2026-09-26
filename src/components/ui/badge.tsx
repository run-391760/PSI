import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type Tone = "neutral" | "brand" | "info" | "good" | "warning" | "serious" | "critical";

const tones: Record<Tone, string> = {
  neutral: "bg-surface-3 text-text-2",
  brand: "bg-brand-soft text-brand-ink",
  info: "bg-info-soft text-link",
  good: "bg-good-soft text-good-ink",
  warning: "bg-warning-soft text-warning-ink",
  serious: "bg-serious-soft text-serious-ink",
  critical: "bg-critical-soft text-critical-ink",
};

export function Badge({ tone = "neutral", children, className, title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex h-5 items-center gap-1 rounded px-1.5 text-[11.5px] font-medium whitespace-nowrap", tones[tone], className)}>
      {children}
    </span>
  );
}

const dots: Record<Tone, string> = {
  neutral: "bg-text-3",
  brand: "bg-brand",
  info: "bg-link",
  good: "bg-good",
  warning: "bg-warning",
  serious: "bg-serious",
  critical: "bg-critical",
};
export function Dot({ tone = "neutral", className }: { tone?: Tone; className?: string }) {
  return <span className={cn("inline-block h-2 w-2 shrink-0 rounded-full", dots[tone], className)} aria-hidden />;
}

/** Colored swatch that carries series identity next to text (text itself stays in ink tokens). */
export function Swatch({ color, className, shape = "square" }: { color: string; className?: string; shape?: "square" | "line" | "dot" }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block shrink-0", shape === "line" ? "h-0.5 w-3 rounded" : shape === "dot" ? "h-2.5 w-2.5 rounded-full" : "h-2.5 w-2.5 rounded-sm", className)}
      style={{ background: color }}
    />
  );
}
