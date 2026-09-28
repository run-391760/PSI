import { TrendingUp } from "lucide-react";
import Link from "next/link";
import type { GeoNode, TrendingIssue } from "@/lib/cx/listening/insights";
import { WEEKDAYS } from "@/lib/cx/listening/insights";
import { num } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Weekday × hour heatmap (server-safe). Cell shade = share of the busiest cell; value in the tooltip. */
export function Heatmap({ grid, unit = "mentions", tzLabel = "UTC" }: { grid: number[][]; unit?: string; tzLabel?: string }) {
  const max = Math.max(1, ...grid.flat());
  return (
    <div className="scroll-thin overflow-x-auto">
      <div className="grid min-w-[560px] grid-cols-[34px_repeat(24,minmax(0,1fr))] gap-[2px] text-[10.5px] text-text-3">
        <span />
        {Array.from({ length: 24 }, (_, h) => (
          <span key={h} className="text-center tabular-nums">{h % 3 === 0 ? String(h).padStart(2, "0") : ""}</span>
        ))}
        {grid.map((row, d) => (
          <div key={d} className="contents">
            <span className="self-center">{WEEKDAYS[d]}</span>
            {row.map((v, h) => (
              <span
                key={h}
                title={`${WEEKDAYS[d]} ${String(h).padStart(2, "0")}:00–${String((h + 1) % 24).padStart(2, "0")}:00 ${tzLabel}: ${num(v)} ${unit}`}
                className="h-5 rounded-[3px] border border-border/60"
                style={{ background: v ? `color-mix(in srgb, var(--seq-500) ${Math.round(12 + (v / max) * 88)}%, transparent)` : "var(--surface-2)" }}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-end gap-2 text-[11px] text-text-3">
        <span>Fewer</span>
        {[15, 40, 65, 100].map((p) => (
          <span key={p} className="h-3 w-5 rounded-[3px]" style={{ background: `color-mix(in srgb, var(--seq-500) ${p}%, transparent)` }} />
        ))}
        <span>More ({tzLabel})</span>
      </div>
    </div>
  );
}

const arc = (cx: number, cy: number, r0: number, r1: number, a0: number, a1: number) => {
  const p = (r: number, a: number) => `${(cx + r * Math.sin(a)).toFixed(2)} ${(cy - r * Math.cos(a)).toFixed(2)}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  if (a1 - a0 >= Math.PI * 2 - 1e-6) a1 = a0 + Math.PI * 2 - 1e-4;
  return `M ${p(r1, a0)} A ${r1} ${r1} 0 ${large} 1 ${p(r1, a1)} L ${p(r0, a1)} A ${r0} ${r0} 0 ${large} 0 ${p(r0, a0)} Z`;
};

/** Sunburst (country → state → city). Inner ring = countries in series colors; outer rings are lighter shades of the parent. */
export function Sunburst({ root, size = 240 }: { root: GeoNode; size?: number }) {
  const c = size / 2;
  const rings = [
    [c * 0.28, c * 0.58],
    [c * 0.6, c * 0.8],
    [c * 0.82, c * 0.98],
  ];
  const paths: { d: string; fill: string; opacity: number; title: string }[] = [];
  const walk = (nodes: GeoNode[], depth: number, a0: number, span: number, total: number, color: string | null, trail: string[]) => {
    let a = a0;
    nodes.forEach((n, i) => {
      const s = (n.value / total) * span;
      const fill = color ?? `var(--series-${(i % 8) + 1})`;
      paths.push({ d: arc(c, c, rings[depth][0], rings[depth][1], a, a + s), fill, opacity: [1, 0.7, 0.45][depth], title: `${[...trail, n.name].join(" › ")}: ${num(n.value)} mentions` });
      if (depth < 2 && n.children.length) walk(n.children, depth + 1, a, s * (n.children.reduce((x, ch) => x + ch.value, 0) / n.value), n.children.reduce((x, ch) => x + ch.value, 0), fill, [...trail, n.name]);
      a += s;
    });
  };
  if (root.value) walk(root.children, 0, 0, Math.PI * 2, root.value, null, []);
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width="100%" style={{ maxWidth: size }} role="img" aria-label="Mentions by country, state and city">
      {paths.map((p, i) => (
        <path key={i} d={p.d} fill={p.fill} fillOpacity={p.opacity} stroke="var(--surface)" strokeWidth={1.5}>
          <title>{p.title}</title>
        </path>
      ))}
      <text x={c} y={c - 4} textAnchor="middle" className="fill-text text-[18px] font-semibold">{num(root.value)}</text>
      <text x={c} y={c + 14} textAnchor="middle" className="fill-text-3 text-[11px]">located</text>
    </svg>
  );
}

/** Trending issues list ("N mentions of X, k× normal"). */
export function TrendingList({ issues, brandId, empty }: { issues: TrendingIssue[]; brandId: string; empty?: string }) {
  if (!issues.length) return <p className="px-4 py-6 text-center text-[13px] text-text-3">{empty ?? "Nothing is trending above 3× its normal rate."}</p>;
  const max = Math.max(...issues.map((i) => i.count));
  return (
    <ul className="divide-y divide-border">
      {issues.map((t) => (
        <li key={t.term} className="grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-2.5">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[13.5px] font-medium text-text">
              <TrendingUp className="h-3.5 w-3.5 shrink-0 text-serious-ink" aria-hidden />
              <Link href={`/cx/listening?brand=${brandId}&q=${encodeURIComponent(t.term)}`} className="truncate hover:underline">{t.term}</Link>
            </div>
            <div className="mt-1 h-1.5 rounded bg-surface-3">
              <div className="h-1.5 rounded bg-[var(--series-2)]" style={{ width: `${(t.count / max) * 100}%` }} />
            </div>
            <div className="mt-1 text-[12px] text-text-3">
              {num(t.mentions)} mentions{t.tickets ? `, ${num(t.tickets)} tickets` : ""} · baseline {t.baseline.toFixed(1)} per window
            </div>
          </div>
          <span className={cn("rounded px-2 py-0.5 text-[12px] font-semibold tabular-nums", t.isNew ? "bg-brand-soft text-brand-ink" : "bg-serious-soft text-serious-ink")}>{t.isNew ? "New" : `${(t.ratio ?? 0).toFixed(1)}×`}</span>
        </li>
      ))}
    </ul>
  );
}

/** Change badge vs previous period (null → n/a). */
export function Change({ value, upIsGood = true }: { value: number | null; upIsGood?: boolean }) {
  if (value == null || !Number.isFinite(value)) return <span className="text-text-3">n/a</span>;
  const good = value === 0 ? null : value > 0 === upIsGood;
  return <span className={cn("tabular-nums", good == null ? "text-text-2" : good ? "text-good-ink" : "text-critical-ink")}>{value > 0 ? "+" : ""}{Math.round(value)}%</span>;
}
