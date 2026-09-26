"use client";

import { type CSSProperties, useId, useMemo } from "react";
import { rng } from "@/lib/seo/engine/random";
import { cn } from "@/lib/utils";

export type GridPoint = { row: number; col: number; lat: number; lng: number; rank: number | null; pack: string[] };

export const RANK_BANDS = [
  { id: "top3", label: "1–3", note: "Local pack", color: "var(--good)", ink: "#ffffff" },
  { id: "top10", label: "4–10", note: "Page 1 of Maps", color: "var(--warning)", ink: "#2b2100" },
  { id: "top20", label: "11–20", note: "Low visibility", color: "var(--serious)", ink: "#ffffff" },
  { id: "none", label: "20+", note: "Not found", color: "var(--critical)", ink: "#ffffff" },
] as const;
export function bandFor(rank: number | null) {
  if (rank == null) return RANK_BANDS[3];
  if (rank <= 3) return RANK_BANDS[0];
  if (rank <= 10) return RANK_BANDS[1];
  return RANK_BANDS[2];
}

const SIZE = 480;
const PAD = 44;

/** Stylised, deterministic street map (not real geography) drawn behind the grid. */
function MapBackground({ seed }: { seed: string }) {
  const shapes = useMemo(() => {
    const r = rng(`map-bg:${seed}`);
    const blocks: { x: number; y: number; w: number; h: number }[] = [];
    const step = 44;
    for (let x = -10; x < SIZE; x += step)
      for (let y = -10; y < SIZE; y += step) if (r.chance(0.72)) blocks.push({ x: x + r.range(3, 7), y: y + r.range(3, 7), w: step - r.range(9, 16), h: step - r.range(9, 16) });
    const curve = (horizontal: boolean) => {
      const a = r.range(60, SIZE - 60);
      const b = r.range(60, SIZE - 60);
      const c = r.range(40, SIZE - 40);
      return horizontal ? `M -20 ${a} Q ${SIZE / 2} ${c} ${SIZE + 20} ${b}` : `M ${a} -20 Q ${c} ${SIZE / 2} ${b} ${SIZE + 20}`;
    };
    const roads = [curve(true), curve(false), r.chance(0.6) ? curve(true) : curve(false)];
    const riverY = r.range(SIZE * 0.15, SIZE * 0.85);
    const river = r.chance(0.55)
      ? `M -30 ${riverY} C ${SIZE * 0.3} ${riverY + r.range(-90, 90)}, ${SIZE * 0.6} ${riverY + r.range(-90, 90)}, ${SIZE + 30} ${riverY + r.range(-60, 60)}`
      : null;
    const lake = river ? null : { cx: r.range(60, SIZE - 60), cy: r.range(60, SIZE - 60), rx: r.range(28, 60), ry: r.range(20, 42) };
    const parks = Array.from({ length: r.int(2, 3) }, () => ({ x: r.range(10, SIZE - 110), y: r.range(10, SIZE - 110), w: r.range(55, 110), h: r.range(45, 90) }));
    return { blocks, roads, river, lake, parks, rotate: r.range(-14, 14) };
  }, [seed]);
  return (
    <g aria-hidden>
      <rect x={0} y={0} width={SIZE} height={SIZE} style={{ fill: "var(--map-land)" }} />
      <g transform={`rotate(${shapes.rotate} ${SIZE / 2} ${SIZE / 2})`}>
        {shapes.blocks.map((b, i) => (
          <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} rx={3} style={{ fill: "var(--map-block)" }} />
        ))}
      </g>
      {shapes.parks.map((p, i) => (
        <rect key={i} x={p.x} y={p.y} width={p.w} height={p.h} rx={14} style={{ fill: "var(--map-park)" }} />
      ))}
      {shapes.lake && <ellipse cx={shapes.lake.cx} cy={shapes.lake.cy} rx={shapes.lake.rx} ry={shapes.lake.ry} style={{ fill: "var(--map-water)" }} />}
      {shapes.river && <path d={shapes.river} fill="none" strokeWidth={16} strokeLinecap="round" style={{ stroke: "var(--map-water)" }} />}
      {shapes.roads.map((d, i) => (
        <g key={i}>
          <path d={d} fill="none" strokeWidth={9} style={{ stroke: "var(--map-road-edge)" }} />
          <path d={d} fill="none" strokeWidth={6} style={{ stroke: "var(--map-road)" }} />
        </g>
      ))}
    </g>
  );
}

const MAP_VARS = {
  "--map-land": "var(--surface-2)",
  "--map-block": "color-mix(in oklab, var(--surface-3) 85%, var(--border))",
  "--map-park": "color-mix(in oklab, var(--good) 16%, var(--surface-2))",
  "--map-water": "color-mix(in oklab, var(--series-1) 22%, var(--surface-2))",
  "--map-road": "var(--surface)",
  "--map-road-edge": "var(--border-strong)",
} as CSSProperties;

/**
 * Geo-grid heatmap: one marker per grid point with the business's local-pack rank there.
 * `delta` mode shows rank change vs a previous scan instead (positive = improved).
 */
export function GeoGrid({
  cells,
  grid,
  seed,
  previous,
  mode = "rank",
  selected,
  onSelect,
  className,
  label,
}: {
  cells: GridPoint[];
  grid: number;
  seed: string;
  previous?: GridPoint[];
  mode?: "rank" | "delta";
  selected?: string | null;
  onSelect?: (key: string) => void;
  className?: string;
  label?: string;
}) {
  const spacing = grid > 1 ? (SIZE - 2 * PAD) / (grid - 1) : 0;
  const radius = Math.min(27, spacing * 0.36);
  const center = (grid - 1) / 2;
  const prevBy = new Map(previous?.map((c) => [`${c.row}:${c.col}`, c.rank]));
  const filterId = `gg-shadow-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className={cn("h-auto w-full rounded-lg border border-border", className)} style={MAP_VARS} role="img" aria-label={label ?? "Geo-grid rank heatmap"}>
      <defs>
        <filter id={filterId} x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="1" stdDeviation="1.4" floodOpacity="0.28" />
        </filter>
      </defs>
      <MapBackground seed={seed} />
      <circle cx={SIZE / 2} cy={SIZE / 2} r={(SIZE - 2 * PAD) / 2 + radius * 0.6} fill="none" strokeDasharray="5 5" strokeWidth={1.5} style={{ stroke: "var(--text-3)" }} opacity={0.5} />
      {cells.map((c) => {
        const key = `${c.row}:${c.col}`;
        const x = PAD + c.col * spacing;
        const y = PAD + c.row * spacing;
        const isCenter = c.row === center && c.col === center;
        let fill: string, ink: string, text: string, title: string;
        if (mode === "delta") {
          const prev = prevBy.get(key);
          const d = (prev ?? 21) - (c.rank ?? 21);
          fill = d > 0 ? "var(--good)" : d < 0 ? "var(--critical)" : "var(--surface-3)";
          ink = d === 0 ? "var(--text-2)" : "#ffffff";
          text = d === 0 ? "0" : `${d > 0 ? "+" : "−"}${Math.abs(d)}`;
          title = `${prev == null ? "20+" : `#${prev}`} → ${c.rank == null ? "20+" : `#${c.rank}`}`;
        } else {
          const band = bandFor(c.rank);
          fill = band.color;
          ink = band.ink;
          text = c.rank == null ? "20+" : String(c.rank);
          title = `Rank ${c.rank == null ? "20+ (not found)" : `#${c.rank}`} at ${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}${c.pack.length ? ` · Local pack: ${c.pack.join(", ")}` : ""}`;
        }
        const active = selected === key;
        return (
          <g
            key={key}
            onClick={onSelect ? () => onSelect(key) : undefined}
            className={onSelect ? "cursor-pointer" : undefined}
            role={onSelect ? "button" : undefined}
            tabIndex={onSelect ? 0 : undefined}
            onKeyDown={onSelect ? (e) => (e.key === "Enter" || e.key === " ") && onSelect(key) : undefined}
            aria-label={title}
          >
            <title>{title}</title>
            {(active || isCenter) && <circle cx={x} cy={y} r={radius + 4.5} fill="none" strokeWidth={active ? 3 : 2} style={{ stroke: active ? "var(--text)" : "var(--brand)" }} />}
            <circle cx={x} cy={y} r={radius} filter={`url(#${filterId})`} strokeWidth={2} style={{ fill, stroke: "var(--surface)" }} />
            <text x={x} y={y} dy="0.36em" textAnchor="middle" fontSize={radius * (text.length > 2 ? 0.66 : 0.8)} fontWeight={700} style={{ fill: ink }}>
              {text}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function RankLegend({ className, delta }: { className?: string; delta?: boolean }) {
  if (delta)
    return (
      <ul className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-text-2", className)}>
        <li className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full" style={{ background: "var(--good)" }} /> Improved (positions gained)
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full border border-border-strong" style={{ background: "var(--surface-3)" }} /> No change
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full" style={{ background: "var(--critical)" }} /> Declined
        </li>
      </ul>
    );
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-text-2", className)}>
      {RANK_BANDS.map((b) => (
        <li key={b.id} className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full" style={{ background: b.color }} />
          <span className="font-medium text-text">{b.label}</span> {b.note}
        </li>
      ))}
    </ul>
  );
}
