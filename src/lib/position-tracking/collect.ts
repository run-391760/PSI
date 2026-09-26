import { database, rootDomain } from "@/lib/domain";
import { dfs, market } from "@/lib/providers/dataforseo";
import { cached } from "@/lib/providers/source";
import { domainKeywords, hash, isBrandKeyword, keywordMetrics, positionOn, serp, topicFor, unit, urlFor } from "@/lib/seo/engine";
import type { Intent, SerpFeature } from "@/lib/seo/types";
import type { Device } from "./types";

/** What one check stores for one keyword × device × day. */
export type Snapshot = {
  positions: Record<string, number | null>;
  urls: Record<string, string | null>;
  own_urls: { url: string; position: number }[];
  features: SerpFeature[];
  owned: SerpFeature[];
  fs_owner: string | null;
};
export type SerpTop = { d: string; p: number; u: string }[];

// ------------------------------------------------------------------------------------ Demo engine

/** Mirrors the engine's owned-feature rule so Position Tracking agrees with Organic Research. */
function ownedFor(position: number | null, features: SerpFeature[], key: string): SerpFeature[] {
  if (position == null) return [];
  const out: SerpFeature[] = [];
  if (position <= 3 && features.includes("featured_snippet") && unit(`fs:${key}`) < 0.45) out.push("featured_snippet");
  if (position <= 5 && features.includes("ai_overview") && unit(`aio:${key}`) < 0.5) out.push("ai_overview");
  if (position <= 10 && features.includes("people_also_ask") && unit(`paa:${key}`) < 0.25) out.push("people_also_ask");
  if (position <= 10 && features.includes("image_pack") && unit(`img:${key}`) < 0.3) out.push("image_pack");
  if (position <= 3 && features.includes("sitelinks")) out.push("sitelinks");
  if (position <= 10 && features.includes("video") && unit(`vid:${key}`) < 0.2) out.push("video");
  return out;
}

const ALT_INTENT: Record<Intent, Intent> = { informational: "commercial", commercial: "informational", transactional: "informational", navigational: "informational" };

/**
 * Demo collector: daily positions from the engine's positionOn() for every tracked domain, landing URLs from
 * serp()/domainKeywords(), SERP features from keywordMetrics(). Some keywords deterministically get a second
 * ranking URL or a URL that switches over time so the cannibalization report has realistic cases.
 */
export function demoCollector(db: string, ownDomain: string, domains: string[]) {
  const ownUrls = new Map(domainKeywords(ownDomain, db).map((k) => [k.keyword, k.url]));
  const perKeyword = new Map<string, { features: SerpFeature[]; urls: Record<string, string>; alt: string; top: SerpTop; mode: "multi" | "switch" | "single"; phase: number }>();

  const prepare = (keyword: string) => {
    const hit = perKeyword.get(keyword);
    if (hit) return hit;
    const m = keywordMetrics(keyword, db);
    const topic = topicFor(keyword);
    const list = serp(keyword, db, { extraDomains: domains });
    const urls: Record<string, string> = {};
    for (const d of domains) {
      const fromSerp = list.find((s) => s.domain === d)?.url;
      urls[d] = (d === ownDomain ? ownUrls.get(keyword) : undefined) ?? fromSerp ?? urlFor(d, keyword, topic, m.intents, isBrandKeyword(keyword, d));
    }
    const altIntent = ALT_INTENT[m.intents[0] ?? "informational"];
    let alt = urlFor(ownDomain, keyword, topic, [altIntent], false);
    if (alt === urls[ownDomain]) alt = urlFor(ownDomain, keyword, topic, ["transactional"], false);
    const u = unit(`pt:cann:${ownDomain}:${keyword}`);
    const entry = {
      features: m.serpFeatures,
      urls,
      alt,
      top: list.slice(0, 20).map((s) => ({ d: s.domain, p: s.position, u: s.url })),
      mode: (u < 0.09 ? "multi" : u < 0.16 ? "switch" : "single") as "multi" | "switch" | "single",
      phase: (hash(`pt:phase:${keyword}`) % 628) / 100,
    };
    perKeyword.set(keyword, entry);
    return entry;
  };

  return (keyword: string, device: Device, day: string): { snapshot: Snapshot; top: SerpTop } => {
    const k = prepare(keyword);
    const positions: Record<string, number | null> = {};
    const urls: Record<string, string | null> = {};
    for (const d of domains) {
      positions[d] = positionOn(d, keyword, db, device, day);
      urls[d] = positions[d] == null ? null : k.urls[d];
    }
    const own = positions[ownDomain];
    let own_urls: { url: string; position: number }[] = [];
    if (own != null) {
      const dayNum = Math.floor(Date.parse(`${day}T00:00:00Z`) / 86400000);
      if (k.mode === "multi") {
        own_urls = [
          { url: k.urls[ownDomain], position: own },
          { url: k.alt, position: Math.min(100, own + 2 + (hash(`pt:alt:${keyword}:${device}`) % 18)) },
        ];
      } else if (k.mode === "switch" && Math.sin(dayNum / 3.2 + k.phase) > 0.5) {
        own_urls = [{ url: k.alt, position: own }];
      } else own_urls = [{ url: k.urls[ownDomain], position: own }];
      urls[ownDomain] = own_urls[0].url;
    }
    // Featured snippet: at most one owner — the best-placed tracked domain that qualifies, else the SERP's #1.
    let fs_owner: string | null = null;
    if (k.features.includes("featured_snippet")) {
      const candidates = domains
        .filter((d) => ownedFor(positions[d], k.features, `${d}:${keyword}`).includes("featured_snippet"))
        .sort((a, b) => (positions[a] ?? 101) - (positions[b] ?? 101));
      fs_owner = candidates[0] ?? k.top[0]?.d ?? null;
    }
    const owned = ownedFor(own, k.features, `${ownDomain}:${keyword}`).filter((f) => f !== "featured_snippet" || fs_owner === ownDomain);
    return { snapshot: { positions, urls, own_urls, features: k.features, owned, fs_owner }, top: k.top };
  };
}

// ------------------------------------------------------------------------------------ DataForSEO (live)

type SlimItem = { type: string; rank: number | null; domain: string; url: string; links: boolean; refs: string[] };
type SlimSerp = { types: string[]; items: SlimItem[] };

const TYPE_MAP: Record<string, SerpFeature> = {
  ai_overview: "ai_overview",
  featured_snippet: "featured_snippet",
  people_also_ask: "people_also_ask",
  local_pack: "local_pack",
  map: "local_pack",
  images: "image_pack",
  video: "video",
  short_videos: "video",
  top_stories: "top_stories",
  shopping: "shopping",
  popular_products: "shopping",
  knowledge_graph: "knowledge_panel",
  paid: "ads_top",
  discussions_and_forums: "discussions",
  perspectives: "discussions",
  related_searches: "related_searches",
};

function hostMatches(host: string, domain: string) {
  const h = host.toLowerCase().replace(/^www\./, "");
  return h === domain || h.endsWith(`.${domain}`);
}
function safeRoot(host: string) {
  try {
    return rootDomain(host);
  } catch {
    return host;
  }
}

function locationPayload(db: string, location: string) {
  const loc = location.trim();
  if (!loc) return market(db);
  const country = database(db).name;
  const name = (loc.toLowerCase().includes(country.toLowerCase()) ? loc : `${loc},${country}`).replace(/\s*,\s*/g, ",");
  return { location_name: name, language_code: database(db).language };
}

/** One live SERP (depth 100), cached per keyword/market/device/day so re-running a check is free. */
export async function liveSerp(ownerId: string, keyword: string, db: string, location: string, device: Device, day: string) {
  const res = await cached<SlimSerp>(`pt:serp:${db}:${location.toLowerCase()}:${device}:${keyword}:${day}`, "dataforseo", 36, async () => {
    const [r] = await dfs(
      ownerId,
      "serp/google/organic/live/advanced",
      { keyword, ...locationPayload(db, location), device, os: device === "mobile" ? "android" : "windows", depth: 100 },
      20000,
    );
    const items = ((r?.items ?? []) as any[]).map(
      (it): SlimItem => ({
        type: String(it?.type ?? ""),
        rank: it?.rank_group ?? null,
        domain: String(it?.domain ?? ""),
        url: String(it?.url ?? ""),
        links: Array.isArray(it?.links) && it.links.length > 0,
        refs: Array.isArray(it?.references) ? it.references.map((x: any) => String(x?.domain ?? "")).filter(Boolean) : [],
      }),
    );
    return { types: ((r?.item_types ?? []) as string[]).map(String), items };
  });
  return res.data;
}

export function parseLiveSerp(s: SlimSerp, ownDomain: string, domains: string[]): { snapshot: Snapshot; top: SerpTop } {
  const organic = s.items.filter((i) => i.type === "organic" && i.rank != null);
  const positions: Record<string, number | null> = {};
  const urls: Record<string, string | null> = {};
  for (const d of domains) {
    const hit = organic.find((i) => hostMatches(i.domain, d));
    positions[d] = hit?.rank ?? null;
    urls[d] = hit?.url ?? null;
  }
  const own_urls = organic.filter((i) => hostMatches(i.domain, ownDomain)).map((i) => ({ url: i.url, position: i.rank! }));
  const types = new Set([...s.types, ...s.items.map((i) => i.type)]);
  const features = [...new Set([...types].map((t) => TYPE_MAP[t]).filter(Boolean))] as SerpFeature[];
  const fs = s.items.find((i) => i.type === "featured_snippet");
  const fs_owner = fs?.domain ? safeRoot(fs.domain) : null;
  const owned: SerpFeature[] = [];
  if (fs && hostMatches(fs.domain, ownDomain)) owned.push("featured_snippet");
  if (s.items.some((i) => i.type === "ai_overview" && i.refs.some((r) => hostMatches(r, ownDomain)))) owned.push("ai_overview");
  if (organic.some((i) => hostMatches(i.domain, ownDomain) && i.links)) owned.push("sitelinks");
  if (s.items.some((i) => i.type === "local_pack" && hostMatches(i.domain, ownDomain))) owned.push("local_pack");
  const top = organic.slice(0, 20).map((i) => ({ d: safeRoot(i.domain), p: i.rank!, u: i.url }));
  return { snapshot: { positions, urls, own_urls, features, owned, fs_owner }, top };
}

/** Live search volume + CPC for keywords (Google Ads data), cached for 30 days. */
export async function liveVolumes(ownerId: string, keywords: string[], db: string) {
  const out = new Map<string, { volume: number | null; cpc: number | null }>();
  for (let i = 0; i < keywords.length; i += 700) {
    const chunk = keywords.slice(i, i + 700).sort();
    const res = await cached<{ keyword: string; volume: number | null; cpc: number | null }[]>(
      `pt:volume:${db}:${hash(chunk.join("\n"))}`,
      "dataforseo",
      720,
      async () => {
        const rows = await dfs(ownerId, "keywords_data/google_ads/search_volume/live", { keywords: chunk, ...market(db) }, 100000);
        return (rows as any[]).map((r) => ({ keyword: String(r?.keyword ?? "").toLowerCase(), volume: r?.search_volume ?? null, cpc: r?.cpc ?? null }));
      },
    );
    for (const r of res.data) out.set(r.keyword, { volume: r.volume, cpc: r.cpc });
  }
  return out;
}
