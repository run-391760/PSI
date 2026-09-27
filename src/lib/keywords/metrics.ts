import { createHash } from "node:crypto";
import { database } from "@/lib/domain";
import { dfs, market } from "@/lib/providers/dataforseo";
import { demoAllowed } from "@/lib/data-mode";
import { cached, liveEnabled } from "@/lib/providers/source";
import { keywordMetrics, trailingMonths } from "@/lib/seo/engine";
import type { Intent, SerpFeature } from "@/lib/seo/types";
import { textIntents } from "./intent";
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

/** Where keyword metrics came from. "none" = no metrics provider: numbers are null, intent is text-based. */
export type MetricsSource = "dataforseo" | "demo" | "none";
export type MetricsResult = { data: KwRow[]; source: MetricsSource; fetchedAt: string };

/** A row without measured metrics: every number is null ("n/a"); intent is classified from the text. */
export function textRow(keyword: string): KwRow {
  return { keyword, volume: null, kd: null, cpc: null, competition: null, intents: textIntents(keyword), features: [], trend: [], results: null };
}

/** Which metrics source is active right now (DataForSEO → demo engine in local dev only → none). */
export function metricsSource(): MetricsSource {
  return liveEnabled() ? "dataforseo" : demoAllowed() ? "demo" : "none";
}

/**
 * Metrics for a set of keywords in one database. Live (DataForSEO Labs, cached 7 days) when configured;
 * the demo engine only when DEMO_DATA=true; otherwise null metrics with text-based intent. Never mixes.
 */
export async function keywordRows(ownerId: string, keywordsInput: string[], dbInput: string): Promise<MetricsResult> {
  const db = database(dbInput).code;
  const keywords = [...new Set(keywordsInput.map(normalizeKw).filter(Boolean))];
  const source = metricsSource();
  const now = new Date().toISOString();
  if (!keywords.length) return { data: [], source, fetchedAt: now };
  if (source === "dataforseo") {
    const r = await cached(`kw-metrics:${db}:${digest([...keywords].sort().join("|"))}`, "dataforseo", 24 * 7, () => liveRows(ownerId, keywords, db));
    return { data: r.data, source, fetchedAt: r.fetchedAt };
  }
  if (source === "demo") return { data: keywords.map((k) => demoRow(k, db)), source, fetchedAt: now };
  return { data: keywords.map(textRow), source, fetchedAt: now };
}

/**
 * Stored metrics (lists, PPC campaigns) that came from the demo engine are hidden unless DEMO_DATA=true:
 * the keyword stays, its numbers become n/a and intent is re-classified from the text.
 */
export function visibleStoredRow<T extends KwRow & { source: string }>(r: T): T {
  if (r.source !== "demo" || demoAllowed()) return r;
  return { ...r, ...textRow(r.keyword), source: "none" };
}
