import { WEEKDAYS } from "./insights";

/**
 * Social analytics from our own records (pure, fixture-tested): configurable engagement-rate formula,
 * best posting times, and content-tag (campaign) performance.
 */

export const ER_METRICS = ["likes", "comments", "shares", "views"] as const;
export type ErMetric = (typeof ER_METRICS)[number];
export type ErFormula = { weights: Record<ErMetric, number>; denominator: "followers" | "views" | "none" };
export const DEFAULT_ER: ErFormula = { weights: { likes: 1, comments: 1, shares: 1, views: 0 }, denominator: "followers" };

export function parseFormula(v: unknown): ErFormula {
  const o = (v && typeof v === "object" ? v : {}) as Partial<ErFormula>;
  const w = (o.weights ?? {}) as Partial<Record<ErMetric, unknown>>;
  const num = (x: unknown, d: number) => (typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 100 ? x : d);
  return {
    weights: Object.fromEntries(ER_METRICS.map((m) => [m, num(w[m], DEFAULT_ER.weights[m])])) as Record<ErMetric, number>,
    denominator: o.denominator === "views" || o.denominator === "none" ? o.denominator : "followers",
  };
}

export function formulaText(f: ErFormula) {
  const parts = ER_METRICS.filter((m) => f.weights[m] > 0).map((m) => (f.weights[m] === 1 ? m : `${f.weights[m]}×${m}`));
  const num = parts.length ? parts.join(" + ") : "0";
  return f.denominator === "none" ? `${num} (engagements)` : `(${num}) ÷ ${f.denominator} × 100`;
}

export type PostMetrics = { likes: number | null; comments: number | null; shares: number | null; views: number | null };

/** Engagement rate (or weighted engagements when denominator is "none"); null when an input it needs is unknown. */
export function engagementRate(p: PostMetrics, f: ErFormula, followers: number | null) {
  let sum = 0;
  let known = false;
  for (const m of ER_METRICS) {
    if (!f.weights[m]) continue;
    const v = p[m];
    if (v == null) continue;
    sum += v * f.weights[m];
    known = true;
  }
  if (!known) return null;
  if (f.denominator === "none") return sum;
  const d = f.denominator === "views" ? p.views : followers;
  return d ? (sum / d) * 100 : null;
}

export type TimedEvent = { at: string | null; weight: number };

/**
 * Best posting times: weekday × hour grid (in the given UTC offset, minutes) of summed weights, and
 * the best days/hours. Weights are engagements per post or clicks per click event (both real counts).
 */
export function bestTimes(events: TimedEvent[], tzOffsetMinutes = 0) {
  const grid = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  const posts = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  let n = 0;
  for (const e of events) {
    if (!e.at) continue;
    const d = new Date(new Date(e.at).getTime() + tzOffsetMinutes * 60000);
    if (Number.isNaN(d.getTime())) continue;
    const day = (d.getUTCDay() + 6) % 7;
    grid[day][d.getUTCHours()] += e.weight;
    posts[day][d.getUTCHours()]++;
    n++;
  }
  const dayTotals = grid.map((r, i) => ({ day: WEEKDAYS[i], value: r.reduce((a, b) => a + b, 0), n: posts[i].reduce((a, b) => a + b, 0) }));
  const hourTotals = Array.from({ length: 24 }, (_, h) => ({ hour: h, value: grid.reduce((a, r) => a + r[h], 0), n: posts.reduce((a, r) => a + r[h], 0) }));
  const avg = (x: { value: number; n: number }) => (x.n ? x.value / x.n : 0);
  const byAvg = <T extends { value: number; n: number }>(a: T[]) => [...a].filter((x) => x.n > 0).sort((x, y) => avg(y) - avg(x));
  const days = byAvg(dayTotals);
  return {
    events: n,
    grid,
    bestDays: days.slice(0, 2).map((d) => d.day),
    worstDay: days.length > 2 ? days[days.length - 1].day : null,
    bestHours: byAvg(hourTotals).slice(0, 3).map((h) => h.hour),
    dayTotals,
  };
}

export type TagPost = { campaign_id: string | null; channels: string[]; published_at: string | null; clicks: number; engagements: number | null; rate: number | null };

/** Content-tag performance: posts, channels, link clicks and engagement (current vs previous period). */
export function tagPerformance(posts: TagPost[], tags: { id: string; name: string }[], periodStart: Date, prevStart: Date) {
  const name = new Map(tags.map((t) => [t.id, t.name]));
  const m = new Map<string, { tag: string; posts: number; prevPosts: number; clicks: number; prevClicks: number; engagements: number | null; rates: number[]; channels: Set<string> }>();
  for (const p of posts) {
    if (!p.published_at) continue;
    const t = new Date(p.published_at).getTime();
    const cur = t > periodStart.getTime();
    if (!cur && t <= prevStart.getTime()) continue;
    const key = p.campaign_id ?? "";
    const e = m.get(key) ?? { tag: p.campaign_id ? (name.get(p.campaign_id) ?? "Deleted tag") : "Untagged", posts: 0, prevPosts: 0, clicks: 0, prevClicks: 0, engagements: null, rates: [], channels: new Set<string>() };
    if (cur) {
      e.posts++;
      e.clicks += p.clicks;
      if (p.engagements != null) e.engagements = (e.engagements ?? 0) + p.engagements;
      if (p.rate != null) e.rates.push(p.rate);
      p.channels.forEach((c) => e.channels.add(c));
    } else {
      e.prevPosts++;
      e.prevClicks += p.clicks;
    }
    m.set(key, e);
  }
  return [...m.values()]
    .map((e) => ({
      tag: e.tag,
      posts: e.posts,
      prevPosts: e.prevPosts,
      clicks: e.clicks,
      prevClicks: e.prevClicks,
      clicksPerPost: e.posts ? e.clicks / e.posts : null,
      engagements: e.engagements,
      avgRate: e.rates.length ? e.rates.reduce((a, b) => a + b, 0) / e.rates.length : null,
      channels: [...e.channels],
    }))
    .sort((a, b) => b.posts - a.posts || b.clicks - a.clicks);
}
