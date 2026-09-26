import { ctrFor, domainCompetitors, domainKeywords, domainPages, domainSubdomains, lostKeywords, rng, round } from "@/lib/seo/engine";
import { database } from "@/lib/domain";
import { dfs, market } from "@/lib/providers/dataforseo";
import { cached, demo, liveEnabled, type Sourced } from "@/lib/providers/source";
import type { Intent, SerpFeature } from "@/lib/seo/types";
import { type KeywordRow, toKeywordRow } from "./domain-overview";
import { recentMonths } from "./shared";

export { getDomainOverview as getOrganicSummary } from "./domain-overview";

export type OrganicPosition = KeywordRow & { branded: boolean; trafficCost: number };
export type ChangeType = "new" | "improved" | "declined" | "lost";
export type PositionChangeRow = {
  keyword: string;
  type: ChangeType;
  position: number | null;
  previousPosition: number | null;
  change: number | null;
  volume: number;
  kd: number;
  cpc: number;
  intents: Intent[];
  traffic: number;
  trafficChange: number;
  url: string;
};
export type OrganicChanges = {
  counts: Record<ChangeType, number>;
  trend: { month: string; new: number; improved: number; declined: number; lost: number }[];
  rows: PositionChangeRow[];
};
export type OrganicCompetitor = {
  domain: string;
  competitionLevel: number;
  commonKeywords: number;
  organicKeywords: number;
  organicTraffic: number;
  trafficCost: number;
  paidKeywords: number;
  authorityScore: number | null;
};
export type OrganicPage = { url: string; traffic: number; trafficPct: number; keywords: number; topKeyword: string; backlinks: number | null };
export type OrganicSubdomain = { subdomain: string; traffic: number; trafficPct: number; keywords: number };

const TTL = 24 * 7;
const MAX_ROWS = 2500;

// ------------------------------------------------------------------------------------------------
// Positions
// ------------------------------------------------------------------------------------------------

function demoPositions(domain: string, db: string): OrganicPosition[] {
  return domainKeywords(domain, db)
    .slice(0, MAX_ROWS)
    .map((k) => ({ ...toKeywordRow(k), branded: k.branded, trafficCost: k.trafficCost }));
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapRanked(items: any[], domain: string, totalTraffic: number): OrganicPosition[] {
  const label = domain.split(".")[0];
  return items.map((it) => {
    const kd = it.keyword_data ?? {};
    const serp = it.ranked_serp_element?.serp_item ?? {};
    const keyword = String(kd.keyword ?? "");
    const traffic = Math.round(serp.etv ?? 0);
    const cpc = kd.keyword_info?.cpc ?? 0;
    return {
      keyword,
      position: serp.rank_group ?? 0,
      previousPosition: serp.rank_changes?.is_new ? null : (serp.rank_changes?.previous_rank_absolute ?? null),
      url: serp.url ?? "",
      volume: kd.keyword_info?.search_volume ?? 0,
      kd: kd.keyword_properties?.keyword_difficulty ?? 0,
      cpc,
      intents: [kd.search_intent_info?.main_intent, ...(kd.search_intent_info?.foreign_intent ?? [])].filter(Boolean).slice(0, 2) as Intent[],
      traffic,
      trafficPct: totalTraffic ? round((traffic / totalTraffic) * 100, 2) : 0,
      serpFeatures: (kd.serp_info?.serp_item_types ?? []) as SerpFeature[],
      ownedFeatures: [],
      trend: ((kd.keyword_info?.monthly_searches ?? []) as { search_volume?: number }[])
        .slice(0, 12)
        .reverse()
        .map((x) => x.search_volume ?? 0),
      branded: keyword.replace(/\s+/g, "").includes(label),
      trafficCost: round(traffic * cpc, 2),
    };
  });
}

async function livePositions(ownerId: string, domain: string, db: string) {
  const [res] = await dfs(ownerId, "dataforseo_labs/google/ranked_keywords/live", { target: domain, ...market(db), limit: 1000, order_by: ["ranked_serp_element.serp_item.etv,desc"] }, 110000);
  const items: any[] = res?.items ?? [];
  const total = items.reduce((s, it) => s + (it.ranked_serp_element?.serp_item?.etv ?? 0), 0);
  return mapRanked(items, domain, total);
}

export async function getOrganicPositions(ownerId: string, domain: string, dbInput: string): Promise<Sourced<OrganicPosition[]>> {
  const db = database(dbInput).code;
  if (liveEnabled()) return cached(`organic-positions:${domain}:${db}`, "dataforseo", TTL, () => livePositions(ownerId, domain, db));
  return demo(demoPositions(domain, db));
}

// ------------------------------------------------------------------------------------------------
// Position changes
// ------------------------------------------------------------------------------------------------

function changesFrom(positions: OrganicPosition[], lost: PositionChangeRow[], seed: string): OrganicChanges {
  const rows: PositionChangeRow[] = [];
  for (const k of positions) {
    const prev = k.previousPosition;
    const type: ChangeType | null = prev == null ? "new" : prev > k.position ? "improved" : prev < k.position ? "declined" : null;
    if (!type) continue;
    const before = prev == null ? 0 : Math.round(k.volume * ctrFor(prev, k.serpFeatures));
    rows.push({
      keyword: k.keyword,
      type,
      position: k.position,
      previousPosition: prev,
      change: prev == null ? null : prev - k.position,
      volume: k.volume,
      kd: k.kd,
      cpc: k.cpc,
      intents: k.intents,
      traffic: k.traffic,
      trafficChange: k.traffic - before,
      url: k.url,
    });
  }
  rows.push(...lost);
  const counts = { new: 0, improved: 0, declined: 0, lost: 0 } as Record<ChangeType, number>;
  for (const r of rows) counts[r.type]++;
  const months = recentMonths(12);
  const r = rng(`orgchg:${seed}`);
  const trend = months.map((month, i) => {
    if (i === months.length - 1) return { month, ...counts };
    const f = () => r.range(0.55, 1.45);
    return { month, new: Math.round(counts.new * f()), improved: Math.round(counts.improved * f()), declined: Math.round(counts.declined * f()), lost: Math.round(counts.lost * f()) };
  });
  return { counts, trend, rows };
}

export async function getOrganicChanges(ownerId: string, domain: string, dbInput: string): Promise<Sourced<OrganicChanges>> {
  const db = database(dbInput).code;
  const positions = await getOrganicPositions(ownerId, domain, db);
  if (positions.source !== "demo") return { ...positions, data: changesFrom(positions.data, [], `${domain}:${db}`) };
  const lost: PositionChangeRow[] = lostKeywords(domain, db).map((l) => {
    const before = Math.round(l.metrics.volume * ctrFor(l.previousPosition, l.metrics.serpFeatures));
    return {
      keyword: l.keyword,
      type: "lost",
      position: null,
      previousPosition: l.previousPosition,
      change: null,
      volume: l.metrics.volume,
      kd: l.metrics.kd,
      cpc: l.metrics.cpc,
      intents: l.metrics.intents,
      traffic: 0,
      trafficChange: -before,
      url: "",
    };
  });
  return demo(changesFrom(positions.data, lost, `${domain}:${db}`));
}

// ------------------------------------------------------------------------------------------------
// Competitors, pages, subdomains
// ------------------------------------------------------------------------------------------------

async function liveCompetitors(ownerId: string, domain: string, db: string): Promise<OrganicCompetitor[]> {
  const [res] = await dfs(ownerId, "dataforseo_labs/google/competitors_domain/live", { target: domain, ...market(db), limit: 50 }, 60000);
  const items: any[] = res?.items ?? [];
  const own = items.find((c) => c.domain === domain);
  const mine = own?.full_domain_metrics?.organic?.count ?? 0;
  return items
    .filter((c) => c.domain && c.domain !== domain)
    .map((c) => {
      const o = c.full_domain_metrics?.organic ?? {};
      const p = c.full_domain_metrics?.paid ?? {};
      const common = c.intersections ?? 0;
      return {
        domain: c.domain,
        competitionLevel: Math.min(1, common / Math.max(1, mine + (o.count ?? 0) - common)),
        commonKeywords: common,
        organicKeywords: o.count ?? 0,
        organicTraffic: Math.round(o.etv ?? 0),
        trafficCost: Math.round(o.estimated_paid_traffic_cost ?? 0),
        paidKeywords: p.count ?? 0,
        authorityScore: null,
      };
    });
}

export async function getOrganicCompetitors(ownerId: string, domain: string, dbInput: string): Promise<Sourced<OrganicCompetitor[]>> {
  const db = database(dbInput).code;
  if (liveEnabled()) return cached(`organic-competitors:${domain}:${db}`, "dataforseo", TTL, () => liveCompetitors(ownerId, domain, db));
  return demo(
    domainCompetitors(domain, db, 40).map((c) => ({
      domain: c.domain,
      competitionLevel: c.competitionLevel,
      commonKeywords: c.commonKeywords,
      organicKeywords: c.organicKeywords,
      organicTraffic: c.organicTraffic,
      trafficCost: c.trafficCost,
      paidKeywords: c.paidKeywords,
      authorityScore: c.authorityScore,
    })),
  );
}

async function livePages(ownerId: string, domain: string, db: string): Promise<OrganicPage[]> {
  const [res] = await dfs(ownerId, "dataforseo_labs/google/relevant_pages/live", { target: domain, ...market(db), limit: 200, order_by: ["metrics.organic.etv,desc"] }, 60000);
  const items: any[] = res?.items ?? [];
  const total = items.reduce((s, p) => s + (p.metrics?.organic?.etv ?? 0), 0);
  return items.map((p) => {
    const traffic = Math.round(p.metrics?.organic?.etv ?? 0);
    return { url: p.page_address ?? "", traffic, trafficPct: total ? round((traffic / total) * 100, 2) : 0, keywords: p.metrics?.organic?.count ?? 0, topKeyword: "", backlinks: null };
  });
}

export async function getOrganicPages(ownerId: string, domain: string, dbInput: string): Promise<Sourced<OrganicPage[]>> {
  const db = database(dbInput).code;
  if (liveEnabled()) return cached(`organic-pages:${domain}:${db}`, "dataforseo", TTL, () => livePages(ownerId, domain, db));
  return demo(domainPages(domain, db).slice(0, 1000));
}

async function liveSubdomains(ownerId: string, domain: string, db: string): Promise<OrganicSubdomain[]> {
  const [res] = await dfs(ownerId, "dataforseo_labs/google/subdomains/live", { target: domain, ...market(db), limit: 100 }, 40000);
  const items: any[] = res?.items ?? [];
  const total = items.reduce((s, x) => s + (x.metrics?.organic?.etv ?? 0), 0);
  return items.map((x) => {
    const traffic = Math.round(x.metrics?.organic?.etv ?? 0);
    return { subdomain: x.subdomain ?? "", traffic, trafficPct: total ? round((traffic / total) * 100, 1) : 0, keywords: x.metrics?.organic?.count ?? 0 };
  });
}

export async function getOrganicSubdomains(ownerId: string, domain: string, dbInput: string): Promise<Sourced<OrganicSubdomain[]>> {
  const db = database(dbInput).code;
  if (liveEnabled()) return cached(`organic-subdomains:${domain}:${db}`, "dataforseo", TTL, () => liveSubdomains(ownerId, domain, db));
  return demo(domainSubdomains(domain, db));
}
