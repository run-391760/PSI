"use client";

import { useState } from "react";
import { MONTH_RANGES, TrendChart, type TrendSeries } from "@/components/charts/trend-chart";
import type { ValueFormat } from "@/components/charts/format";
import { Segmented } from "@/components/ui/tabs";

export type TrendView = { id: string; label: string; series: TrendSeries[]; type?: "line" | "area" | "stacked"; yFormat?: ValueFormat; reversed?: boolean };

/**
 * Trend chart with a metric switcher: each view is one measure (one y-axis), e.g. Visits by device /
 * Unique visitors, or Paid traffic / Paid keywords / Traffic cost.
 */
export function MetricTrend({
  data,
  views,
  xKey = "month",
  height = 250,
  defaultRange = "1y",
  ranges = true,
  className,
}: {
  data: Record<string, unknown>[];
  views: TrendView[];
  xKey?: string;
  height?: number;
  defaultRange?: string;
  ranges?: boolean;
  className?: string;
}) {
  const [view, setView] = useState(views[0]?.id);
  const v = views.find((x) => x.id === view) ?? views[0];
  if (!v) return null;
  return (
    <div className={className}>
      {views.length > 1 && <Segmented className="mb-3" options={views.map((x) => ({ value: x.id, label: x.label }))} value={v.id} onChange={setView} />}
      <TrendChart
        data={data}
        xKey={xKey}
        series={v.series}
        type={v.type ?? "line"}
        yFormat={v.yFormat ?? "compact"}
        reversed={v.reversed}
        ranges={ranges ? MONTH_RANGES : undefined}
        defaultRange={defaultRange}
        height={height}
      />
    </div>
  );
}
