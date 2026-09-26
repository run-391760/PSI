import { cn } from "@/lib/utils";

/** Thin horizontal bar (0..100). Color is a CSS color/var; defaults to series-1. */
export function Bar({ value, color = "var(--series-1)", className, track = true, max = 100 }: { value: number; color?: string; className?: string; track?: boolean; max?: number }) {
  const w = Math.max(0, Math.min(100, (value / (max || 1)) * 100));
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full", track && "bg-surface-3", className)} role="meter" aria-valuenow={Math.round(w)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full" style={{ width: `${w}%`, background: color }} />
    </div>
  );
}

/** Score ring (e.g. Site Health, Authority Score). Server-safe SVG. */
export function ScoreRing({
  value,
  size = 96,
  stroke = 9,
  color,
  label,
  sub,
}: {
  value: number;
  size?: number;
  stroke?: number;
  color?: string;
  label?: string;
  sub?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value));
  const auto = v >= 80 ? "var(--good)" : v >= 60 ? "var(--warning)" : v >= 40 ? "var(--serious)" : "var(--critical)";
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color ?? auto} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${(v / 100) * c} ${c}`} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-semibold text-text" style={{ fontSize: size * 0.26 }}>
          {label ?? `${Math.round(v)}%`}
        </span>
        {sub && <span className="text-[11px] text-text-3">{sub}</span>}
      </div>
    </div>
  );
}

/** Semicircle gauge 0..100 (Keyword Difficulty, volatility). */
export function Gauge({ value, color, size = 140, label, sub }: { value: number; color: string; size?: number; label?: string; sub?: string }) {
  const stroke = size * 0.1;
  const r = (size - stroke) / 2;
  const half = Math.PI * r;
  const v = Math.max(0, Math.min(100, value));
  const h = size / 2 + stroke / 2;
  return (
    <div className="relative inline-flex flex-col items-center" style={{ width: size }}>
      <svg width={size} height={h} viewBox={`0 0 ${size} ${h}`}>
        <path d={`M ${stroke / 2} ${size / 2} A ${r} ${r} 0 0 1 ${size - stroke / 2} ${size / 2}`} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} strokeLinecap="round" />
        <path d={`M ${stroke / 2} ${size / 2} A ${r} ${r} 0 0 1 ${size - stroke / 2} ${size / 2}`} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${(v / 100) * half} ${half}`} />
      </svg>
      <div className="absolute bottom-0 flex flex-col items-center">
        <span className="leading-none font-semibold text-text" style={{ fontSize: size * 0.2 }}>
          {label ?? Math.round(v)}
        </span>
        {sub && <span className="mt-0.5 text-[11.5px] text-text-3">{sub}</span>}
      </div>
    </div>
  );
}

/** 100% horizontal stacked bar with legend (follow/nofollow, intent mix, etc.). */
export function DistributionBar({
  segments,
  className,
  showLegend = true,
  format = (v: number, share: number) => `${share.toFixed(1)}%`,
}: {
  segments: { label: string; value: number; color: string }[];
  className?: string;
  showLegend?: boolean;
  format?: (value: number, share: number) => string;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  return (
    <div className={className}>
      <div className="flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full">
        {segments
          .filter((s) => s.value > 0)
          .map((s) => (
            <div key={s.label} title={`${s.label}: ${format(s.value, (s.value / total) * 100)}`} style={{ width: `${(s.value / total) * 100}%`, background: s.color }} className="h-full first:rounded-l-full last:rounded-r-full" />
          ))}
      </div>
      {showLegend && (
        <ul className="mt-2.5 grid gap-1.5 text-[12.5px]">
          {segments.map((s) => (
            <li key={s.label} className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: s.color }} aria-hidden />
              <span className="flex-1 truncate text-text-2">{s.label}</span>
              <span className="tabular font-medium text-text">{format(s.value, (s.value / total) * 100)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
