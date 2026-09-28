/** BI widget catalogue (client-safe): data sources, metrics, groupings, chart types. */
import { humanDuration } from "./metrics";
export type Source = "tickets" | "messages" | "mentions" | "surveys" | "qa";
export type ChartType = "kpi" | "line" | "bar" | "donut" | "table" | "compare" | "stacked" | "cloud";
export type BaseGroupBy = "none" | "date" | "channel" | "agent" | "tag" | "sentiment" | "intent" | "priority" | "status" | "direction" | "survey" | "scorecard";
/** `field:<key>` groups tickets by an Additional/Custom field value (fields from the Admin package). */
export type GroupBy = BaseGroupBy | `field:${string}`;
export type MetricFormat = "number" | "hours" | "percent" | "score";
export type WidgetFilters = { channel?: string; sentiment?: string; priority?: string; status?: string; tag?: string };
/** Classification / field filters (resolved in JS against ticket field values). */
export type FieldFilter = { key: string; value: string };
export type DashboardFilters = WidgetFilters & { fields?: FieldFilter[]; classificationIds?: string[] };
export type Widget = {
  id: string;
  title: string;
  source: Source;
  metric: string;
  chart: ChartType;
  groupBy: GroupBy;
  /** Trailing days (ignored when `from` and `to` are set). */
  range: number;
  /** Custom date range (YYYY-MM-DD, inclusive). */
  from?: string;
  to?: string;
  fields?: FieldFilter[];
  classificationIds?: string[];
  filters: WidgetFilters;
  /** Grid width: 1 = one third, 2 = two thirds, 3 = full row. */
  size: 1 | 2 | 3;
};
export type WidgetResult = {
  rows: { key: string; value: number | null }[];
  total: number | null;
  previous: number | null;
  error?: string;
  /** Multi-series rows (compare / stacked charts): { key, <series>: value }. */
  multi?: { series: { key: string; label: string }[]; rows: Record<string, string | number | null>[] };
  /** Phrase cloud terms. */
  terms?: { term: string; count: number }[];
};

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
      { id: "queue", label: "Queue by status (open / pending / on hold / reopened)", format: "number", additive: true },
      { id: "sentscale", label: "Sentiment scale (0–100)", format: "score", additive: false },
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
      { id: "phrases", label: "Top 2–3 word phrases (customer messages)", format: "number", additive: true },
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
      { id: "phrases", label: "Top 2–3 word phrases", format: "number", additive: true },
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

export const groupLabel = (g: GroupBy, fields: { key: string; label: string }[] = []) => (g.startsWith("field:") ? fields.find((f) => `field:${f.key}` === g)?.label ?? g.slice(6) : GROUP_LABELS[g as BaseGroupBy] ?? g);
export const GROUP_LABELS: Record<BaseGroupBy, string> = {
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
export const CHART_LABELS: Record<ChartType, string> = {
  kpi: "KPI tile",
  line: "Line chart",
  bar: "Bar chart",
  donut: "Donut",
  table: "Table",
  compare: "Volume vs same period last year",
  stacked: "Stacked bars (agent queue)",
  cloud: "Phrase cloud",
};
/** Charts that only make sense for some metrics. */
export function chartsFor(source: Source, metric: string): ChartType[] {
  if (metric === "phrases") return ["cloud", "table"];
  if (metric === "queue") return ["stacked", "table"];
  const base: ChartType[] = ["kpi", "line", "bar", "donut", "table"];
  return metricDef({ source, metric })?.additive ? [...base, "compare"] : base;
}
export const THEMES: { id: string; label: string; colors: string[] }[] = [
  { id: "default", label: "Default", colors: [] },
  { id: "ocean", label: "Ocean", colors: ["#0e7490", "#2563eb", "#0891b2", "#4f46e5", "#0d9488", "#64748b"] },
  { id: "sunset", label: "Sunset", colors: ["#ea580c", "#db2777", "#d97706", "#9333ea", "#dc2626", "#78716c"] },
  { id: "forest", label: "Forest", colors: ["#15803d", "#65a30d", "#0f766e", "#a16207", "#4d7c0f", "#57534e"] },
  { id: "mono", label: "Monochrome", colors: ["#334155", "#64748b", "#94a3b8", "#1e293b", "#475569", "#cbd5e1"] },
];
/** CSS variables that recolor chart series for a theme (empty for the default theme). */
export function themeVars(theme: string): Record<string, string> {
  const t = THEMES.find((x) => x.id === theme);
  return Object.fromEntries((t?.colors ?? []).map((c, i) => [`--series-${i + 1}`, c]));
}
/** Human description of a widget's date window. */
export function rangeLabel(w: Pick<Widget, "range" | "from" | "to">) {
  return w.from && w.to ? `${w.from} to ${w.to}` : `last ${w.range} days`;
}
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
