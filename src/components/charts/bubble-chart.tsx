"use client";

import { CartesianGrid, LabelList, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { type ValueFormat, formatValue } from "./format";
import { AXIS, GRID } from "./theme";

type Point = { label: string; x: number; y: number; z?: number; highlight?: boolean };

/** 1-2-5 ticks spanning [min, max] for log axes (Recharts' defaults are sparse/uneven). */
function logTicks(values: number[]) {
  const pos = values.filter((v) => v > 0);
  if (!pos.length) return undefined;
  const lo = Math.floor(Math.log10(Math.min(...pos)));
  const hi = Math.ceil(Math.log10(Math.max(...pos)));
  const ticks: number[] = [];
  for (let e = lo; e <= hi; e++) for (const m of hi - lo > 3 ? [1] : [1, 2, 5]) ticks.push(m * 10 ** e);
  return ticks;
}

/**
 * Competitive positioning map. Emphasis encoding: the highlighted entity uses series-1, every other
 * point is neutral. The highlighted point and the largest neighbours are direct-labelled (identity
 * never depends on color); the tooltip names the rest.
 */
export function BubbleChart({
  points,
  xLabel,
  yLabel,
  zLabel,
  xFormat = "compact",
  yFormat = "compact",
  height = 300,
  log,
}: {
  points: Point[];
  xLabel: string;
  yLabel: string;
  zLabel?: string;
  xFormat?: ValueFormat;
  yFormat?: ValueFormat;
  height?: number;
  log?: boolean;
}) {
  const main = points.filter((p) => p.highlight);
  // Direct-label only the largest neighbours to avoid collisions; the tooltip carries the rest.
  const labelled = new Set([...points].sort((a, b) => (b.z ?? b.y) - (a.z ?? a.y)).slice(0, 6).map((p) => p.label));
  const rest = points.filter((p) => !p.highlight).map((p) => ({ ...p, shown: labelled.has(p.label) ? p.label : "" }));
  const xTicks = log ? logTicks(points.map((p) => p.x)) : undefined;
  const yTicks = log ? logTicks(points.map((p) => p.y)) : undefined;
  const zs = points.map((p) => p.z ?? 1);
  return (
    <div style={{ height }} className="[&_svg]:overflow-visible">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 26, right: 48, bottom: 18, left: 12 }}>
          <CartesianGrid {...GRID} vertical />
          <XAxis type="number" dataKey="x" name={xLabel} {...AXIS} scale={log ? "log" : "auto"} domain={log && xTicks ? [xTicks[0], xTicks[xTicks.length - 1]] : [0, "auto"]} ticks={xTicks} tickFormatter={(v) => formatValue(v, xFormat)} label={{ value: xLabel, position: "insideBottom", offset: -10, fill: "var(--chart-text)", fontSize: 11 }} />
          <YAxis type="number" dataKey="y" name={yLabel} {...AXIS} axisLine={false} width={56} scale={log ? "log" : "auto"} domain={log && yTicks ? [yTicks[0], yTicks[yTicks.length - 1]] : [0, "auto"]} ticks={yTicks} tickFormatter={(v) => formatValue(v, yFormat)} label={{ value: yLabel, angle: -90, position: "insideLeft", fill: "var(--chart-text)", fontSize: 11, dx: 6 }} />
          <ZAxis type="number" dataKey="z" range={[60, 900]} domain={[Math.min(...zs), Math.max(...zs)]} />
          <Tooltip
            cursor={{ strokeDasharray: "0", stroke: "var(--chart-axis)" }}
            content={({ active, payload }) => {
              const p = active && payload?.[0]?.payload as Point | undefined;
              if (!p) return null;
              return (
                <div className="rounded-lg border border-border bg-surface px-3 py-2 text-[12px] shadow-pop">
                  <div className="mb-1 font-medium text-text">{p.label}</div>
                  <div className="text-text-2">
                    {xLabel}: <span className="font-medium text-text">{formatValue(p.x, xFormat)}</span>
                  </div>
                  <div className="text-text-2">
                    {yLabel}: <span className="font-medium text-text">{formatValue(p.y, yFormat)}</span>
                  </div>
                  {zLabel && p.z != null && (
                    <div className="text-text-2">
                      {zLabel}: <span className="font-medium text-text">{formatValue(p.z)}</span>
                    </div>
                  )}
                </div>
              );
            }}
          />
          <Scatter data={rest} fill="var(--text-3)" fillOpacity={0.45} stroke="var(--surface)" strokeWidth={2} isAnimationActive={false}>
            <LabelList dataKey="shown" position="top" style={{ fill: "var(--text-2)", fontSize: 10.5 }} />
          </Scatter>
          <Scatter data={main} fill="var(--series-1)" fillOpacity={0.85} stroke="var(--surface)" strokeWidth={2} isAnimationActive={false}>
            <LabelList dataKey="label" position="top" style={{ fill: "var(--text)", fontSize: 11, fontWeight: 600 }} />
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
