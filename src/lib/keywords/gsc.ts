import { createHash } from "node:crypto";
import { dateRange, getProjectGoogle, gscQuery, type GscRow } from "@/lib/google/data";
import { googleConfigured } from "@/lib/google/oauth";
import { listProjects } from "@/lib/projects";
import { cached } from "@/lib/providers/source";
import {
  containsQueryFilter,
  exactQueryFilter,
  mergeKeywordStats,
  rankSites,
  regexChunks,
  seedFilterGroups,
  sitePerformance,
  type GscKwStat,
  type GscSiteRef,
  type SitePerformance,
} from "./gsc-map";
import { normalizeKw } from "./text";

/**
 * The user's own Search Console data for keywords (real, from the properties linked to their projects).
 * Every aggregation is cached 6 h per site; failed sites are skipped (and not cached) so one broken link
 * never hides the others.
 */

/** Keyword research looks at the last 3 months of Search Console data. */
export const GSC_DAYS = 90;
const TTL = 6;
const digest = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 16);

/** Search Console properties linked to the user's projects (deduplicated). Empty when Google is not configured. */
export async function linkedGscSites(userId: string): Promise<GscSiteRef[]> {
  if (!googleConfigured()) return [];
  const projects = await listProjects(userId);
  const out = new Map<string, GscSiteRef>();
  for (const p of projects) {
    const link = await getProjectGoogle(p.id);
    if (link.gscSite && !out.has(link.gscSite)) out.set(link.gscSite, { site: link.gscSite, project: p.name, projectId: p.id });
  }
  return [...out.values()];
}

export type GscStatus = { configured: boolean; sites: number; errors: string[]; fetchedAt: string | null };
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function perSite<T>(sites: GscSiteRef[], run: (s: GscSiteRef) => Promise<{ data: T; fetchedAt: string }>) {
  const settled = await Promise.allSettled(sites.map(run));
  const ok: { site: GscSiteRef; data: T }[] = [];
  const errors: string[] = [];
  let fetchedAt: string | null = null;
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") {
      ok.push({ site: sites[i], data: r.value.data });
      if (!fetchedAt || r.value.fetchedAt < fetchedAt) fetchedAt = r.value.fetchedAt;
    } else errors.push(`${sites[i].site}: ${errMsg(r.reason)}`);
  });
  return { ok, errors, fetchedAt: fetchedAt as string | null };
}

/**
 * Your clicks / impressions / position / ranking page for an arbitrary set of keywords (bulk overview,
 * lists). Per site: exact-match regex filters in chunks, 2 queries per chunk (totals, pages).
 */
export async function gscKeywordStats(userId: string, keywordsInput: string[]): Promise<{ stats: Record<string, GscKwStat>; status: GscStatus }> {
  const configured = googleConfigured();
  const keywords = [...new Set(keywordsInput.map(normalizeKw).filter(Boolean))].slice(0, 2000);
  const sites = configured && keywords.length ? await linkedGscSites(userId) : [];
  if (!sites.length) return { stats: {}, status: { configured, sites: 0, errors: [], fetchedAt: null } };
  const range = dateRange(GSC_DAYS);
  const chunks = regexChunks(keywords);
  const { ok, errors, fetchedAt } = await perSite(sites, (s) =>
    cached(`kw-gsc:stats:${s.site}:${range.end}:${digest([...keywords].sort().join("|"))}`, "search-console", TTL, async () => {
      const queryRows: GscRow[] = [];
      const pageRows: GscRow[] = [];
      for (const c of chunks) {
        const filter = [{ filters: [{ dimension: "query", operator: "includingRegex", expression: c.regex }] }];
        const base = { startDate: range.start, endDate: range.end, dimensionFilterGroups: filter };
        const [q, p] = await Promise.all([
          gscQuery(userId, s.site, { ...base, dimensions: ["query"], rowLimit: Math.min(25000, c.keywords.length + 10) }),
          gscQuery(userId, s.site, { ...base, dimensions: ["query", "page"], rowLimit: 5000 }),
        ]);
        queryRows.push(...q);
        pageRows.push(...p);
      }
      return { queryRows, pageRows };
    }),
  );
  const stats = mergeKeywordStats(ok.map((o) => ({ site: o.site, ...o.data })));
  return { stats, status: { configured, sites: sites.length, errors, fetchedAt } };
}

/**
 * Your queries that contain every word of a seed (Magic Tool columns): one batched query per linked
 * site, cached 6 h per site + seed.
 */
export async function gscSeedStats(userId: string, seedInput: string): Promise<{ stats: Record<string, GscKwStat>; status: GscStatus }> {
  const configured = googleConfigured();
  const seed = normalizeKw(seedInput);
  const sites = configured && seed ? await linkedGscSites(userId) : [];
  if (!sites.length) return { stats: {}, status: { configured, sites: 0, errors: [], fetchedAt: null } };
  const range = dateRange(GSC_DAYS);
  const { ok, errors, fetchedAt } = await perSite(sites, (s) =>
    cached(`kw-gsc:seed:${s.site}:${range.end}:${seed}`, "search-console", TTL, () =>
      gscQuery(userId, s.site, { startDate: range.start, endDate: range.end, dimensions: ["query"], dimensionFilterGroups: seedFilterGroups(seed), rowLimit: 5000 }),
    ),
  );
  const stats = mergeKeywordStats(ok.map((o) => ({ site: o.site, queryRows: o.data })));
  return { stats, status: { configured, sites: sites.length, errors, fetchedAt } };
}

/** "Your site" card for Keyword Overview: exact query totals + ranking pages + your queries containing it, per linked site. */
export async function gscKeywordPerformance(userId: string, keywordInput: string): Promise<{ sites: SitePerformance[]; status: GscStatus }> {
  const configured = googleConfigured();
  const keyword = normalizeKw(keywordInput);
  const linked = configured && keyword ? await linkedGscSites(userId) : [];
  if (!linked.length) return { sites: [], status: { configured, sites: 0, errors: [], fetchedAt: null } };
  const range = dateRange(GSC_DAYS);
  const { ok, errors, fetchedAt } = await perSite(linked, (s) =>
    cached(`kw-gsc:perf:${s.site}:${range.end}:${keyword}`, "search-console", TTL, async () => {
      const base = { startDate: range.start, endDate: range.end };
      const [contains, pages] = await Promise.all([
        gscQuery(userId, s.site, { ...base, dimensions: ["query"], dimensionFilterGroups: containsQueryFilter(keyword), rowLimit: 200 }),
        gscQuery(userId, s.site, { ...base, dimensions: ["page"], dimensionFilterGroups: exactQueryFilter(keyword), rowLimit: 20 }),
      ]);
      return { contains, pages };
    }),
  );
  const sites = rankSites(ok.map((o) => sitePerformance(keyword, o.site, o.data.contains, o.data.pages)));
  return { sites, status: { configured, sites: linked.length, errors, fetchedAt } };
}

export type { GscKwStat, SitePerformance };
