import { domainCompetitors, domainEntity, domainFacts, keywordMetrics, memo, round, TOPICS, topicPool, topicUniverse, trafficFacts, type TrafficChannel } from "@/lib/seo/engine";
import { database, domainLabel } from "@/lib/domain";
import { demo as demoData, type Sourced } from "@/lib/providers/source";
import { demoAllowed } from "@/lib/data-mode";
import { AppError } from "@/lib/domain";
import { CHANNEL_ORDER } from "./traffic-analytics";
import { changePct } from "./shared";

export type Quadrant = "leaders" | "gameChangers" | "established" | "niche";
export const QUADRANTS: Record<Quadrant, { label: string; note: string }> = {
  leaders: { label: "Niche leaders", note: "High traffic and high growth" },
  gameChangers: { label: "Game changers", note: "Lower traffic but growing fast" },
  established: { label: "Established players", note: "High traffic, slower growth" },
  niche: { label: "Niche players", note: "Lower traffic and slower growth" },
};

export type MarketPlayer = {
  domain: string;
  isSeed: boolean;
  visits: number;
  share: number;
  /** Year-over-year visits change, %. */
  growth: number;
  /** Month-over-month visits change, %. */
  mom: number;
  organicKeywords: number;
  authorityScore: number;
  mobile: number;
  quadrant: Quadrant;
  quadrantLabel: string;
  channels: Record<TrafficChannel, number>;
  history: number[];
};

export type MarketReport = {
  mode: "domain" | "topic";
  seed: string | null;
  topicId: string;
  topicName: string;
  db: string;
  players: MarketPlayer[];
  totalVisits: number;
  growth: number;
  mom: number;
  searchDemand: number;
  marketKeywords: number;
  concentration: number;
  thresholds: { visits: number; growth: number };
  months: string[];
  trend: Record<string, string | number>[];
  trendPlayers: string[];
  channels: { channel: TrafficChannel; visits: number; share: number }[];
  devices: { desktop: number; mobile: number };
  demographics: { age: { band: string; share: number }[]; female: number; male: number };
  countries: { db: string; name: string; flag: string; visits: number; share: number }[];
};

const NOTE = "Market-level clickstream estimates are not offered by the connected providers; this report always uses the demo engine.";
const MAX_PLAYERS = 20;

/** Resolve free text to a market (topic): id, name, or a word from its name/signals/head terms. */
export function matchTopic(input: string) {
  const q = input.toLowerCase().trim().replace(/[-_]+/g, " ");
  if (!q) return null;
  const exact = TOPICS.find((t) => t.id === q.replace(/ /g, "-") || t.name.toLowerCase() === q);
  if (exact) return exact;
  const words = q.split(/[\s&,]+/).filter((w) => w.length > 2);
  return (
    TOPICS.find((t) => t.name.toLowerCase().includes(q)) ??
    TOPICS.find((t) => words.some((w) => t.name.toLowerCase().split(/[\s&]+/).includes(w))) ??
    TOPICS.find((t) => t.heads.includes(q)) ??
    TOPICS.find((t) => words.some((w) => t.signals.includes(w) || t.signals.includes(w.replace(/s$/, "")))) ??
    null
  );
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const buildMarket = memo((mode: "domain" | "topic", seed: string | null, topicId: string, db: string): MarketReport => {
  const topic = TOPICS.find((t) => t.id === topicId) ?? TOPICS[0];
  let domains: string[];
  if (seed) {
    const comps = domainCompetitors(seed, db, 40)
      .filter((c) => domainEntity(c.domain).kind !== "giant")
      .map((c) => c.domain);
    domains = [seed, ...comps].slice(0, MAX_PLAYERS);
  } else {
    domains = topicPool(topic.id)
      .filter((e) => e.kind !== "giant")
      .sort((a, b) => b.strength - a.strength)
      .slice(0, MAX_PLAYERS)
      .map((e) => e.domain);
  }
  const facts = domains.map((d) => ({ t: trafficFacts(d), f: domainFacts(d, db) }));
  const totalVisits = facts.reduce((s, x) => s + x.t.visits, 0) || 1;
  const raw = facts.map(({ t, f }, i) => {
    const h = t.history.map((x) => x.visits);
    const n = h.length;
    return {
      domain: domains[i],
      isSeed: domains[i] === seed,
      visits: t.visits,
      share: round((t.visits / totalVisits) * 100, 1),
      growth: changePct(h[n - 13], h[n - 1]),
      mom: t.visitsChangePct,
      organicKeywords: f.organicKeywords,
      authorityScore: f.authorityScore,
      mobile: t.devices.mobile,
      channels: Object.fromEntries(CHANNEL_ORDER.map((c) => [c, t.channels.find((x) => x.channel === c)?.share ?? 0])) as Record<TrafficChannel, number>,
      history: h,
    };
  });
  const thresholds = { visits: median(raw.map((p) => p.visits)), growth: round(median(raw.map((p) => p.growth)), 1) };
  const players: MarketPlayer[] = raw
    .map((p) => {
      const quadrant: Quadrant = p.visits >= thresholds.visits ? (p.growth >= thresholds.growth ? "leaders" : "established") : p.growth >= thresholds.growth ? "gameChangers" : "niche";
      return { ...p, quadrant, quadrantLabel: QUADRANTS[quadrant].label };
    })
    .sort((a, b) => b.visits - a.visits);

  // Market trend: total + top 5 players + other.
  const months = facts[0].t.history.map((h) => h.month);
  const top = players.slice(0, 5);
  const trend = months.map((month, m) => {
    const row: Record<string, string | number> = { month };
    let total = 0;
    for (const p of players) total += p.history[m] ?? 0;
    row.total = total;
    let topSum = 0;
    top.forEach((p, i) => {
      row[`p${i}`] = p.history[m] ?? 0;
      topSum += p.history[m] ?? 0;
    });
    row.other = Math.max(0, total - topSum);
    return row;
  });
  const n = trend.length;

  // Aggregates weighted by visits.
  const channelVisits = CHANNEL_ORDER.map((c) => ({ channel: c, visits: Math.round(facts.reduce((s, x) => s + (x.t.channels.find((ch) => ch.channel === c)?.visits ?? 0), 0)) }));
  const channels = channelVisits.map((c) => ({ ...c, share: round((c.visits / totalVisits) * 100, 1) }));
  const mobileVisits = facts.reduce((s, x) => s + (x.t.visits * x.t.devices.mobile) / 100, 0);
  const ageBands = facts[0].t.demographics.age.map((a) => a.band);
  const age = ageBands.map((band, i) => ({ band, share: round(facts.reduce((s, x) => s + x.t.visits * (x.t.demographics.age[i]?.share ?? 0), 0) / totalVisits, 1) }));
  const female = round(facts.reduce((s, x) => s + x.t.visits * x.t.demographics.female, 0) / totalVisits, 1);
  const countryMap = new Map<string, { db: string; name: string; flag: string; visits: number }>();
  for (const { t } of facts)
    for (const c of t.countries) {
      const e = countryMap.get(c.db) ?? { db: c.db, name: c.name, flag: c.flag, visits: 0 };
      e.visits += c.visits;
      countryMap.set(c.db, e);
    }
  const countries = [...countryMap.values()].sort((a, b) => b.visits - a.visits).map((c) => ({ ...c, share: round((c.visits / totalVisits) * 100, 1) }));

  const universe = topicUniverse(topic.id);
  const searchDemand = universe.reduce((s, k) => s + keywordMetrics(k, db).volume, 0);
  const sortedShares = players.map((p) => p.share).sort((a, b) => b - a);

  return {
    mode,
    seed,
    topicId: topic.id,
    topicName: topic.name,
    db,
    players,
    totalVisits,
    growth: changePct(Number(trend[n - 13]?.total), Number(trend[n - 1]?.total)),
    mom: changePct(Number(trend[n - 2]?.total), Number(trend[n - 1]?.total)),
    searchDemand,
    marketKeywords: universe.length,
    concentration: round(sortedShares.slice(0, 3).reduce((s, x) => s + x, 0), 1),
    thresholds,
    months,
    trend,
    trendPlayers: top.map((p) => p.domain),
    channels,
    devices: { mobile: round((mobileVisits / totalVisits) * 100, 1), desktop: round(100 - (mobileVisits / totalVisits) * 100, 1) },
    demographics: { age, female, male: round(100 - female, 1) },
    countries,
  };
}, 40);

export async function getMarketByDomain(domain: string, dbInput: string): Promise<Sourced<MarketReport>> {
  const db = database(dbInput).code;
  const topicId = domainFacts(domain, db).topicId;
  return demo(buildMarket("domain", domain, topicId, db), NOTE);
}

export async function getMarketByTopic(topicId: string, dbInput: string): Promise<Sourced<MarketReport>> {
  const db = database(dbInput).code;
  return demo(buildMarket("topic", null, topicId, db), NOTE);
}

export const marketLabel = (r: MarketReport) => (r.seed ? `${domainLabel(r.seed)} market` : r.topicName);

/** Demo data only in local development (DEMO_DATA=true). */
function demo<T>(data: T, note?: string): Sourced<T> {
  if (!demoAllowed()) throw new AppError("Market Explorer needs DataForSEO.", 409);
  return demoData(data, note);
}
