/**
 * CX Reports (WP-K4): pure, client-safe aggregation and drill-down logic. No DB access; fixture-tested in
 * tests/cx-k4.test.ts. Every number is computed from stored rows; unknown values are null ("n/a"), never 0.
 *
 * Times: rows carry `at` already shifted to the brand's local time and written as a UTC ISO string, so all
 * bucketing here is plain UTC math (bucket "2026-09-29" is the local day).
 */
import { tokenize } from "@/lib/cx/listening/analytics";
import { parseRule } from "@/lib/cx/listening/sources";
import { bucketKey, bucketKeys } from "@/lib/cx/insights/reports-math";

export { bucketKey, bucketKeys };

// ---------------------------------------------------------------- basics

export type Sentiment = "positive" | "negative" | "neutral";
export const SENTIMENTS: Sentiment[] = ["positive", "negative", "neutral"];
export const SENTIMENT_LABEL: Record<Sentiment, string> = { positive: "Positive", negative: "Negative", neutral: "Neutral" };
/** Sentiment is a meaning, so it uses the status colors (always with a label); neutral uses the first series slot. */
export const SENTIMENT_COLOR: Record<Sentiment, string> = { positive: "var(--good)", negative: "var(--critical)", neutral: "var(--series-1)" };
export const asSentiment = (s: string | null | undefined): Sentiment => (s === "positive" || s === "negative" ? s : "neutral");

export type Interval = "day" | "week" | "month";
export const INTERVALS: { id: Interval; label: string }[] = [
  { id: "day", label: "Daily" },
  { id: "week", label: "Weekly" },
  { id: "month", label: "Monthly" },
];
export const isInterval = (v: unknown): v is Interval => v === "day" || v === "week" || v === "month";
export type Basis = "publish" | "created";

/** Inclusive local date range, yyyy-mm-dd. */
export type Range = { from: string; to: string };
const DAY = 86400000;
const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const ms = (day: string) => Date.parse(`${day}T00:00:00Z`);

/** Report range from ?from=&to= (local dates). Defaults to the last 7 days ending `today`; at most 366 days. */
export function parseRange(sp: { from?: unknown; to?: unknown }, today: string, defDays = 7): Range {
  let to = isDay(sp.to) ? (sp.to as string) : today;
  let from = isDay(sp.from) ? (sp.from as string) : dayOf(ms(to) - (defDays - 1) * DAY);
  if (ms(from) > ms(to)) [from, to] = [to, from];
  if ((ms(to) - ms(from)) / DAY > 365) from = dayOf(ms(to) - 365 * DAY);
  return { from, to };
}
export const rangeDays = (r: Range) => Math.round((ms(r.to) - ms(r.from)) / DAY) + 1;
/** The equal-length period immediately before `r`. */
export function previousRange(r: Range): Range {
  const n = rangeDays(r);
  return { from: dayOf(ms(r.from) - n * DAY), to: dayOf(ms(r.from) - DAY) };
}
/** Whether a local ISO instant falls inside the inclusive day range. */
export const inRange = (at: string, r: Range) => {
  const d = at.slice(0, 10);
  return d >= r.from && d <= r.to;
};
/** "29/09/2026" from "2026-09-29" (or a "2026-09" month key → "09/2026"). */
export function dmy(key: string) {
  if (/^\d{4}-\d{2}-\d{2}/.test(key)) return `${key.slice(8, 10)}/${key.slice(5, 7)}/${key.slice(0, 4)}`;
  if (/^\d{4}-\d{2}$/.test(key)) return `${key.slice(5, 7)}/${key.slice(0, 4)}`;
  return key;
}
export const rangeLabel = (r: Range) => `${dmy(r.from)} - ${dmy(r.to)}`;
/** "6:00 PM" from an hour 0–23. */
export function hourLabel(h: number | null) {
  if (h == null) return "n/a";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:00 ${h < 12 ? "AM" : "PM"}`;
}
export function bucketLabel(key: string, interval: Interval) {
  return interval === "week" ? `Week of ${dmy(key)}` : dmy(key);
}

/** Percent change; null when there is no previous value to compare with. */
export function pctChange(cur: number | null | undefined, prev: number | null | undefined) {
  if (cur == null || prev == null || prev === 0) return null;
  return ((cur - prev) / prev) * 100;
}
/** "0D : 2H : 22M" (rounded down to minutes); "n/a" when unknown. */
export function dhm(seconds: number | null | undefined) {
  if (seconds == null || !Number.isFinite(seconds)) return "n/a";
  const m = Math.floor(Math.max(0, seconds) / 60);
  return `${Math.floor(m / 1440)}D : ${Math.floor((m % 1440) / 60)}H : ${m % 60}M`;
}

// ---------------------------------------------------------------- rows

/** One conversation (listening mention or ticket) normalized for reports. */
export type RRow = {
  id: string;
  kind: "mention" | "ticket";
  /** Local-time ISO instant used for bucketing (publish or created basis). */
  at: string;
  sentiment: Sentiment;
  /** Scope entities (cluster/topic/profile ids) this row belongs to. */
  entities: string[];
  mediaType: string;
  /** Network / source key used for the avatar badge (news, mastodon, email, facebook…). */
  network: string;
  author: string;
  handle: string | null;
  avatar: string | null;
  title: string;
  text: string;
  url: string | null;
  ticketId: string | null;
  ticketNumber: number | null;
  mentionId: string | null;
  engagement: number | null;
  score: number | null;
  /** Ticket-only: effective CRM status, channel (profile) id, assignee id. */
  status?: string | null;
  profile?: string | null;
  agent?: string | null;
  inQueue?: boolean;
};
export type Entity = { id: string; name: string; kind: "cluster" | "topic" | "profile" | "brand" | "owned" | "other" };

export function sentimentCounts(rows: Pick<RRow, "sentiment">[]) {
  const c = { total: rows.length, positive: 0, negative: 0, neutral: 0 };
  for (const r of rows) c[r.sentiment]++;
  return c;
}
export type SentCounts = ReturnType<typeof sentimentCounts>;

/** Per-entity sentiment counts, in entity order (a row in two entities counts in both). */
export function entityCounts(rows: Pick<RRow, "entities" | "sentiment">[], entities: Entity[]) {
  return entities.map((e) => ({ ...e, ...sentimentCounts(rows.filter((r) => r.entities.includes(e.id))) }));
}

/** Continuous time series of counts per bucket for each series key. */
export function timeSeries<T extends { at: string }>(rows: T[], range: Range, interval: Interval, seriesOf: (r: T) => string[], keys: string[]) {
  const buckets = bucketKeys(new Date(`${range.from}T00:00:00Z`), new Date(`${range.to}T23:59:59Z`), interval);
  const by = new Map(buckets.map((b) => [b, Object.fromEntries(keys.map((k) => [k, 0])) as Record<string, number>]));
  for (const r of rows) {
    const b = by.get(bucketKey(r.at, interval));
    if (!b) continue;
    for (const k of seriesOf(r)) if (k in b) b[k]++;
  }
  return buckets.map((key) => ({ ...by.get(key)!, key }) as Record<string, number | string> & { key: string });
}

/** Buzz stats: total, average per day, peak day and peak hour of day (local). */
export function buzzStats(rows: Pick<RRow, "at">[], range: Range) {
  const days = new Map<string, number>(), hours = new Array<number>(24).fill(0);
  for (const r of rows) {
    days.set(r.at.slice(0, 10), (days.get(r.at.slice(0, 10)) ?? 0) + 1);
    hours[new Date(r.at).getUTCHours()]++;
  }
  let peakDate: string | null = null, best = 0;
  for (const [d, n] of [...days.entries()].sort((a, b) => a[0].localeCompare(b[0]))) if (n > best) [peakDate, best] = [d, n];
  const maxH = Math.max(...hours);
  return {
    total: rows.length,
    avgPerDay: rows.length ? Math.round(rows.length / rangeDays(range)) : 0,
    peakDate,
    peakDateCount: best,
    peakHour: rows.length ? hours.indexOf(maxH) : null,
  };
}

/** Relative share of voice: slices with %, plus the most and least talked-about entity (ties → first). */
export function shareOfVoice(counts: { id: string; name: string; total: number }[]) {
  const sum = counts.reduce((s, c) => s + c.total, 0);
  const slices = counts.map((c) => ({ id: c.id, name: c.name, value: c.total, pct: sum ? (c.total / sum) * 100 : 0 }));
  const live = slices.filter((s) => s.value > 0);
  const most = live.length ? live.reduce((a, b) => (b.value > a.value ? b : a)) : null;
  const least = live.length ? live.reduce((a, b) => (b.value < a.value ? b : a)) : null;
  return { total: sum, slices, most, least };
}

/** Days of the period with the most positive / most negative conversations (null when none). */
export function sentimentPeaks(rows: Pick<RRow, "at" | "sentiment">[], range: Range) {
  const by = (s: Sentiment) => {
    const m = new Map<string, number>();
    for (const r of rows) if (r.sentiment === s) m.set(r.at.slice(0, 10), (m.get(r.at.slice(0, 10)) ?? 0) + 1);
    let day: string | null = null, n = 0;
    for (const [d, c] of [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))) if (c > n) [day, n] = [d, c];
    return day;
  };
  const c = sentimentCounts(rows);
  const days = rangeDays(range);
  return { avgPositive: Math.round(c.positive / days), avgNegative: Math.round(c.negative / days), mostPositiveOn: by("positive"), mostNegativeOn: by("negative") };
}

/**
 * MOST/LEAST POSITIVE/NEGATIVE tiles: the entity with the most / least posts of that sentiment, as a count and as
 * a share of the entity's own conversations. Entities without conversations are skipped.
 */
export function extremes(counts: (Entity & SentCounts)[], s: "positive" | "negative") {
  const live = counts.filter((c) => c.total > 0);
  if (!live.length) return { most: null, least: null };
  const pick = (cmp: (a: number, b: number) => boolean) => live.reduce((a, b) => (cmp(b[s], a[s]) ? b : a));
  const shape = (c: Entity & SentCounts) => ({ id: c.id, name: c.name, count: c[s], pct: (c[s] / c.total) * 100 });
  return { most: shape(pick((a, b) => a > b)), least: shape(pick((a, b) => a < b)) };
}

/** Counts per media type with sentiment split and percentages (largest first). */
export function byMediaType(rows: Pick<RRow, "mediaType" | "sentiment">[]) {
  const m = new Map<string, SentCounts>();
  for (const r of rows) {
    const c = m.get(r.mediaType) ?? { total: 0, positive: 0, negative: 0, neutral: 0 };
    c.total++;
    c[r.sentiment]++;
    m.set(r.mediaType, c);
  }
  return [...m.entries()]
    .map(([mediaType, c]) => ({ mediaType, ...c, pctPositive: (c.positive / c.total) * 100, pctNegative: (c.negative / c.total) * 100, pctNeutral: (c.neutral / c.total) * 100 }))
    .sort((a, b) => b.total - a.total || a.mediaType.localeCompare(b.mediaType));
}

/** Convert count rows into 100%-stacked percentages over the visible keys (hidden keys are excluded). */
export function toPercent<T extends Record<string, unknown>>(rows: T[], keys: string[]) {
  return rows.map((r) => {
    const sum = keys.reduce((s, k) => s + (Number(r[k]) || 0), 0);
    const out: Record<string, unknown> = { ...r };
    for (const k of keys) out[k] = sum ? Math.round(((Number(r[k]) || 0) / sum) * 1000) / 10 : 0;
    return out as T;
  });
}

/**
 * Sentiment Current Trends: the 7 days ending `to`, the 7 before ("past") and the 7 before that ("previous"),
 * each with counts per sentiment and % change against the next older 7 days (the 4th window is only a base).
 */
export function currentTrends(rows: Pick<RRow, "at" | "sentiment">[], to: string) {
  const end = ms(to);
  const win = (i: number): Range => ({ from: dayOf(end - (7 * i + 6) * DAY), to: dayOf(end - 7 * i * DAY) });
  const windows = [0, 1, 2, 3].map((i) => ({ range: win(i), counts: sentimentCounts(rows.filter((r) => inRange(r.at, win(i)))) }));
  const names = ["Current 7 days", "Past 7 days", "Previous 7 days"];
  return names.map((label, i) => ({
    label,
    range: windows[i].range,
    counts: windows[i].counts,
    change: Object.fromEntries(SENTIMENTS.map((s) => [s, pctChange(windows[i].counts[s], windows[i + 1].counts[s])])) as Record<Sentiment, number | null>,
  }));
}

/** Words of the topics' own keyword rules (excluded from word clouds). */
export function ownWords(keywordRules: string[]) {
  return new Set(keywordRules.flatMap((k) => parseRule(k).flat().flatMap((p) => [p, ...p.split(" ")])).filter(Boolean));
}

/** Word cloud by document frequency (each word counted once per conversation), largest first. */
export function wordCloud(rows: Pick<RRow, "title" | "text">[], exclude: Set<string> = new Set(), limit = 60) {
  const df = new Map<string, number>();
  for (const r of rows) for (const w of new Set(tokenize(`${r.title} ${r.text}`))) if (!exclude.has(w)) df.set(w, (df.get(w) ?? 0) + 1);
  return [...df.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([word, count]) => ({ word, count }));
}

/** Rows whose text contains the word as a token (case-insensitive) — the drill-down of a word-cloud word. */
export const hasWord = (r: Pick<RRow, "title" | "text">, word: string) => tokenize(`${r.title} ${r.text}`).includes(word.toLowerCase());

/** Top posts of a sentiment: strongest score first, then engagement, then newest. */
export function topPosts<T extends Pick<RRow, "sentiment" | "score" | "engagement" | "at">>(rows: T[], s: Sentiment, limit = 20) {
  return rows
    .filter((r) => r.sentiment === s)
    .sort((a, b) => Math.abs(b.score ?? 0) - Math.abs(a.score ?? 0) || (b.engagement ?? -1) - (a.engagement ?? -1) || b.at.localeCompare(a.at))
    .slice(0, limit);
}

/** Total engagement of a mention from its stored counters (ratings and vote counts are not engagement). */
export function engagementOf(e: Record<string, unknown> | null | undefined) {
  if (!e) return null;
  let sum = 0, any = false;
  for (const [k, v] of Object.entries(e)) {
    if (k === "rating" || k === "votes") continue;
    const n = Number(v);
    if (Number.isFinite(n)) [sum, any] = [sum + n, true];
  }
  return any ? sum : null;
}

/** Media type of a listening mention from its source: the shared ops mapping (same ids the inbox filters use). */
export { mentionMediaType } from "@/lib/cx/ops/model";

// ---------------------------------------------------------------- tickets

export type TRow = {
  id: string;
  number: number;
  created_at: string;
  status: string;
  in_queue: boolean;
  assignee_id: string | null;
  resolved_at: string | null;
  reopen_count: number;
};
export const TICKET_TILES: { id: string; label: string; info?: string }[] = [
  { id: "total", label: "Total tickets" },
  { id: "open", label: "Open", info: "New, open and reopened tickets nobody has picked up" },
  { id: "wip", label: "WIP" },
  { id: "follow_up", label: "Follow up" },
  { id: "assigned", label: "Assigned", info: "Open with an assignee and no reply yet" },
  { id: "assign_pending", label: "Assign pending", info: "Waiting in the assignment queue" },
  { id: "responded", label: "Responded", info: "Last message is from the team" },
  { id: "pending", label: "Pending", info: "Waiting for the customer (shown where other tools have FYI)" },
  { id: "on_hold", label: "On hold", info: "Waiting on a third party" },
  { id: "ignored", label: "Ignored" },
  { id: "solved", label: "Resolved" },
  { id: "closed", label: "Closed" },
];
/** Which tile a ticket's effective CRM status counts under ("open" groups new/open/reopened). */
export const statusTile = (s: string) => (s === "new" || s === "reopened" ? "open" : s);
export function ticketStats(rows: Pick<TRow, "status" | "in_queue" | "assignee_id">[]) {
  const c: Record<string, number> = Object.fromEntries(TICKET_TILES.map((t) => [t.id, 0]));
  c.total = rows.length;
  for (const r of rows) {
    const k = statusTile(r.status);
    if (k in c && k !== "total") c[k]++;
    if (r.in_queue && !r.assignee_id) c.assign_pending++;
  }
  return c;
}
/** Whether a ticket row matches a ticket tile (the drill-down of a tile). */
export function matchesTile(r: { status?: string | null; in_queue?: boolean; assignee_id?: string | null }, tile: string) {
  if (tile === "total") return true;
  if (tile === "assign_pending") return !!r.in_queue && !r.assignee_id;
  return statusTile(r.status ?? "") === tile;
}

export type Msg = { ticket_id: string; direction: "in" | "out" | "note"; created_at: string };
/**
 * Reply turnaround per ticket: every customer run → next agent reply (notes ignored), numbered per ticket.
 * Returns the average of all replies, of the 1st/2nd/3rd reply of each ticket, and average replies per ticket
 * (over tickets with at least one reply). Seconds; null when nothing was measured.
 */
export function replyTat(messages: Msg[]) {
  const by = new Map<string, Msg[]>();
  for (const m of messages) if (m.direction !== "note") by.set(m.ticket_id, [...(by.get(m.ticket_id) ?? []), m]);
  const all: number[] = [], nth: number[][] = [[], [], []];
  const replies: number[] = [];
  const perTicket = new Map<string, number[]>();
  for (const [id, list] of by) {
    list.sort((a, b) => a.created_at.localeCompare(b.created_at));
    let waiting: Msg | null = null, out = 0;
    const tats: number[] = [];
    for (const m of list) {
      if (m.direction === "in") waiting ??= m;
      else {
        out++;
        if (waiting) {
          tats.push((Date.parse(m.created_at) - Date.parse(waiting.created_at)) / 1000);
          waiting = null;
        }
      }
    }
    tats.forEach((s, i) => {
      all.push(s);
      if (i < 3) nth[i].push(s);
    });
    if (out) replies.push(out);
    perTicket.set(id, tats);
  }
  const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
  return { average: avg(all), first: avg(nth[0]), second: avg(nth[1]), third: avg(nth[2]), averageReplies: avg(replies), measured: all.length, perTicket };
}

/** Agent replies per ticket (out messages), for first-time resolution. */
export function outCounts(messages: Msg[]) {
  const m = new Map<string, number>();
  for (const x of messages) if (x.direction === "out") m.set(x.ticket_id, (m.get(x.ticket_id) ?? 0) + 1);
  return m;
}
export type FtrBucket = "first" | "multi" | "noreply" | "open";
export const FTR_LABEL: Record<FtrBucket, string> = { first: "Resolved on first reply", multi: "Needed more replies", noreply: "Resolved without a reply", open: "Not resolved yet" };
/** First-time resolution bucket of a ticket: resolved after exactly one agent reply and never reopened. */
export function ftrBucket(t: Pick<TRow, "status" | "reopen_count">, replies: number): FtrBucket {
  const resolved = ["solved", "closed", "ignored"].includes(t.status);
  if (!resolved) return "open";
  if (replies === 0) return "noreply";
  return replies === 1 && !t.reopen_count ? "first" : "multi";
}
export function firstTimeResolution(tickets: Pick<TRow, "id" | "status" | "reopen_count">[], replies: Map<string, number>) {
  const c: Record<FtrBucket, number> = { first: 0, multi: 0, noreply: 0, open: 0 };
  for (const t of tickets) c[ftrBucket(t, replies.get(t.id) ?? 0)]++;
  const decided = c.first + c.multi;
  return { counts: c, rate: decided ? (c.first / decided) * 100 : null };
}

// ---------------------------------------------------------------- drill-down

export type DrillSource = "mentions" | "tickets" | "conversations" | "tasks" | "surveys";
/** Serializable description of a chart slice; the server re-runs the report query and filters with it. */
export type DrillSpec = {
  source: DrillSource;
  title: string;
  range: Range;
  basis?: Basis;
  /** Serialized report filters (scope selection, media types…) as a query string, re-resolved on the server. */
  filters?: string;
  interval?: Interval;
  // dimension values (all optional; every one present must match)
  entity?: string;
  sentiment?: Sentiment;
  mediaType?: string;
  bucket?: string;
  /** Override the date range (e.g. a Current Trends window). */
  window?: Range;
  /** Ticket tile id, or several joined with "," (any matches). */
  status?: string;
  profile?: string;
  agent?: string;
  word?: string;
  classification?: string;
  ftr?: FtrBucket;
  /** One row id ("m:<mention id>" / "t:<ticket id>"), e.g. a top-post list row. */
  item?: string;
  /** Free-form dimensions for tasks/surveys (status, priority, score…). */
  dims?: Record<string, string>;
};
export type DimKey = "item" | "entity" | "sentiment" | "mediaType" | "bucket" | "status" | "profile" | "agent" | "word" | "classification" | "ftr" | `dims.${string}`;
/** A chart's declarative drill mapping: the base spec plus which dimension its series and x values set. */
export type DrillMap = { base: Omit<DrillSpec, "title">; series?: DimKey; x?: DimKey };

/** Set one dimension on a spec (immutable). */
export function withDim(spec: Omit<DrillSpec, "title">, dim: DimKey | undefined, value: string): Omit<DrillSpec, "title"> {
  if (!dim) return spec;
  if (dim.startsWith("dims.")) return { ...spec, dims: { ...(spec.dims ?? {}), [dim.slice(5)]: value } };
  if (dim === "sentiment") return { ...spec, sentiment: asSentiment(value) };
  if (dim === "ftr") return { ...spec, ftr: value as FtrBucket };
  return { ...spec, [dim]: value };
}
/** Build the spec for a clicked mark: series value, then x value, and a title naming the slice. */
export function drillFor(map: DrillMap, parts: { series?: string; x?: string; title: (string | null | undefined)[] }): DrillSpec {
  let s = map.base;
  if (parts.series != null) s = withDim(s, map.series, parts.series);
  if (parts.x != null) s = withDim(s, map.x, parts.x);
  return { ...s, title: drillTitle(parts.title) };
}
export const drillTitle = (parts: (string | null | undefined)[]) => parts.filter((p) => p != null && p !== "").join(" · ") || "Details";

/** Date window of a spec: an explicit window, else the bucket (day/week/month), else the report range. */
export function drillWindow(spec: Pick<DrillSpec, "range" | "window" | "bucket" | "interval">): Range {
  if (spec.window) return spec.window;
  if (spec.bucket && /^\d{4}-\d{2}-\d{2}$/.test(spec.bucket)) {
    if (spec.interval === "week") return { from: spec.bucket, to: dayOf(ms(spec.bucket) + 6 * DAY) };
    return { from: spec.bucket, to: spec.bucket };
  }
  if (spec.bucket && /^\d{4}-\d{2}$/.test(spec.bucket)) {
    const start = ms(`${spec.bucket}-01`);
    const next = new Date(start);
    next.setUTCMonth(next.getUTCMonth() + 1);
    return { from: dayOf(start), to: dayOf(next.getTime() - DAY) };
  }
  return spec.range;
}

/** Whether a conversation row belongs to the slice described by `spec` (mentions/tickets/conversations). */
export function drillMatches(r: RRow, spec: DrillSpec) {
  if (spec.source === "mentions" && r.kind !== "mention") return false;
  if (spec.source === "tickets" && r.kind !== "ticket") return false;
  if (spec.item && r.id !== spec.item) return false;
  if (!inRange(r.at, drillWindow(spec))) return false;
  if (spec.entity && !r.entities.includes(spec.entity)) return false;
  if (spec.sentiment && r.sentiment !== spec.sentiment) return false;
  if (spec.mediaType && r.mediaType !== spec.mediaType) return false;
  if (spec.profile && r.profile !== spec.profile) return false;
  if (spec.agent && (spec.agent === "none" ? r.agent : r.agent !== spec.agent)) return false;
  if (spec.status && !spec.status.split(",").some((st) => matchesTile({ status: r.status, in_queue: r.inQueue, assignee_id: r.agent }, st))) return false;
  if (spec.word && !hasWord(r, spec.word)) return false;
  return true;
}

/** Refine within a slice from the drawer's filter: text search, sentiment, media type. */
export type Refine = { q?: string; sentiment?: Sentiment | ""; mediaType?: string };
export function refineMatches(r: Pick<RRow, "title" | "text" | "author" | "handle" | "sentiment" | "mediaType">, f: Refine | undefined) {
  if (!f) return true;
  if (f.sentiment && r.sentiment !== f.sentiment) return false;
  if (f.mediaType && r.mediaType !== f.mediaType) return false;
  const q = f.q?.trim().toLowerCase();
  if (q && !`${r.title} ${r.text} ${r.author} ${r.handle ?? ""}`.toLowerCase().includes(q)) return false;
  return true;
}

/** Page of a list (1-based) with a next-page marker for infinite scroll. */
export function pageOf<T>(xs: T[], page: number, size: number) {
  const p = Math.max(1, Math.floor(page) || 1);
  const items = xs.slice((p - 1) * size, p * size);
  return { items, total: xs.length, nextPage: p * size < xs.length ? p + 1 : null };
}
