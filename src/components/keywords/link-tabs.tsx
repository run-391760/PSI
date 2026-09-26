import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/tooltip";

/** Server-safe segmented control made of links (URL state such as match type or view). */
export function LinkSegmented({ items, className }: { items: { href: string; label: ReactNode; active: boolean; count?: ReactNode; title?: string }[]; className?: string }) {
  return (
    <div className={cn("scroll-thin inline-flex max-w-full overflow-x-auto rounded-md border border-border-strong bg-surface p-0.5", className)} role="tablist">
      {items.map((it, i) => {
        const link = (
          <Link
            key={i}
            href={it.href}
            role="tab"
            aria-selected={it.active}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-[12.5px] font-medium whitespace-nowrap transition-colors",
              it.active ? "bg-brand-soft text-brand-ink" : "text-text-2 hover:bg-surface-3 hover:text-text",
            )}
          >
            {it.label}
            {it.count != null && <span className={cn("tabular text-[11.5px]", it.active ? "text-brand-ink/80" : "text-text-3")}>{it.count}</span>}
          </Link>
        );
        return it.title ? (
          <Tooltip key={i} content={it.title} side="bottom">
            {link}
          </Tooltip>
        ) : (
          link
        );
      })}
    </div>
  );
}
