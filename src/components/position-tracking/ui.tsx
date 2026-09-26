import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Fixed color per tracked domain: index 0 = your domain, then competitors in campaign order. */
export function domainColor(index: number) {
  return `var(--series-${(index % 8) + 1})`;
}
export const domainDashed = (index: number) => index >= 8;

/** Rank position cell: "3" / "–" (not in top 100). */
export function Pos({ value, className, strong }: { value: number | null | undefined; className?: string; strong?: boolean }) {
  if (value == null)
    return (
      <span className={cn("text-text-3", className)} title="Not in the top 100">
        –
      </span>
    );
  return <span className={cn("tabular", strong && "font-semibold text-text", className)}>{value}</span>;
}

/** Signed delta with arrow and meaning color (text stays in ink tokens). */
export function Delta({
  value,
  digits = 1,
  suffix = "",
  upIsGood = true,
  className,
  hideZero,
}: {
  value: number | null | undefined;
  digits?: number;
  suffix?: string;
  upIsGood?: boolean;
  className?: string;
  hideZero?: boolean;
}) {
  if (value == null || Number.isNaN(value)) return <span className={cn("text-text-3", className)}>n/a</span>;
  const rounded = Number(value.toFixed(digits));
  if (rounded === 0) return hideZero ? null : <span className={cn("tabular text-[12px] text-text-3", className)}>0{suffix}</span>;
  const good = rounded > 0 === upIsGood;
  return (
    <span className={cn("tabular inline-flex items-center text-[12px] font-medium", good ? "text-good-ink" : "text-critical-ink", className)}>
      {rounded > 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
      {rounded > 0 ? "+" : "−"}
      {Math.abs(rounded).toFixed(digits)}
      {suffix}
    </span>
  );
}

/** Stat block used in report strips when the delta is not a percentage (positions, counts). */
export function Stat({ label, value, delta, sub, info, className }: { label: ReactNode; value: ReactNode; delta?: ReactNode; sub?: ReactNode; info?: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex items-center gap-1 text-[12.5px] text-text-2">
        <span className="truncate">{label}</span>
        {info}
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-[22px] font-semibold tracking-tight text-text">{value}</span>
        {delta}
      </div>
      {sub && <div className="mt-0.5 text-[12px] text-text-3">{sub}</div>}
    </div>
  );
}

/** Tag chip (neutral; tags have no semantic color). */
export function TagChip({ name, onRemove, className }: { name: string; onRemove?: () => void; className?: string }) {
  return (
    <span className={cn("inline-flex h-5 max-w-40 items-center gap-1 rounded border border-border bg-surface-2 px-1.5 text-[11px] font-medium text-text-2", className)}>
      <span className="truncate">{name}</span>
      {onRemove && (
        <button type="button" onClick={onRemove} className="text-text-3 hover:text-text" aria-label={`Remove tag ${name}`}>
          ×
        </button>
      )}
    </span>
  );
}

/** Position sparkline (reversed: higher on the chart = better rank). Gaps for days outside the top 100. */
export function PositionSpark({ values, width = 84, height = 24, color = "var(--series-1)" }: { values: (number | null)[]; width?: number; height?: number; color?: string }) {
  const known = values.filter((v): v is number => v != null);
  if (values.length < 2 || !known.length) return <span className="text-[11.5px] text-text-3">–</span>;
  const min = Math.min(...known);
  const max = Math.max(...known);
  const span = max - min || 1;
  const x = (i: number) => (i / (values.length - 1)) * (width - 4) + 2;
  const y = (v: number) => 3 + ((v - min) / span) * (height - 6);
  const segs: string[] = [];
  let cur = "";
  values.forEach((v, i) => {
    if (v == null) {
      if (cur) segs.push(cur);
      cur = "";
      return;
    }
    cur += `${cur ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
  });
  if (cur) segs.push(cur);
  const lastIdx = values.map((v, i) => (v == null ? -1 : i)).filter((i) => i >= 0).pop()!;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Position trend: ${values.map((v) => v ?? "–").join(", ")}`}>
      {segs.map((d, i) => (
        <path key={i} d={d} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      ))}
      <circle cx={x(lastIdx)} cy={y(values[lastIdx]!)} r={2.4} fill={color} stroke="var(--surface)" strokeWidth={1.2} />
    </svg>
  );
}
