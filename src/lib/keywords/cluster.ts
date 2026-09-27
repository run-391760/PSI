import { database } from "@/lib/domain";
import { serp } from "@/lib/seo/engine";
import { autoGroup } from "./ppc-model";

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
  /** False when no member has a known volume (show "n/a", not 0). */
  hasVolume: boolean;
  avgKd: number | null;
};

export const MAX_CLUSTER_KEYWORDS = 1000;

export type SerpSets = Map<string, { urls: Set<string>; domains: Set<string> }>;

/** Keywords sorted for clustering: by volume, then alphabetically; capped at MAX_CLUSTER_KEYWORDS. */
export const clusterOrder = (items: ClusterInput[]) =>
  [...items].sort((a, b) => (b.volume ?? -1) - (a.volume ?? -1) || a.keyword.localeCompare(b.keyword)).slice(0, MAX_CLUSTER_KEYWORDS);

/**
 * Groups keywords whose Google top 10 overlap (the same pages rank for them, so one page can target
 * them all). Keywords are visited by volume; each joins the existing cluster whose pillar it shares
 * the most results with (above the strictness threshold) or starts a new cluster. Pure: the caller
 * supplies the top-10 URL/domain sets (keywords without a SERP are skipped).
 */
export function clusterBySerps(items: ClusterInput[], serps: SerpSets, strictness: Strictness = "medium"): Cluster[] {
  const sorted = clusterOrder(items).filter((it) => serps.has(it.keyword));
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
  return clusters.map((c, i) => toCluster(`c${i + 1}`, c.pillar.keyword, c.members)).sort((a, b) => b.keywords.length - a.keywords.length || b.volume - a.volume);
}

function toCluster(id: string, pillar: string, members: (ClusterInput & { sharedUrls: number })[]): Cluster {
  const kds = members.filter((m) => m.kd != null);
  const vols = members.filter((m) => m.volume != null);
  return {
    id,
    pillar,
    keywords: members,
    volume: members.reduce((s, m) => s + (m.volume ?? 0), 0),
    hasVolume: vols.length > 0,
    avgKd: kds.length ? Math.round(kds.reduce((s, m) => s + (m.kd ?? 0), 0) / kds.length) : null,
  };
}

/** Demo SERPs (local development only, DEMO_DATA=true). */
export function clusterKeywords(items: ClusterInput[], dbInput: string, strictness: Strictness = "medium"): Cluster[] {
  const db = database(dbInput).code;
  const serps: SerpSets = new Map(
    clusterOrder(items).map((it) => {
      const top = serp(it.keyword, db, { depth: 10 });
      return [it.keyword, { urls: new Set(top.map((r) => r.url)), domains: new Set(top.map((r) => r.domain)) }];
    }),
  );
  return clusterBySerps(items, serps, strictness);
}

/**
 * Real text analysis (no SERP data needed): keywords grouped by the most specific word they share with
 * other keywords. `pillar` is the group's shared word/phrase, not a keyword.
 */
export function groupBySharedWords(items: ClusterInput[]): Cluster[] {
  const byKw = new Map(items.map((i) => [i.keyword, i]));
  return autoGroup(clusterOrder(items).map((i) => i.keyword), 60).map((g, i) =>
    toCluster(
      `w${i + 1}`,
      g.name,
      g.keywords.map((k) => ({ ...(byKw.get(k) ?? { keyword: k, volume: null, kd: null }), sharedUrls: 0 })),
    ),
  );
}
