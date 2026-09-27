import { AppError } from "@/lib/domain";
import { googleProjectForDomain } from "@/lib/data-mode";
import { dateRange, ga4Report, gscQuery, type ProjectGoogleLink } from "@/lib/google/data";
import { getProject } from "@/lib/projects";
import { cached } from "@/lib/providers/source";
import {
  brandSplit,
  brandTerms,
  buildPages,
  buildQueries,
  GA4_METRICS,
  ga4Daily,
  ga4Dimension,
  ga4Totals,
  GSC_RETENTION_DAYS,
  gscDaily,
  gscDimension,
  gscTotals,
  hasComparablePrevious,
  ownRange,
  positionBands,
  statusCounts,
  type DailyPoint,
  type OwnDimRow,
  type OwnPageRow,
  type OwnQueryRow,
  type SearchTotals,
  type TrafficDaily,
  type TrafficDimRow,
  type TrafficTotals,
} from "./own-site-map";

/**
 * The user's own sites: real Search Console (and GA4) data for a domain that one of the user's
 * projects has linked in Organic Traffic Insights. Cached 6 h; results with errors are never cached.
 */

export type OwnSite = { project: { id: string; name: string; domain: string; country: string }; link: ProjectGoogleLink; brand: string[] };

export async function ownSiteFor(userId: string, domain: string): Promise<OwnSite | null> {
  const found = await googleProjectForDomain(userId, domain);
  if (!found) return null;
  const project = await getProject(userId, found.project.id).catch(() => null);
  return { project: found.project, link: found.link, brand: brandTerms(domain, project?.brand_terms ?? []) };
}

const QUERY_LIMIT = 5000;

export type OwnSearchReport = {
  site: string;
  range: ReturnType<typeof dateRange>;
  comparable: boolean;
  totals: SearchTotals;
  previous: SearchTotals | null;
  /** Daily points for the whole Search Console retention window (16 months). */
  daily: DailyPoint[];
  queries: OwnQueryRow[];
  queryLimitHit: boolean;
  counts: ReturnType<typeof statusCounts>;
  bands: ReturnType<typeof positionBands>;
  brand: ReturnType<typeof brandSplit>;
  brandTerms: string[];
  pages: OwnPageRow[];
  countries: OwnDimRow[];
  devices: OwnDimRow[];
};

export async function getOwnSearch(userId: string, site: OwnSite, rangeId: string) {
  const gscSite = site.link.gscSite;
  if (!gscSite) throw new AppError("No Search Console property is linked to this project.", 409);
  const r = ownRange(rangeId);
  const range = dateRange(r.days);
  const comparable = hasComparablePrevious(r.days);
  const full = dateRange(GSC_RETENTION_DAYS);
  const key = `own-search:v1:${userId}:${gscSite}:${range.start}:${range.end}:${site.brand.join("|")}`;
  return cached(key, "search-console", 6, async (): Promise<OwnSearchReport> => {
    const cur = { startDate: range.start, endDate: range.end };
    const prev = { startDate: range.prevStart, endDate: range.prevEnd };
    const q = (body: Record<string, unknown>) => gscQuery(userId, gscSite, body);
    const [totals, previous, daily, queries, prevQueries, pageQuery, pages, prevPages, countries, devices] = await Promise.all([
      q(cur),
      comparable ? q(prev) : Promise.resolve(null),
      q({ startDate: full.start, endDate: full.end, dimensions: ["date"], rowLimit: 1000 }),
      q({ ...cur, dimensions: ["query"], rowLimit: QUERY_LIMIT }),
      comparable ? q({ ...prev, dimensions: ["query"], rowLimit: QUERY_LIMIT }) : Promise.resolve(null),
      q({ ...cur, dimensions: ["page", "query"], rowLimit: 10000 }),
      q({ ...cur, dimensions: ["page"], rowLimit: 1000 }),
      comparable ? q({ ...prev, dimensions: ["page"], rowLimit: 1000 }) : Promise.resolve(null),
      q({ ...cur, dimensions: ["country"], rowLimit: 250 }),
      q({ ...cur, dimensions: ["device"], rowLimit: 5 }),
    ]);
    const rows = buildQueries({ current: queries, previous: prevQueries, pageQuery, brand: site.brand });
    return {
      site: gscSite,
      range,
      comparable,
      totals: gscTotals(totals) ?? { clicks: 0, impressions: 0, ctr: 0, position: null },
      previous: previous ? gscTotals(previous) : null,
      daily: gscDaily(daily),
      queries: rows,
      queryLimitHit: queries.length >= QUERY_LIMIT,
      counts: statusCounts(rows),
      bands: positionBands(rows),
      brand: brandSplit(rows),
      brandTerms: site.brand,
      pages: buildPages(pages, prevPages, pageQuery),
      countries: gscDimension(countries, "country"),
      devices: gscDimension(devices, "device"),
    };
  });
}

export type OwnTrafficReport = {
  property: string;
  range: ReturnType<typeof dateRange>;
  totals: TrafficTotals;
  previous: TrafficTotals;
  daily: TrafficDaily[];
  channels: TrafficDimRow[];
  countries: TrafficDimRow[];
  devices: TrafficDimRow[];
  landingPages: TrafficDimRow[];
  newReturning: TrafficDimRow[];
};

/** GA4 traffic for a linked property. GA4 limits concurrent requests per property: reports run sequentially. */
export async function getOwnTraffic(userId: string, property: string, rangeId: string) {
  const r = ownRange(rangeId);
  const range = dateRange(r.days);
  const key = `own-traffic:v1:${userId}:${property}:${range.start}:${range.end}`;
  return cached(key, "google-analytics", 6, async (): Promise<OwnTrafficReport> => {
    const metrics = GA4_METRICS.map((name) => ({ name }));
    const cur = [{ startDate: range.start, endDate: range.end }];
    const prev = [{ startDate: range.prevStart, endDate: range.prevEnd }];
    const bySessions = [{ metric: { metricName: "sessions" }, desc: true }];
    const dim = (name: string, limit: number) => ga4Report(userId, property, { dateRanges: cur, dimensions: [{ name }], metrics, orderBys: bySessions, limit });
    const totals = await ga4Report(userId, property, { dateRanges: cur, metrics });
    const previous = await ga4Report(userId, property, { dateRanges: prev, metrics });
    const daily = await ga4Report(userId, property, { dateRanges: cur, dimensions: [{ name: "date" }], metrics: [{ name: "sessions" }, { name: "totalUsers" }], limit: 1000 });
    const channels = await dim("sessionDefaultChannelGroup", 25);
    const countries = await dim("country", 100);
    const devices = await dim("deviceCategory", 10);
    const landing = await dim("landingPagePlusQueryString", 250);
    const newReturning = await dim("newVsReturning", 5);
    return {
      property,
      range,
      totals: ga4Totals(totals[0]?.metricValues),
      previous: ga4Totals(previous[0]?.metricValues),
      daily: ga4Daily(daily),
      channels: ga4Dimension(channels, "channel"),
      countries: ga4Dimension(countries, "country"),
      devices: ga4Dimension(devices, "device"),
      landingPages: ga4Dimension(landing, "landing"),
      newReturning: ga4Dimension(newReturning, "newReturning").filter((x) => x.key !== "(not set)" && x.key !== ""),
    };
  });
}

/** Loads a report and returns an error message instead of throwing (the page shows it). */
export async function settle<T>(p: Promise<T>): Promise<{ data: T; error: null } | { data: null; error: string }> {
  try {
    return { data: await p, error: null };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : "Google data could not be loaded." };
  }
}
