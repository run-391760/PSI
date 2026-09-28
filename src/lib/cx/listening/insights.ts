import { tokenize, type MentionRow, type TopicRef } from "./analytics";
import { parseRule } from "./sources";

/**
 * WP3 listening analytics (pure, fixture-tested): period comparison, sentiment-split and phrase clouds,
 * peak activity windows, trending issues, review ratings, buzz year-over-year and geography.
 * Every number is derived from stored real records; unknown values are null ("n/a"), never estimated.
 */

const DAY = 86400000;
const HOUR = 3600000;
const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

// ------------------------------------------------------------------ period comparison

/** Merge a previous-period series into the current one by position (day i of the period ↔ day i of the previous period). */
export function withPrevious<T extends Record<string, unknown>>(cur: T[], prev: Record<string, unknown>[], keys: string[]) {
  return cur.map((r, i) => ({ ...r, ...Object.fromEntries(keys.map((k) => [`prev_${k}`, (prev[i]?.[k] as number | undefined) ?? null])) }));
}

/** Count per key for two periods with change; rows sorted by current count. */
export function compareCounts(cur: { key: string; count: number }[], prev: { key: string; count: number }[]) {
  const p = new Map(prev.map((x) => [x.key, x.count]));
  const keys = [...new Set([...cur.map((x) => x.key), ...prev.map((x) => x.key)])];
  const c = new Map(cur.map((x) => [x.key, x.count]));
  return keys
    .map((key) => {
      const now = c.get(key) ?? 0;
      const before = p.get(key) ?? 0;
      return { key, count: now, prev: before, change: before ? ((now - before) / before) * 100 : null };
    })
    .sort((a, b) => b.count - a.count || b.prev - a.prev);
}

// ------------------------------------------------------------------ clouds

const own = (topics: TopicRef[]) => new Set(topics.flatMap((t) => t.keywords.flatMap((k) => parseRule(k).flat().flatMap((p) => [p, ...p.split(" ")]))));
type Term = { term: string; count: number; tone: string; prev?: number };

function docFreq(rows: MentionRow[], grams: (text: string) => string[]) {
  const df = new Map<string, { count: number; neg: number; pos: number }>();
  for (const r of rows) {
    for (const t of new Set(grams(`${r.title} ${r.body}`))) {
      const e = df.get(t) ?? { count: 0, neg: 0, pos: 0 };
      e.count++;
      if (r.sentiment === "negative") e.neg++;
      if (r.sentiment === "positive") e.pos++;
      df.set(t, e);
    }
  }
  return df;
}

function rank(df: Map<string, { count: number; neg: number; pos: number }>, total: number, limit: number, prev?: Map<string, { count: number }>, tone?: string): Term[] {
  return [...df.entries()]
    .filter(([, e]) => e.count >= 2 || total < 20)
    .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([term, e]) => ({ term, count: e.count, tone: tone ?? (e.neg > e.pos ? "negative" : e.pos > e.neg ? "positive" : "neutral"), prev: prev ? (prev.get(term)?.count ?? 0) : undefined }));
}

/** Word n-grams (n = 2 or 3) whose words are all content words and not all the topic's own keywords. */
export function ngrams(text: string, n: number, exclude: Set<string> = new Set()) {
  const words = text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;|&#\d+;/g, " ")
    .split(/[^\p{L}\p{N}'-]+/u)
    .map((w) => w.replace(/^['-]+|['-]+$/g, "").replace(/'s$/, ""));
  const out: string[] = [];
  for (let i = 0; i + n <= words.length; i++) {
    const g = words.slice(i, i + n);
    if (g.some((w) => tokenize(w).length !== 1 || tokenize(w)[0] !== w)) continue;
    if (g.every((w) => exclude.has(w))) continue;
    out.push(g.join(" "));
  }
  return out;
}

/** 2- and 3-word phrase cloud (document frequency) with the previous-period count per phrase. */
export function topPhrases(rows: MentionRow[], topics: TopicRef[], n: 2 | 3, limit = 30, prevRows?: MentionRow[]) {
  const ex = own(topics);
  const g = (t: string) => ngrams(t, n, ex);
  return rank(docFreq(rows, g), rows.length, limit, prevRows ? docFreq(prevRows, g) : undefined);
}

/** One word cloud per sentiment (terms colored by the cloud's sentiment) with previous-period counts. */
export function sentimentClouds(rows: MentionRow[], topics: TopicRef[], limit = 25, prevRows: MentionRow[] = []) {
  const ex = own(topics);
  const g = (t: string) => tokenize(t).filter((w) => !ex.has(w));
  const out = {} as Record<"positive" | "neutral" | "negative", Term[]>;
  for (const s of ["positive", "neutral", "negative"] as const) {
    const cur = rows.filter((r) => (r.sentiment ?? "neutral") === s);
    const prev = prevRows.filter((r) => (r.sentiment ?? "neutral") === s);
    out[s] = rank(docFreq(cur, g), cur.length, limit, docFreq(prev, g), s);
  }
  return out;
}

// ------------------------------------------------------------------ peak windows

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const wd = (d: Date) => (d.getUTCDay() + 6) % 7;

/** Weekday × hour (UTC) activity grid and each source's busiest 3-hour window and weekday. */
export function peakWindows(rows: Pick<MentionRow, "source" | "published_at">[]) {
  const grid = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  const per = new Map<string, { hours: number[]; days: number[]; total: number }>();
  for (const r of rows) {
    if (!r.published_at) continue;
    const d = new Date(r.published_at);
    const h = d.getUTCHours();
    grid[wd(d)][h]++;
    const s = per.get(r.source) ?? { hours: Array(24).fill(0), days: Array(7).fill(0), total: 0 };
    s.hours[h]++;
    s.days[wd(d)]++;
    s.total++;
    per.set(r.source, s);
  }
  const bySource = [...per.entries()]
    .map(([source, s]) => {
      let best = 0;
      let bestN = -1;
      for (let h = 0; h < 24; h++) {
        const n = s.hours[h] + s.hours[(h + 1) % 24] + s.hours[(h + 2) % 24];
        if (n > bestN) [best, bestN] = [h, n];
      }
      const day = s.days.indexOf(Math.max(...s.days));
      return { source, total: s.total, peakStart: best, peakEnd: (best + 3) % 24, peakShare: s.total ? bestN / s.total : null, peakDay: WEEKDAYS[day], peakDayShare: s.total ? s.days[day] / s.total : null };
    })
    .sort((a, b) => b.total - a.total);
  const flat = grid.flatMap((row, d) => row.map((n, h) => ({ d, h, n }))).sort((a, b) => b.n - a.n);
  return { grid, bySource, top: flat.filter((x) => x.n > 0).slice(0, 3).map((x) => ({ day: WEEKDAYS[x.d], hour: x.h, count: x.n })) };
}

// ------------------------------------------------------------------ trending issues (S12)

export type TrendDoc = { id: string; kind: "mention" | "ticket"; text: string; at: string | null };
export type TrendingIssue = { term: string; count: number; mentions: number; tickets: number; baseline: number; ratio: number | null; isNew: boolean; ids: string[] };

/**
 * Terms and 2-word phrases whose count in the latest window is ≥ `minRatio` × their average per window
 * over the trailing baseline ("14 mentions of refund, 3× normal"). Terms absent from the baseline are
 * "new" and only reported when the baseline itself has data (otherwise everything would be new).
 */
export function trendingIssues(docs: TrendDoc[], now: Date, opts: { windowHours?: number; baselineDays?: number; minCount?: number; minRatio?: number; exclude?: Set<string>; limit?: number } = {}): TrendingIssue[] {
  const { windowHours = 24, baselineDays = 14, minCount = 3, minRatio = 3, exclude = new Set<string>(), limit = 10 } = opts;
  const end = now.getTime();
  const winStart = end - windowHours * HOUR;
  const baseStart = winStart - baselineDays * DAY;
  const windows = (baselineDays * 24) / windowHours;
  const grams = (t: string) => {
    const one = tokenize(t).filter((w) => !exclude.has(w) && !w.startsWith("@"));
    return [...new Set([...one, ...ngrams(t, 2, exclude)])];
  };
  const cur = new Map<string, { m: number; t: number; ids: string[] }>();
  const base = new Map<string, number>();
  let baseDocs = 0;
  for (const d of docs) {
    if (!d.at) continue;
    const ts = new Date(d.at).getTime();
    if (ts > winStart && ts <= end) {
      for (const g of grams(d.text)) {
        const e = cur.get(g) ?? { m: 0, t: 0, ids: [] };
        if (d.kind === "ticket") e.t++;
        else e.m++;
        if (e.ids.length < 20) e.ids.push(d.id);
        cur.set(g, e);
      }
    } else if (ts > baseStart && ts <= winStart) {
      baseDocs++;
      for (const g of grams(d.text)) base.set(g, (base.get(g) ?? 0) + 1);
    }
  }
  const out: TrendingIssue[] = [];
  for (const [term, e] of cur) {
    const count = e.m + e.t;
    if (count < minCount) continue;
    const avg = (base.get(term) ?? 0) / windows;
    const isNew = avg === 0;
    if (isNew && baseDocs < 10) continue;
    const ratio = isNew ? null : count / avg;
    if (ratio != null && ratio < minRatio) continue;
    out.push({ term, count, mentions: e.m, tickets: e.t, baseline: avg, ratio, isNew, ids: e.ids });
  }
  // Prefer phrases over their single words when both trend with the same docs.
  const phrases = out.filter((x) => x.term.includes(" "));
  const kept = out.filter((x) => x.term.includes(" ") || !phrases.some((p) => p.term.split(" ").includes(x.term) && p.count >= x.count * 0.8));
  return kept.sort((a, b) => (b.ratio ?? 99) * Math.log1p(b.count) - (a.ratio ?? 99) * Math.log1p(a.count) || b.count - a.count).slice(0, limit);
}

export const trendLabel = (t: TrendingIssue) => `${t.count} ${t.tickets && !t.mentions ? "tickets" : t.mentions && !t.tickets ? "mentions" : "mentions and tickets"} of “${t.term}”, ${t.isNew ? "new this window" : `${(t.ratio ?? 0).toFixed(1)}× normal`}`;

// ------------------------------------------------------------------ reviews (M8)

export type Review = { published_at: string | null; rating: number | null };

/** Daily average rating and count, plus a trailing 7-day average (null where no reviews). */
export function ratingSeries(reviews: Review[], dayList: string[]) {
  const by = new Map(dayList.map((d) => [d, { sum: 0, n: 0 }]));
  for (const r of reviews) {
    if (!r.published_at || r.rating == null) continue;
    const e = by.get(r.published_at.slice(0, 10));
    if (e) {
      e.sum += r.rating;
      e.n++;
    }
  }
  return dayList.map((d, i) => {
    const e = by.get(d)!;
    const win = dayList.slice(Math.max(0, i - 6), i + 1).map((x) => by.get(x)!);
    const n7 = win.reduce((a, w) => a + w.n, 0);
    return { date: d, reviews: e.n, rating: e.n ? e.sum / e.n : null, rolling: n7 ? win.reduce((a, w) => a + w.sum, 0) / n7 : null };
  });
}

export function ratingDistribution(reviews: Review[]) {
  const d = [5, 4, 3, 2, 1].map((stars) => ({ stars, count: 0 }));
  for (const r of reviews) if (r.rating != null && r.rating >= 1 && r.rating <= 5) d[5 - Math.round(r.rating)].count++;
  return d;
}

/** Rating drop: recent average vs the preceding baseline average. Needs ≥ minRecent recent and ≥ 5 baseline reviews. */
export function ratingDrop(reviews: Review[], now: Date, opts: { recentDays?: number; baselineDays?: number; threshold?: number; minRecent?: number } = {}) {
  const { recentDays = 7, baselineDays = 30, threshold = 0.5, minRecent = 3 } = opts;
  const t = now.getTime();
  const recent = reviews.filter((r) => r.rating != null && r.published_at && new Date(r.published_at).getTime() > t - recentDays * DAY && new Date(r.published_at).getTime() <= t);
  const base = reviews.filter((r) => {
    const ts = r.published_at ? new Date(r.published_at).getTime() : NaN;
    return r.rating != null && ts > t - (recentDays + baselineDays) * DAY && ts <= t - recentDays * DAY;
  });
  const avg = (a: Review[]) => (a.length ? a.reduce((s, r) => s + (r.rating ?? 0), 0) / a.length : null);
  const recentAvg = avg(recent);
  const baselineAvg = avg(base);
  const ready = recent.length >= minRecent && base.length >= 5;
  const drop = recentAvg != null && baselineAvg != null ? baselineAvg - recentAvg : null;
  return { recentAvg, baselineAvg, recentCount: recent.length, baselineCount: base.length, drop, ready, triggered: ready && drop != null && drop >= threshold };
}

// ------------------------------------------------------------------ buzz year over year (L11)

/** Monthly mentions for the last `months` months with the same month a year earlier (null before coverage). */
export function buzzYoY(rows: Pick<MentionRow, "published_at">[], now: Date, coverageStart: Date | null, months = 12) {
  const counts = new Map<string, number>();
  for (const r of rows) if (r.published_at) counts.set(r.published_at.slice(0, 7), (counts.get(r.published_at.slice(0, 7)) ?? 0) + 1);
  return buzzYoYCounts(counts, now, coverageStart, months);
}

/** Same as buzzYoY from pre-aggregated monthly counts ("YYYY-MM" → mentions). */
export function buzzYoYCounts(counts: Map<string, number>, now: Date, coverageStart: Date | null, months = 12) {
  const key = (d: Date) => d.toISOString().slice(0, 7);
  const covered = (y: number, m: number) => coverageStart != null && Date.UTC(y, m, 1) >= Date.UTC(coverageStart.getUTCFullYear(), coverageStart.getUTCMonth(), 1);
  return Array.from({ length: months }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1 - i), 1));
    const ly = new Date(Date.UTC(d.getUTCFullYear() - 1, d.getUTCMonth(), 1));
    const cur = covered(d.getUTCFullYear(), d.getUTCMonth()) ? (counts.get(key(d)) ?? 0) : null;
    const prev = covered(ly.getUTCFullYear(), ly.getUTCMonth()) ? (counts.get(key(ly)) ?? 0) : null;
    return { month: key(d), mentions: cur, lastYear: prev, change: cur != null && prev ? ((cur - prev) / prev) * 100 : null };
  });
}

// ------------------------------------------------------------------ geography (L14)

const CCTLD: Record<string, string> = {
  in: "IN", uk: "GB", au: "AU", ca: "CA", de: "DE", fr: "FR", jp: "JP", br: "BR", es: "ES", it: "IT", nl: "NL", sg: "SG", nz: "NZ", za: "ZA", ie: "IE", ae: "AE", pk: "PK", bd: "BD", lk: "LK", np: "NP", my: "MY", ph: "PH", id: "ID", ng: "NG", ke: "KE", mx: "MX", ar: "AR", ru: "RU", cn: "CN", kr: "KR", ch: "CH", se: "SE", no: "NO", dk: "DK", fi: "FI", pl: "PL", be: "BE", at: "AT", pt: "PT", tr: "TR", sa: "SA", qa: "QA", eg: "EG", il: "IL", hk: "HK", tw: "TW", th: "TH", vn: "VN",
};
/** Country of a publisher host from its country-code TLD (e.g. timesofindia.co.in → IN); null for generic TLDs. */
export function countryFromHost(host: string | null | undefined) {
  if (!host) return null;
  const tld = host.toLowerCase().replace(/\/.*$/, "").split(".").pop() ?? "";
  return CCTLD[tld] ?? null;
}

// Compact gazetteer: [place, state/region, country, isCity]. Matched as whole words in mention text.
const PLACES: [string, string, string, boolean][] = [
  ...["Gujarat", "Maharashtra", "Karnataka", "Tamil Nadu", "Kerala", "Rajasthan", "Uttar Pradesh", "Madhya Pradesh", "West Bengal", "Bihar", "Punjab", "Haryana", "Telangana", "Andhra Pradesh", "Odisha", "Assam", "Jharkhand", "Chhattisgarh", "Uttarakhand", "Himachal Pradesh", "Goa", "Delhi", "Jammu and Kashmir"].map((s): [string, string, string, boolean] => [s, s, "IN", false]),
  ...[["Vadodara", "Gujarat"], ["Baroda", "Gujarat"], ["Ahmedabad", "Gujarat"], ["Surat", "Gujarat"], ["Rajkot", "Gujarat"], ["Gandhinagar", "Gujarat"], ["Mumbai", "Maharashtra"], ["Pune", "Maharashtra"], ["Nagpur", "Maharashtra"], ["Bengaluru", "Karnataka"], ["Bangalore", "Karnataka"], ["Chennai", "Tamil Nadu"], ["Hyderabad", "Telangana"], ["Kolkata", "West Bengal"], ["New Delhi", "Delhi"], ["Noida", "Uttar Pradesh"], ["Lucknow", "Uttar Pradesh"], ["Gurugram", "Haryana"], ["Gurgaon", "Haryana"], ["Jaipur", "Rajasthan"], ["Indore", "Madhya Pradesh"], ["Bhopal", "Madhya Pradesh"], ["Patna", "Bihar"], ["Kochi", "Kerala"], ["Chandigarh", "Punjab"], ["Bhubaneswar", "Odisha"], ["Guwahati", "Assam"]].map(([c, s]): [string, string, string, boolean] => [c, s, "IN", true]),
  ...["California", "Texas", "Florida", "New York State", "Illinois", "Washington State", "Massachusetts", "Georgia", "Ohio", "Pennsylvania", "Michigan", "Arizona", "Colorado", "Virginia", "New Jersey", "North Carolina", "Oregon"].map((s): [string, string, string, boolean] => [s, s.replace(/ State$/, ""), "US", false]),
  ...[["New York City", "New York"], ["San Francisco", "California"], ["Los Angeles", "California"], ["Seattle", "Washington"], ["Chicago", "Illinois"], ["Boston", "Massachusetts"], ["Austin", "Texas"], ["Houston", "Texas"], ["Dallas", "Texas"], ["Miami", "Florida"], ["Atlanta", "Georgia"], ["Denver", "Colorado"]].map(([c, s]): [string, string, string, boolean] => [c, s, "US", true]),
  ...[["London", "England"], ["Manchester", "England"], ["Birmingham", "England"], ["Edinburgh", "Scotland"], ["Glasgow", "Scotland"], ["Cardiff", "Wales"]].map(([c, s]): [string, string, string, boolean] => [c, s, "GB", true]),
  ...[["Scotland", "Scotland"], ["Wales", "Wales"], ["England", "England"]].map(([c, s]): [string, string, string, boolean] => [c, s, "GB", false]),
  ...[["Toronto", "Ontario"], ["Vancouver", "British Columbia"], ["Montreal", "Quebec"], ["Sydney", "New South Wales"], ["Melbourne", "Victoria"], ["Dubai", "Dubai"], ["Abu Dhabi", "Abu Dhabi"], ["Singapore", "Singapore"]].map(([c, s]): [string, string, string, boolean] => [c, s, c === "Toronto" || c === "Vancouver" || c === "Montreal" ? "CA" : c === "Sydney" || c === "Melbourne" ? "AU" : c === "Singapore" ? "SG" : "AE", true]),
];
const PLACE_RE = PLACES.map(([name, state, country, city]) => ({ re: new RegExp(`\\b${name.replace(/ /g, "\\s+")}\\b`), state, country, city: city ? name.replace(/^Baroda$/, "Vadodara").replace(/^Bangalore$/, "Bengaluru").replace(/^Gurgaon$/, "Gurugram") : null }));

/** First place named in the text (case-sensitive proper nouns): { country, state, city }. */
export function placeIn(text: string) {
  for (const p of PLACE_RE) if (p.re.test(text)) return { country: p.country, state: p.state, city: p.city };
  return null;
}

export type GeoNode = { name: string; value: number; children: GeoNode[] };

/**
 * Country → state → city hierarchy for the sunburst. Country comes from the source (App Store storefront),
 * the publisher's country-code domain (news) or a place named in the text; state/city only from named places.
 */
export type GeoRow = Pick<MentionRow, "source" | "author_handle" | "title" | "body"> & { country?: string | null };
export function geoTree(rows: GeoRow[]) {
  const root: GeoNode = { name: "All", value: 0, children: [] };
  let located = 0;
  const child = (n: GeoNode, name: string) => {
    let c = n.children.find((x) => x.name === name);
    if (!c) n.children.push((c = { name, value: 0, children: [] }));
    c.value++;
    return c;
  };
  for (const r of rows) {
    const place = placeIn(`${r.title} ${r.body}`);
    const country = r.country || (r.source === "news" ? countryFromHost(r.author_handle) : null) || place?.country || null;
    if (!country) continue;
    located++;
    root.value++;
    const c = child(root, country);
    if (place && place.country === country) {
      const s = child(c, place.state);
      if (place.city) child(s, place.city);
    }
  }
  const sort = (n: GeoNode) => {
    n.children.sort((a, b) => b.value - a.value);
    n.children.forEach(sort);
  };
  sort(root);
  return { root, located, total: rows.length };
}
