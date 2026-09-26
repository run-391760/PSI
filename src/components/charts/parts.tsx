"use client";

import { cn } from "@/lib/utils";
import { type AxisFormat, type ValueFormat, formatAxis, formatValue } from "./format";

type TooltipRow = { dataKey?: string | number; name?: string | number; value?: unknown; color?: string; payload?: Record<string, unknown> };

/** Tooltip card shared by all cartesian charts. */
export function ChartTooltip({
  active,
  payload,
  label,
  xFormat = "raw",
  yFormat = "compact",
  labels,
  colors,
}: {
  active?: boolean;
  payload?: TooltipRow[];
  label?: unknown;
  xFormat?: AxisFormat;
  yFormat?: ValueFormat;
  labels?: Record<string, string>;
  colors?: Record<string, string>;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-40 rounded-lg border border-border bg-surface px-3 py-2 text-[12px] shadow-pop">
      {label != null && label !== "" && <div className="mb-1.5 font-medium text-text">{formatAxis(label, xFormat)}</div>}
      <ul className="space-y-1">
        {payload.map((p) => {
          const key = String(p.dataKey ?? p.name);
          return (
            <li key={key} className="flex items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: colors?.[key] ?? p.color }} aria-hidden />
              <span className="flex-1 text-text-2">{labels?.[key] ?? p.name}</span>
              <span className="tabular font-medium text-text">{formatValue(p.value, yFormat)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** HTML legend; clicking an item toggles its series. */
export function ChartLegend({
  items,
  hidden,
  onToggle,
  className,
}: {
  items: { key: string; label: string; color: string; dashed?: boolean }[];
  hidden?: Set<string>;
  onToggle?: (key: string) => void;
  className?: string;
}) {
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px]", className)}>
      {items.map((it) => {
        const off = hidden?.has(it.key);
        return (
          <li key={it.key}>
            <button
              type="button"
              onClick={() => onToggle?.(it.key)}
              disabled={!onToggle}
              className={cn("inline-flex items-center gap-1.5 text-text-2 transition-opacity", onToggle && "hover:text-text", off && "opacity-40")}
              aria-pressed={!off}
            >
              {it.dashed ? (
                <span className="h-0 w-3.5 border-t-2 border-dashed" style={{ borderColor: it.color }} aria-hidden />
              ) : (
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: it.color }} aria-hidden />
              )}
              {it.label}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
