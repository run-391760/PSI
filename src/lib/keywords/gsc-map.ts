/**
 * Pure mapping from Search Console Search Analytics rows to keyword-tool view models (no server imports,
 * unit-tested in tests/keywords-real.test.ts). Queries are made by ./gsc.ts.
 */
import { kwTokens, normalizeKw, stem, STOPWORDS } from "./text";

/** Search Analytics row (same shape as GscRow in @/lib/google/data; repeated to stay client/test safe). */
export type GscApiRow = { keys?: string[]; clicks: number; impressions: number; ctr: number; position: number };

/** One of the user's Search Console properties, linked to a project. */
export type GscSiteRef = { site: string; project: string; projectId: string };

/** The user's own performance for one keyword on one of their sites. */
export type GscKwStat = {
  keyword: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  /** Best-performing ranking page (most clicks, then impressions), when known. */
  page: string | null;
  site: string;
  project: string;
};

/** Compact client form for large tables (Magic Tool): impressions, clicks, position, site index. */
export type GscCell = { im: number; cl: number; po: number; pg?: string | null; s: string };

// ------------------------------------------------------------------------------ request builders

/** Escapes a literal for an RE2 regex (Search Console `includingRegex`). */
export function escapeRe2(s: string) {
  return s.replace(/[\\^$.|?*+()[\]{}]/g, "\\$&");
}

/**
 * Splits keywords into exact-match regex filters `^(?:a|b|c)$` that stay under Search Console's filter
 * length limit (4,096 characters; we keep a margin).
 */
export function regexChunks(keywordsInput: string[], maxLen = 3800): { keywords: string[]; regex: string }[] {
  const keywords = [...new Set(keywordsInput.map(normalizeKw).filter(Boolean))];
  const out: { keywords: string[]; regex: string }[] = [];
  let cur: string[] = [];
  let len = 0;
  const flush = () => {
    if (cur.length) out.push({ keywords: cur, regex: `^(?:${cur.map(escapeRe2).join("|")})$` });
    cur = [];
    len = 0;
  };
  for (const k of keywords) {
    const e = escapeRe2(k);
    if (e.length + 8 > maxLen) continue; // a single keyword that can never fit
    if (len + e.length + 1 + 8 > maxLen) flush();
    cur.push(k);
    len += e.length + 1;
  }
  flush();
  return out;
}

/** Filter groups for a seed: every meaningful seed word must appear (substring, so plurals match). */
export function seedFilterGroups(seedInput: string) {
  const seed = normalizeKw(seedInput);
  const words = [...new Set(kwTokens(seed).filter((t) => !STOPWORDS.has(t) && t.length >= 2).map(stem))];
  const expressions = words.length ? words : [seed];
  return [{ groupType: "and", filters: expressions.map((expression) => ({ dimension: "query", operator: "contains", expression })) }];
}

export const exactQueryFilter = (keyword: string) => [{ filters: [{ dimension: "query", operator: "equals", expression: normalizeKw(keyword) }] }];
export const containsQueryFilter = (keyword: string) => [{ filters: [{ dimension: "query", operator: "contains", expression: normalizeKw(keyword) }] }];

// ------------------------------------------------------------------------------ mappers

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

/**
 * Merges per-site rows into one stat per keyword. `queryRows` have keys [query]; `pageRows` (optional)
 * keys [query, page]. When a keyword appears on several sites the site with the most impressions wins.
 */
export function mergeKeywordStats(perSite: { site: GscSiteRef; queryRows: GscApiRow[]; pageRows?: GscApiRow[] }[]): Record<string, GscKwStat> {
  const out: Record<string, GscKwStat> = {};
  for (const { site, queryRows, pageRows = [] } of perSite) {
    const bestPage = new Map<string, GscApiRow>();
    for (const r of pageRows) {
      const q = normalizeKw(r.keys?.[0] ?? "");
      if (!q || !r.keys?.[1]) continue;
      const cur = bestPage.get(q);
      if (!cur || r.clicks > cur.clicks || (r.clicks === cur.clicks && r.impressions > cur.impressions)) bestPage.set(q, r);
    }
    for (const r of queryRows) {
      const keyword = normalizeKw(r.keys?.[0] ?? "");
      if (!keyword) continue;
      const prev = out[keyword];
      if (prev && prev.impressions >= r.impressions) continue;
      out[keyword] = {
        keyword,
        clicks: r.clicks,
        impressions: r.impressions,
        ctr: round(r.ctr, 4),
        position: round(r.position, 1),
        page: bestPage.get(keyword)?.keys?.[1] ?? null,
        site: site.site,
        project: site.project,
      };
    }
  }
  return out;
}

/** Compact per-keyword cells for the Magic Tool (keeps the RSC payload small for ~3,000 rows). */
export function toCells(stats: Record<string, GscKwStat>): Record<string, GscCell> {
  const out: Record<string, GscCell> = {};
  for (const [k, s] of Object.entries(stats)) out[k] = { im: s.impressions, cl: s.clicks, po: s.position, pg: s.page, s: s.site };
  return out;
}

export type SitePerformance = {
  site: string;
  project: string;
  projectId: string;
  /** The exact query, when the site received impressions for it. */
  exact: { clicks: number; impressions: number; ctr: number; position: number } | null;
  /** Pages that appeared for the exact query (most clicks first). */
  pages: { url: string; clicks: number; impressions: number; ctr: number; position: number }[];
  /** Other queries of the site that contain the keyword (most impressions first). */
  related: { query: string; clicks: number; impressions: number; position: number }[];
};

/**
 * "Your site" card for Keyword Overview. `containsRows` keys [query] (queries containing the keyword);
 * `pageRows` keys [page] (exact-query filter).
 */
export function sitePerformance(keywordInput: string, site: GscSiteRef, containsRows: GscApiRow[], pageRows: GscApiRow[]): SitePerformance {
  const keyword = normalizeKw(keywordInput);
  const exactRow = containsRows.find((r) => normalizeKw(r.keys?.[0] ?? "") === keyword);
  return {
    site: site.site,
    project: site.project,
    projectId: site.projectId,
    exact: exactRow ? { clicks: exactRow.clicks, impressions: exactRow.impressions, ctr: round(exactRow.ctr, 4), position: round(exactRow.position, 1) } : null,
    pages: pageRows
      .filter((r) => r.keys?.[0])
      .map((r) => ({ url: r.keys![0], clicks: r.clicks, impressions: r.impressions, ctr: round(r.ctr, 4), position: round(r.position, 1) }))
      .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
      .slice(0, 5),
    related: containsRows
      .map((r) => ({ query: normalizeKw(r.keys?.[0] ?? ""), clicks: r.clicks, impressions: r.impressions, position: round(r.position, 1) }))
      .filter((r) => r.query && r.query !== keyword)
      .sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks)
      .slice(0, 10),
  };
}

/** Sites ordered for display: those with the exact query first (by impressions), then by related impressions. */
export function rankSites(list: SitePerformance[]) {
  const rel = (s: SitePerformance) => s.related.reduce((n, r) => n + r.impressions, 0);
  return [...list].sort((a, b) => (b.exact?.impressions ?? -1) - (a.exact?.impressions ?? -1) || rel(b) - rel(a));
}
