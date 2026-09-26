"use client";

import { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Segmented } from "@/components/ui/tabs";
import { type AxisFormat, type ValueFormat, formatAxis, formatValue } from "./format";
import { ChartLegend, ChartTooltip } from "./parts";
import { AXIS, GRID, series as seriesColor } from "./theme";

export type TrendSeries = { key: string; label: string; color?: string; dashed?: boolean };
type Range = { id: string; label: string; points: number };

/**
 * Time-series line/area chart. One y-axis only (never dual-axis): put measures of different scale
 * in separate charts. Series colors follow the order given (entity-stable).
 */
export function TrendChart({
  data,
  xKey,
  series,
  height = 240,
  type = "line",
  yFormat = "compact",
  xFormat = "monthShort",
  ranges,
  defaultRange,
  reversed,
  yDomain,
  showLegend,
  markers,
  className,
}: {
  data: Record<string, unknown>[];
  xKey: string;
  series: TrendSeries[];
  height?: number;
  type?: "line" | "area" | "stacked";
  yFormat?: ValueFormat;
  xFormat?: AxisFormat;
  /** Time-range presets as number of trailing points, e.g. [{id:"6m",label:"6M",points:6}]. */
  ranges?: Range[];
  defaultRange?: string;
  /** Reverse the y-axis (rank positions: 1 at the top). */
  reversed?: boolean;
  yDomain?: [number | "auto" | "dataMin" | "dataMax", number | "auto" | "dataMin" | "dataMax"];
  showLegend?: boolean;
  /** Vertical annotations (e.g. Google core updates) keyed by x value. */
  markers?: { x: string; label: string }[];
  className?: string;
}) {
  const [range, setRange] = useState(defaultRange ?? ranges?.[ranges.length - 1]?.id);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const colored = series.map((s, i) => ({ ...s, color: s.color ?? seriesColor(i) }));
  const points = ranges?.find((r) => r.id === range)?.points;
  const visible = useMemo(() => (points ? data.slice(-points) : data), [data, points]);
  const labels = Object.fromEntries(colored.map((s) => [s.key, s.label]));
  const colors = Object.fromEntries(colored.map((s) => [s.key, s.color]));
  const legend = showLegend ?? series.length > 1;
  const toggle = (k: string) =>
    setHidden((h) => {
      const next = new Set(h);
      if (next.has(k)) next.delete(k);
      else if (next.size < series.length - 1) next.add(k);
      return next;
    });

  const common = {
    data: visible,
    margin: { top: 8, right: 12, bottom: 0, left: 0 },
  };
  const axes = (
    <>
      <CartesianGrid {...GRID} />
      <XAxis dataKey={xKey} {...AXIS} tickFormatter={(v) => formatAxis(v, xFormat)} minTickGap={24} dy={4} />
      <YAxis
        {...AXIS}
        axisLine={false}
        width={52}
        reversed={reversed}
        domain={yDomain ?? (reversed ? [1, "auto"] : [0, "auto"])}
        allowDecimals={false}
        tickFormatter={(v) => formatValue(v, yFormat === "position" ? "raw" : yFormat)}
      />
      <Tooltip content={<ChartTooltip xFormat={xFormat === "monthShort" ? "month" : xFormat} yFormat={yFormat} labels={labels} colors={colors} />} cursor={{ stroke: "var(--chart-axis)", strokeWidth: 1 }} />
      {markers?.map((m) => (
        <ReferenceLine key={m.x} x={m.x} stroke="var(--text-3)" strokeOpacity={0.5} label={{ value: m.label, position: "insideTopLeft", fill: "var(--text-3)", fontSize: 10 }} />
      ))}
    </>
  );

  return (
    <div className={className}>
      {(legend || ranges) && (
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          {legend ? <ChartLegend items={colored} hidden={hidden} onToggle={toggle} /> : <span />}
          {ranges && <Segmented options={ranges.map((r) => ({ value: r.id, label: r.label }))} value={range ?? ""} onChange={setRange} />}
        </div>
      )}
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          {type === "line" ? (
            <LineChart {...common}>
              {axes}
              {colored.map((s) =>
                hidden.has(s.key) ? null : (
                  <Line
                    key={s.key}
                    type="monotone"
                    dataKey={s.key}
                    name={s.label}
                    stroke={s.color}
                    strokeWidth={2}
                    strokeDasharray={s.dashed ? "5 4" : undefined}
                    dot={visible.length <= 14 ? { r: 3, strokeWidth: 2, stroke: "var(--surface)", fill: s.color } : false}
                    activeDot={{ r: 4.5, strokeWidth: 2, stroke: "var(--surface)" }}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                ),
              )}
            </LineChart>
          ) : (
            <AreaChart {...common}>
              {axes}
              {colored.map((s) =>
                hidden.has(s.key) ? null : (
                  <Area
                    key={s.key}
                    type="monotone"
                    dataKey={s.key}
                    name={s.label}
                    stroke={s.color}
                    strokeWidth={2}
                    fill={s.color}
                    fillOpacity={type === "stacked" ? 0.35 : 0.1}
                    stackId={type === "stacked" ? "a" : undefined}
                    activeDot={{ r: 4.5, strokeWidth: 2, stroke: "var(--surface)" }}
                    isAnimationActive={false}
                  />
                ),
              )}
            </AreaChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export const MONTH_RANGES: Range[] = [
  { id: "6m", label: "6M", points: 6 },
  { id: "1y", label: "1Y", points: 12 },
  { id: "2y", label: "2Y", points: 24 },
];
export const DAY_RANGES: Range[] = [
  { id: "7d", label: "7D", points: 7 },
  { id: "30d", label: "30D", points: 30 },
  { id: "90d", label: "90D", points: 90 },
];
