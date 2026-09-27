import type { DomainOverview } from "@/lib/competitive/domain-overview";
import type { BlOverview, BlSummary } from "@/lib/backlinks/types";

/** Pure mappings for report data (unit-tested; no server imports). */

export type SlimFacts = {
  domain: string;
  authorityScore: number;
  organicTraffic: number;
  organicKeywords: number;
  trafficChangePct: number;
  paidTraffic: number;
  paidKeywords: number;
  backlinks: number;
  referringDomains: number;
  referringIps: number;
  followRatio: number;
  topicName: string;
  history: { month: string; organicTraffic: number; organicKeywords: number; top3: number; top10: number; referringDomains: number; backlinks: number; authorityScore: number }[];
};

/** Domain Overview (live DataForSEO) → comparison row. */
export function slimFromOverview(o: DomainOverview): SlimFacts {
  return {
    domain: o.domain,
    authorityScore: o.authorityScore,
    organicTraffic: o.organic.traffic,
    organicKeywords: o.organic.keywords,
    trafficChangePct: o.organic.trafficChangePct,
    paidTraffic: o.paid.traffic,
    paidKeywords: o.paid.keywords,
    backlinks: o.backlinks.total,
    referringDomains: o.backlinks.referringDomains,
    referringIps: o.backlinks.referringIps,
    followRatio: o.backlinks.followRatio,
    topicName: o.topicName,
    history: o.history.map((h) => ({ month: h.month, organicTraffic: h.organicTraffic, organicKeywords: h.organicKeywords, top3: h.top3, top10: h.top10, referringDomains: h.referringDomains, backlinks: h.backlinks, authorityScore: h.authorityScore })),
  };
}

export type BacklinkReportData = {
  facts: SlimFacts;
  velocity: { date: string; newReferringDomains: number; lostReferringDomains: number }[];
  referring: { domain: string; authorityScore: number; backlinks: number; country: string; firstSeen: string; follow?: boolean }[];
  anchors: { anchor: string; type: string; referringDomains: number; backlinks: number }[];
  types: { type: string; count: number }[];
  toxicity: { label: string; value: number }[];
  toxicSample: { domain: string; score: number; markers: string[] }[];
};

/** Backlinks API (live) summary + overview → backlink report data. Toxicity has no real source here. */
export function backlinkReportFromLive(s: BlSummary, o: BlOverview): BacklinkReportData {
  return {
    facts: {
      domain: s.domain,
      authorityScore: s.authorityScore,
      organicTraffic: 0,
      organicKeywords: 0,
      trafficChangePct: 0,
      paidTraffic: 0,
      paidKeywords: 0,
      backlinks: s.backlinks,
      referringDomains: s.referringDomains,
      referringIps: s.referringIps,
      followRatio: s.followRatio,
      topicName: "",
      history: o.history.map((h) => ({ month: h.month, organicTraffic: 0, organicKeywords: 0, top3: 0, top10: 0, referringDomains: h.referringDomains, backlinks: h.backlinks, authorityScore: h.authorityScore })),
    },
    velocity: o.velocity.map((v) => ({ date: v.date, newReferringDomains: v.newReferringDomains, lostReferringDomains: v.lostReferringDomains })),
    referring: o.topReferringDomains.map((r) => ({ domain: r.domain, authorityScore: r.authorityScore, backlinks: r.backlinks, country: r.country || "", firstSeen: r.firstSeen })),
    anchors: o.anchors.map((a) => ({ anchor: a.anchor, type: a.type, referringDomains: a.referringDomains, backlinks: a.backlinks })),
    types: o.linkTypes.map((t) => ({ type: t.label.toLowerCase(), count: t.value })),
    toxicity: [],
    toxicSample: [],
  };
}

export type RankingRow = { keyword: string; position: number | null; previous: number | null; url: string | null };
type StoredRanking = { keyword: string; day: string; pos: string | number | null; url: string | null };

/** Latest and previous stored day of Position Tracking rankings → report rows (best first, unranked last). */
export function rankingRows(rows: StoredRanking[]): { day: string | null; previousDay: string | null; rows: RankingRow[] } {
  const days = [...new Set(rows.map((r) => r.day))].sort();
  const day = days[days.length - 1] ?? null;
  const previousDay = days[days.length - 2] ?? null;
  const num = (v: string | number | null) => {
    const n = v == null || v === "" ? null : Number(v);
    return n != null && Number.isFinite(n) && n > 0 ? n : null;
  };
  const prev = new Map(rows.filter((r) => r.day === previousDay).map((r) => [r.keyword, num(r.pos)]));
  const out = rows
    .filter((r) => r.day === day)
    .map((r) => ({ keyword: r.keyword, position: num(r.pos), previous: prev.get(r.keyword) ?? null, url: r.url || null }))
    .sort((a, b) => (a.position ?? 999) - (b.position ?? 999) || a.keyword.localeCompare(b.keyword));
  return { day, previousDay, rows: out };
}
