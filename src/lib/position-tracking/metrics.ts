import { ctrFor } from "@/lib/seo/engine";
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
};

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
 */
export function aggregateDay(day: string, rows: RankRow[], domains: string[], volumes: Map<string, number | null>): DayAggregate[] {
  const n = rows.length;
  return domains.map((domain) => {
    let ranked = 0,
      top3 = 0,
      top10 = 0,
      top20 = 0,
      vis = 0,
      traffic = 0,
      posSum = 0;
    for (const r of rows) {
      const p = r.positions[domain] ?? null;
      posSum += p ?? 100;
      if (p == null) continue;
      ranked++;
      if (p <= 3) top3++;
      if (p <= 10) top10++;
      if (p <= 20) top20++;
      vis += keywordVisibility(p);
      traffic += keywordTraffic(p, volumes.get(r.keyword_id), r.features);
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
      traffic,
      avgPosition: n ? posSum / n : null,
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
