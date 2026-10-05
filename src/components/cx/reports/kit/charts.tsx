"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Label, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartLegend } from "@/components/charts/parts";
import { AXIS, GRID, series as seriesColor } from "@/components/charts/theme";
import { compact } from "@/lib/format";
import { bucketLabel, dmy, drillFor, toPercent, type DrillMap, type Interval } from "@/lib/cx/reports/model";
import { cn } from "@/lib/utils";
import { useReport, useSeriesToggle } from "./context";

/**
 * Interactive report charts (Recharts). Common contract:
 * - `series` keys are entity-stable; colors follow the order given (or an explicit color).
 * - Legend items toggle series (shared across the page through <ReportProvider> unless `shared={false}`),
 *   and the chart rescales to what is visible.
 * - Every point / bar segment / slice is clickable: it builds a DrillSpec from the declarative `drill` map
 *   (series → map.series dimension, x value → map.x dimension) and opens the drill-down drawer.
 */
export type KSeries = { key: string; label: string; color?: string };
export type XFormat = "day" | "week" | "month" | "raw";
type Row = Record<string, string | number | null>;

const colored = (s: KSeries[]) => s.map((x, i) => ({ ...x, color: x.color ?? seriesColor(i) }));
const xLabel = (v: unknown, f: XFormat) => (f === "raw" ? String(v ?? "") : f === "week" ? bucketLabel(String(v), "week") : dmy(String(v ?? "")));
const short = (s: string, n = 16) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const AXIS_LABEL = { fill: "var(--chart-text)", fontSize: 11 } as const;

function Tip({ active, payload, label, xFormat, percent, labels }: { active?: boolean; payload?: { dataKey?: string | number; value?: unknown; color?: string; payload?: Row }[]; label?: unknown; xFormat: XFormat; percent?: boolean; labels: Record<string, string> }) {
  if (!active || !payload?.length) return null;
  const sum = payload.reduce((s, p) => s + (Number(p.value) || 0), 0);
  return (
    <div className="min-w-40 rounded-lg border border-border bg-surface px-3 py-2 text-[12px] shadow-pop">
      {label != null && label !== "" && <div className="mb-1.5 font-medium text-text">{xLabel(label, xFormat)}</div>}
      <ul className="space-y-1">
        {payload.map((p) => (
          <li key={String(p.dataKey)} className="flex items-center gap-2">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: p.color }} aria-hidden />
            <span className="flex-1 text-text-2">{labels[String(p.dataKey)] ?? String(p.dataKey)}</span>
            <span className="tabular font-medium text-text">
              {percent ? `${Number(p.value ?? 0).toFixed(1)}%` : Number(p.value ?? 0).toLocaleString("en-US")}
              {!percent && payload.length > 1 && sum > 0 && <span className="ml-1 font-normal text-text-3">({Math.round(((Number(p.value) || 0) / sum) * 100)}%)</span>}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-[11px] text-text-3">Click to see the items</p>
    </div>
  );
}

function Hint({ show }: { show: boolean }) {
  return show ? <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-[12.5px] text-text-3">All series hidden. Click a legend item to show it.</p> : null;
}

/** Smooth line chart over time buckets; one line per series; dots and the hovered point are clickable. */
export function LineChartK({
  data,
  series,
  drill,
  xFormat = "day",
  interval,
  height = 280,
  shared = true,
  yLabel,
  legend = true,
}: {
  data: Row[];
  series: KSeries[];
  drill: DrillMap;
  xFormat?: XFormat;
  interval?: Interval;
  height?: number;
  shared?: boolean;
  yLabel?: string;
  legend?: boolean;
}) {
  const { openDrill } = useReport();
  const { hidden, toggle } = useSeriesToggle(shared);
  const s = colored(series);
  const visible = s.filter((x) => !hidden.has(x.key));
  const labels = Object.fromEntries(s.map((x) => [x.key, x.label]));
  const clicked = useRef(false);
  const fmt = interval === "week" ? "week" : interval === "month" ? "month" : xFormat;
  const open = (seriesKey: string | undefined, x: string) => {
    const name = seriesKey ? labels[seriesKey] : undefined;
    openDrill(drillFor(drill, { series: seriesKey, x, title: [name, xLabel(x, fmt)] }));
  };
  const dot = (key: string, color: string, r: number) =>
    function DotRender(p: { cx?: number; cy?: number; index?: number; payload?: Row }) {
      if (p.cx == null || p.cy == null) return <g key={`${key}-${p.index}`} />;
      return (
        <g
          key={`${key}-${p.index}`}
          className="cursor-pointer"
          onClick={() => {
            clicked.current = true;
            open(key, String(p.payload?.key));
          }}
        >
          <circle cx={p.cx} cy={p.cy} r={12} fill="transparent" />
          <circle cx={p.cx} cy={p.cy} r={r} fill={color} stroke="var(--surface)" strokeWidth={2} />
        </g>
      );
    };
  return (
    <div>
      <div className="relative" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 8, right: 12, bottom: 0, left: yLabel ? 8 : 0 }}
            onClick={(st: { activeLabel?: unknown } | null) => {
              if (clicked.current) return void (clicked.current = false);
              if (st?.activeLabel == null) return;
              open(visible.length === 1 ? visible[0].key : undefined, String(st.activeLabel));
            }}
            className="cursor-pointer"
          >
            <CartesianGrid {...GRID} />
            <XAxis dataKey="key" {...AXIS} tickFormatter={(v) => xLabel(v, fmt === "week" ? "day" : fmt)} minTickGap={20} dy={4} />
            <YAxis {...AXIS} axisLine={false} width={yLabel ? 56 : 44} allowDecimals={false} domain={[0, "auto"]} tickFormatter={(v) => compact(Number(v))}>
              {yLabel && <Label value={yLabel} angle={-90} position="insideLeft" style={{ ...AXIS_LABEL, textAnchor: "middle" }} />}
            </YAxis>
            <Tooltip content={<Tip xFormat={fmt} labels={labels} />} cursor={{ stroke: "var(--chart-axis)", strokeWidth: 1 }} />
            {visible.map((x) => (
              <Line key={x.key} type="monotone" dataKey={x.key} name={x.label} stroke={x.color} strokeWidth={2.5} dot={dot(x.key, x.color, data.length > 40 ? 0 : 3.5)} activeDot={dot(x.key, x.color, 5)} isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
        <Hint show={!visible.length} />
      </div>
      {legend && <ChartLegend className="mt-2 justify-end" items={s} hidden={hidden} onToggle={toggle} />}
    </div>
  );
}

/**
 * Column / bar chart: categories on the x axis (or y axis when `horizontal`), one bar or segment per series.
 * `mode`: stacked, grouped, or percent (100% stacked over the visible series).
 */
export function ColumnChartK({
  data,
  series,
  drill,
  xKey = "key",
  xFormat = "raw",
  catLabels,
  mode = "stacked",
  horizontal,
  height = 280,
  shared = true,
  yLabel,
  legend = true,
  interval,
}: {
  data: Row[];
  series: KSeries[];
  drill: DrillMap;
  xKey?: string;
  xFormat?: XFormat;
  /** Display names of category keys (e.g. entity id → name). */
  catLabels?: Record<string, string>;
  mode?: "stacked" | "grouped" | "percent";
  horizontal?: boolean;
  height?: number;
  shared?: boolean;
  yLabel?: string;
  legend?: boolean;
  interval?: Interval;
}) {
  const { openDrill } = useReport();
  const { hidden, toggle } = useSeriesToggle(shared);
  const s = colored(series);
  const visible = s.filter((x) => !hidden.has(x.key));
  const labels = Object.fromEntries(s.map((x) => [x.key, x.label]));
  const rows = useMemo(() => (mode === "percent" ? toPercent(data, visible.map((x) => x.key)) : data), [data, mode, visible]);
  const fmt = interval === "week" ? "week" : interval === "month" ? "month" : xFormat;
  const cat = (v: unknown) => catLabels?.[String(v)] ?? xLabel(v, fmt === "week" ? "day" : fmt);
  const many = data.length > 4;
  const percent = mode === "percent";
  const stackId = mode === "grouped" ? undefined : "s";
  const valueAxis = { ...AXIS, axisLine: false, allowDecimals: false, domain: percent ? ([0, 100] as [number, number]) : ([0, "auto"] as [number, string]), tickFormatter: (v: number) => (percent ? `${v}` : compact(Number(v))) };
  const catAxis = { ...AXIS, dataKey: xKey, tickFormatter: (v: unknown) => short(cat(v), horizontal ? 18 : 14) };
  return (
    <div>
      <div className="relative" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout={horizontal ? "vertical" : "horizontal"} margin={{ top: 8, right: 12, bottom: 0, left: yLabel ? 8 : 0 }} barCategoryGap={data.length <= 2 ? "30%" : "18%"}>
            <CartesianGrid {...GRID} vertical={!!horizontal} horizontal={!horizontal} />
            {horizontal ? (
              <>
                <XAxis type="number" {...valueAxis} />
                <YAxis type="category" {...catAxis} width={110} interval={0} />
              </>
            ) : (
              <>
                <XAxis {...catAxis} interval={0} angle={many ? -35 : 0} textAnchor={many ? "end" : "middle"} height={many ? 64 : 30} dy={4} />
                <YAxis {...valueAxis} width={yLabel ? 56 : 44}>
                  {yLabel && <Label value={yLabel} angle={-90} position="insideLeft" style={{ ...AXIS_LABEL, textAnchor: "middle" }} />}
                </YAxis>
              </>
            )}
            <Tooltip content={<Tip xFormat="raw" percent={percent} labels={labels} />} labelFormatter={(v) => cat(v)} cursor={{ fill: "var(--surface-3)", opacity: 0.6 }} />
            {visible.map((x, i) => (
              <Bar
                key={x.key}
                dataKey={x.key}
                name={x.label}
                stackId={stackId}
                fill={x.color}
                maxBarSize={horizontal ? 56 : 64}
                radius={stackId ? (i === visible.length - 1 ? (horizontal ? [0, 3, 3, 0] : [3, 3, 0, 0]) : 0) : horizontal ? [0, 3, 3, 0] : [3, 3, 0, 0]}
                stroke="var(--surface)"
                strokeWidth={stackId ? 1 : 0}
                isAnimationActive={false}
                style={{ cursor: "pointer" }}
                onClick={(d: { payload?: Row }) => {
                  const xv = String(d?.payload?.[xKey] ?? "");
                  openDrill(drillFor(drill, { series: x.key, x: xv, title: [x.label, cat(xv)] }));
                }}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
        <Hint show={!visible.length} />
      </div>
      {legend && s.length > 1 && <ChartLegend className="mt-2 justify-end" items={s} hidden={hidden} onToggle={toggle} />}
    </div>
  );
}

/** Pie or donut; hidden series drop out and the rest rescale. Optional total in the centre (donut). */
export function PieChartK({
  slices,
  drill,
  donut,
  centerLabel,
  height = 260,
  shared = true,
  legend = true,
  labels = true,
}: {
  /** `dim` is the drill dimension value when it differs from the (toggle) key. */
  slices: { key: string; label: string; value: number; color?: string; dim?: string }[];
  drill: DrillMap;
  donut?: boolean;
  centerLabel?: string;
  height?: number;
  shared?: boolean;
  legend?: boolean;
  labels?: boolean;
}) {
  const { openDrill } = useReport();
  const { hidden, toggle } = useSeriesToggle(shared);
  const all = slices.map((x, i) => ({ ...x, color: x.color ?? seriesColor(i) }));
  const visible = all.filter((x) => !hidden.has(x.key) && x.value > 0);
  const total = visible.reduce((s, x) => s + x.value, 0);
  const pct = (v: number) => (total ? `${((v / total) * 100).toFixed(2)}%` : "0%");
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver((es) => setWidth(es[0]?.contentRect.width ?? 0));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Outside labels need room; on narrow cards the legend and tooltip carry the values instead.
  const showLabels = labels && visible.length <= 6 && width >= 440;
  return (
    <div>
      <div ref={box} className="relative" style={{ height }}>
        {total > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart margin={{ top: 16, right: 8, bottom: 16, left: 8 }}>
              <Tooltip
                content={({ active, payload }) => {
                  const p = payload?.[0]?.payload as (typeof visible)[number] | undefined;
                  if (!active || !p) return null;
                  return (
                    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-[12px] shadow-pop">
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
                        <span className="text-text-2">{p.label}</span>
                        <span className="tabular font-medium text-text">{p.value.toLocaleString("en-US")} ({pct(p.value)})</span>
                      </div>
                      <p className="mt-1 text-[11px] text-text-3">Click to see the items</p>
                    </div>
                  );
                }}
              />
              <Pie
                data={visible}
                dataKey="value"
                nameKey="label"
                innerRadius={donut ? "58%" : 0}
                outerRadius="78%"
                paddingAngle={visible.length > 1 ? 1 : 0}
                stroke="var(--surface)"
                strokeWidth={2}
                isAnimationActive={false}
                label={showLabels ? ({ payload }: { payload?: { label: string; value: number } }) => (payload ? `${short(payload.label, 18)}: ${pct(payload.value)} (${compact(payload.value)})` : "") : false}
                labelLine={showLabels}
                style={{ cursor: "pointer", fontSize: 11 }}
                onClick={(_: unknown, i: number) => {
                  const sl = visible[i];
                  if (sl) openDrill(drillFor(drill, { series: sl.dim ?? sl.key, title: [sl.label] }));
                }}
              >
                {visible.map((x) => <Cell key={x.key} fill={x.color} />)}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        ) : null}
        {total > 0 && donut && centerLabel != null && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-[22px] leading-7 font-semibold text-text tabular">{total.toLocaleString("en-US")}</span>
            <span className="text-[11px] text-text-3">{centerLabel}</span>
          </div>
        )}
        {total > 0 ? null : (
          <p className="flex h-full items-center justify-center text-[12.5px] text-text-3">{all.some((x) => x.value > 0) ? "All slices hidden. Click a legend item to show it." : "Nothing to show for this period."}</p>
        )}
      </div>
      {legend && all.length > 1 && <ChartLegend className={cn("mt-2 justify-center")} items={all} hidden={hidden} onToggle={toggle} />}
    </div>
  );
}
