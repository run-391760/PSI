/**
 * One-Click Report (WP-K4): pure, client-safe workbook builders. Each report becomes a list of sheets, one per
 * widget of the on-screen report, plus a "Report" cover sheet with the filters used. Every value comes from the
 * report view models (stored conversations and tickets); unknown values stay empty ("n/a"), never 0.
 * Fixture-tested in tests/cx-k4-oneclick.test.ts.
 */
import type { Cell } from "@/lib/cx/inbox/xlsx";
import {
  bucketLabel, buzzStats, dhm, dmy, firstTimeResolution, FTR_LABEL, hourLabel, rangeLabel, replyTat, SENTIMENT_LABEL, SENTIMENTS, ticketStats, TICKET_TILES, timeSeries,
  type FtrBucket, type Interval, type Msg, type Range, type Sentiment,
} from "./model";

export type Sheet = { name: string; rows: Cell[][] };
export type OneClickReport = "sov" | "sentiment" | "ticketing";
export type OneClickChoice = OneClickReport | "all";

/** Sheet names per report, in workbook order (also listed on the page as "what's inside"). */
export const SOV_SHEETS = ["Buzz Trend", "Buzz Stats", "Overall Sentiment", "Relative Share of Voice", "Top Posts", "Word Cloud"] as const;
export const SENTIMENT_SHEETS = [
  "Sentiment KPIs", "Sentiment Over Time", "Sentiment Peaks", "Overall Sentiment", "Sentiment By Brand", "Most and Least", "By Media Type", "Positive Words", "Negative Words",
  "Current Trends", "Top Positive Posts", "Top Negative Posts",
] as const;
export const TICKETING_SHEETS = ["Ticket Statistics", "Reply TAT", "Ticket Trend", "Ticket Trend Stats", "First Time Resolution", "Ticket Tracker"] as const;

export const ONE_CLICK_REPORTS: { id: OneClickReport; label: string; description: string; source: "conversations" | "tickets"; sheets: readonly string[]; prefix: string }[] = [
  { id: "sov", label: "Share of Voice", description: "Buzz trend, sentiment per scope, relative share, top posts and words.", source: "conversations", sheets: SOV_SHEETS, prefix: "SOV" },
  { id: "sentiment", label: "Sentiment Analysis", description: "KPIs with change, sentiment over time, by brand and media type, words, trends and top posts.", source: "conversations", sheets: SENTIMENT_SHEETS, prefix: "Sentiment" },
  { id: "ticketing", label: "Ticketing", description: "Ticket statistics, reply TAT, ticket trend per profile, first-time resolution and tracker.", source: "tickets", sheets: TICKETING_SHEETS, prefix: "Tickets" },
];
export const isChoice = (v: unknown): v is OneClickChoice => v === "all" || ONE_CLICK_REPORTS.some((r) => r.id === v);

const r1 = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10) / 10);
const share = (n: number, total: number) => (total ? r1((n / total) * 100) : null);
const period = (key: string, interval: Interval) => bucketLabel(key, interval);

// ---------------------------------------------------------------- inputs (structural subsets of the view models)

type Ent = { id: string; name: string };
type Post = { at: string; author: string; handle: string | null; network: string; mediaType: string; sentiment: Sentiment; title: string; text: string; url: string | null };
type Word = { word: string; count: number };
type Counts = { total: number; positive: number; negative: number; neutral: number };
type Row = Record<string, number | string> & { key: string };

export type SovInput = {
  entities: Ent[];
  trend: Row[];
  buzz: { name: string; total: number; avgPerDay: number; peakDate: string | null; peakDateCount: number; peakHour: number | null };
  sentiment: { key: string; positive: number; negative: number; neutral: number }[];
  sov: { total: number; slices: { id: string; name: string; value: number; pct: number }[]; most: { name: string; value: number } | null; least: { name: string; value: number } | null };
  posts: { items: Post[] };
  cloud: { words: Word[] };
};
export type SentimentInput = {
  entities: Ent[];
  kpis: Record<"total" | Sentiment, { value: number; change: number | null }>;
  overTime: { data: Row[]; peaks: { avgPositive: number; avgNegative: number; mostPositiveOn: string | null; mostNegativeOn: string | null } };
  byEntity: (Counts & { key: string; name: string })[];
  extremes: Record<"positive" | "negative", { most: { name: string; count: number; pct: number } | null; least: { name: string; count: number; pct: number } | null }>;
  byMedia: { rows: (Counts & { mediaType: string; pctPositive: number; pctNegative: number; pctNeutral: number })[] };
  clouds: { positive: Word[]; negative: Word[] };
  trends: { label: string; range: Range; counts: Counts; change: Record<Sentiment, number | null> }[];
  top: { positive: Post[]; negative: Post[] };
};

// ---------------------------------------------------------------- ticketing aggregation

/** Ticket rows as loaded by loadTicketRows (only the fields used here). */
export type TicketIn = { ticketId: string | null; at: string; status?: string | null; inQueue?: boolean; agent?: string | null; profile?: string | null };

/** Ticketing report numbers from stored tickets, their messages and reopen counts. */
export function ticketingSummary(rows: TicketIn[], messages: Msg[], reopen: Map<string, number>, range: Range, interval: Interval, profileName: (id: string) => string) {
  const stats = ticketStats(rows.map((r) => ({ status: r.status ?? "", in_queue: !!r.inQueue, assignee_id: r.agent ?? null })));
  const { perTicket: _p, ...tat } = replyTat(messages);
  const counts = new Map<string, number>();
  for (const r of rows) {
    const p = r.profile ?? "unknown";
    counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  const profiles = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([id, total]) => ({ id, name: profileName(id), total }));
  const trend = timeSeries(rows, range, interval, (r) => [r.profile ?? "unknown"], profiles.map((p) => p.id));
  const out = new Map<string, number>();
  for (const m of messages) if (m.direction === "out") out.set(m.ticket_id, (out.get(m.ticket_id) ?? 0) + 1);
  const ftr = firstTimeResolution(
    rows.filter((r) => r.ticketId).map((r) => ({ id: r.ticketId!, status: r.status ?? "", reopen_count: reopen.get(r.ticketId!) ?? 0 })),
    out,
  );
  return { total: rows.length, stats, tat, profiles, trend, buzz: buzzStats(rows, range), ftr };
}
export type TicketingInput = ReturnType<typeof ticketingSummary>;

// ---------------------------------------------------------------- sheet builders

const postRows = (posts: Post[]): Cell[][] => [
  ["Date", "Author", "Handle", "Network", "Media type", "Sentiment", "Title", "Text", "URL"],
  ...posts.map((p) => [dmy(p.at), p.author, p.handle ?? "", p.network, p.mediaType, SENTIMENT_LABEL[p.sentiment], p.title, p.text, p.url ?? ""]),
];
const wordRows = (words: Word[]): Cell[][] => [["Word", "Conversations"], ...words.map((w) => [w.word, w.count])];

export function sovSheets(v: SovInput, interval: Interval): Sheet[] {
  const names = Object.fromEntries(v.entities.map((e) => [e.id, e.name]));
  return [
    {
      name: "Buzz Trend",
      rows: [["Period", ...v.entities.map((e) => e.name), "Total"], ...v.trend.map((r) => {
        const vals = v.entities.map((e) => Number(r[e.id] ?? 0));
        return [period(r.key, interval), ...vals, vals.reduce((s, x) => s + x, 0)];
      })],
    },
    {
      name: "Buzz Stats",
      rows: [
        ["Metric", v.buzz.name],
        ["Total conversations", v.buzz.total],
        ["Average per day", v.buzz.avgPerDay],
        ["Peak date", v.buzz.peakDate ? dmy(v.buzz.peakDate) : "n/a"],
        ["Conversations on peak date", v.buzz.peakDate ? v.buzz.peakDateCount : "n/a"],
        ["Peak time", hourLabel(v.buzz.peakHour)],
      ],
    },
    {
      name: "Overall Sentiment",
      rows: [["Scope", "Positive", "Negative", "Neutral", "Total"], ...v.sentiment.map((r) => [names[r.key] ?? r.key, r.positive, r.negative, r.neutral, r.positive + r.negative + r.neutral])],
    },
    {
      name: "Relative Share of Voice",
      rows: [
        ["Scope", "Conversations", "Share %"],
        ...v.sov.slices.map((s) => [s.name, s.value, r1(s.pct)]),
        ["Total conversation", v.sov.total, v.sov.total ? 100 : null],
        ["Most talked", v.sov.most ? `${v.sov.most.name} (${v.sov.most.value})` : "n/a", null],
        ["Least talked", v.sov.least ? `${v.sov.least.name} (${v.sov.least.value})` : "n/a", null],
      ],
    },
    { name: "Top Posts", rows: postRows(v.posts.items) },
    { name: "Word Cloud", rows: wordRows(v.cloud.words) },
  ];
}

export function sentimentSheets(v: SentimentInput, interval: Interval): Sheet[] {
  const total = v.kpis.total.value;
  const ext = (label: string, x: { name: string; count: number; pct: number } | null): Cell[] => [label, x?.name ?? "n/a", x ? x.count : null, x ? r1(x.pct) : null];
  return [
    {
      name: "Sentiment KPIs",
      rows: [["Metric", "Conversations", "Change vs previous period %"], ["Total", total, r1(v.kpis.total.change)], ...SENTIMENTS.map((s) => [SENTIMENT_LABEL[s], v.kpis[s].value, r1(v.kpis[s].change)])],
    },
    {
      name: "Sentiment Over Time",
      rows: [["Period", ...SENTIMENTS.map((s) => SENTIMENT_LABEL[s])], ...v.overTime.data.map((r) => [period(r.key, interval), ...SENTIMENTS.map((s) => Number(r[s] ?? 0))])],
    },
    {
      name: "Sentiment Peaks",
      rows: [
        ["Metric", "Value"],
        ["Avg positive per day", v.overTime.peaks.avgPositive],
        ["Avg negative per day", v.overTime.peaks.avgNegative],
        ["Most positive on", v.overTime.peaks.mostPositiveOn ? dmy(v.overTime.peaks.mostPositiveOn) : "n/a"],
        ["Most negative on", v.overTime.peaks.mostNegativeOn ? dmy(v.overTime.peaks.mostNegativeOn) : "n/a"],
      ],
    },
    { name: "Overall Sentiment", rows: [["Sentiment", "Conversations", "Share %"], ...SENTIMENTS.map((s) => [SENTIMENT_LABEL[s], v.kpis[s].value, share(v.kpis[s].value, total)])] },
    {
      name: "Sentiment By Brand",
      rows: [["Scope", "Total", "Positive", "Negative", "Neutral", "Positive %", "Negative %", "Neutral %"], ...v.byEntity.map((e) => [e.name, e.total, e.positive, e.negative, e.neutral, share(e.positive, e.total), share(e.negative, e.total), share(e.neutral, e.total)])],
    },
    {
      name: "Most and Least",
      rows: [
        ["Tile", "Scope", "Posts", "Share of its conversations %"],
        ext("Most positive", v.extremes.positive.most),
        ext("Least positive", v.extremes.positive.least),
        ext("Most negative", v.extremes.negative.most),
        ext("Least negative", v.extremes.negative.least),
      ],
    },
    {
      name: "By Media Type",
      rows: [["Media type", "Total", "Positive", "Negative", "Neutral", "Positive %", "Negative %", "Neutral %"], ...v.byMedia.rows.map((m) => [m.mediaType, m.total, m.positive, m.negative, m.neutral, r1(m.pctPositive), r1(m.pctNegative), r1(m.pctNeutral)])],
    },
    { name: "Positive Words", rows: wordRows(v.clouds.positive) },
    { name: "Negative Words", rows: wordRows(v.clouds.negative) },
    {
      name: "Current Trends",
      rows: [
        ["Window", "From", "To", ...SENTIMENTS.flatMap((s) => [SENTIMENT_LABEL[s], `${SENTIMENT_LABEL[s]} change %`])],
        ...v.trends.map((t) => [t.label, dmy(t.range.from), dmy(t.range.to), ...SENTIMENTS.flatMap((s) => [t.counts[s], r1(t.change[s])])]),
      ],
    },
    { name: "Top Positive Posts", rows: postRows(v.top.positive) },
    { name: "Top Negative Posts", rows: postRows(v.top.negative) },
  ];
}

const TRACKER_SKIP = new Set(["total", "assign_pending"]);
export function ticketingSheets(v: TicketingInput, interval: Interval): Sheet[] {
  const tat = (label: string, s: number | null): Cell[] => [label, dhm(s), s == null ? null : Math.round(s)];
  const tracked = TICKET_TILES.filter((t) => !TRACKER_SKIP.has(t.id));
  const trackedTotal = tracked.reduce((s, t) => s + (v.stats[t.id] ?? 0), 0);
  return [
    { name: "Ticket Statistics", rows: [["Status", "Tickets"], ...TICKET_TILES.map((t) => [t.label, v.stats[t.id] ?? 0])] },
    {
      name: "Reply TAT",
      rows: [
        ["Measure", "D : H : M", "Seconds"],
        tat("Average reply TAT", v.tat.average),
        tat("First reply TAT", v.tat.first),
        tat("Second reply TAT", v.tat.second),
        tat("Third reply TAT", v.tat.third),
        ["Average replies per ticket", v.tat.averageReplies == null ? "n/a" : String(r1(v.tat.averageReplies)), null],
        ["Replies measured", String(v.tat.measured), null],
      ],
    },
    {
      name: "Ticket Trend",
      rows: [["Period", ...v.profiles.map((p) => p.name), "Total"], ...v.trend.map((r) => {
        const vals = v.profiles.map((p) => Number(r[p.id] ?? 0));
        return [period(r.key, interval), ...vals, vals.reduce((s, x) => s + x, 0)];
      })],
    },
    {
      name: "Ticket Trend Stats",
      rows: [
        ["Metric", "Value"],
        ["Total tickets", v.buzz.total],
        ["Average tickets per day", v.buzz.avgPerDay],
        ["Peak date", v.buzz.peakDate ? dmy(v.buzz.peakDate) : "n/a"],
        ["Tickets on peak date", v.buzz.peakDate ? v.buzz.peakDateCount : "n/a"],
        ["Peak time", hourLabel(v.buzz.peakHour)],
        ...v.profiles.map((p) => [`Tickets - ${p.name}`, p.total] as Cell[]),
      ],
    },
    {
      name: "First Time Resolution",
      rows: [
        ["Outcome", "Tickets"],
        ...(Object.keys(FTR_LABEL) as FtrBucket[]).map((k) => [FTR_LABEL[k], v.ftr.counts[k]]),
        ["First-time resolution rate %", v.ftr.rate == null ? "n/a" : r1(v.ftr.rate)],
      ],
    },
    { name: "Ticket Tracker", rows: [["Status", "Tickets", "Share %"], ...tracked.map((t) => [t.label, v.stats[t.id] ?? 0, share(v.stats[t.id] ?? 0, trackedTotal)]), ["Total", trackedTotal, trackedTotal ? 100 : null]] },
  ];
}

// ---------------------------------------------------------------- workbook assembly

export type CoverInfo = { report: string; brand: string; range: Range; scope: string; media: string[]; basis: "publish" | "created"; interval: Interval; generatedAt: Date };
export function coverSheet(c: CoverInfo): Sheet {
  return {
    name: "Report",
    rows: [
      ["Field", "Value"],
      ["Report", c.report],
      ["Brand", c.brand],
      ["Period", rangeLabel(c.range)],
      ["Scope", c.scope],
      ["Media types", c.media.length ? c.media.join(", ") : "All"],
      ["Date basis", c.basis === "created" ? "Created date" : "Publish date"],
      ["Interval", c.interval === "week" ? "Weekly" : c.interval === "month" ? "Monthly" : "Daily"],
      ["Generated (UTC)", c.generatedAt.toISOString().slice(0, 16).replace("T", " ")],
      ["Source", "Stored listening mentions and tickets of this brand"],
    ],
  };
}

/** Excel sheet names: at most 31 characters, no []:*?/\ and unique (case-insensitive). */
export function uniqueSheetNames(sheets: Sheet[]): Sheet[] {
  const used = new Set<string>();
  return sheets.map((s, i) => {
    const base = s.name.replace(/[\\/?*[\]:]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) || `Sheet${i + 1}`;
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base.slice(0, 31 - String(n).length - 1)} ${n}`;
    used.add(name.toLowerCase());
    return { ...s, name };
  });
}

/** Prefix sheet names with the report (combined "all reports" workbook). */
export const prefixed = (prefix: string, sheets: Sheet[]) => sheets.map((s) => ({ ...s, name: `${prefix} - ${s.name}` }));

/** Download file name, e.g. "acme-share-of-voice-2026-09-01-to-2026-09-30.xlsx". */
export function workbookName(brand: string, report: string, range: Range) {
  const slug = (s: string) => s.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "report";
  return `${slug(brand)}-${slug(report)}-${range.from}-to-${range.to}.xlsx`;
}
