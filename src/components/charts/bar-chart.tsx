"use client";

import { useState } from "react";
import { Bar, BarChart as RBarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { type AxisFormat, type ValueFormat, formatAxis, formatValue } from "./format";
import { ChartLegend, ChartTooltip } from "./parts";
import { AXIS, GRID, series as seriesColor } from "./theme";

export type BarSeries = { key: string; label: string; color?: string };

/**
 * Column (vertical) or bar (horizontal) chart. Marks ≤ 24px thick with 4px rounded data-ends; a 2px
 * surface gap separates stacked segments. One series = one color for every bar.
 */
export function BarChart({
  data,
  xKey,
  series,
  layout = "columns",
  stacked,
  height = 240,
  yFormat = "compact",
  xFormat = "raw",
  showLegend,
  valueLabels,
  categoryWidth = 120,
  highlight,
  yDomain,
  className,
}: {
  data: Record<string, unknown>[];
  xKey: string;
  series: BarSeries[];
  layout?: "columns" | "bars";
  stacked?: boolean;
  height?: number;
  yFormat?: ValueFormat;
  xFormat?: AxisFormat;
  showLegend?: boolean;
  /** Print the value at each bar tip (only for single-series charts with few bars). */
  valueLabels?: boolean;
  /** Width of the category axis for horizontal bars. */
  categoryWidth?: number;
  /** Category value to emphasize (others fade). */
  highlight?: string;
  /** Value-axis domain, e.g. [0, 100] for percentage stacks. */
  yDomain?: [number | "auto" | "dataMin" | "dataMax", number | "auto" | "dataMin" | "dataMax"];
  className?: string;
}) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const colored = series.map((s, i) => ({ ...s, color: s.color ?? seriesColor(i) }));
  const labels = Object.fromEntries(colored.map((s) => [s.key, s.label]));
  const colors = Object.fromEntries(colored.map((s) => [s.key, s.color]));
  const legend = showLegend ?? series.length > 1;
  const horizontal = layout === "bars";
  const toggle = (k: string) =>
    setHidden((h) => {
      const next = new Set(h);
      if (next.has(k)) next.delete(k);
      else if (next.size < series.length - 1) next.add(k);
      return next;
    });
  const visibleSeries = colored.filter((s) => !hidden.has(s.key));
  return (
    <div className={className}>
      {legend && <ChartLegend items={colored} hidden={hidden} onToggle={toggle} className="mb-2" />}
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <RBarChart data={data} layout={horizontal ? "vertical" : "horizontal"} margin={{ top: valueLabels && !horizontal ? 18 : 6, right: valueLabels && horizontal ? 48 : 12, bottom: 0, left: 0 }} barCategoryGap="22%" barGap={2}>
            <CartesianGrid {...GRID} vertical={horizontal} horizontal={!horizontal} />
            {horizontal ? (
              <>
                <XAxis type="number" {...AXIS} axisLine={false} domain={yDomain ?? [0, "auto"]} allowDecimals={false} tickFormatter={(v) => formatValue(v, yFormat)} />
                <YAxis type="category" dataKey={xKey} {...AXIS} width={categoryWidth} tickFormatter={(v) => formatAxis(v, xFormat)} interval={0} />
              </>
            ) : (
              <>
                <XAxis dataKey={xKey} {...AXIS} tickFormatter={(v) => formatAxis(v, xFormat)} minTickGap={8} dy={4} />
                <YAxis {...AXIS} axisLine={false} width={52} domain={yDomain ?? [0, "auto"]} tickFormatter={(v) => formatValue(v, yFormat)} allowDecimals={false} />
              </>
            )}
            <Tooltip cursor={{ fill: "var(--surface-3)", opacity: 0.6 }} content={<ChartTooltip xFormat={xFormat === "monthShort" ? "month" : xFormat} yFormat={yFormat} labels={labels} colors={colors} />} />
            {visibleSeries.map((s, i) => {
              const isTop = !stacked || i === visibleSeries.length - 1;
              const radius: [number, number, number, number] = isTop ? (horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]) : [0, 0, 0, 0];
              return (
                <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} stackId={stacked ? "a" : undefined} radius={radius} maxBarSize={24} stroke={stacked ? "var(--surface)" : undefined} strokeWidth={stacked ? 2 : 0} isAnimationActive={false}>
                  {highlight && data.map((d, idx) => <Cell key={idx} fillOpacity={String(d[xKey]) === highlight ? 1 : 0.35} />)}
                  {valueLabels && series.length === 1 && <LabelList dataKey={s.key} position={horizontal ? "right" : "top"} formatter={(v: unknown) => formatValue(v, yFormat)} style={{ fill: "var(--text-2)", fontSize: 11 }} />}
                </Bar>
              );
            })}
          </RBarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
