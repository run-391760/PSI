/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Pure mappings for real content benchmarks (no server imports; unit-tested in
 * tests/links-content-real.test.ts): DataForSEO advanced SERP → top results + features, crawled rival
 * pages → averages and semantically related terms, Search Console rows → page/keyword pairs.
 */
import type { SerpFeature } from "@/lib/seo/types";
import type { PageFacts } from "./extract";
import { STOPWORDS, countKeyword, hasKeyword, keywordRegex, normalizeText, wordList } from "./text";

export type SerpOrganic = { position: number; url: string; title: string; description: string; domain: string };
export type SerpTop = { organic: SerpOrganic[]; features: SerpFeature[]; questions: string[]; related: string[] };

const FEATURE_MAP: Record<string, SerpFeature> = {
  featured_snippet: "featured_snippet",
  people_also_ask: "people_also_ask",
  video: "video",
  short_videos: "video",
  images: "image_pack",
  local_pack: "local_pack",
  map: "local_pack",
  shopping: "shopping",
  popular_products: "shopping",
  top_stories: "top_stories",
  knowledge_graph: "knowledge_panel",
  ai_overview: "ai_overview",
  discussions_and_forums: "discussions",
  perspectives: "discussions",
  related_searches: "related_searches",
  paid: "ads_top",
};

/** Map one `serp/google/organic/live/advanced` result. */
export function mapAdvancedSerp(result: any): SerpTop {
  const items: any[] = Array.isArray(result?.items) ? result.items : [];
  const features = new Set<SerpFeature>();
  const questions: string[] = [];
  const related: string[] = [];
  const organic: SerpOrganic[] = [];
  for (const it of items) {
    const type = String(it?.type ?? "");
    if (FEATURE_MAP[type]) features.add(FEATURE_MAP[type]);
    if (type === "organic" && it.url) {
      if (it.rating) features.add("reviews");
      organic.push({
        position: Number(it.rank_group ?? organic.length + 1),
        url: String(it.url),
        title: String(it.title ?? ""),
        description: String(it.description ?? ""),
        domain: String(it.domain ?? "").replace(/^www\./, ""),
      });
    } else if (type === "people_also_ask") {
      for (const q of it.items ?? []) if (q?.title) questions.push(String(q.title));
    } else if (type === "related_searches") {
      for (const r of it.items ?? []) if (typeof r === "string") related.push(r);
    }
  }
  organic.sort((a, b) => a.position - b.position);
  return { organic, features: [...features], questions: [...new Set(questions)], related: [...new Set(related.map((r) => r.toLowerCase().trim()))] };
}

/* ------------------------------------------------------------------------------------------------
 * Crawled rivals
 * ---------------------------------------------------------------------------------------------- */

export type RealRival = {
  position: number;
  domain: string;
  url: string;
  title: string;
  description: string;
  fetched: boolean;
  error: string | null;
  words: number | null;
  mentions: number | null;
  readability: number | null;
  images: number | null;
  h2: number | null;
  hasVideo: boolean | null;
  schema: string[];
  titleHasKw: boolean;
  h1HasKw: boolean | null;
  metaHasKw: boolean;
};

/** Measure a crawled rival page (facts from extractPage) for a keyword. */
export function measureRival(r: SerpOrganic, keyword: string, page: { facts: PageFacts; text: string } | null, error: string | null = null): RealRival {
  const f = page?.facts;
  return {
    position: r.position,
    domain: r.domain,
    url: r.url,
    title: f?.title || r.title,
    description: r.description,
    fetched: !!f,
    error: f ? null : error,
    words: f ? f.words : null,
    mentions: page ? countKeyword(page.text, keyword) : null,
    readability: f?.flesch != null ? Math.round(f.flesch) : null,
    images: f ? f.images : null,
    h2: f ? f.h2s.length : null,
    hasVideo: f ? f.hasVideo : null,
    schema: f?.schemaTypes ?? [],
    titleHasKw: hasKeyword(f?.title || r.title, keyword),
    h1HasKw: f ? f.h1s.some((h) => hasKeyword(h, keyword)) : null,
    metaHasKw: hasKeyword(f?.metaDescription || r.description, keyword),
  };
}

export type RivalAvg = {
  crawled: number;
  words: number;
  wordsRange: [number, number];
  mentions: number;
  readability: number | null;
  images: number;
  h2: number;
  titleKw: number;
  h1Kw: number;
  metaKw: number;
  video: number;
};

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const shareOf = (xs: boolean[]) => (xs.length ? Math.round((xs.filter(Boolean).length / xs.length) * 100) : 0);

/** Averages over the rivals that were actually crawled; null when fewer than 3 could be measured. */
export function summarizeRivals(rivals: RealRival[]): RivalAvg | null {
  const ok = rivals.filter((r) => r.fetched && (r.words ?? 0) >= 50);
  if (ok.length < 3) return null;
  const words = ok.map((r) => r.words!).sort((a, b) => a - b);
  const read = ok.map((r) => r.readability).filter((x): x is number => x != null);
  return {
    crawled: ok.length,
    words: Math.round(mean(words) / 10) * 10,
    wordsRange: [words[Math.floor(words.length * 0.2)], words[Math.min(words.length - 1, Math.floor(words.length * 0.8))]],
    mentions: Math.round(mean(ok.map((r) => r.mentions ?? 0))),
    readability: read.length ? Math.round(mean(read)) : null,
    images: Math.round(mean(ok.map((r) => r.images ?? 0))),
    h2: Math.round(mean(ok.map((r) => r.h2 ?? 0))),
    titleKw: shareOf(ok.map((r) => r.titleHasKw)),
    h1Kw: shareOf(ok.map((r) => !!r.h1HasKw)),
    metaKw: shareOf(ok.map((r) => r.metaHasKw)),
    video: shareOf(ok.map((r) => !!r.hasVideo)),
  };
}

export type SemanticTerm = { term: string; rivals: number; of: number };

const NOISE = new Set(["cookie", "cookies", "privacy", "policy", "newsletter", "subscribe", "copyright", "rights", "reserved", "login", "sign", "menu", "share", "facebook", "twitter", "instagram", "linkedin", "pinterest", "youtube", "email", "click", "read", "comments", "comment", "reply", "posted", "updated", "published", "min", "like", "also", "well", "many", "much", "make", "need", "want", "know", "way", "new", "first", "best", "even", "every", "time", "year", "years", "day", "days"]);

/**
 * Words and two-word phrases used by several of the crawled top pages (document frequency), excluding
 * the keyword's own words, stopwords, numbers and the rivals' brand names.
 */
export function semanticFromTexts(keywords: string[], docs: { domain: string; text: string }[], limit = 24): SemanticTerm[] {
  const n = docs.length;
  if (n < 3) return [];
  const seed = new Set(keywords.flatMap((k) => wordList(normalizeText(k))).flatMap((t) => [t, t.replace(/s$/, ""), `${t}s`]));
  const brands = new Set(docs.flatMap((d) => d.domain.split(".").slice(0, -1)).filter((b) => b.length >= 3));
  const ok = (t: string) => t.length >= 3 && !STOPWORDS.has(t) && !seed.has(t) && !brands.has(t) && !NOISE.has(t) && !/^\d/.test(t);
  const df = new Map<string, number>();
  const tf = new Map<string, number>();
  for (const d of docs) {
    const toks = wordList(normalizeText(d.text));
    const seen = new Set<string>();
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (ok(t)) {
        tf.set(t, (tf.get(t) ?? 0) + 1);
        seen.add(t);
      }
      const u = toks[i + 1];
      if (u && ok(t) && ok(u)) {
        const bg = `${t} ${u}`;
        tf.set(bg, (tf.get(bg) ?? 0) + 1);
        seen.add(bg);
      }
    }
    for (const s of seen) df.set(s, (df.get(s) ?? 0) + 1);
  }
  const min = Math.max(2, Math.ceil(n * 0.3));
  const ranked = [...df.entries()]
    .filter(([term, c]) => c >= min && (term.includes(" ") ? c >= Math.max(2, Math.ceil(n * 0.3)) : true))
    .sort((a, b) => b[1] - a[1] || (tf.get(b[0]) ?? 0) - (tf.get(a[0]) ?? 0) || a[0].localeCompare(b[0]));
  const out: SemanticTerm[] = [];
  for (const [term, c] of ranked) {
    // Prefer a phrase over its single words when both are used by the same pages.
    if (out.some((o) => o.term.includes(" ") && o.term.split(" ").includes(term) && o.rivals >= c)) continue;
    if (term.includes(" ")) {
      for (let i = out.length - 1; i >= 0; i--) if (!out[i].term.includes(" ") && term.split(" ").includes(out[i].term) && out[i].rivals <= c) out.splice(i, 1);
    }
    out.push({ term, rivals: c, of: n });
    if (out.length >= limit) break;
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * Search Console
 * ---------------------------------------------------------------------------------------------- */

export type GscRowLike = { keys?: string[]; clicks: number; impressions: number; ctr: number; position: number };
export type GscPair = { url: string; keyword: string; clicks: number; impressions: number; position: number };

/** Best query per page (by clicks, then impressions) from rows with dimensions [page, query]. */
export function pairsFromGsc(rows: GscRowLike[], limit = 30): GscPair[] {
  const pages = new Map<string, { clicks: number; impressions: number; best: GscPair | null }>();
  for (const r of rows) {
    const [url, q] = r.keys ?? [];
    if (!url || !q || q.length > 120) continue;
    const p = pages.get(url) ?? { clicks: 0, impressions: 0, best: null };
    p.clicks += r.clicks;
    p.impressions += r.impressions;
    if (!p.best || r.clicks > p.best.clicks || (r.clicks === p.best.clicks && r.impressions > p.best.impressions))
      p.best = { url, keyword: q.toLowerCase().trim(), clicks: r.clicks, impressions: r.impressions, position: Math.round(r.position * 10) / 10 };
    pages.set(url, p);
  }
  return [...pages.values()]
    .filter((p) => p.best)
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
    .slice(0, limit)
    .map((p) => p.best!);
}

export type GscQuery = { query: string; clicks: number; impressions: number; ctr: number; position: number };
export type GscPageData = {
  site: string;
  start: string;
  end: string;
  /** Totals of the page (null when Search Console has no rows for it). */
  page: { clicks: number; impressions: number; ctr: number; position: number } | null;
  /** Queries the page gets impressions for (top by impressions). */
  queries: GscQuery[];
  /** Pages of the site that get impressions for the target keyword. */
  keywordPages: { url: string; clicks: number; impressions: number; position: number }[];
};

export function mapGscPage(site: string, range: { start: string; end: string }, pageRows: GscRowLike[], queryRows: GscRowLike[], keywordRows: GscRowLike[]): GscPageData {
  const q = queryRows
    .map((r) => ({ query: r.keys?.[0] ?? "", clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: Math.round(r.position * 10) / 10 }))
    .filter((r) => r.query)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 50);
  const p = pageRows[0];
  return {
    site,
    start: range.start,
    end: range.end,
    page: p ? { clicks: p.clicks, impressions: p.impressions, ctr: p.ctr, position: Math.round(p.position * 10) / 10 } : null,
    queries: q,
    keywordPages: keywordRows
      .map((r) => ({ url: r.keys?.[0] ?? "", clicks: r.clicks, impressions: r.impressions, position: Math.round(r.position * 10) / 10 }))
      .filter((r) => r.url)
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 10),
  };
}

/** Conservative expected CTR by position (used only to flag unusually low CTR, never shown as data). */
export function expectedCtr(position: number) {
  if (position < 1.5) return 0.22;
  if (position < 2.5) return 0.12;
  if (position < 3.5) return 0.08;
  if (position < 5.5) return 0.05;
  if (position < 10.5) return 0.025;
  return 0.01;
}

/**
 * Recommended words for the Writing Assistant from real Google Autocomplete suggestions: the words
 * searchers add to the seed, ranked by how many suggestions use them.
 */
export function recommendedFromAutocomplete(seed: string, suggestions: string[], limit = 15): string[] {
  const seedTokens = new Set(wordList(normalizeText(seed)).flatMap((t) => [t, t.replace(/s$/, ""), `${t}s`]));
  const counts = new Map<string, number>();
  for (const s of suggestions) {
    const seen = new Set<string>();
    for (const t of wordList(normalizeText(s))) if (t.length >= 3 && !seedTokens.has(t) && !STOPWORDS.has(t) && !/^\d+$/.test(t) && !["near", "reddit", "youtube", "pdf"].includes(t)) seen.add(t);
    for (const t of seen) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([t]) => t);
}

export type Snippet = { position: number; domain: string; url: string; keyword: string; text: string };

/** Merge several SERPs: URLs ranking for more keywords and higher first. Pure. */
export function mergeSerps(lists: SerpOrganic[][], limit = 10): SerpOrganic[] {
  const n = lists.length;
  const pool = new Map<string, { r: SerpOrganic; sum: number; hits: number }>();
  for (const list of lists)
    for (const r of list.slice(0, 10)) {
      const cur = pool.get(r.url);
      if (cur) {
        cur.sum += r.position;
        cur.hits++;
      } else pool.set(r.url, { r, sum: r.position, hits: 1 });
    }
  return [...pool.values()]
    .map((p) => ({ ...p, rank: (p.sum + (n - p.hits) * 12) / n }))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit)
    .map((p, i) => ({ ...p.r, position: n > 1 ? i + 1 : p.r.position }));
}

/** Result descriptions from the SERP that mention one of the keywords (real snippets). Pure. */
export function keywordSnippets(results: SerpOrganic[], keywords: string[], limit = 6): Snippet[] {
  const out: Snippet[] = [];
  for (const r of results) {
    const kw = keywords.find((k) => keywordRegex(k)?.test(r.description));
    if (kw && r.description) out.push({ position: r.position, domain: r.domain, url: r.url, keyword: kw, text: r.description });
    if (out.length >= limit) break;
  }
  return out;
}

