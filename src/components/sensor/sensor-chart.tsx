"use client";

import { useMemo, useState } from "react";
import { Bar, CartesianGrid, Cell, ComposedChart, Line, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { dateLabel, dayLabel } from "@/lib/format";
import { BANDS, bandFor, GOOGLE_UPDATES } from "@/lib/sensor/bands";
import { AXIS, GRID } from "@/components/charts/theme";
import { ChartLegend } from "@/components/charts/parts";
import { Segmented } from "@/components/ui/tabs";

type Point = { date: string; score: number; personal?: number | null };
const RANGES = [
  { id: "30d", label: "30D", points: 30 },
  { id: "90d", label: "90D", points: 90 },
  { id: "1y", label: "1Y", points: 365 },
  { id: "2y", label: "2Y", points: 730 },
];
const monthDay = new Intl.DateTimeFormat("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });

function SensorTooltip({ active, payload, label }: { active?: boolean; payload?: { dataKey?: string; value?: number }[]; label?: string }) {
  if (!active || !payload?.length || !label) return null;
  const score = payload.find((p) => p.dataKey === "score")?.value;
  const personal = payload.find((p) => p.dataKey === "personal")?.value;
  const updates = GOOGLE_UPDATES.filter((u) => label >= u.start && label <= u.end);
  const band = score != null ? bandFor(score) : null;
  return (
    <div className="min-w-44 rounded-lg border border-border bg-surface px-3 py-2 text-[12px] shadow-pop">
      <div className="mb-1.5 font-medium text-text">{dateLabel(label)}</div>
      {score != null && band && (
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: band.color }} aria-hidden />
          <span className="flex-1 text-text-2">Volatility</span>
          <span className="tabular font-medium text-text">
            {score.toFixed(1)} · {band.label}
          </span>
        </div>
      )}
      {personal != null && (
        <div className="mt-1 flex items-center gap-2">
          <span className="h-0.5 w-2.5 rounded bg-[var(--series-7)]" aria-hidden />
          <span className="flex-1 text-text-2">Personal score</span>
          <span className="tabular font-medium text-text">{personal.toFixed(1)}</span>
        </div>
      )}
      {updates.map((u) => (
        <div key={u.name} className="mt-1.5 border-t border-border pt-1.5 text-text-3">
          {u.name} <span className="italic">(reference)</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Daily volatility columns colored by band, optional personal-score line, and shaded rollout
 * periods of Google updates from the curated reference list.
 */
export function SensorChart({ data, height = 280, defaultRange = "30d", personalLabel }: { data: Point[]; height?: number; defaultRange?: string; personalLabel?: string }) {
  const [range, setRange] = useState(defaultRange);
  const points = RANGES.find((r) => r.id === range)?.points ?? 30;
  const visible = useMemo(() => data.slice(-points), [data, points]);
  const first = visible[0]?.date ?? "";
  const last = visible[visible.length - 1]?.date ?? "";
  const updates = GOOGLE_UPDATES.filter((u) => u.end >= first && u.start <= last);
  const hasPersonal = visible.some((p) => p.personal != null);
  const legend = [
    ...BANDS.map((b) => ({ key: b.id, label: `${b.label} (${b.min}–${b.max})`, color: b.color })),
    ...(hasPersonal ? [{ key: "personal", label: personalLabel ?? "Personal score", color: "var(--series-7)", dashed: false }] : []),
  ];
  const long = points > 90;
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <ChartLegend items={legend} />
        <Segmented options={RANGES.map((r) => ({ value: r.id, label: r.label }))} value={range} onChange={setRange} />
      </div>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={visible} margin={{ top: 16, right: 8, bottom: 0, left: 0 }} barCategoryGap={long ? 0 : "18%"}>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="date" {...AXIS} tickFormatter={(v: string) => (long ? monthDay.format(new Date(`${v}T00:00:00Z`)) : dayLabel(v))} minTickGap={long ? 40 : 18} dy={4} />
            <YAxis {...AXIS} axisLine={false} width={34} domain={[0, 10]} ticks={[0, 2, 5, 8, 10]} />
            {updates.map((u) => (
              <ReferenceArea
                key={u.name}
                x1={u.start < first ? first : u.start}
                x2={u.end > last ? last : u.end}
                fill="var(--text-3)"
                fillOpacity={0.09}
                strokeOpacity={0}
                label={long ? undefined : { value: `${u.name} (reference)`, position: "insideTopLeft", fill: "var(--text-3)", fontSize: 10 }}
              />
            ))}
            <Tooltip content={<SensorTooltip />} cursor={{ fill: "var(--surface-3)", opacity: 0.6 }} />
            <Bar dataKey="score" name="Volatility" radius={long ? 0 : [3, 3, 0, 0]} maxBarSize={18} isAnimationActive={false}>
              {visible.map((p) => (
                <Cell key={p.date} fill={bandFor(p.score).color} fillOpacity={0.85} />
              ))}
            </Bar>
            {hasPersonal && <Line type="monotone" dataKey="personal" stroke="var(--series-7)" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {updates.length > 0 && (
        <p className="mt-1.5 text-[11.5px] text-text-3">
          Shaded periods: Google updates from the curated reference list ({updates.map((u) => u.name).join(", ")}).
        </p>
      )}
    </div>
  );
}
