import { DATABASES, database } from "@/lib/domain";
import { TOPICS, clamp, domainEntity, keywordMetrics, memo, rng, round, topicPool, topicUniverse, unit } from "@/lib/seo/engine";
import type { SerpFeature } from "@/lib/seo/types";
import { BANDS, bandFor, GOOGLE_UPDATES } from "./bands";

export { BANDS, bandFor, GOOGLE_UPDATES, UPDATES_NOTE, type BandTone } from "./bands";

/**
 * SERP Sensor demo engine. Deterministic volatility (0–10) per day × regional database × device ×
 * category, SERP feature occurrence and winners/losers. Pure (no database access); every number is
 * synthetic and must be labelled "Demo data" in the UI.
 */

export type Device = "desktop" | "mobile";
export const SENSOR_CATEGORIES: { id: string; name: string }[] = [{ id: "all", name: "All categories" }, ...TOPICS.map((t) => ({ id: t.id, name: t.name }))];
export const categoryName = (id: string) => SENSOR_CATEGORIES.find((c) => c.id === id)?.name ?? "All categories";
export const validCategory = (id: string | null | undefined) => (SENSOR_CATEGORIES.some((c) => c.id === id) ? (id as string) : "all");

const DAY = 86400000;
const dayNum = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY);
export const isoDay = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);
export const todayIso = () => new Date().toISOString().slice(0, 10);

/** `count` ISO dates ending today (UTC), oldest first. */
export function lastDays(count: number, end = todayIso()) {
  const e = dayNum(end);
  return Array.from({ length: count }, (_, i) => isoDay(e - count + 1 + i));
}

// ------------------------------------------------------------------------------ volatility model

function updateBoost(date: string) {
  let boost = 0;
  const d = dayNum(date);
  for (const u of GOOGLE_UPDATES) {
    const s = dayNum(u.start);
    const e = dayNum(u.end);
    if (d < s || d > e) continue;
    const len = e - s + 1;
    const i = d - s;
    const ramp = Math.min(1, (i + 1) / 3);
    const decay = i > len * 0.45 ? 1 - ((i - len * 0.45) / (len * 0.55)) * 0.65 : 1;
    const wobble = 0.75 + 0.5 * unit(`sensor:upd:${u.start}:${date}`);
    boost += (u.type === "core" ? 4.1 : 2.3) * ramp * decay * wobble;
  }
  return boost;
}

/** Google-wide turbulence for a day in one regional database. */
const weather = memo(
  (date: string, db: string) => {
    const r = rng(`sensor:g:${date}`);
    let v = 2.2 + r.normal(0, 0.5);
    if (unit(`sensor:spike:${date}`) < 0.07) v += 1.6 + 2.6 * unit(`sensor:spikeh:${date}`); // unconfirmed update
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (dow === 0 || dow === 6) v -= 0.35;
    v += updateBoost(date);
    const dbFactor = db === "US" ? 1 : 0.82 + 0.3 * unit(`sensor:db:${db}`);
    return v * dbFactor + rng(`sensor:gdb:${db}:${date}`).normal(0, 0.3);
  },
  5000,
  (d, db) => `${d}|${db}`,
);

const SENSITIVITY: Record<string, number> = { finance: 1.25, health: 1.3, legal: 1.15, news: 1.35, gaming: 1.1, "real-estate": 1.1, careers: 1.05, travel: 1.05 };
const sensitivity = (cat: string) => SENSITIVITY[cat] ?? 0.8 + 0.25 * unit(`sensor:sens:${cat}`);

function categoryScore(db: string, device: Device, cat: string, date: string) {
  const r = rng(`sensor:${db}:${device}:${cat}:${date}`);
  const local = unit(`sensor:cspike:${cat}:${db}:${date}`) < 0.035 ? 1.8 + 1.5 * r.next() : 0;
  const dev = device === "mobile" ? 0.25 + r.normal(0, 0.2) : 0;
  return round(clamp(weather(date, db) * sensitivity(cat) + r.normal(0, 0.5) + dev + local, 0.2, 10), 1);
}

/** Volatility score 0–10 for a day. "all" is the mean over the 18 categories. */
export function volatility(dbInput: string, device: Device, cat: string, date: string) {
  const db = database(dbInput).code;
  if (cat === "all") return round(TOPICS.reduce((s, t) => s + categoryScore(db, device, t.id, date), 0) / TOPICS.length, 1);
  return categoryScore(db, device, cat, date);
}

export function volatilitySeries(db: string, device: Device, cat: string, days: string[]) {
  return days.map((date) => ({ date, score: volatility(db, device, cat, date) }));
}

// ---------------------------------------------------------------------------- SERP feature trends

export const TRACKED_FEATURES: SerpFeature[] = ["ai_overview", "featured_snippet", "people_also_ask", "local_pack", "video", "shopping", "image_pack", "top_stories", "reviews", "sitelinks", "knowledge_panel", "ads_top", "discussions"];
/** Features plotted in the multi-line chart (fixed order = fixed series colors). */
export const CHART_FEATURES: SerpFeature[] = ["ai_overview", "featured_snippet", "people_also_ask", "local_pack", "video", "shopping"];

/** Share (0..1) of a topic's keyword universe whose SERP shows each feature (from the demo engine). */
const topicFeatureRates = memo(
  (topicId: string, db: string) => {
    const universe = topicUniverse(topicId);
    const step = Math.max(1, Math.floor(universe.length / 140));
    const counts = new Map<SerpFeature, number>();
    let n = 0;
    for (let i = 0; i < universe.length; i += step) {
      n++;
      for (const f of keywordMetrics(universe[i], db).serpFeatures) counts.set(f, (counts.get(f) ?? 0) + 1);
    }
    return Object.fromEntries(TRACKED_FEATURES.map((f) => [f, (counts.get(f) ?? 0) / Math.max(1, n)])) as Record<SerpFeature, number>;
  },
  80,
  (t, db) => `${t}|${db}`,
);

function baseRates(cat: string, db: string) {
  if (cat !== "all") return topicFeatureRates(cat, db);
  const out = {} as Record<SerpFeature, number>;
  for (const f of TRACKED_FEATURES) out[f] = TOPICS.reduce((s, t) => s + topicFeatureRates(t.id, db)[f], 0) / TOPICS.length;
  return out;
}

const MOBILE_ADJ: Partial<Record<SerpFeature, number>> = { video: 1.18, local_pack: 1.22, shopping: 0.9, image_pack: 1.1, ads_top: 0.95, sitelinks: 0.88, knowledge_panel: 0.92 };
/** Relative change per 365 days (AI Overviews keep growing, featured snippets shrink). */
const YEARLY_SLOPE: Partial<Record<SerpFeature, number>> = { ai_overview: 0.55, discussions: 0.25, featured_snippet: -0.2, top_stories: -0.05, video: 0.08 };
const EPOCH = dayNum("2026-01-01");

/** Daily % of SERPs with each tracked feature. */
export function featureSeries(dbInput: string, device: Device, cat: string, days: string[]) {
  const db = database(dbInput).code;
  const base = baseRates(cat, db);
  return days.map((date) => {
    const d = dayNum(date);
    const vol = volatility(db, device, cat, date);
    const row: Record<string, number | string> = { date };
    for (const f of TRACKED_FEATURES) {
      const r = rng(`sensor:f:${db}:${device}:${cat}:${f}:${date}`);
      const slope = 1 + (YEARLY_SLOPE[f] ?? 0.04 * (unit(`sensor:fs:${f}:${cat}`) - 0.5)) * ((d - EPOCH) / 365);
      const wave = 1 + 0.04 * Math.sin((d / (9 + 14 * unit(`sensor:fp:${f}`))) * 6.283 + 6.283 * unit(`sensor:fo:${f}:${cat}`));
      const dev = device === "mobile" ? (MOBILE_ADJ[f] ?? 1) : 1;
      const noise = 1 + r.normal(0, 0.012 + 0.006 * vol);
      const v = base[f] * clamp(slope, 0.35, 2.2) * wave * dev * noise * 100;
      row[f] = round(clamp(v, 0, 99), 1);
    }
    return row;
  });
}

// ------------------------------------------------------------------------------ winners & losers

const poolFor = memo(
  (cat: string) => {
    if (cat !== "all") return topicPool(cat).slice(0, 36).map((e) => e.domain);
    const seen = new Set<string>();
    for (const t of TOPICS) for (const l of t.leaders.slice(0, 4)) seen.add(l.split("@")[0]);
    for (const g of ["wikipedia.org", "youtube.com", "reddit.com", "amazon.com", "quora.com", "pinterest.com", "linkedin.com", "forbes.com", "medium.com", "nytimes.com"]) seen.add(g);
    return [...seen];
  },
  40,
  (c) => c,
);

export type Mover = { domain: string; visibility: number; change: number };

function shares(db: string, device: Device, cat: string, date: string) {
  const vol = volatility(db, device, cat, date);
  const sigma = 0.015 + 0.018 * vol;
  const raw = poolFor(cat).map((domain) => {
    const e = domainEntity(domain);
    const w = e.strength ** 5 * (0.7 + 0.6 * unit(`sensor:w:${domain}:${cat}:${db}`));
    const eps = rng(`sensor:mv:${domain}:${cat}:${db}:${device}:${date}`).normal(0, sigma);
    return { domain, v: w * Math.exp(eps) };
  });
  const total = raw.reduce((s, r) => s + r.v, 0) || 1;
  return new Map(raw.map((r) => [r.domain, (r.v / total) * 100]));
}

/** Domains whose visibility share in the category changed most vs the previous day. */
export function winnersLosers(dbInput: string, device: Device, cat: string, date = todayIso()) {
  const db = database(dbInput).code;
  const today = shares(db, device, cat, date);
  const prev = shares(db, device, cat, isoDay(dayNum(date) - 1));
  const rows: Mover[] = [...today.entries()].map(([domain, v]) => ({ domain, visibility: round(v, 2), change: round(v - (prev.get(domain) ?? v), 2) }));
  return {
    winners: rows.filter((r) => r.change > 0).sort((a, b) => b.change - a.change).slice(0, 6),
    losers: rows.filter((r) => r.change < 0).sort((a, b) => a.change - b.change).slice(0, 6),
  };
}

// --------------------------------------------------------------------------------------- summary

export type CategoryRow = { id: string; name: string; today: number; yesterday: number; change: number; avg30: number; spark: number[] };

/** Everything the Sensor page needs for one db × device × category. */
export function sensorOverview(dbInput: string, device: Device, catInput: string, historyDays = 730) {
  const db = database(dbInput).code;
  const cat = validCategory(catInput);
  const days = lastDays(historyDays);
  const history = volatilitySeries(db, device, cat, days);
  const last30 = history.slice(-30);
  const today = history[history.length - 1];
  const yesterday = history[history.length - 2];
  const avg30 = round(last30.reduce((s, h) => s + h.score, 0) / last30.length, 1);
  const d30 = lastDays(30);
  const categories: CategoryRow[] = SENSOR_CATEGORIES.map((c) => {
    const spark = d30.map((d) => volatility(db, device, c.id, d));
    const t = spark[spark.length - 1];
    const y = spark[spark.length - 2];
    return { id: c.id, name: c.name, today: t, yesterday: y, change: round(t - y, 1), avg30: round(spark.reduce((s, v) => s + v, 0) / spark.length, 1), spark };
  });
  const otherDevice: Device = device === "desktop" ? "mobile" : "desktop";
  const countries = DATABASES.map((d) => ({ db: d.code, name: d.name, flag: d.flag, score: volatility(d.code, device, cat, today.date) }));
  const bandDays = BANDS.map((b) => ({ ...b, days: last30.filter((h) => bandFor(h.score).id === b.id).length }));
  return {
    db,
    device,
    category: cat,
    categoryName: categoryName(cat),
    today,
    yesterday,
    change: round(today.score - yesterday.score, 1),
    avg30,
    peak30: last30.reduce((m, h) => (h.score > m.score ? h : m), last30[0]),
    otherDevice: { device: otherDevice, score: volatility(db, otherDevice, cat, today.date) },
    history,
    categories,
    countries,
    bandDays,
    features: featureSeries(db, device, cat, d30),
    movers: winnersLosers(db, device, cat, today.date),
  };
}
export type SensorOverview = ReturnType<typeof sensorOverview>;

/** Compact snapshot for the Home widget. */
export function sensorSnapshot(db: string, device: Device = "desktop") {
  const days = lastDays(30);
  const series = volatilitySeries(db, device, "all", days);
  const today = series[series.length - 1];
  const yesterday = series[series.length - 2];
  const hot = SENSOR_CATEGORIES.slice(1)
    .map((c) => ({ id: c.id, name: c.name, score: volatility(db, device, c.id, today.date) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  return { db: database(db).code, device, today, change: round(today.score - yesterday.score, 1), series, hot };
}
