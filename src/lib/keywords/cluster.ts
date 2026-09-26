import { database } from "@/lib/domain";
import { serp } from "@/lib/seo/engine";

export type Strictness = "loose" | "medium" | "strict";
export const STRICTNESS: { id: Strictness; label: string; note: string }[] = [
  { id: "loose", label: "Loose", note: "Shares ≥3 of the top-10 URLs, or ≥7 of the top-10 domains, with the pillar." },
  { id: "medium", label: "Medium", note: "Shares ≥3 of the top-10 URLs with the pillar keyword." },
  { id: "strict", label: "Strict", note: "Shares ≥5 of the top-10 URLs with the pillar keyword." },
];

export type ClusterInput = { keyword: string; volume: number | null; kd: number | null };
export type Cluster = {
  id: string;
  /** Highest-volume keyword of the cluster (the page's main keyword). */
  pillar: string;
  keywords: (ClusterInput & { sharedUrls: number })[];
  volume: number;
  avgKd: number | null;
};

export const MAX_CLUSTER_KEYWORDS = 1000;

/**
 * Groups keywords whose Google top 10 overlap (the same pages rank for them, so one page can target
 * them all). Keywords are visited by volume; each joins the existing cluster whose pillar it shares
 * the most results with (above the strictness threshold) or starts a new cluster. SERPs come from
 * the demo engine.
 */
export function clusterKeywords(items: ClusterInput[], dbInput: string, strictness: Strictness = "medium"): Cluster[] {
  const db = database(dbInput).code;
  const sorted = [...items].sort((a, b) => (b.volume ?? -1) - (a.volume ?? -1) || a.keyword.localeCompare(b.keyword)).slice(0, MAX_CLUSTER_KEYWORDS);
  const serps = new Map(
    sorted.map((it) => {
      const top = serp(it.keyword, db, { depth: 10 });
      return [it.keyword, { urls: new Set(top.map((r) => r.url)), domains: new Set(top.map((r) => r.domain)) }];
    }),
  );
  const minUrls = strictness === "strict" ? 5 : 3;
  const clusters: { pillar: ClusterInput; members: (ClusterInput & { sharedUrls: number })[] }[] = [];
  for (const it of sorted) {
    const s = serps.get(it.keyword)!;
    let best: (typeof clusters)[number] | null = null;
    let bestScore = 0;
    let bestUrls = 0;
    for (const c of clusters) {
      const p = serps.get(c.pillar.keyword)!;
      let urls = 0;
      for (const u of s.urls) if (p.urls.has(u)) urls++;
      let domains = 0;
      if (strictness === "loose") for (const d of s.domains) if (p.domains.has(d)) domains++;
      const ok = urls >= minUrls || (strictness === "loose" && domains >= 7);
      const score = urls * 2 + domains * 0.5;
      if (ok && score > bestScore) {
        best = c;
        bestScore = score;
        bestUrls = urls;
      }
    }
    if (best) best.members.push({ ...it, sharedUrls: bestUrls });
    else clusters.push({ pillar: it, members: [{ ...it, sharedUrls: s.urls.size }] });
  }
  return clusters
    .map((c, i) => {
      const kds = c.members.filter((m) => m.kd != null);
      return {
        id: `c${i + 1}`,
        pillar: c.pillar.keyword,
        keywords: c.members,
        volume: c.members.reduce((s, m) => s + (m.volume ?? 0), 0),
        avgKd: kds.length ? Math.round(kds.reduce((s, m) => s + (m.kd ?? 0), 0) / kds.length) : null,
      };
    })
    .sort((a, b) => b.keywords.length - a.keywords.length || b.volume - a.volume);
}
