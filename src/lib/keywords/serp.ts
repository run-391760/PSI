import { database } from "@/lib/domain";
import { dfs, market } from "@/lib/providers/dataforseo";
import { cached } from "@/lib/providers/source";
import { clusterBySerps, clusterOrder, type Cluster, type ClusterInput, type SerpSets, type Strictness } from "./cluster";
import { mapDfsSerpItems, top10Sets, type LiveSerpItem } from "./serp-map";
import { normalizeKw } from "./text";

/** Live Google top 20 (DataForSEO SERP API), cached 24 h per keyword + database. */
export async function liveSerpItems(ownerId: string, keywordInput: string, dbInput: string): Promise<LiveSerpItem[]> {
  const keyword = normalizeKw(keywordInput);
  const db = database(dbInput).code;
  const { data } = await cached(`kw-serp:${db}:${keyword}`, "dataforseo", 24, async () => {
    const [res] = await dfs(ownerId, "serp/google/organic/live/regular", { keyword, ...market(db), depth: 20 }, 6000);
    return mapDfsSerpItems(res?.items);
  });
  return data;
}

/** Max keywords clustered with live SERPs (one SERP request each, cached 24 h). */
export const MAX_LIVE_CLUSTER = 150;

/** SERP-overlap clusters from live Google results (top MAX_LIVE_CLUSTER keywords by volume). */
export async function clusterLive(ownerId: string, items: ClusterInput[], dbInput: string, strictness: Strictness): Promise<{ clusters: Cluster[]; clustered: number; failed: number }> {
  const picked = clusterOrder(items).slice(0, MAX_LIVE_CLUSTER);
  const serps: SerpSets = new Map();
  let failed = 0;
  let next = 0;
  const worker = async () => {
    while (next < picked.length) {
      const it = picked[next++];
      try {
        serps.set(it.keyword, top10Sets(await liveSerpItems(ownerId, it.keyword, dbInput)));
      } catch {
        failed++;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(5, picked.length) }, worker));
  return { clusters: clusterBySerps(picked, serps, strictness), clustered: serps.size, failed };
}
