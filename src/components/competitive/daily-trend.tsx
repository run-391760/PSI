"use client";

import { useState } from "react";
import { TrendChart } from "@/components/charts/trend-chart";
import type { TrendView } from "./metric-trend";
import { Segmented } from "@/components/ui/tabs";

const RANGES = [
  { id: "3m", label: "3M", points: 90 },
  { id: "6m", label: "6M", points: 180 },
  { id: "12m", label: "12M", points: 365 },
  { id: "16m", label: "16M", points: 480 },
];

/** Daily trend (Search Console / GA4) with a metric switcher and 3/6/12/16-month ranges. */
export function DailyTrend({ data, views, height = 250, defaultRange = "3m", className }: { data: Record<string, unknown>[]; views: TrendView[]; height?: number; defaultRange?: string; className?: string }) {
  const [view, setView] = useState(views[0]?.id);
  const v = views.find((x) => x.id === view) ?? views[0];
  if (!v) return null;
  return (
    <div className={className}>
      {views.length > 1 && (
        <div className="scroll-thin mb-3 max-w-full overflow-x-auto">
          <Segmented options={views.map((x) => ({ value: x.id, label: x.label }))} value={v.id} onChange={setView} />
        </div>
      )}
      <TrendChart data={data} xKey="date" xFormat="day" series={v.series} type={v.type ?? "line"} yFormat={v.yFormat ?? "compact"} reversed={v.reversed} ranges={RANGES} defaultRange={defaultRange} height={height} />
    </div>
  );
}
