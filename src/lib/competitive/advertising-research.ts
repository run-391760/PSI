import { brandPhrase, clamp, domainEntity, domainFacts, keywordMetrics, paidKeywordRows, rng, round, topicById, topicPool, topicUniverse, unit } from "@/lib/seo/engine";
import { database } from "@/lib/domain";
import { dfs, market } from "@/lib/providers/dataforseo";
import { cached, demo as demoData, liveEnabled, type Sourced } from "@/lib/providers/source";
import { demoAllowed } from "@/lib/data-mode";
import { AppError } from "@/lib/domain";
import type { Intent } from "@/lib/seo/types";
import { changePct, recentMonths } from "./shared";

export type PaidRow = {
  keyword: string;
  position: number;
  previousPosition: number | null;
  volume: number;
  cpc: number;
  kd: number;
  competition: number;
  intents: Intent[];
  traffic: number;
  trafficPct: number;
  trafficCost: number;
  costPct: number;
  url: string;
  title: string;
  description: string;
  trend: number[];
};

export type AdsSummary = {
  domain: string;
  db: string;
  topicName: string;
  paidKeywords: number;
  paidTraffic: number;
  paidTrafficCost: number;
  keywordsChange: number;
  trafficChange: number;
  costChange: number;
  history: { month: string; traffic: number; keywords: number; cost: number }[];
};

export type AdsChangeRow = { keyword: string; type: "new" | "improved" | "declined" | "lost"; position: number | null; previousPosition: number | null; volume: number; cpc: number; kd: number; intents: Intent[]; traffic: number; trafficChange: number; url: string };
export type AdsChanges = { counts: Record<AdsChangeRow["type"], number>; trend: { month: string; new: number; improved: number; declined: number; lost: number }[]; rows: AdsChangeRow[] };
export type PaidCompetitor = { domain: string; competitionLevel: number; commonKeywords: number; paidKeywords: number; paidTraffic: number; paidTrafficCost: number | null; organicKeywords: number | null };
export type AdCopy = { id: string; title: string; description: string; url: string; displayUrl: string; keywords: string[]; traffic: number; firstSeen: string; lastSeen: string };
export type AdsHistory = { months: string[]; rows: { keyword: string; volume: number; cpc: number; traffic: number; positions: (number | null)[]; status: "active" | "new" | "lost" }[] };
export type AdsPage = { url: string; keywords: number; traffic: number; trafficPct: number; ads: number };

const TTL = 24 * 7;
const cap = (s: string) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
const stripUtm = (u: string) => u.split("?")[0];

function topicOf(domain: string) {
  const e = domainEntity(domain);
  return topicById(e.topicId === "*" ? "fashion" : e.topicId);
}

// ------------------------------------------------------------------------------------------------ Summary

async function liveSummary(ownerId: string, domain: string, db: string): Promise<AdsSummary> {
  const m = market(db);
  const [rank] = await dfs(ownerId, "dataforseo_labs/google/domain_rank_overview/live", { target: domain, ...m }, 30000);
  const [hist] = await dfs(ownerId, "dataforseo_labs/google/historical_rank_overview/live", { target: domain, ...m }, 40000).catch(() => [undefined]);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const p = (rank as any)?.items?.[0]?.metrics?.paid ?? {};
  const history = (((hist as any)?.items ?? []) as any[])
    .map((h) => ({ month: `${h.year}-${String(h.month).padStart(2, "0")}`, traffic: Math.round(h.metrics?.paid?.etv ?? 0), keywords: h.metrics?.paid?.count ?? 0, cost: Math.round(h.metrics?.paid?.estimated_paid_traffic_cost ?? 0) }))
    .sort((a, b) => a.month.localeCompare(b.month));
  const prev = history[history.length - 2];
  return {
    domain,
    db,
    topicName: "",
    paidKeywords: p.count ?? 0,
    paidTraffic: Math.round(p.etv ?? 0),
    paidTrafficCost: Math.round(p.estimated_paid_traffic_cost ?? 0),
    keywordsChange: changePct(prev?.keywords, p.count),
    trafficChange: changePct(prev?.traffic, p.etv),
    costChange: changePct(prev?.cost, p.estimated_paid_traffic_cost),
    history,
  };
}

export async function getAdsSummary(ownerId: string, domain: string, dbInput: string): Promise<Sourced<AdsSummary>> {
  const db = database(dbInput).code;
  if (liveEnabled()) return cached(`ads-summary:${domain}:${db}`, "dataforseo", TTL, () => liveSummary(ownerId, domain, db));
  const f = domainFacts(domain, db);
  const cpc = f.paidTraffic ? f.paidTrafficCost / f.paidTraffic : 0;
  const r = rng(`adcost:${domain}:${db}`);
  const history = f.history.map((h) => ({ month: h.month, traffic: h.paidTraffic, keywords: h.paidKeywords, cost: Math.round(h.paidTraffic * cpc * r.range(0.92, 1.08)) }));
  history[history.length - 1].cost = f.paidTrafficCost;
  const n = history.length;
  return demo({
    domain,
    db,
    topicName: f.topicName,
    paidKeywords: f.paidKeywords,
    paidTraffic: f.paidTraffic,
    paidTrafficCost: f.paidTrafficCost,
    keywordsChange: changePct(history[n - 2]?.keywords, history[n - 1]?.keywords),
    trafficChange: changePct(history[n - 2]?.traffic, history[n - 1]?.traffic),
    costChange: changePct(history[n - 2]?.cost, history[n - 1]?.cost),
    history,
  });
}

// ------------------------------------------------------------------------------------------------ Positions

function demoPositions(domain: string, db: string): PaidRow[] {
  const rows = paidKeywordRows(domain, db);
  const traffic = rows.reduce((s, k) => s + k.traffic, 0) || 1;
  const cost = rows.reduce((s, k) => s + k.trafficCost, 0) || 1;
  return rows.map((k) => {
    const r = rng(`adprev:${domain}:${k.keyword}:${db}`);
    const previousPosition = r.chance(0.12) ? null : r.chance(0.6) ? k.position : clamp(k.position + r.pick([-2, -1, 1, 2]), 1, 4);
    return {
      keyword: k.keyword,
      position: k.position,
      previousPosition,
      volume: k.metrics.volume,
      cpc: k.metrics.cpc,
      kd: k.metrics.kd,
      competition: k.metrics.competition,
      intents: k.metrics.intents,
      traffic: k.traffic,
      trafficPct: round((k.traffic / traffic) * 100, 2),
      trafficCost: k.trafficCost,
      costPct: round((k.trafficCost / cost) * 100, 2),
      url: k.url,
      title: k.adTitle,
      description: k.adDescription,
      trend: k.metrics.trend,
    };
  });
}

async function livePositions(ownerId: string, domain: string, db: string): Promise<PaidRow[]> {
  const [res] = await dfs(ownerId, "dataforseo_labs/google/ranked_keywords/live", { target: domain, ...market(db), limit: 1000, item_types: ["paid"], order_by: ["ranked_serp_element.serp_item.etv,desc"] }, 110000);
  const items: any[] = (res as any)?.items ?? [];
  const rows = items.map((it) => {
    const kd = it.keyword_data ?? {};
    const serp = it.ranked_serp_element?.serp_item ?? {};
    const traffic = Math.round(serp.etv ?? 0);
    const cpc = kd.keyword_info?.cpc ?? 0;
    return {
      keyword: String(kd.keyword ?? ""),
      position: serp.rank_group ?? 0,
      previousPosition: serp.rank_changes?.is_new ? null : (serp.rank_changes?.previous_rank_absolute ?? null),
      volume: kd.keyword_info?.search_volume ?? 0,
      cpc,
      kd: kd.keyword_properties?.keyword_difficulty ?? 0,
      competition: kd.keyword_info?.competition ?? 0,
      intents: [kd.search_intent_info?.main_intent].filter(Boolean) as Intent[],
      traffic,
      trafficPct: 0,
      trafficCost: round(traffic * cpc, 2),
      costPct: 0,
      url: serp.url ?? "",
      title: serp.title ?? "",
      description: serp.description ?? "",
      trend: ((kd.keyword_info?.monthly_searches ?? []) as { search_volume?: number }[])
        .slice(0, 12)
        .reverse()
        .map((x) => x.search_volume ?? 0),
    };
  });
  const t = rows.reduce((s, r) => s + r.traffic, 0) || 1;
  const c = rows.reduce((s, r) => s + r.trafficCost, 0) || 1;
  for (const r of rows) {
    r.trafficPct = round((r.traffic / t) * 100, 2);
    r.costPct = round((r.trafficCost / c) * 100, 2);
  }
  return rows;
}

export async function getAdsPositions(ownerId: string, domain: string, dbInput: string): Promise<Sourced<PaidRow[]>> {
  const db = database(dbInput).code;
  if (liveEnabled()) return cached(`ads-positions:${domain}:${db}`, "dataforseo", TTL, () => livePositions(ownerId, domain, db));
  return demo(demoPositions(domain, db));
}

// ------------------------------------------------------------------------------------------------ Changes & history

function demoLost(domain: string, db: string, current: Set<string>) {
  if (!current.size) return [];
  return topicUniverse(topicOf(domain).id)
    .filter((k) => !current.has(k) && unit(`adlost:${domain}:${k}:${db}`) < 0.025)
    .map((k) => ({ keyword: k, metrics: keywordMetrics(k, db), previousPosition: rng(`adlostpos:${domain}:${k}`).int(1, 4) }))
    .filter((x) => x.metrics.cpc > 0 && x.metrics.intents.some((i) => i === "commercial" || i === "transactional"));
}

export async function getAdsChanges(ownerId: string, domain: string, dbInput: string): Promise<Sourced<AdsChanges>> {
  const db = database(dbInput).code;
  const pos = await getAdsPositions(ownerId, domain, db);
  const ctr = [0.065, 0.04, 0.03, 0.02, 0.015, 0.012, 0.01, 0.008];
  const rows: AdsChangeRow[] = [];
  for (const k of pos.data) {
    const prev = k.previousPosition;
    const type = prev == null ? "new" : prev > k.position ? "improved" : prev < k.position ? "declined" : null;
    if (!type) continue;
    const before = prev == null ? 0 : Math.round(k.volume * (ctr[prev - 1] ?? 0.005));
    rows.push({ keyword: k.keyword, type, position: k.position, previousPosition: prev, volume: k.volume, cpc: k.cpc, kd: k.kd, intents: k.intents, traffic: k.traffic, trafficChange: k.traffic - before, url: k.url });
  }
  if (pos.source === "demo")
    for (const l of demoLost(domain, db, new Set(pos.data.map((k) => k.keyword))))
      rows.push({ keyword: l.keyword, type: "lost", position: null, previousPosition: l.previousPosition, volume: l.metrics.volume, cpc: l.metrics.cpc, kd: l.metrics.kd, intents: l.metrics.intents, traffic: 0, trafficChange: -Math.round(l.metrics.volume * (ctr[l.previousPosition - 1] ?? 0.01)), url: "" });
  const counts = { new: 0, improved: 0, declined: 0, lost: 0 };
  for (const r of rows) counts[r.type]++;
  const months = recentMonths(12);
  const r = rng(`adchg:${domain}:${db}`);
  // Month-by-month history is only reconstructed by the demo engine; live data has the current period only.
  if (pos.source !== "demo") return { ...pos, data: { counts, trend: [], rows } };
  const trend = months.map((month, i) => (i === months.length - 1 ? { month, ...counts } : { month, new: Math.round(counts.new * r.range(0.5, 1.5)), improved: Math.round(counts.improved * r.range(0.5, 1.5)), declined: Math.round(counts.declined * r.range(0.5, 1.5)), lost: Math.round(counts.lost * r.range(0.5, 1.5)) }));
  return { ...pos, data: { counts, trend, rows } };
}

/** Keyword × month grid of ad positions (deterministic demo reconstruction; not available live). */
export async function getAdsHistory(ownerId: string, domain: string, dbInput: string): Promise<Sourced<AdsHistory>> {
  const db = database(dbInput).code;
  const months = recentMonths(12);
  if (liveEnabled()) return { ...(await getAdsPositions(ownerId, domain, db)), data: { months, rows: [] } };
  const pos = demoPositions(domain, db);
  const rows: AdsHistory["rows"] = pos.slice(0, 60).map((k) => {
    const r = rng(`adhist:${domain}:${k.keyword}:${db}`);
    const isNew = k.previousPosition == null;
    const start = isNew ? 11 : r.chance(0.45) ? 0 : r.int(1, 9);
    const positions = months.map((_, m) => {
      if (m === 11) return k.position;
      if (m === 10 && !isNew) return k.previousPosition;
      if (m < start || r.chance(0.1)) return null;
      return clamp(k.position + r.pick([-1, 0, 0, 1]), 1, 4);
    });
    return { keyword: k.keyword, volume: k.volume, cpc: k.cpc, traffic: k.traffic, positions, status: isNew ? "new" : "active" };
  });
  for (const l of demoLost(domain, db, new Set(pos.map((k) => k.keyword))).slice(0, 10)) {
    const r = rng(`adhistlost:${domain}:${l.keyword}:${db}`);
    const start = r.int(0, 8);
    rows.push({
      keyword: l.keyword,
      volume: l.metrics.volume,
      cpc: l.metrics.cpc,
      traffic: 0,
      positions: months.map((_, m) => (m === 11 ? null : m === 10 ? l.previousPosition : m < start || r.chance(0.12) ? null : clamp(l.previousPosition + r.pick([-1, 0, 1]), 1, 4))),
      status: "lost",
    });
  }
  return demo({ months, rows });
}

// ------------------------------------------------------------------------------------------------ Competitors

async function liveCompetitors(ownerId: string, domain: string, db: string): Promise<PaidCompetitor[]> {
  const [res] = await dfs(ownerId, "dataforseo_labs/google/competitors_domain/live", { target: domain, ...market(db), limit: 50, item_types: ["paid"] }, 60000);
  const items: any[] = (res as any)?.items ?? [];
  const mine = items.find((c) => c.domain === domain)?.full_domain_metrics?.paid?.count ?? 0;
  return items
    .filter((c) => c.domain && c.domain !== domain)
    .map((c) => {
      const p = c.full_domain_metrics?.paid ?? {};
      const common = c.intersections ?? 0;
      return {
        domain: c.domain,
        competitionLevel: Math.min(1, common / Math.max(1, mine + (p.count ?? 0) - common)),
        commonKeywords: common,
        paidKeywords: p.count ?? 0,
        paidTraffic: Math.round(p.etv ?? 0),
        paidTrafficCost: Math.round(p.estimated_paid_traffic_cost ?? 0),
        organicKeywords: c.full_domain_metrics?.organic?.count ?? null,
      };
    });
}

export async function getAdsCompetitors(ownerId: string, domain: string, dbInput: string): Promise<Sourced<PaidCompetitor[]>> {
  const db = database(dbInput).code;
  if (liveEnabled()) return cached(`ads-competitors:${domain}:${db}`, "dataforseo", TTL, () => liveCompetitors(ownerId, domain, db));
  const mine = new Set(paidKeywordRows(domain, db).map((k) => k.keyword));
  if (!mine.size) return demo([]);
  const ranked: { domain: string; common: number; level: number }[] = [];
  for (const cand of topicPool(topicOf(domain).id)) {
    if (cand.domain === domain) continue;
    const theirs = paidKeywordRows(cand.domain, db);
    const common = theirs.filter((k) => mine.has(k.keyword)).length;
    if (!common) continue;
    ranked.push({ domain: cand.domain, common, level: round(common / (mine.size + theirs.length - common), 3) });
  }
  return demo(
    ranked
      .sort((a, b) => b.level - a.level)
      .slice(0, 30)
      .map((c) => {
        const f = domainFacts(c.domain, db);
        return { domain: c.domain, competitionLevel: c.level, commonKeywords: c.common, paidKeywords: f.paidKeywords, paidTraffic: f.paidTraffic, paidTrafficCost: f.paidTrafficCost, organicKeywords: f.organicKeywords };
      }),
  );
}

// ------------------------------------------------------------------------------------------------ Ad copies & pages

export function adCopiesFrom(domain: string, rows: PaidRow[], live: boolean): AdCopy[] {
  const groups = new Map<string, PaidRow[]>();
  for (const k of rows) {
    const key = live ? `${k.title}|${k.description}` : stripUtm(k.url);
    groups.set(key, [...(groups.get(key) ?? []), k]);
  }
  const months = recentMonths(12);
  const brand = cap(brandPhrase(domain));
  return [...groups.entries()]
    .map(([key, ks]) => {
      const lead = [...ks].sort((a, b) => b.traffic - a.traffic)[0];
      const r = rng(`adcopy:${domain}:${key}`);
      const slug = stripUtm(lead.url).replace(/\/$/, "").split("/").pop() ?? "";
      const head = cap(slug.replace(/-/g, " "));
      const title = live
        ? lead.title
        : r.pick([`${head} | ${brand}® Official Site`, `Shop ${head} Online - ${brand}`, `${head} Sale — Up to 30% Off | ${brand}`, `Best ${head} of 2026 | ${brand}`]);
      const description = live ? lead.description : lead.description.replace(lead.keyword, head.toLowerCase());
      const first = r.int(0, 9);
      return {
        id: key,
        title,
        description,
        url: stripUtm(lead.url),
        displayUrl: stripUtm(lead.url).replace(/^https?:\/\//, "").replace(/\/$/, ""),
        keywords: ks.map((k) => k.keyword),
        traffic: ks.reduce((s, k) => s + k.traffic, 0),
        firstSeen: months[first],
        lastSeen: months[11],
      };
    })
    .sort((a, b) => b.keywords.length - a.keywords.length || b.traffic - a.traffic);
}

export function adsPagesFrom(rows: PaidRow[], copies: AdCopy[]): AdsPage[] {
  const total = rows.reduce((s, k) => s + k.traffic, 0) || 1;
  const map = new Map<string, AdsPage>();
  for (const k of rows) {
    const url = stripUtm(k.url);
    const p = map.get(url) ?? { url, keywords: 0, traffic: 0, trafficPct: 0, ads: 0 };
    p.keywords++;
    p.traffic += k.traffic;
    map.set(url, p);
  }
  for (const c of copies) {
    const p = map.get(c.url);
    if (p) p.ads++;
  }
  return [...map.values()].map((p) => ({ ...p, ads: Math.max(1, p.ads), trafficPct: round((p.traffic / total) * 100, 2) })).sort((a, b) => b.traffic - a.traffic);
}

/** Demo data only in local development (DEMO_DATA=true). */
function demo<T>(data: T, note?: string): Sourced<T> {
  if (!demoAllowed()) throw new AppError("Advertising Research needs DataForSEO.", 409);
  return demoData(data, note);
}
