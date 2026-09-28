"use client";

import { BarChart } from "@/components/charts/bar-chart";
import { DonutChart } from "@/components/charts/donut-chart";
import { TrendChart } from "@/components/charts/trend-chart";
import { Metric } from "@/components/ui/metric";
import { formatMetric, groupLabel, metricDef, rangeLabel, type Widget, type WidgetResult } from "@/lib/cx/insights/widget-defs";

const label = (k: string) => (k.length > 28 ? `${k.slice(0, 27)}…` : k).replace(/_/g, " ");

/** Renders one BI widget result (KPI, line, bar, donut or table). */
export function WidgetView({ widget, result, height = 220 }: { widget: Widget; result: WidgetResult; height?: number }) {
  const def = metricDef(widget);
  const fmt = def?.format ?? "number";
  if (result.error) return <p className="py-6 text-center text-[13px] text-critical-ink">{result.error}</p>;
  if (widget.chart === "cloud") {
    const terms = result.terms ?? [];
    if (!terms.length) return <p className="py-10 text-center text-[13px] text-text-3">Not enough repeated phrases in {rangeLabel(widget)} yet.</p>;
    const max = terms[0].count, min = terms[terms.length - 1].count;
    return (
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5 py-2" aria-label="Phrase cloud">
        {terms.map((t) => {
          const k = max === min ? 0.5 : (t.count - min) / (max - min);
          return (
            <span key={t.term} title={`${t.count} ${t.count === 1 ? "text" : "texts"}`} className="text-text" style={{ fontSize: `${12 + k * 12}px`, fontWeight: k > 0.5 ? 600 : 400, opacity: 0.65 + k * 0.35 }}>
              {t.term}
            </span>
          );
        })}
      </div>
    );
  }
  if ((widget.chart === "compare" || widget.chart === "stacked") && result.multi) {
    const m = result.multi;
    if (!m.rows.some((r) => m.series.some((s) => Number(r[s.key]) > 0))) return <p className="py-10 text-center text-[13px] text-text-3">No records match this widget in {rangeLabel(widget)}.</p>;
    if (widget.chart === "compare") return <BarChart data={m.rows} xKey="key" xFormat="monthShort" series={m.series} height={height} showLegend />;
    return <BarChart data={m.rows.map((r) => ({ ...r, key: label(String(r.key)) }))} xKey="key" layout="bars" stacked series={m.series} height={Math.max(160, m.rows.length * 30 + 50)} categoryWidth={130} showLegend />;
  }
  if (widget.chart === "kpi") {
    const delta = result.total != null && result.previous != null && result.previous !== 0 && fmt !== "percent" && fmt !== "score" ? ((result.total - result.previous) / Math.abs(result.previous)) * 100 : null;
    const pts = (fmt === "percent" || fmt === "score") && result.total != null && result.previous != null ? result.total - result.previous : null;
    return (
      <Metric
        size="lg"
        label={def?.label && def.label !== widget.title ? def.label : rangeLabel(widget)}
        value={formatMetric(result.total, fmt)}
        delta={delta}
        upIsGood={!def?.lowerIsBetter}
        deltaLabel="vs prev."
        sub={pts != null ? `${pts >= 0 ? "+" : ""}${pts.toFixed(1)} pts vs previous period` : result.previous == null ? "No data in the previous period" : `Previous: ${formatMetric(result.previous, fmt)}`}
      />
    );
  }
  const rows = result.rows;
  const hasData = rows.some((r) => r.value != null && r.value !== 0);
  if (!hasData) return <p className="py-10 text-center text-[13px] text-text-3">No records match this widget in {rangeLabel(widget)}.</p>;
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
            <th className="py-1.5 font-medium">{widget.groupBy === "date" ? "Date" : widget.metric === "phrases" ? "Phrase" : groupLabel(widget.groupBy)}</th>
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
