import {
  anchors as engineAnchors,
  backlinks as engineBacklinks,
  countryDistribution,
  domainCompetitors,
  domainFacts,
  domainKeywords,
  domainPages,
  paidKeywordRows,
  referringDomains,
} from "@/lib/seo/engine";
import { database } from "@/lib/domain";
import { dfs, market } from "@/lib/providers/dataforseo";
import { cached, demo, liveEnabled, type Sourced } from "@/lib/providers/source";
import type { CountryShare, Intent, MonthlyPoint, SerpFeature } from "@/lib/seo/types";

/** Slim keyword row sent to the client. */
export type KeywordRow = {
  keyword: string;
  position: number;
  previousPosition: number | null;
  url: string;
  volume: number;
  kd: number;
  cpc: number;
  intents: Intent[];
  traffic: number;
  trafficPct: number;
  serpFeatures: SerpFeature[];
  ownedFeatures: SerpFeature[];
  trend: number[];
};

export type DomainOverview = {
  domain: string;
  db: string;
  topicName: string;
  authorityScore: number;
  organic: { traffic: number; trafficChangePct: number; keywords: number; keywordsChangePct: number; trafficCost: number };
  paid: { traffic: number; keywords: number; trafficCost: number };
  backlinks: { total: number; referringDomains: number; referringIps: number; followRatio: number };
  history: MonthlyPoint[];
  countries: CountryShare[];
  positionBuckets: { label: string; keywords: number }[];
  intents: { intent: Intent; keywords: number; traffic: number }[];
  serpFeatures: { feature: SerpFeature; keywords: number }[];
  brandedTraffic: { branded: number; nonBranded: number };
  topKeywords: KeywordRow[];
  competitors: { domain: string; commonKeywords: number; competitionLevel: number; organicKeywords: number; organicTraffic: number; authorityScore: number }[];
  topPages: { url: string; traffic: number; trafficPct: number; keywords: number }[];
  paidKeywords: { keyword: string; position: number; volume: number; cpc: number; traffic: number; url: string }[];
  ads: { keyword: string; title: string; description: string; url: string }[];
  referringDomains: { domain: string; authorityScore: number; backlinks: number; country: string; firstSeen: string }[];
  anchors: { anchor: string; referringDomains: number; backlinks: number }[];
  linkTypes: { type: string; count: number }[];
};

const BUCKETS: [string, number, number][] = [
  ["1–3", 1, 3],
  ["4–10", 4, 10],
  ["11–20", 11, 20],
  ["21–50", 21, 50],
  ["51–100", 51, 100],
];

export function toKeywordRow(k: ReturnType<typeof domainKeywords>[number]): KeywordRow {
  return {
    keyword: k.keyword,
    position: k.position,
    previousPosition: k.previousPosition,
    url: k.url,
    volume: k.metrics.volume,
    kd: k.metrics.kd,
    cpc: k.metrics.cpc,
    intents: k.metrics.intents,
    traffic: k.traffic,
    trafficPct: k.trafficPct,
    serpFeatures: k.metrics.serpFeatures,
    ownedFeatures: k.ownedFeatures,
    trend: k.metrics.trend,
  };
}

function demoOverview(domain: string, db: string): DomainOverview {
  const f = domainFacts(domain, db);
  const sample = domainKeywords(domain, db);
  const scale = f.organicKeywords / Math.max(1, sample.length);
  const trafficScale = f.organicTraffic / Math.max(1, sample.reduce((s, k) => s + k.traffic, 0));
  const intents = (["informational", "navigational", "commercial", "transactional"] as Intent[]).map((intent) => {
    const rows = sample.filter((k) => k.metrics.intents[0] === intent);
    return { intent, keywords: Math.round(rows.length * scale), traffic: Math.round(rows.reduce((s, k) => s + k.traffic, 0) * trafficScale) };
  });
  const featureCounts = new Map<SerpFeature, number>();
  for (const k of sample) for (const ft of k.metrics.serpFeatures) featureCounts.set(ft, (featureCounts.get(ft) ?? 0) + 1);
  const branded = sample.filter((k) => k.branded).reduce((s, k) => s + k.traffic, 0);
  const nonBranded = sample.filter((k) => !k.branded).reduce((s, k) => s + k.traffic, 0);
  const home = domainFacts(domain, f.homeDb);
  const rds = referringDomains(domain);
  const bl = engineBacklinks(domain);
  const types = new Map<string, number>();
  for (const b of bl) types.set(b.type, (types.get(b.type) ?? 0) + 1);
  const blScale = home.backlinks / Math.max(1, bl.length);
  return {
    domain,
    db,
    topicName: f.topicName,
    authorityScore: f.authorityScore,
    organic: { traffic: f.organicTraffic, trafficChangePct: f.trafficChangePct, keywords: f.organicKeywords, keywordsChangePct: f.keywordsChangePct, trafficCost: f.organicTrafficCost },
    paid: { traffic: f.paidTraffic, keywords: f.paidKeywords, trafficCost: f.paidTrafficCost },
    backlinks: { total: f.backlinks, referringDomains: f.referringDomains, referringIps: f.referringIps, followRatio: f.followRatio },
    history: f.history,
    countries: countryDistribution(domain),
    positionBuckets: BUCKETS.map(([label, a, b]) => ({ label, keywords: Math.round(sample.filter((k) => k.position >= a && k.position <= b).length * scale) })),
    intents,
    serpFeatures: [...featureCounts.entries()]
      .filter(([ft]) => ft !== "related_searches")
      .map(([feature, n]) => ({ feature, keywords: Math.round(n * scale) }))
      .sort((a, b) => b.keywords - a.keywords),
    brandedTraffic: { branded: Math.round(branded * trafficScale), nonBranded: Math.round(nonBranded * trafficScale) },
    topKeywords: sample.slice(0, 10).map(toKeywordRow),
    competitors: domainCompetitors(domain, db, 10).map((c) => ({ domain: c.domain, commonKeywords: c.commonKeywords, competitionLevel: c.competitionLevel, organicKeywords: c.organicKeywords, organicTraffic: c.organicTraffic, authorityScore: c.authorityScore })),
    topPages: domainPages(domain, db).slice(0, 8).map((p) => ({ url: p.url, traffic: Math.round(p.traffic * trafficScale), trafficPct: p.trafficPct, keywords: Math.round(p.keywords * scale) })),
    paidKeywords: paidKeywordRows(domain, db).slice(0, 8).map((p) => ({ keyword: p.keyword, position: p.position, volume: p.metrics.volume, cpc: p.metrics.cpc, traffic: p.traffic, url: p.url })),
    ads: paidKeywordRows(domain, db).slice(0, 3).map((p) => ({ keyword: p.keyword, title: p.adTitle, description: p.adDescription, url: p.url })),
    referringDomains: rds.slice(0, 8).map((r) => ({ domain: r.domain, authorityScore: r.authorityScore, backlinks: r.backlinks, country: r.country, firstSeen: r.firstSeen })),
    anchors: engineAnchors(domain).slice(0, 8).map((a) => ({ anchor: a.anchor, referringDomains: a.referringDomains, backlinks: a.backlinks })),
    linkTypes: [...types.entries()].map(([type, n]) => ({ type, count: Math.round(n * blScale) })),
  };
}

/**
 * Live Domain Overview from DataForSEO Labs + Backlinks. Fields the provider does not return fall back
 * to empty arrays (never to demo numbers) so live and demo data are never mixed.
 */
async function liveOverview(ownerId: string, domain: string, db: string): Promise<DomainOverview> {
  const m = market(db);
  const [rank] = await dfs(ownerId, "dataforseo_labs/google/domain_rank_overview/live", { target: domain, ...m }, 30000);
  const [ranked] = await dfs(ownerId, "dataforseo_labs/google/ranked_keywords/live", { target: domain, ...m, limit: 100, order_by: ["ranked_serp_element.serp_item.etv,desc"] }, 60000);
  const [comp] = await dfs(ownerId, "dataforseo_labs/google/competitors_domain/live", { target: domain, ...m, limit: 10 }, 40000);
  const [hist] = await dfs(ownerId, "dataforseo_labs/google/historical_rank_overview/live", { target: domain, ...m }, 40000);
  const [bl] = await dfs(ownerId, "backlinks/summary/live", { target: domain, include_subdomains: true }, 30000).catch(() => [undefined]);
  const o = rank?.items?.[0]?.metrics?.organic ?? {};
  const p = rank?.items?.[0]?.metrics?.paid ?? {};
  const items: any[] = ranked?.items ?? [];
  const rows: KeywordRow[] = items.map((it) => {
    const kd = it.keyword_data ?? {};
    const serp = it.ranked_serp_element?.serp_item ?? {};
    return {
      keyword: kd.keyword,
      position: serp.rank_group ?? 0,
      previousPosition: serp.rank_changes?.previous_rank_absolute ?? null,
      url: serp.url ?? "",
      volume: kd.keyword_info?.search_volume ?? 0,
      kd: kd.keyword_properties?.keyword_difficulty ?? 0,
      cpc: kd.keyword_info?.cpc ?? 0,
      intents: [kd.search_intent_info?.main_intent, ...(kd.search_intent_info?.foreign_intent ?? [])].filter(Boolean).slice(0, 2) as Intent[],
      traffic: Math.round(serp.etv ?? 0),
      trafficPct: 0,
      serpFeatures: (kd.serp_info?.serp_item_types ?? []) as SerpFeature[],
      ownedFeatures: [],
      trend: ((kd.keyword_info?.monthly_searches ?? []) as { search_volume: number }[]).slice(0, 12).reverse().map((x) => x.search_volume ?? 0),
    };
  });
  const totalTraffic = Math.round(o.etv ?? 0);
  for (const r of rows) r.trafficPct = totalTraffic ? Math.round((r.traffic / totalTraffic) * 10000) / 100 : 0;
  const history: MonthlyPoint[] = ((hist?.items ?? []) as any[])
    .map((h) => ({
      month: `${h.year}-${String(h.month).padStart(2, "0")}`,
      organicTraffic: Math.round(h.metrics?.organic?.etv ?? 0),
      organicKeywords: h.metrics?.organic?.count ?? 0,
      paidTraffic: Math.round(h.metrics?.paid?.etv ?? 0),
      paidKeywords: h.metrics?.paid?.count ?? 0,
      top3: (h.metrics?.organic?.pos_1 ?? 0) + (h.metrics?.organic?.pos_2_3 ?? 0),
      top10: (h.metrics?.organic?.pos_1 ?? 0) + (h.metrics?.organic?.pos_2_3 ?? 0) + (h.metrics?.organic?.pos_4_10 ?? 0),
      top20: 0,
      top100: h.metrics?.organic?.count ?? 0,
      backlinks: 0,
      referringDomains: 0,
      authorityScore: 0,
    }))
    .sort((a, b) => a.month.localeCompare(b.month));
  const pct = (a?: number, b?: number) => (a != null && b ? Math.round(((a - b) / b) * 1000) / 10 : 0);
  const prev = history[history.length - 2];
  return {
    domain,
    db,
    topicName: "",
    authorityScore: bl?.rank != null ? Math.round(bl.rank / 10) : 0,
    organic: { traffic: totalTraffic, trafficChangePct: pct(o.etv, prev?.organicTraffic), keywords: o.count ?? 0, keywordsChangePct: pct(o.count, prev?.organicKeywords), trafficCost: Math.round(o.estimated_paid_traffic_cost ?? 0) },
    paid: { traffic: Math.round(p.etv ?? 0), keywords: p.count ?? 0, trafficCost: Math.round(p.estimated_paid_traffic_cost ?? 0) },
    backlinks: { total: bl?.backlinks ?? 0, referringDomains: bl?.referring_domains ?? 0, referringIps: bl?.referring_ips ?? 0, followRatio: bl?.referring_domains ? 1 - (bl.referring_domains_nofollow ?? 0) / bl.referring_domains : 0 },
    history,
    countries: [],
    positionBuckets: [
      { label: "1–3", keywords: (o.pos_1 ?? 0) + (o.pos_2_3 ?? 0) },
      { label: "4–10", keywords: o.pos_4_10 ?? 0 },
      { label: "11–20", keywords: o.pos_11_20 ?? 0 },
      { label: "21–50", keywords: (o.pos_21_30 ?? 0) + (o.pos_31_40 ?? 0) + (o.pos_41_50 ?? 0) },
      { label: "51–100", keywords: (o.pos_51_60 ?? 0) + (o.pos_61_70 ?? 0) + (o.pos_71_80 ?? 0) + (o.pos_81_90 ?? 0) + (o.pos_91_100 ?? 0) },
    ],
    intents: (["informational", "navigational", "commercial", "transactional"] as Intent[]).map((intent) => ({
      intent,
      keywords: rows.filter((r) => r.intents[0] === intent).length,
      traffic: rows.filter((r) => r.intents[0] === intent).reduce((s, r) => s + r.traffic, 0),
    })),
    serpFeatures: [],
    brandedTraffic: { branded: 0, nonBranded: totalTraffic },
    topKeywords: rows.slice(0, 10),
    competitors: ((comp?.items ?? []) as any[])
      .filter((c) => c.domain !== domain)
      .map((c) => ({
        domain: c.domain,
        commonKeywords: c.intersections ?? 0,
        competitionLevel: Math.min(1, (c.intersections ?? 0) / Math.max(1, o.count ?? 1)),
        organicKeywords: c.full_domain_metrics?.organic?.count ?? 0,
        organicTraffic: Math.round(c.full_domain_metrics?.organic?.etv ?? 0),
        authorityScore: 0,
      })),
    topPages: [],
    paidKeywords: [],
    ads: [],
    referringDomains: [],
    anchors: [],
    linkTypes: [],
  };
}

export async function getDomainOverview(ownerId: string, domain: string, dbInput: string): Promise<Sourced<DomainOverview>> {
  const db = database(dbInput).code;
  if (liveEnabled()) return cached(`domain-overview:${domain}:${db}`, "dataforseo", 24 * 7, () => liveOverview(ownerId, domain, db));
  return demo(demoOverview(domain, db));
}
