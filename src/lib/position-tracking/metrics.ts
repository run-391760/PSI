import type { SerpFeature } from "@/lib/seo/types";
import type { DayAggregate } from "./types";

/** One stored daily snapshot (pt_rankings row). */
export type RankRow = {
  keyword_id: string;
  day: string;
  positions: Record<string, number | null>;
  urls: Record<string, string | null>;
  own_urls: { url: string; position: number }[];
  features: SerpFeature[];
  owned: SerpFeature[];
  fs_owner: string | null;
  /** Real Search Console clicks / impressions (null or absent for SERP-based sources). */
  clicks?: number | null;
  impressions?: number | null;
};

/**
 * Organic CTR model by position (same curve as the shared engine's ctrFor, so reports agree across tools),
 * linearly interpolated so Search Console's fractional average positions (e.g. 4.3) are supported.
 */
const CURVE = [0.28, 0.155, 0.11, 0.08, 0.065, 0.05, 0.04, 0.032, 0.027, 0.023];
function ctrAt(p: number) {
  if (p <= 10) return CURVE[p - 1];
  if (p <= 20) return 0.012 - (p - 11) * 0.0008;
  return Math.max(0.0002, 0.003 - (p - 21) * 0.00004);
}
export function ctrFor(position: number, features: SerpFeature[] = []) {
  const p = Math.max(1, position);
  const lo = Math.floor(p);
  let ctr = lo === p ? ctrAt(p) : ctrAt(lo) + (ctrAt(lo + 1) - ctrAt(lo)) * (p - lo);
  if (features.includes("ai_overview")) ctr *= 0.72;
  if (features.includes("ads_top")) ctr *= 0.88;
  if (features.includes("featured_snippet") && p > 1) ctr *= 0.85;
  return ctr;
}
const CTR1 = ctrFor(1);

/** Visibility contribution of one keyword, 0..100 (CTR(pos) / CTR(1)). */
export function keywordVisibility(position: number | null | undefined) {
  return position == null ? 0 : (ctrFor(position) / CTR1) * 100;
}

/** Estimated monthly visits from one keyword: volume × CTR(pos) (SERP features dampen CTR). */
export function keywordTraffic(position: number | null | undefined, volume: number | null | undefined, features: SerpFeature[] = []) {
  return position == null || !volume ? 0 : volume * ctrFor(position, features);
}

/**
 * Per-domain aggregates for one day. Visibility = Σ CTR(pos) / (n × CTR(1)) × 100 where n is the number of
 * tracked keywords with a snapshot that day; keywords outside the top 100 count as position 100 in the average.
 * `measured` (Search Console campaigns): traffic is the real sum of clicks, and the average position covers only
 * keywords with impressions that day (a keyword without impressions has no position, not position 100).
 */
export function aggregateDay(day: string, rows: RankRow[], domains: string[], volumes: Map<string, number | null>, opts: { measured?: boolean } = {}): DayAggregate[] {
  const n = rows.length;
  const measured = Boolean(opts.measured);
  return domains.map((domain) => {
    let ranked = 0,
      top3 = 0,
      top10 = 0,
      top20 = 0,
      vis = 0,
      traffic = 0,
      posSum = 0,
      clicks = 0,
      impressions = 0;
    for (const r of rows) {
      const p = r.positions[domain] ?? null;
      clicks += Number(r.clicks ?? 0);
      impressions += Number(r.impressions ?? 0);
      if (!measured) posSum += p ?? 100;
      if (p == null) continue;
      if (measured) posSum += p;
      ranked++;
      if (p <= 3) top3++;
      if (p <= 10) top10++;
      if (p <= 20) top20++;
      vis += keywordVisibility(p);
      if (!measured) traffic += keywordTraffic(p, volumes.get(r.keyword_id), r.features);
    }
    return {
      day,
      domain,
      keywords: n,
      ranked,
      top3,
      top10,
      top20,
      top100: ranked,
      visibility: n ? vis / n : 0,
      traffic: measured ? clicks : traffic,
      avgPosition: measured ? (ranked ? posSum / ranked : null) : n ? posSum / n : null,
      clicks: measured ? clicks : null,
      impressions: measured ? impressions : null,
    };
  });
}

/** ISO day (UTC) helpers. */
export const isoDay = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (day: string, n: number) => isoDay(new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000));
export function daysBetween(from: string, to: string) {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
export const today = () => isoDay(new Date());
