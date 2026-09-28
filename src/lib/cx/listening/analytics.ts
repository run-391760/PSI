import { parseRule } from "./sources";

/**
 * Listening dashboard aggregations over stored mentions (pure). Every number is a count of stored
 * real mentions; reach uses author follower counts only where the source provides them.
 */
export type MentionRow = {
  id: string;
  topic_id: string | null;
  source: string;
  author: string;
  author_handle: string | null;
  author_followers: number | null;
  title: string;
  body: string;
  language: string | null;
  published_at: string | null;
  sentiment: string | null;
  intent: string | null;
};
export type TopicRef = { id: string; name: string; kind: string; keywords: string[] };

const DAY = 86400000;
const dayKey = (d: Date) => d.toISOString().slice(0, 10);

export function days(endIso: string, n: number) {
  const end = new Date(`${endIso.slice(0, 10)}T00:00:00Z`).getTime();
  return Array.from({ length: n }, (_, i) => dayKey(new Date(end - (n - 1 - i) * DAY)));
}

export function countBy<T>(rows: T[], key: (r: T) => string | null | undefined) {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = key(r) || "unknown";
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].map(([k, v]) => ({ key: k, count: v })).sort((a, b) => b.count - a.count);
}

export function summary(rows: MentionRow[]) {
  const pos = rows.filter((r) => r.sentiment === "positive").length;
  const neg = rows.filter((r) => r.sentiment === "negative").length;
  const withReach = rows.filter((r) => r.author_followers != null);
  const authors = new Set(rows.map((r) => `${r.source}:${r.author_handle ?? r.author}`));
  return {
    mentions: rows.length,
    positive: pos,
    negative: neg,
    negativeShare: rows.length ? neg / rows.length : null,
    netSentiment: pos + neg ? ((pos - neg) / (pos + neg)) * 100 : null,
    reach: withReach.length ? withReach.reduce((a, r) => a + (r.author_followers ?? 0), 0) : null,
    authors: authors.size,
  };
}

/** Percent change; null when the previous period is too small to compare meaningfully. */
export const delta = (cur: number | null, prev: number | null, minPrev = 0) => (cur == null || prev == null || prev === 0 || Math.abs(prev) < minPrev ? null : ((cur - prev) / prev) * 100);

/** Daily series: total + by sentiment. */
export function dailyTrend(rows: MentionRow[], dayList: string[]) {
  const idx = new Map(dayList.map((d, i) => [d, i]));
  const out = dayList.map((d) => ({ date: d, mentions: 0, positive: 0, neutral: 0, negative: 0 }));
  for (const r of rows) {
    if (!r.published_at) continue;
    const i = idx.get(r.published_at.slice(0, 10));
    if (i == null) continue;
    out[i].mentions++;
    const s = (r.sentiment ?? "neutral") as "positive" | "neutral" | "negative";
    if (s in out[i]) out[i][s]++;
  }
  return out;
}

/** Share of voice across brand + competitor topics. */
export function shareOfVoice(rows: MentionRow[], topics: TopicRef[]) {
  const sov = topics.filter((t) => t.kind === "brand" || t.kind === "competitor");
  const total = rows.filter((r) => sov.some((t) => t.id === r.topic_id)).length;
  return sov
    .map((t) => {
      const mine = rows.filter((r) => r.topic_id === t.id);
      const s = summary(mine);
      return { id: t.id, name: t.name, kind: t.kind, mentions: mine.length, share: total ? mine.length / total : null, netSentiment: s.netSentiment, negative: s.negative };
    })
    .sort((a, b) => b.mentions - a.mentions);
}

/** Per-topic daily volume for the SOV trend. */
export function topicTrend(rows: MentionRow[], topics: TopicRef[], dayList: string[]) {
  const idx = new Map(dayList.map((d, i) => [d, i]));
  const out: Record<string, number | string>[] = dayList.map((d) => ({ date: d, ...Object.fromEntries(topics.map((t) => [t.id, 0])) }));
  for (const r of rows) {
    const i = r.published_at ? idx.get(r.published_at.slice(0, 10)) : undefined;
    if (i == null || !r.topic_id || !(r.topic_id in out[i])) continue;
    (out[i][r.topic_id] as number)++;
  }
  return out;
}

export function topAuthors(rows: MentionRow[], limit = 10) {
  const m = new Map<string, { author: string; handle: string | null; source: string; mentions: number; followers: number | null; negative: number }>();
  for (const r of rows) {
    const k = `${r.source}:${r.author_handle ?? r.author}`;
    const a = m.get(k) ?? { author: r.author, handle: r.author_handle, source: r.source, mentions: 0, followers: null, negative: 0 };
    a.mentions++;
    if (r.sentiment === "negative") a.negative++;
    if (r.author_followers != null) a.followers = Math.max(a.followers ?? 0, r.author_followers);
    m.set(k, a);
  }
  const all = [...m.values()];
  return {
    byMentions: [...all].sort((a, b) => b.mentions - a.mentions).slice(0, limit),
    byFollowers: all.filter((a) => a.followers != null).sort((a, b) => (b.followers ?? 0) - (a.followers ?? 0)).slice(0, limit),
  };
}

// ------------------------------------------------------------------ terms

const STOP = new Set(
  `a about above after again against all also am an and any are aren as at be because been before being below between both but by can cannot could did do does doing don down during each few for from further had has have having he her here hers herself him himself his how i if in into is isn it its itself just let me more most my myself no nor not now of off on once only or other ought our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours yourself yourselves
  new one two get comment comments post posted got via its it's i'm i've you're we're they're don't can't won't didn't doesn't isn't wasn't amp quot nbsp http https www com html htm said says say like just really also still even much many make made time year years day days today week use using used way want need know think going see would could should might may us one's per vs etc yet ever every lot lots thing things
  el la los las de del y en un una que por para con es se al lo le les des du et est pour pas dans sur une der die das und ist nicht mit ein eine zu von`
    .split(/\s+/)
    .filter(Boolean),
);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;|&#\d+;/g, " ")
    .split(/[^\p{L}\p{N}'#@-]+/u)
    .map((t) => t.replace(/^['#@-]+|['-]+$/g, "").replace(/'s$/, ""))
    .filter((t) => t.length >= 3 && t.length <= 30 && !/^\d+$/.test(t) && !STOP.has(t));
}

/** Top terms by document frequency, excluding the topics' own keywords. */
export function topTerms(rows: MentionRow[], topics: TopicRef[], limit = 40) {
  const own = new Set(topics.flatMap((t) => t.keywords.flatMap((k) => parseRule(k).flat().flatMap((p) => [p, ...p.split(" ")]))));
  const df = new Map<string, { count: number; neg: number; pos: number }>();
  for (const r of rows) {
    const seen = new Set(tokenize(`${r.title} ${r.body}`).filter((t) => !own.has(t)));
    for (const t of seen) {
      const e = df.get(t) ?? { count: 0, neg: 0, pos: 0 };
      e.count++;
      if (r.sentiment === "negative") e.neg++;
      if (r.sentiment === "positive") e.pos++;
      df.set(t, e);
    }
  }
  return [...df.entries()]
    .filter(([, e]) => e.count >= 2 || rows.length < 20)
    .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([term, e]) => ({ term, count: e.count, tone: e.neg > e.pos ? "negative" : e.pos > e.neg ? "positive" : "neutral" }));
}
