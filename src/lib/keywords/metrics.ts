import { createHash } from "node:crypto";
import { database } from "@/lib/domain";
import { dfs, market } from "@/lib/providers/dataforseo";
import { cached, demo, liveEnabled, type Sourced } from "@/lib/providers/source";
import { keywordMetrics, trailingMonths } from "@/lib/seo/engine";
import type { Intent, SerpFeature } from "@/lib/seo/types";
import { normalizeKw } from "./text";
import type { KwRow } from "./types";

/** Keyword metrics from the demo engine (deterministic, consistent with every other tool). */
export function demoRow(keyword: string, db: string): KwRow {
  const m = keywordMetrics(keyword, db);
  return {
    keyword: m.keyword,
    volume: m.volume,
    kd: m.kd,
    cpc: m.cpc,
    competition: m.competition,
    intents: m.intents,
    features: m.serpFeatures,
    trend: m.trend,
    results: m.results,
  };
}

/** "YYYY-MM" labels of the 12 trend months (oldest first, ending last month). */
export function trendMonths() {
  return trailingMonths(12).map((d) => d.toISOString().slice(0, 7));
}

const FEATURE_MAP: Record<string, SerpFeature> = {
  ai_overview: "ai_overview",
  featured_snippet: "featured_snippet",
  people_also_ask: "people_also_ask",
  local_pack: "local_pack",
  map: "local_pack",
  images: "image_pack",
  video: "video",
  top_stories: "top_stories",
  shopping: "shopping",
  popular_products: "shopping",
  google_reviews: "reviews",
  knowledge_graph: "knowledge_panel",
  paid: "ads_top",
  discussions_and_forums: "discussions",
  related_searches: "related_searches",
};
const INTENTS = new Set(["informational", "navigational", "commercial", "transactional"]);

/** Maps a DataForSEO Labs keyword item (keyword_overview / suggestions / ideas) to a row. Missing stays null. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapDfsKeyword(it: any): KwRow {
  const k = it?.keyword_data ?? it ?? {};
  const info = k.keyword_info ?? {};
  const monthly = ((info.monthly_searches ?? []) as { year: number; month: number; search_volume: number | null }[])
    .slice()
    .sort((a, b) => a.year - b.year || a.month - b.month)
    .slice(-12);
  const intents = [k.search_intent_info?.main_intent, ...(k.search_intent_info?.foreign_intent ?? [])].filter((x): x is Intent => INTENTS.has(x)).slice(0, 2);
  const features = [...new Set(((k.serp_info?.serp_item_types ?? []) as string[]).map((t) => FEATURE_MAP[t]).filter(Boolean))];
  return {
    keyword: normalizeKw(String(k.keyword ?? "")),
    volume: info.search_volume ?? null,
    kd: k.keyword_properties?.keyword_difficulty ?? null,
    cpc: info.cpc ?? null,
    competition: info.competition ?? null,
    intents,
    features,
    trend: monthly.map((m) => m.search_volume ?? 0),
    results: k.serp_info?.se_results_count ?? null,
  };
}

const digest = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 16);

async function liveRows(ownerId: string, keywords: string[], db: string): Promise<KwRow[]> {
  const out: KwRow[] = [];
  for (let i = 0; i < keywords.length; i += 700) {
    const chunk = keywords.slice(i, i + 700);
    const [res] = await dfs(ownerId, "dataforseo_labs/google/keyword_overview/live", { keywords: chunk, ...market(db), include_serp_info: true }, 20000 + chunk.length * 150);
    const byKw = new Map(((res?.items ?? []) as unknown[]).map((it) => mapDfsKeyword(it)).map((r) => [r.keyword, r]));
    for (const k of chunk)
      out.push(byKw.get(k) ?? { keyword: k, volume: null, kd: null, cpc: null, competition: null, intents: [], features: [], trend: [], results: null });
  }
  return out;
}

/**
 * Metrics for a set of keywords in one database. Live (DataForSEO Labs, cached 7 days) when configured,
 * otherwise the demo engine. Never mixes the two.
 */
export async function keywordRows(ownerId: string, keywordsInput: string[], dbInput: string): Promise<Sourced<KwRow[]>> {
  const db = database(dbInput).code;
  const keywords = [...new Set(keywordsInput.map(normalizeKw).filter(Boolean))];
  if (!keywords.length) return demo([]);
  if (liveEnabled()) return cached(`kw-metrics:${db}:${digest([...keywords].sort().join("|"))}`, "dataforseo", 24 * 7, () => liveRows(ownerId, keywords, db));
  return demo(keywords.map((k) => demoRow(k, db)));
}
