/** BI widget catalogue (client-safe): data sources, metrics, groupings, chart types. */
import { humanDuration } from "./metrics";
export type Source = "tickets" | "messages" | "mentions" | "surveys" | "qa";
export type ChartType = "kpi" | "line" | "bar" | "donut" | "table";
export type GroupBy = "none" | "date" | "channel" | "agent" | "tag" | "sentiment" | "intent" | "priority" | "status" | "direction" | "survey" | "scorecard";
export type MetricFormat = "number" | "hours" | "percent" | "score";
export type WidgetFilters = { channel?: string; sentiment?: string; priority?: string; status?: string; tag?: string };
export type Widget = {
  id: string;
  title: string;
  source: Source;
  metric: string;
  chart: ChartType;
  groupBy: GroupBy;
  /** Trailing days. */
  range: number;
  filters: WidgetFilters;
  /** Grid width: 1 = one third, 2 = two thirds, 3 = full row. */
  size: 1 | 2 | 3;
};
export type WidgetResult = { rows: { key: string; value: number | null }[]; total: number | null; previous: number | null; error?: string };

export const SOURCES: Record<Source, { label: string; metrics: { id: string; label: string; format: MetricFormat; additive: boolean; lowerIsBetter?: boolean }[]; groups: GroupBy[]; filters: (keyof WidgetFilters)[] }> = {
  tickets: {
    label: "Tickets",
    metrics: [
      { id: "count", label: "Tickets created", format: "number", additive: true },
      { id: "solved", label: "Tickets solved", format: "number", additive: true },
      { id: "open", label: "Still open", format: "number", additive: true },
      { id: "frt", label: "Avg first response", format: "hours", additive: false, lowerIsBetter: true },
      { id: "art", label: "Avg resolution time", format: "hours", additive: false, lowerIsBetter: true },
      { id: "sla", label: "SLA compliance", format: "percent", additive: false },
      { id: "csat", label: "Avg ticket CSAT (1–5)", format: "score", additive: false },
    ],
    groups: ["none", "date", "channel", "agent", "tag", "sentiment", "intent", "priority", "status"],
    filters: ["channel", "sentiment", "priority", "status", "tag"],
  },
  messages: {
    label: "Messages",
    metrics: [
      { id: "count", label: "Messages", format: "number", additive: true },
      { id: "inbound", label: "Inbound messages", format: "number", additive: true },
      { id: "outbound", label: "Agent replies", format: "number", additive: true },
    ],
    groups: ["none", "date", "channel", "agent", "direction", "sentiment", "intent"],
    filters: ["channel", "sentiment"],
  },
  mentions: {
    label: "Mentions",
    metrics: [
      { id: "count", label: "Mentions", format: "number", additive: true },
      { id: "net", label: "Net sentiment", format: "score", additive: false },
      { id: "positive", label: "Positive share", format: "percent", additive: false },
      { id: "negative", label: "Negative share", format: "percent", additive: false, lowerIsBetter: true },
      { id: "reach", label: "Author reach (followers)", format: "number", additive: true },
    ],
    groups: ["none", "date", "channel", "tag", "sentiment", "intent"],
    filters: ["channel", "sentiment", "tag"],
  },
  surveys: {
    label: "Survey responses",
    metrics: [
      { id: "count", label: "Responses", format: "number", additive: true },
      { id: "nps", label: "NPS", format: "score", additive: false },
      { id: "csat", label: "CSAT (% satisfied)", format: "percent", additive: false },
      { id: "avg", label: "Average score", format: "score", additive: false },
    ],
    groups: ["none", "date", "survey", "channel", "agent", "sentiment"],
    filters: ["channel", "sentiment"],
  },
  qa: {
    label: "Quality reviews",
    metrics: [
      { id: "count", label: "Reviews", format: "number", additive: true },
      { id: "avg", label: "Avg QA score", format: "percent", additive: false },
      { id: "fatal", label: "Fatal error rate", format: "percent", additive: false, lowerIsBetter: true },
    ],
    groups: ["none", "date", "agent", "scorecard", "channel"],
    filters: ["channel"],
  },
};

export const GROUP_LABELS: Record<GroupBy, string> = {
  none: "No grouping (single value)",
  date: "Date",
  channel: "Channel / source",
  agent: "Agent",
  tag: "Tag",
  sentiment: "Sentiment",
  intent: "Intent",
  priority: "Priority",
  status: "Status",
  direction: "Direction",
  survey: "Survey",
  scorecard: "Scorecard",
};
export const CHART_LABELS: Record<ChartType, string> = { kpi: "KPI tile", line: "Line chart", bar: "Bar chart", donut: "Donut", table: "Table" };
export const RANGE_OPTIONS = [
  { value: 7, label: "Last 7 days" },
  { value: 30, label: "Last 30 days" },
  { value: 90, label: "Last 90 days" },
  { value: 180, label: "Last 6 months" },
  { value: 365, label: "Last 12 months" },
];

export const metricDef = (w: Pick<Widget, "source" | "metric">) => SOURCES[w.source]?.metrics.find((m) => m.id === w.metric) ?? SOURCES[w.source]?.metrics[0];

export function formatMetric(v: number | null | undefined, f: MetricFormat) {
  if (v == null || !Number.isFinite(v)) return "n/a";
  if (f === "percent") return `${v.toFixed(v < 10 && v % 1 ? 1 : 0)}%`;
  if (f === "hours") return humanDuration(v * 3600);
  if (f === "score") return v.toFixed(Math.abs(v) < 10 ? 1 : 0);
  return Math.round(v).toLocaleString("en-US");
}

export function defaultWidget(id: string): Widget {
  return { id, title: "Tickets created", source: "tickets", metric: "count", chart: "line", groupBy: "date", range: 30, filters: {}, size: 2 };
}

/** Dashboard templates offered when creating a dashboard. */
export const TEMPLATES: { id: string; name: string; description: string; widgets: Omit<Widget, "id">[] }[] = [
  { id: "blank", name: "Blank", description: "Start empty and add widgets.", widgets: [] },
  {
    id: "support",
    name: "Support performance",
    description: "Volume, response times, SLA and CSAT by channel and agent.",
    widgets: [
      { title: "Tickets created", source: "tickets", metric: "count", chart: "kpi", groupBy: "none", range: 30, filters: {}, size: 1 },
      { title: "Avg first response", source: "tickets", metric: "frt", chart: "kpi", groupBy: "none", range: 30, filters: {}, size: 1 },
      { title: "SLA compliance", source: "tickets", metric: "sla", chart: "kpi", groupBy: "none", range: 30, filters: {}, size: 1 },
      { title: "Tickets per day", source: "tickets", metric: "count", chart: "line", groupBy: "date", range: 30, filters: {}, size: 2 },
      { title: "Tickets by channel", source: "tickets", metric: "count", chart: "donut", groupBy: "channel", range: 30, filters: {}, size: 1 },
      { title: "Solved by agent", source: "tickets", metric: "solved", chart: "bar", groupBy: "agent", range: 30, filters: {}, size: 2 },
      { title: "Tickets by intent", source: "tickets", metric: "count", chart: "table", groupBy: "intent", range: 30, filters: {}, size: 1 },
    ],
  },
  {
    id: "voice",
    name: "Voice of customer",
    description: "Mentions, sentiment, NPS and CSAT trends.",
    widgets: [
      { title: "Mentions", source: "mentions", metric: "count", chart: "kpi", groupBy: "none", range: 30, filters: {}, size: 1 },
      { title: "Net sentiment", source: "mentions", metric: "net", chart: "kpi", groupBy: "none", range: 30, filters: {}, size: 1 },
      { title: "NPS", source: "surveys", metric: "nps", chart: "kpi", groupBy: "none", range: 90, filters: {}, size: 1 },
      { title: "Mentions per day", source: "mentions", metric: "count", chart: "line", groupBy: "date", range: 30, filters: {}, size: 2 },
      { title: "Mentions by sentiment", source: "mentions", metric: "count", chart: "donut", groupBy: "sentiment", range: 30, filters: {}, size: 1 },
      { title: "Mentions by source", source: "mentions", metric: "count", chart: "bar", groupBy: "channel", range: 30, filters: {}, size: 2 },
      { title: "CSAT by survey", source: "surveys", metric: "csat", chart: "table", groupBy: "survey", range: 90, filters: {}, size: 1 },
    ],
  },
];
