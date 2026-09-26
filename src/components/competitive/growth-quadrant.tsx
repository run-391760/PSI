"use client";

import { CartesianGrid, LabelList, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { formatValue } from "@/components/charts/format";
import { AXIS, GRID } from "@/components/charts/theme";

type Quadrant = "leaders" | "gameChangers" | "established" | "niche";
type Point = { label: string; x: number; y: number; quadrant: Quadrant; quadrantLabel: string; highlight?: boolean; tag?: string };

const COLORS: Record<Quadrant, string> = {
  leaders: "var(--series-1)",
  gameChangers: "var(--series-3)",
  established: "var(--series-7)",
  niche: "var(--series-4)",
};
const LABELS: Record<Quadrant, string> = { leaders: "Niche leaders", gameChangers: "Game changers", established: "Established players", niche: "Niche players" };

/**
 * Market Explorer growth quadrant: traffic (log x) vs year-over-year growth (y), split at the
 * market medians. Each quadrant has its own color and a corner label (the legend); the analyzed
 * domain is outlined and always labelled, other labels are limited to the largest players.
 */
export function GrowthQuadrant({ points, xThreshold, yThreshold, height = 340, labelTop = 7 }: { points: Point[]; xThreshold: number; yThreshold: number; height?: number; labelTop?: number }) {
  const ranked = [...points].sort((a, b) => b.x - a.x);
  const labelled = new Set([...ranked.slice(0, labelTop).map((p) => p.label), ...points.filter((p) => p.highlight).map((p) => p.label)]);
  const data = points.map((p) => ({ ...p, x: Math.max(1, p.x), tag: labelled.has(p.label) ? p.label : "" }));
  const ys = data.map((p) => p.y);
  const yMin = Math.min(...ys, yThreshold);
  const yMax = Math.max(...ys, yThreshold);
  const step = niceStep((yMax - yMin) / 5 || 10);
  const yDomain: [number, number] = [Math.floor(yMin / step - 0.3) * step, Math.ceil(yMax / step + 0.3) * step];
  const yTicks: number[] = [];
  for (let v = yDomain[0]; v <= yDomain[1] + 1e-9; v += step) yTicks.push(Math.round(v));
  const xs = data.map((p) => p.x);
  const xTicks = logTicks(Math.min(...xs), Math.max(...xs));
  const xDomain: [number, number] = [Math.min(xTicks[0], Math.min(...xs)) * 0.85, Math.max(xTicks[xTicks.length - 1], Math.max(...xs)) * 1.15];
  const corner = "pointer-events-none absolute flex items-center gap-1.5 rounded bg-surface/80 px-1.5 py-0.5 text-[11.5px] font-medium text-text-2";
  return (
    <div className="relative" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 28, right: 24, bottom: 24, left: 4 }}>
          <CartesianGrid {...GRID} vertical />
          <XAxis type="number" dataKey="x" name="Traffic" {...AXIS} scale="log" domain={xDomain} ticks={xTicks} allowDataOverflow tickFormatter={(v) => formatValue(v, "compact")} label={{ value: "Monthly visits (log scale)", position: "insideBottom", offset: -14, fill: "var(--chart-text)", fontSize: 11 }} />
          <YAxis type="number" dataKey="y" name="Growth" {...AXIS} axisLine={false} width={52} domain={yDomain} ticks={yTicks} tickFormatter={(v) => `${v}%`} label={{ value: "Traffic growth, YoY", angle: -90, position: "insideLeft", fill: "var(--chart-text)", fontSize: 11, dx: 8, dy: 50 }} />
          <ZAxis range={[90, 90]} />
          <ReferenceLine x={xThreshold} stroke="var(--chart-axis)" strokeDasharray="4 4" />
          <ReferenceLine y={yThreshold} stroke="var(--chart-axis)" strokeDasharray="4 4" />
          <Tooltip
            cursor={{ strokeDasharray: "0", stroke: "var(--chart-axis)" }}
            content={({ active, payload }) => {
              const p = active && (payload?.[0]?.payload as Point | undefined);
              if (!p) return null;
              return (
                <div className="rounded-lg border border-border bg-surface px-3 py-2 text-[12px] shadow-pop">
                  <div className="mb-1 font-medium text-text">{p.label}</div>
                  <div className="text-text-2">
                    Visits: <span className="font-medium text-text">{formatValue(p.x, "compact")}</span>
                  </div>
                  <div className="text-text-2">
                    Growth: <span className="font-medium text-text">{p.y > 0 ? "+" : ""}{p.y}%</span>
                  </div>
                  <div className="mt-1 inline-flex items-center gap-1.5 text-text-2">
                    <span className="h-2 w-2 rounded-full" style={{ background: COLORS[p.quadrant] }} aria-hidden />
                    {p.quadrantLabel}
                  </div>
                </div>
              );
            }}
          />
          {(Object.keys(COLORS) as Quadrant[]).map((q) => (
            <Scatter key={q} data={data.filter((p) => p.quadrant === q && !p.highlight)} fill={COLORS[q]} fillOpacity={0.8} stroke="var(--surface)" strokeWidth={1.5} isAnimationActive={false}>
              <LabelList dataKey="tag" position="top" style={{ fill: "var(--text-2)", fontSize: 10.5 }} />
            </Scatter>
          ))}
          {data
            .filter((p) => p.highlight)
            .map((p) => (
              <Scatter key={p.label} data={[p]} fill={COLORS[p.quadrant]} stroke="var(--text)" strokeWidth={2.5} isAnimationActive={false}>
                <LabelList dataKey="tag" position="top" style={{ fill: "var(--text)", fontSize: 11.5, fontWeight: 600 }} />
              </Scatter>
            ))}
        </ScatterChart>
      </ResponsiveContainer>
      <span className={corner} style={{ top: 2, left: 60 }}>
        <span className="h-2 w-2 rounded-full" style={{ background: COLORS.gameChangers }} aria-hidden />
        {LABELS.gameChangers}
      </span>
      <span className={corner} style={{ top: 2, right: 24 }}>
        <span className="h-2 w-2 rounded-full" style={{ background: COLORS.leaders }} aria-hidden />
        {LABELS.leaders}
      </span>
      <span className={corner} style={{ bottom: 52, left: 60 }}>
        <span className="h-2 w-2 rounded-full" style={{ background: COLORS.niche }} aria-hidden />
        {LABELS.niche}
      </span>
      <span className={corner} style={{ bottom: 52, right: 24 }}>
        <span className="h-2 w-2 rounded-full" style={{ background: COLORS.established }} aria-hidden />
        {LABELS.established}
      </span>
    </div>
  );
}

function niceStep(raw: number) {
  const p = 10 ** Math.floor(Math.log10(Math.abs(raw)));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

/** 1-2-5 ticks covering [min, max] on a log axis, thinned to at most 6. */
function logTicks(min: number, max: number) {
  const out: number[] = [];
  for (let e = Math.floor(Math.log10(Math.max(1, min))); e <= Math.ceil(Math.log10(Math.max(1, max))); e++)
    for (const m of [1, 2, 5]) {
      const v = m * 10 ** e;
      if (v >= min * 0.5 && v <= max * 2) out.push(v);
    }
  const step = Math.ceil(out.length / 6);
  const thinned = out.filter((_, i) => i % step === 0);
  return thinned.length ? thinned : [min, max];
}
