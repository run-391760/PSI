import { countryDistribution, domainCompetitors, domainEntity, domainFacts, domainPages } from "./domains";
import { clamp, memo, rng, round } from "./random";

export type TrafficChannel = "direct" | "organic" | "paid" | "referral" | "social" | "email" | "ai";
export const CHANNEL_LABELS: Record<TrafficChannel, string> = {
  direct: "Direct",
  organic: "Organic search",
  paid: "Paid search",
  referral: "Referral",
  social: "Social",
  email: "Email",
  ai: "AI assistants",
};

export type TrafficFacts = {
  domain: string;
  visits: number;
  uniqueVisitors: number;
  pagesPerVisit: number;
  avgVisitDuration: number;
  bounceRate: number;
  visitsChangePct: number;
  channels: { channel: TrafficChannel; share: number; visits: number }[];
  devices: { desktop: number; mobile: number };
  history: { month: string; visits: number; uniqueVisitors: number; desktop: number; mobile: number }[];
  countries: { db: string; name: string; flag: string; share: number; visits: number }[];
  topPages: { url: string; share: number; visits: number }[];
  audienceOverlap: { domain: string; overlap: number; visits: number }[];
  journey: { previous: { domain: string; share: number }[]; next: { domain: string; share: number }[] };
  demographics: { age: { band: string; share: number }[]; female: number; male: number };
};

/** Clickstream-style traffic estimate (Traffic Analytics). Consistent with domainFacts organic traffic. */
export const trafficFacts = memo((domain: string): TrafficFacts => {
  const e = domainEntity(domain);
  const facts = domainFacts(domain, e.homeDb);
  const r = rng(`traffic:${domain}`);
  const mix: Record<TrafficChannel, number> = {
    direct: r.range(0.18, 0.42),
    organic: r.range(0.3, 0.6) * (e.kind === "giant" ? 0.8 : 1),
    paid: facts.paidTraffic > 0 ? r.range(0.02, 0.12) : 0.005,
    referral: r.range(0.03, 0.12),
    social: r.range(0.01, 0.09),
    email: r.range(0.005, 0.04),
    ai: r.range(0.004, 0.03),
  };
  const sum = Object.values(mix).reduce((s, v) => s + v, 0);
  const shares = Object.fromEntries(Object.entries(mix).map(([k, v]) => [k, v / sum])) as Record<TrafficChannel, number>;
  const countries = countryDistribution(domain);
  const organicAll = countries.reduce((s, c) => s + c.traffic, 0);
  const visits = Math.round(organicAll / shares.organic);
  const mobile = round(r.range(0.48, 0.78), 3);
  const channels = (Object.keys(shares) as TrafficChannel[])
    .map((channel) => ({ channel, share: round(shares[channel] * 100, 1), visits: Math.round(visits * shares[channel]) }))
    .sort((a, b) => b.visits - a.visits);
  const history = facts.history.map((h) => {
    const v = Math.round((h.organicTraffic / Math.max(1, facts.organicTraffic)) * visits * r.range(0.95, 1.05));
    return { month: h.month, visits: v, uniqueVisitors: Math.round(v * 0.58), desktop: Math.round(v * (1 - mobile)), mobile: Math.round(v * mobile) };
  });
  history[history.length - 1] = { month: history[history.length - 1].month, visits, uniqueVisitors: Math.round(visits * 0.58), desktop: Math.round(visits * (1 - mobile)), mobile: Math.round(visits * mobile) };
  const prev = history[history.length - 2]?.visits || visits;
  const pages = domainPages(domain, e.homeDb).slice(0, 30);
  const pageTotal = pages.reduce((s, p) => s + p.traffic, 0) || 1;
  const competitors = domainCompetitors(domain, e.homeDb, 10);
  const age = ["18-24", "25-34", "35-44", "45-54", "55-64", "65+"].map((band) => ({ band, w: r.range(0.4, 1.6) }));
  const ageSum = age.reduce((s, a) => s + a.w, 0);
  const female = round(r.range(0.3, 0.7) * 100, 1);
  return {
    domain,
    visits,
    uniqueVisitors: Math.round(visits * r.range(0.45, 0.72)),
    pagesPerVisit: round(r.range(1.6, 6.5), 2),
    avgVisitDuration: Math.round(r.range(55, 520)),
    bounceRate: round(r.range(32, 72), 1),
    visitsChangePct: round(((visits - prev) / Math.max(1, prev)) * 100, 1),
    channels,
    devices: { desktop: round((1 - mobile) * 100, 1), mobile: round(mobile * 100, 1) },
    history,
    countries: countries.map((c) => ({ db: c.db, name: c.name, flag: c.flag, share: c.share, visits: Math.round((visits * c.share) / 100) })),
    topPages: pages.map((p) => ({ url: p.url, share: round((p.traffic / pageTotal) * 100, 2), visits: Math.round((visits * shares.organic * p.traffic) / pageTotal) })),
    audienceOverlap: competitors.map((c) => ({ domain: c.domain, overlap: round(clamp(c.competitionLevel * r.range(20, 60), 1, 85), 1), visits: Math.round(c.organicTraffic / 0.45) })),
    journey: {
      previous: normalize([["google.com", r.range(30, 55)], ["direct", r.range(15, 35)], ["youtube.com", r.range(2, 8)], ["facebook.com", r.range(1, 5)], ...competitors.slice(0, 3).map((c) => [c.domain, r.range(1, 6)] as [string, number])]),
      next: normalize([["google.com", r.range(20, 40)], ["exit", r.range(25, 45)], ["youtube.com", r.range(2, 8)], ...competitors.slice(0, 4).map((c) => [c.domain, r.range(1, 7)] as [string, number])]),
    },
    demographics: { age: age.map((a) => ({ band: a.band, share: round((a.w / ageSum) * 100, 1) })), female, male: round(100 - female, 1) },
  };
}, 200);

function normalize(rows: [string, number][]) {
  const total = rows.reduce((s, [, v]) => s + v, 0) || 1;
  return rows.map(([domain, v]) => ({ domain, share: round((v / total) * 100, 1) })).sort((a, b) => b.share - a.share);
}
