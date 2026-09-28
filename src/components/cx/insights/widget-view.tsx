"use client";

import { BarChart } from "@/components/charts/bar-chart";
import { DonutChart } from "@/components/charts/donut-chart";
import { TrendChart } from "@/components/charts/trend-chart";
import { Metric } from "@/components/ui/metric";
import { formatMetric, metricDef, type Widget, type WidgetResult } from "@/lib/cx/insights/widget-defs";

const label = (k: string) => (k.length > 28 ? `${k.slice(0, 27)}…` : k).replace(/_/g, " ");

/** Renders one BI widget result (KPI, line, bar, donut or table). */
export function WidgetView({ widget, result, height = 220 }: { widget: Widget; result: WidgetResult; height?: number }) {
  const def = metricDef(widget);
  const fmt = def?.format ?? "number";
  if (result.error) return <p className="py-6 text-center text-[13px] text-critical-ink">{result.error}</p>;
  if (widget.chart === "kpi") {
    const delta = result.total != null && result.previous != null && result.previous !== 0 && fmt !== "percent" && fmt !== "score" ? ((result.total - result.previous) / Math.abs(result.previous)) * 100 : null;
    const pts = (fmt === "percent" || fmt === "score") && result.total != null && result.previous != null ? result.total - result.previous : null;
    return (
      <Metric
        size="lg"
        label={def?.label && def.label !== widget.title ? def.label : `Last ${widget.range} days`}
        value={formatMetric(result.total, fmt)}
        delta={delta}
        upIsGood={!def?.lowerIsBetter}
        deltaLabel="vs prev."
        sub={pts != null ? `${pts >= 0 ? "+" : ""}${pts.toFixed(1)} pts vs previous ${widget.range} days` : result.previous == null ? "No data in the previous period" : `Previous: ${formatMetric(result.previous, fmt)}`}
      />
    );
  }
  const rows = result.rows;
  const hasData = rows.some((r) => r.value != null && r.value !== 0);
  if (!hasData) return <p className="py-10 text-center text-[13px] text-text-3">No records match this widget in the last {widget.range} days.</p>;
  const yFormat = fmt === "percent" ? "percent" : fmt === "number" ? "compact" : "raw";
  const data = rows.map((r) => ({ key: widget.groupBy === "date" ? r.key : label(r.key), value: r.value == null ? null : Math.round(r.value * 10) / 10 }));
  if (widget.chart === "line") return <TrendChart data={data} xKey="key" xFormat="day" series={[{ key: "value", label: def?.label ?? "Value" }]} height={height} type={def?.additive ? "area" : "line"} yFormat={yFormat} />;
  if (widget.chart === "bar")
    return widget.groupBy === "date" ? (
      <BarChart data={data} xKey="key" xFormat="day" series={[{ key: "value", label: def?.label ?? "Value" }]} height={height} yFormat={yFormat} />
    ) : (
      <BarChart data={data.slice(0, 12)} xKey="key" layout="bars" series={[{ key: "value", label: def?.label ?? "Value" }]} height={Math.max(160, Math.min(12, data.length) * 30 + 30)} yFormat={yFormat} valueLabels categoryWidth={130} />
    );
  if (widget.chart === "donut") return <DonutChart data={data.filter((d) => (d.value ?? 0) > 0).map((d) => ({ label: d.key, value: d.value ?? 0 }))} centerValue={formatMetric(result.total, fmt)} centerLabel={def?.additive ? "total" : def?.label} format={fmt === "percent" ? "percent" : "compact"} />;
  return (
    <div className="scroll-thin max-h-[280px] overflow-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-border text-left text-[11.5px] text-text-3">
            <th className="py-1.5 font-medium">{widget.groupBy === "date" ? "Date" : widget.groupBy[0].toUpperCase() + widget.groupBy.slice(1)}</th>
            <th className="py-1.5 text-right font-medium">{def?.label}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-border last:border-0">
              <td className="py-1.5 pr-2 text-text">{r.key.replace(/_/g, " ")}</td>
              <td className="py-1.5 text-right tabular-nums text-text">{formatMetric(r.value, fmt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
