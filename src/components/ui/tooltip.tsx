import { Info } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** CSS-only hover/focus tooltip. Works in server components. */
export function Tooltip({ content, children, className, side = "top" }: { content: ReactNode; children: ReactNode; className?: string; side?: "top" | "bottom" }) {
  return (
    <span className={cn("group/tip relative inline-flex", className)} tabIndex={0}>
      {children}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute left-1/2 z-50 hidden w-max max-w-[min(18rem,calc(100vw-2rem))] -translate-x-1/2 rounded-md bg-[#1d2233] px-2.5 py-1.5 text-[12px] leading-snug font-normal whitespace-normal text-white shadow-pop group-hover/tip:block group-focus/tip:block",
          side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5",
        )}
      >
        {content}
      </span>
    </span>
  );
}

export function InfoTip({ text, className }: { text: string; className?: string }) {
  return (
    <Tooltip content={text} className={className}>
      <Info className="h-3.5 w-3.5 cursor-help text-text-3" aria-label={text} />
    </Tooltip>
  );
}
