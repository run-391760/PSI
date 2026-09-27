import { createHash } from "node:crypto";
import { crawlPage } from "@/lib/crawler";
import { database } from "@/lib/domain";
import { dateRange, gscQuery } from "@/lib/google/data";
import { dfs, market } from "@/lib/providers/dataforseo";
import { cached, liveEnabled } from "@/lib/providers/source";
import { mapAdvancedSerp, mapGscPage, measureRival, pairsFromGsc, semanticFromTexts, summarizeRivals, type GscPageData, type RealRival, type RivalAvg, type SemanticTerm, type SerpTop } from "./bench-map";
import { extractPage } from "./extract";
import { normalizeText } from "./text";

/**
 * Real content benchmarks: live Google SERP from DataForSEO, the top pages crawled with the real
 * crawler (robots.txt and crawl-delay respected, capped, low concurrency) and Search Console data
 * for the user's own pages. Nothing here falls back to synthetic numbers.
 */

const key = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 16);

/** Top organic results + SERP features, PAA questions and related searches (cached 24 h). */
export async function liveSerpTop(ownerId: string, keyword: string, dbInput: string, depth = 20): Promise<SerpTop> {
  const db = database(dbInput).code;
  const k = normalizeText(keyword);
  const { data } = await cached(`content-serp:v1:${db}:${depth}:${k}`, "dataforseo", 24, async () => {
    const [res] = await dfs(ownerId, "serp/google/organic/live/advanced", { keyword: k, ...market(db), depth, people_also_ask_click_depth: 1 }, 12000);
    return mapAdvancedSerp(res);
  });
  return data;
}

/** Crawl the given result pages politely (max `cap`, 3 at a time; the crawler enforces per-site delays). */
export async function crawlRivals(results: SerpTop["organic"], keyword: string, cap = 10): Promise<{ rivals: RealRival[]; texts: { domain: string; text: string }[] }> {
  const list = results.slice(0, cap);
  const rivals: RealRival[] = new Array(list.length);
  const texts: { domain: string; text: string }[] = [];
  let i = 0;
  const worker = async () => {
    while (i < list.length) {
      const idx = i++;
      const r = list[idx];
      try {
        const res = await crawlPage(r.url);
        const type = String(res.headers["content-type"] ?? "text/html");
        if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
        if (!/html/i.test(type)) throw new Error("Not an HTML page");
        const ex = extractPage(res.body, res.url, res.status, res.headers, r.domain);
        rivals[idx] = measureRival(r, keyword, { facts: ex.facts, text: ex.text });
        if (ex.facts.words >= 50) texts.push({ domain: r.domain, text: ex.text });
      } catch (e) {
        rivals[idx] = measureRival(r, keyword, null, e instanceof Error ? e.message : "Request failed");
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return { rivals, texts };
}

export type RealBenchmark = {
  keyword: string;
  db: string;
  features: SerpTop["features"];
  questions: string[];
  related: string[];
  rivals: RealRival[];
  avg: RivalAvg | null;
  semantic: SemanticTerm[];
  /** Position of `ownDomain` in the fetched results (null = not in the top `depth`). */
  ownPosition: number | null;
  ownUrl: string | null;
  depth: number;
  fetchedAt: string;
};

/** Top-10 benchmark for a keyword from the real SERP and crawled pages (cached 24 h). */
export async function realBenchmark(ownerId: string, keyword: string, dbInput: string, ownDomain: string | null, extraKeywords: string[] = []): Promise<RealBenchmark> {
  const db = database(dbInput).code;
  const k = normalizeText(keyword);
  const depth = 30;
  const { data } = await cached(`content-bench:v1:${db}:${key(`${k}|${ownDomain ?? ""}|${extraKeywords.join(",")}`)}`, "dataforseo", 24, async (): Promise<RealBenchmark> => {
    const serp = await liveSerpTop(ownerId, k, db, depth);
    const own = ownDomain ? serp.organic.find((r) => r.domain === ownDomain || r.domain.endsWith(`.${ownDomain}`)) : undefined;
    const top = serp.organic.filter((r) => !ownDomain || !(r.domain === ownDomain || r.domain.endsWith(`.${ownDomain}`))).slice(0, 10);
    const { rivals, texts } = await crawlRivals(top, k, 10);
    return {
      keyword: k,
      db,
      features: serp.features,
      questions: serp.questions.slice(0, 8),
      related: serp.related.slice(0, 12),
      rivals,
      avg: summarizeRivals(rivals),
      semantic: semanticFromTexts([k, ...extraKeywords], texts, 24),
      ownPosition: own?.position ?? null,
      ownUrl: own?.url ?? null,
      depth,
      fetchedAt: new Date().toISOString(),
    };
  });
  return data;
}

export const serpAvailable = () => liveEnabled();

/** Search Console data for one page and its target keyword (last 28 days, cached 6 h). */
export async function gscPageData(userId: string, site: string, pageUrl: string, keyword: string): Promise<GscPageData> {
  const range = dateRange(28);
  const k = normalizeText(keyword);
  const { data } = await cached(`content-gsc-page:v1:${userId}:${key(`${site}|${pageUrl}|${k}|${range.end}`)}`, "search-console", 6, async () => {
    const base = { startDate: range.start, endDate: range.end };
    const pageFilter = { dimensionFilterGroups: [{ filters: [{ dimension: "page", operator: "equals", expression: pageUrl }] }] };
    const [pageRows, queryRows, keywordRows] = await Promise.all([
      gscQuery(userId, site, { ...base, ...pageFilter }),
      gscQuery(userId, site, { ...base, ...pageFilter, dimensions: ["query"], rowLimit: 250 }),
      gscQuery(userId, site, { ...base, dimensions: ["page"], rowLimit: 20, dimensionFilterGroups: [{ filters: [{ dimension: "query", operator: "equals", expression: k }] }] }),
    ]);
    return mapGscPage(site, range, pageRows, queryRows, keywordRows);
  });
  return data;
}

/** Page + best query pairs from Search Console (last 28 days, cached 6 h). */
export async function gscPairs(userId: string, site: string, limit = 30) {
  const range = dateRange(28);
  return cached(`content-gsc-pairs:v1:${userId}:${key(site)}:${range.end}`, "search-console", 6, async () => {
    const rows = await gscQuery(userId, site, { startDate: range.start, endDate: range.end, dimensions: ["page", "query"], rowLimit: 5000 });
    return pairsFromGsc(rows, limit);
  });
}
