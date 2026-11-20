import { query } from "@/lib/db";
import { dailyTrend, days, summary, topAuthors, type MentionRow } from "./analytics";
import { listTopics, type Mention, type Topic } from "./data";
import { LISTEN_SOURCES, SENTIMENTS, type ListenSource } from "./sources";

/**
 * Per-platform listening dashboards (BrandEye-style): one hub card per source and one dashboard per
 * source. Everything is computed from stored real mentions (cx_mentions); nothing is synthesized.
 */

/** Engagement keys that count as interactions. Ratings, owner-reply flags and views are reported separately. */
const INTERACTION_KEYS = ["likes", "reposts", "replies", "comments", "score", "points", "votes"] as const;

/** Sum of interaction counters of one mention; null when the source reports none. */
export function interactions(eng: Record<string, unknown> | null | undefined): number | null {
  let sum = 0;
  let seen = false;
  for (const k of INTERACTION_KEYS) {
    const v = Number(eng?.[k]);
    if (Number.isFinite(v)) {
      sum += v;
      seen = true;
    }
  }
  return seen ? sum : null;
}
export const viewsOf = (eng: Record<string, unknown> | null | undefined) => {
  const v = Number(eng?.views);
  return Number.isFinite(v) ? v : null;
};

export type PlatformPeriod = { days: number; from: string; to: string; label: string; custom: boolean };
export const PERIOD_DAYS = [7, 30, 90] as const;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const validDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

/** Period from ?days= (7/30/90) or a custom ?from=&to= range (max 366 days). Both ends inclusive, UTC days. */
export function readPeriod(sp: Record<string, string | string[] | undefined>, now = new Date()): PlatformPeriod {
  if (validDay(sp.from) && validDay(sp.to) && sp.from <= sp.to) {
    const n = Math.round((Date.parse(sp.to) - Date.parse(sp.from)) / 86400000) + 1;
    if (n <= 366) return { days: n, from: sp.from, to: sp.to, label: `${sp.from} to ${sp.to}`, custom: true };
  }
  const n = PERIOD_DAYS.find((d) => String(d) === sp.days) ?? 7;
  return { days: n, from: isoDay(new Date(now.getTime() - (n - 1) * 86400000)), to: isoDay(now), label: `Last ${n} days`, custom: false };
}

/** Topics that listen on this source ([] sources = every source). */
export const topicsFor = (topics: Topic[], source: string) => topics.filter((t) => t.active && (t.sources.length === 0 || (t.sources as string[]).includes(source)));

// ------------------------------------------------------------------ hub

export type HubCard = {
  source: ListenSource;
  mentions: number;
  allTime: number;
  positive: number;
  neutral: number;
  negative: number;
  authors: number;
  latestAt: string | null;
  spark: number[];
  recent: Pick<Mention, "id" | "url" | "author" | "title" | "body" | "published_at" | "sentiment">[];
};

export async function platformHub(projectId: string, period: PlatformPeriod): Promise<HubCard[]> {
  const range = [projectId, period.from, period.to];
  const [stats, all, daily, recent] = await Promise.all([
    query<{ source: string; n: number; pos: number; neu: number; neg: number; authors: number; latest: string | Date | null }>(
      `SELECT source, count(*)::int n, count(*) FILTER (WHERE sentiment='positive')::int pos, count(*) FILTER (WHERE sentiment='negative')::int neg,
         count(*) FILTER (WHERE sentiment IS NULL OR sentiment NOT IN ('positive','negative'))::int neu,
         count(DISTINCT COALESCE(author_handle, author))::int authors, max(published_at) latest
       FROM cx_mentions WHERE project_id=$1 AND status<>'ignored' AND published_at >= $2::date AND published_at < $3::date + 1 GROUP BY source`,
      range,
    ),
    query<{ source: string; n: number }>("SELECT source, count(*)::int n FROM cx_mentions WHERE project_id=$1 GROUP BY source", [projectId]),
    query<{ source: string; d: string; n: number }>(
      `SELECT source, to_char(published_at AT TIME ZONE 'UTC','YYYY-MM-DD') d, count(*)::int n FROM cx_mentions
       WHERE project_id=$1 AND status<>'ignored' AND published_at >= $2::date AND published_at < $3::date + 1 GROUP BY 1,2`,
      range,
    ),
    query<HubCard["recent"][number] & { source: string }>(
      `SELECT id, source, url, author, title, left(body, 400) body, published_at, sentiment FROM (
         SELECT m.*, row_number() OVER (PARTITION BY source ORDER BY published_at DESC NULLS LAST) rn FROM cx_mentions m
         WHERE project_id=$1 AND status<>'ignored' AND published_at >= $2::date AND published_at < $3::date + 1) x
       WHERE rn <= 5 ORDER BY published_at DESC`,
      range,
    ),
  ]);
  const dayList = days(`${period.to}T00:00:00Z`, period.days);
  return LISTEN_SOURCES.map((source) => {
    const s = stats.find((x) => x.source === source);
    const byDay = new Map(daily.filter((x) => x.source === source).map((x) => [x.d, x.n]));
    return {
      source,
      mentions: s?.n ?? 0,
      allTime: all.find((x) => x.source === source)?.n ?? 0,
      positive: s?.pos ?? 0,
      neutral: s?.neu ?? 0,
      negative: s?.neg ?? 0,
      authors: s?.authors ?? 0,
      latestAt: s?.latest ? new Date(s.latest).toISOString() : null,
      spark: dayList.map((d) => byDay.get(d) ?? 0),
      recent: recent.filter((r) => r.source === source).map((r) => ({ ...r, published_at: r.published_at ? new Date(r.published_at).toISOString() : null })),
    };
  }).sort((a, b) => b.mentions - a.mentions || b.allTime - a.allTime);
}

// ------------------------------------------------------------------ one platform

export type PlatformFilters = { topic?: string; sentiment?: string; q?: string; sort: "newest" | "engagement"; day?: string; page: number };
export function readPlatformFilters(sp: Record<string, string | string[] | undefined>): PlatformFilters {
  const g = (k: string) => (typeof sp[k] === "string" && sp[k] ? (sp[k] as string).slice(0, 200) : undefined);
  const sentiment = g("sentiment");
  return {
    topic: g("topic"),
    sentiment: sentiment && ((SENTIMENTS as readonly string[]).includes(sentiment) || sentiment === "unknown") ? sentiment : undefined,
    q: g("q"),
    sort: g("sort") === "engagement" ? "engagement" : "newest",
    day: validDay(sp.day) ? (sp.day as string) : undefined,
    page: Math.max(1, Math.min(1000, Number(sp.page) || 1)),
  };
}

type Row = MentionRow & { engagement: Record<string, number> };
export type AuthorStat = { author: string; handle: string | null; mentions: number; interactions: number; followers: number | null; negative: number };

export async function platformDashboard(projectId: string, source: ListenSource, period: PlatformPeriod, f: PlatformFilters, pageSize = 40) {
  const topics = await listTopics(projectId);
  // Period stats: platform + period + topic (the feed filters below narrow only the feed, like BrandEye).
  const base: unknown[] = [projectId, source, period.from, period.to];
  let baseSql = "m.project_id=$1 AND m.source=$2 AND m.status<>'ignored' AND m.published_at >= $3::date AND m.published_at < $4::date + 1";
  if (f.topic) {
    base.push(f.topic);
    baseSql += ` AND m.topic_id=$${base.length}`;
  }
  const raw = await query<Row>(
    `SELECT id, topic_id, source, author, author_handle, author_followers, title, body, language, published_at, sentiment, intent, engagement
     FROM cx_mentions m WHERE ${baseSql} ORDER BY published_at LIMIT 20000`,
    base,
  );
  const rows = raw.map((r) => ({ ...r, published_at: r.published_at ? new Date(r.published_at).toISOString() : null }));
  const s = summary(rows);
  const dayList = days(`${period.to}T00:00:00Z`, period.days);
  const trend = dailyTrend(rows, dayList);
  const eng = rows.map((r) => interactions(r.engagement));
  const views = rows.map((r) => viewsOf(r.engagement));
  const hasEng = eng.some((v) => v != null);
  const hasViews = views.some((v) => v != null);

  // Authors with interactions.
  const am = new Map<string, AuthorStat>();
  rows.forEach((r, i) => {
    const k = r.author_handle ?? r.author;
    const a = am.get(k) ?? { author: r.author || "Unknown", handle: r.author_handle, mentions: 0, interactions: 0, followers: null, negative: 0 };
    a.mentions++;
    a.interactions += eng[i] ?? 0;
    if (r.sentiment === "negative") a.negative++;
    if (r.author_followers != null) a.followers = Math.max(a.followers ?? 0, r.author_followers);
    am.set(k, a);
  });
  const authors = [...am.values()];
  const ta = topAuthors(rows, 8);

  // Feed: period + topic + feed filters.
  const params = [...base];
  const conds = [baseSql];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    conds.push(sql.replaceAll("?", `$${params.length}`));
  };
  if (f.sentiment === "unknown") conds.push("(m.sentiment IS NULL OR m.sentiment NOT IN ('positive','neutral','negative'))");
  else if (f.sentiment) add("m.sentiment=?", f.sentiment);
  if (f.q) add("(m.title ILIKE ? OR m.body ILIKE ? OR m.author ILIKE ? OR m.translation ILIKE ?)", `%${f.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
  if (f.day) add("m.published_at >= ?::date AND m.published_at < ?::date + 1", f.day);
  const engSql = `(SELECT COALESCE(sum((e.value)::numeric),0) FROM jsonb_each_text(m.engagement) e WHERE e.key IN (${INTERACTION_KEYS.map((k) => `'${k}'`).join(",")}) AND e.value ~ '^[0-9]+(\\.[0-9]+)?$')`;
  const order = f.sort === "engagement" ? `${engSql} DESC, m.published_at DESC NULLS LAST` : "m.published_at DESC NULLS LAST, m.fetched_at DESC";
  const where = conds.join(" AND ");
  const [{ n }] = await query<{ n: number }>(`SELECT count(*)::int n FROM cx_mentions m WHERE ${where}`, params);
  const feed = await query<Mention>(
    `SELECT m.*, t.name topic_name, t.kind topic_kind, k.number ticket_number FROM cx_mentions m
     LEFT JOIN cx_topics t ON t.id=m.topic_id LEFT JOIN cx_tickets k ON k.id=m.ticket_id
     WHERE ${where} ORDER BY ${order} LIMIT ${pageSize} OFFSET ${(f.page - 1) * pageSize}`,
    params,
  );

  return {
    topics,
    listening: topicsFor(topics, source),
    summary: s,
    neutral: rows.length - s.positive - s.negative,
    interactions: hasEng ? eng.reduce<number>((a, v) => a + (v ?? 0), 0) : null,
    views: hasViews ? views.reduce<number>((a, v) => a + (v ?? 0), 0) : null,
    trend,
    byDay: trend.filter((d) => d.mentions > 0).reverse(),
    authorsByMentions: ta.byMentions.map((a) => am.get(a.handle ?? a.author) ?? { ...a, interactions: 0 }),
    authorsByEngagement: hasEng ? authors.filter((a) => a.interactions > 0).sort((a, b) => b.interactions - a.interactions).slice(0, 8) : [],
    authorsByFollowers: authors.filter((a) => a.followers != null).sort((a, b) => (b.followers ?? 0) - (a.followers ?? 0)).slice(0, 8),
    feed: { total: n, rows: feed, pages: Math.max(1, Math.ceil(n / pageSize)) },
  };
}
