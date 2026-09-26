import Link from "next/link";
import type { ReactNode } from "react";
import { DomainAvatar } from "@/components/seo/badges";
import { Swatch } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * 100% stacked horizontal bars, one row per entity (channel mix per domain, device split…).
 * Server-safe; segments carry a native tooltip with the exact share, and a shared legend below.
 */
export function StackedShareBars({
  rows,
  legend,
  className,
  labelWidth = "minmax(96px,160px)",
}: {
  rows: { label: string; href?: string; marker?: ReactNode; highlight?: boolean; segments: { key: string; value: number }[] }[];
  legend: { key: string; label: string; color: string }[];
  className?: string;
  labelWidth?: string;
}) {
  const colors = Object.fromEntries(legend.map((l) => [l.key, l.color]));
  const labels = Object.fromEntries(legend.map((l) => [l.key, l.label]));
  return (
    <div className={className}>
      <ul className="space-y-2.5">
        {rows.map((r) => {
          const total = r.segments.reduce((s, x) => s + x.value, 0) || 1;
          return (
            <li key={r.label} className="grid items-center gap-3 text-[12.5px]" style={{ gridTemplateColumns: `${labelWidth} 1fr` }}>
              <span className={cn("inline-flex min-w-0 items-center gap-1.5", r.highlight ? "font-semibold text-text" : "text-text-2")}>
                {r.marker ?? <DomainAvatar domain={r.label} size={16} />}
                {r.href ? (
                  <Link href={r.href} className="truncate text-link hover:underline">
                    {r.label}
                  </Link>
                ) : (
                  <span className="truncate">{r.label}</span>
                )}
              </span>
              <div className="flex h-4 w-full gap-[2px] overflow-hidden rounded">
                {r.segments
                  .filter((s) => s.value > 0)
                  .map((s) => {
                    const share = (s.value / total) * 100;
                    return <div key={s.key} title={`${r.label} · ${labels[s.key] ?? s.key}: ${share.toFixed(1)}%`} style={{ width: `${share}%`, background: colors[s.key] }} className="h-full first:rounded-l last:rounded-r" />;
                  })}
              </div>
            </li>
          );
        })}
      </ul>
      <ul className="mt-3.5 flex flex-wrap gap-x-4 gap-y-1.5 text-[12px] text-text-2">
        {legend.map((l) => (
          <li key={l.key} className="inline-flex items-center gap-1.5">
            <Swatch color={l.color} />
            {l.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
