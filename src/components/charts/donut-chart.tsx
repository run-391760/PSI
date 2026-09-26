"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { cn } from "@/lib/utils";
import { type ValueFormat, formatValue } from "./format";
import { ChartTooltip } from "./parts";
import { series as seriesColor } from "./theme";

/**
 * Part-to-whole at a glance (≤ 6 segments; fold the rest into "Other"). Legend with values is always
 * shown so identity never relies on color alone.
 */
export function DonutChart({
  data,
  size = 150,
  centerValue,
  centerLabel,
  format = "compact",
  legend = "right",
  className,
}: {
  data: { label: string; value: number; color?: string }[];
  size?: number;
  centerValue?: string;
  centerLabel?: string;
  format?: ValueFormat;
  legend?: "right" | "bottom" | "none";
  className?: string;
}) {
  const sorted = [...data];
  const rows = sorted.length > 6 ? [...sorted.slice(0, 5), { label: "Other", value: sorted.slice(5).reduce((s, d) => s + d.value, 0), color: "var(--text-3)" }] : sorted;
  const colored = rows.map((d, i) => ({ ...d, color: d.color ?? seriesColor(i) }));
  const total = colored.reduce((s, d) => s + d.value, 0) || 1;
  return (
    <div className={cn("flex items-center gap-5", legend === "bottom" && "flex-col", className)}>
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={colored} dataKey="value" nameKey="label" innerRadius="68%" outerRadius="100%" paddingAngle={colored.length > 1 ? 1.5 : 0} stroke="var(--surface)" strokeWidth={2} startAngle={90} endAngle={-270} isAnimationActive={false}>
              {colored.map((d) => (
                <Cell key={d.label} fill={d.color} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip yFormat={format} />} />
          </PieChart>
        </ResponsiveContainer>
        {(centerValue || centerLabel) && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            {centerValue && <span className="text-[18px] font-semibold text-text">{centerValue}</span>}
            {centerLabel && <span className="text-[11px] text-text-3">{centerLabel}</span>}
          </div>
        )}
      </div>
      {legend !== "none" && (
        <ul className="grid min-w-0 flex-1 gap-1.5 text-[12.5px]">
          {colored.map((d) => (
            <li key={d.label} className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: d.color }} aria-hidden />
              <span className="flex-1 truncate text-text-2">{d.label}</span>
              <span className="tabular text-text-3">{((d.value / total) * 100).toFixed(1)}%</span>
              <span className="tabular w-14 text-right font-medium text-text">{formatValue(d.value, format)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
