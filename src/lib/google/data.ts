import { query } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { cached } from "@/lib/providers/source";
import { googleApi } from "./oauth";

/** Search Console (Search Analytics) + GA4 (Data API) for projects the user has linked. */

const GSC = "https://searchconsole.googleapis.com/webmasters/v3";
const GA_ADMIN = "https://analyticsadmin.googleapis.com/v1beta";
const GA_DATA = "https://analyticsdata.googleapis.com/v1beta";

// ------------------------------------------------------------------------------ discovery & links

export type GscSite = { siteUrl: string; permissionLevel: string };
export async function listGscSites(userId: string): Promise<GscSite[]> {
  const data = await googleApi<{ siteEntry?: GscSite[] }>(userId, `${GSC}/sites`);
  return (data.siteEntry ?? []).filter((s) => s.permissionLevel !== "siteUnverifiedUser").sort((a, b) => a.siteUrl.localeCompare(b.siteUrl));
}

export type Ga4Property = { property: string; name: string; account: string };
export async function listGa4Properties(userId: string): Promise<Ga4Property[]> {
  const out: Ga4Property[] = [];
  let pageToken = "";
  for (let i = 0; i < 5; i++) {
    const data = await googleApi<{ accountSummaries?: { displayName?: string; propertySummaries?: { property: string; displayName?: string }[] }[]; nextPageToken?: string }>(
      userId,
      `${GA_ADMIN}/accountSummaries?pageSize=200${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`,
    );
    for (const a of data.accountSummaries ?? []) for (const p of a.propertySummaries ?? []) out.push({ property: p.property, name: p.displayName ?? p.property, account: a.displayName ?? "" });
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return out;
}

/** Best Search Console property for a domain: the Domain property first, then URL-prefix variants. */
export function suggestGscSite(domain: string, sites: GscSite[]) {
  const candidates = [`sc-domain:${domain}`, `https://www.${domain}/`, `https://${domain}/`, `http://www.${domain}/`, `http://${domain}/`];
  return candidates.find((c) => sites.some((s) => s.siteUrl === c)) ?? sites.find((s) => s.siteUrl.includes(domain))?.siteUrl ?? null;
}

export type ProjectGoogleLink = { gscSite: string | null; ga4Property: string | null; ga4PropertyName: string | null };
export async function getProjectGoogle(projectId: string): Promise<ProjectGoogleLink> {
  const [row] = await query<{ gsc_site: string | null; ga4_property: string | null; ga4_property_name: string | null }>(
    "SELECT gsc_site, ga4_property, ga4_property_name FROM project_google WHERE project_id=$1",
    [projectId],
  );
  return { gscSite: row?.gsc_site ?? null, ga4Property: row?.ga4_property ?? null, ga4PropertyName: row?.ga4_property_name ?? null };
}
export async function setProjectGoogle(projectId: string, link: ProjectGoogleLink) {
  if (link.gscSite && !/^(sc-domain:[a-z0-9.-]+|https?:\/\/.+\/)$/i.test(link.gscSite)) throw new AppError("That is not a Search Console property.");
  if (link.ga4Property && !/^properties\/\d+$/.test(link.ga4Property)) throw new AppError("That is not a GA4 property.");
  await query(
    `INSERT INTO project_google(project_id,gsc_site,ga4_property,ga4_property_name,updated_at) VALUES($1,$2,$3,$4,now())
     ON CONFLICT(project_id) DO UPDATE SET gsc_site=excluded.gsc_site, ga4_property=excluded.ga4_property, ga4_property_name=excluded.ga4_property_name, updated_at=now()`,
    [projectId, link.gscSite, link.ga4Property, link.ga4PropertyName],
  );
}

// ------------------------------------------------------------------------------ date ranges

const iso = (d: Date) => d.toISOString().slice(0, 10);
/** Search Console data lags ~2–3 days, so ranges end 3 days ago for both sources (comparable). */
export function dateRange(days: number) {
  const end = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() - 3));
  const start = new Date(end.getTime() - (days - 1) * 86400000);
  const prevEnd = new Date(start.getTime() - 86400000);
  const prevStart = new Date(prevEnd.getTime() - (days - 1) * 86400000);
  return { start: iso(start), end: iso(end), prevStart: iso(prevStart), prevEnd: iso(prevEnd), days };
}

// ------------------------------------------------------------------------------ Search Console

type GscRow = { keys?: string[]; clicks: number; impressions: number; ctr: number; position: number };
export type GscTotals = { clicks: number; impressions: number; ctr: number; position: number };

async function gscQuery(userId: string, site: string, body: Record<string, unknown>) {
  const data = await googleApi<{ rows?: GscRow[] }>(userId, `${GSC}/sites/${encodeURIComponent(site)}/searchAnalytics/query`, { type: "web", dataState: "all", ...body });
  return data.rows ?? [];
}
const totalsOf = (rows: GscRow[]): GscTotals => {
  const r = rows[0];
  return r ? { clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position } : { clicks: 0, impressions: 0, ctr: 0, position: 0 };
};

export type GscInsights = {
  site: string;
  totals: GscTotals;
  previous: GscTotals;
  daily: ({ date: string } & GscTotals)[];
  queries: ({ query: string } & GscTotals)[];
  pages: ({ url: string; path: string; queries: number; topQuery: string | null } & GscTotals)[];
  countries: ({ country: string } & GscTotals)[];
  devices: ({ device: string } & GscTotals)[];
};

const pathOf = (url: string) => {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
};

async function gscInsights(userId: string, site: string, range: ReturnType<typeof dateRange>): Promise<GscInsights> {
  const base = { startDate: range.start, endDate: range.end };
  const [totals, previous, daily, queries, pageQuery, pages, countries, devices] = await Promise.all([
    gscQuery(userId, site, { ...base }),
    gscQuery(userId, site, { startDate: range.prevStart, endDate: range.prevEnd }),
    gscQuery(userId, site, { ...base, dimensions: ["date"], rowLimit: 500 }),
    gscQuery(userId, site, { ...base, dimensions: ["query"], rowLimit: 1000 }),
    gscQuery(userId, site, { ...base, dimensions: ["page", "query"], rowLimit: 5000 }),
    gscQuery(userId, site, { ...base, dimensions: ["page"], rowLimit: 500 }),
    gscQuery(userId, site, { ...base, dimensions: ["country"], rowLimit: 50 }),
    gscQuery(userId, site, { ...base, dimensions: ["device"], rowLimit: 5 }),
  ]);
  const perPage = new Map<string, { count: number; top: string; clicks: number }>();
  for (const r of pageQuery) {
    const [page, q] = r.keys ?? [];
    const cur = perPage.get(page) ?? { count: 0, top: q, clicks: -1 };
    cur.count++;
    if (r.clicks > cur.clicks) Object.assign(cur, { top: q, clicks: r.clicks });
    perPage.set(page, cur);
  }
  const pick = (r: GscRow): GscTotals => ({ clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position });
  return {
    site,
    totals: totalsOf(totals),
    previous: totalsOf(previous),
    daily: daily.map((r) => ({ date: r.keys?.[0] ?? "", ...pick(r) })).sort((a, b) => a.date.localeCompare(b.date)),
    queries: queries.map((r) => ({ query: r.keys?.[0] ?? "", ...pick(r) })),
    pages: pages.map((r) => {
      const url = r.keys?.[0] ?? "";
      const q = perPage.get(url);
      return { url, path: pathOf(url), queries: q?.count ?? 0, topQuery: q?.top ?? null, ...pick(r) };
    }),
    countries: countries.map((r) => ({ country: (r.keys?.[0] ?? "").toUpperCase(), ...pick(r) })),
    devices: devices.map((r) => ({ device: (r.keys?.[0] ?? "").toLowerCase(), ...pick(r) })),
  };
}

// ------------------------------------------------------------------------------ GA4

type Ga4Row = { dimensionValues?: { value: string }[]; metricValues?: { value: string }[] };
async function ga4Report(userId: string, property: string, body: Record<string, unknown>) {
  const data = await googleApi<{ rows?: Ga4Row[] }>(userId, `${GA_DATA}/${property}:runReport`, body);
  return data.rows ?? [];
}
const METRICS = ["sessions", "totalUsers", "newUsers", "engagementRate", "averageSessionDuration", "screenPageViews", "keyEvents"] as const;
export type Ga4Totals = { sessions: number; users: number; newUsers: number; engagementRate: number; avgDuration: number; pageViews: number; keyEvents: number };
const toTotals = (m: { value: string }[] = []): Ga4Totals => {
  const n = (i: number) => Number(m[i]?.value ?? 0) || 0;
  return { sessions: n(0), users: n(1), newUsers: n(2), engagementRate: n(3), avgDuration: n(4), pageViews: n(5), keyEvents: n(6) };
};
const ORGANIC = { filter: { fieldName: "sessionDefaultChannelGroup", stringFilter: { value: "Organic Search" } } };

export type Ga4Insights = {
  property: string;
  totals: Ga4Totals;
  previous: Ga4Totals;
  organic: Ga4Totals;
  organicPrevious: Ga4Totals;
  daily: { date: string; sessions: number; organic: number }[];
  channels: ({ channel: string } & Ga4Totals)[];
  landingPages: ({ path: string } & Ga4Totals)[];
};

async function ga4Insights(userId: string, property: string, range: ReturnType<typeof dateRange>): Promise<Ga4Insights> {
  const metrics = METRICS.map((name) => ({ name }));
  const cur = [{ startDate: range.start, endDate: range.end }];
  const prev = [{ startDate: range.prevStart, endDate: range.prevEnd }];
  // GA4 limits concurrent requests per property, so reports run one at a time.
  const reports: (() => Promise<Ga4Row[]>)[] = [
    () => ga4Report(userId, property, { dateRanges: cur, metrics }),
    () => ga4Report(userId, property, { dateRanges: prev, metrics }),
    () => ga4Report(userId, property, { dateRanges: cur, metrics, dimensionFilter: ORGANIC }),
    () => ga4Report(userId, property, { dateRanges: prev, metrics, dimensionFilter: ORGANIC }),
    () => ga4Report(userId, property, { dateRanges: cur, dimensions: [{ name: "date" }], metrics: [{ name: "sessions" }], limit: 500 }),
    () => ga4Report(userId, property, { dateRanges: cur, dimensions: [{ name: "date" }], metrics: [{ name: "sessions" }], dimensionFilter: ORGANIC, limit: 500 }),
    () => ga4Report(userId, property, { dateRanges: cur, dimensions: [{ name: "sessionDefaultChannelGroup" }], metrics, orderBys: [{ metric: { metricName: "sessions" }, desc: true }], limit: 20 }),
    () => ga4Report(userId, property, { dateRanges: cur, dimensions: [{ name: "landingPagePlusQueryString" }], metrics, dimensionFilter: ORGANIC, orderBys: [{ metric: { metricName: "sessions" }, desc: true }], limit: 500 }),
  ];
  const results: Ga4Row[][] = [];
  for (const run of reports) results.push(await run());
  const [totals, previous, organic, organicPrevious, daily, dailyOrganic, channels, landing] = results;
  const organicByDay = new Map(dailyOrganic.map((r) => [r.dimensionValues?.[0]?.value ?? "", Number(r.metricValues?.[0]?.value ?? 0)]));
  const gaDate = (v: string) => (v.length === 8 ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6)}` : v);
  return {
    property,
    totals: toTotals(totals[0]?.metricValues),
    previous: toTotals(previous[0]?.metricValues),
    organic: toTotals(organic[0]?.metricValues),
    organicPrevious: toTotals(organicPrevious[0]?.metricValues),
    daily: daily
      .map((r) => {
        const raw = r.dimensionValues?.[0]?.value ?? "";
        return { date: gaDate(raw), sessions: Number(r.metricValues?.[0]?.value ?? 0), organic: organicByDay.get(raw) ?? 0 };
      })
      .sort((a, b) => a.date.localeCompare(b.date)),
    channels: channels.map((r) => ({ channel: r.dimensionValues?.[0]?.value ?? "(other)", ...toTotals(r.metricValues) })),
    landingPages: landing.map((r) => ({ path: r.dimensionValues?.[0]?.value || "/", ...toTotals(r.metricValues) })),
  };
}

// ------------------------------------------------------------------------------ combined

export type InsightPage = {
  path: string;
  url: string | null;
  clicks: number | null;
  impressions: number | null;
  position: number | null;
  queries: number | null;
  topQuery: string | null;
  sessions: number | null;
  engagementRate: number | null;
  keyEvents: number | null;
};

export type OrganicInsights = {
  range: ReturnType<typeof dateRange>;
  gsc: GscInsights | null;
  gscError: string | null;
  ga4: Ga4Insights | null;
  ga4Error: string | null;
  pages: InsightPage[];
};

/** Join Search Console pages with GA4 organic landing pages by path. */
export function joinPages(gsc: GscInsights | null, ga4: Ga4Insights | null): InsightPage[] {
  const map = new Map<string, InsightPage>();
  const norm = (p: string) => (p.length > 1 ? p.replace(/\/$/, "") : p) || "/";
  for (const p of gsc?.pages ?? [])
    map.set(norm(p.path), { path: p.path, url: p.url, clicks: p.clicks, impressions: p.impressions, position: p.position, queries: p.queries, topQuery: p.topQuery, sessions: null, engagementRate: null, keyEvents: null });
  for (const l of ga4?.landingPages ?? []) {
    const key = norm(l.path);
    const row = map.get(key) ?? { path: l.path, url: null, clicks: null, impressions: null, position: null, queries: null, topQuery: null, sessions: null, engagementRate: null, keyEvents: null };
    row.sessions = (row.sessions ?? 0) + l.sessions;
    row.engagementRate = l.engagementRate;
    row.keyEvents = (row.keyEvents ?? 0) + l.keyEvents;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => (b.clicks ?? 0) - (a.clicks ?? 0) || (b.sessions ?? 0) - (a.sessions ?? 0));
}

/** Real organic performance for a linked project (cached 6 h per user/property/range). */
export async function organicInsights(userId: string, link: ProjectGoogleLink, days: number) {
  const range = dateRange(days);
  const key = `google-insights:v2:${userId}:${link.gscSite ?? "-"}:${link.ga4Property ?? "-"}:${range.start}:${range.end}`;
  let partial: OrganicInsights | null = null;
  try {
    return await cached(key, "search-console", 6, async (): Promise<OrganicInsights> => {
    const [gsc, ga4] = await Promise.allSettled([
      link.gscSite ? gscInsights(userId, link.gscSite, range) : Promise.resolve(null),
      link.ga4Property ? ga4Insights(userId, link.ga4Property, range) : Promise.resolve(null),
    ]);
    const err = (r: PromiseSettledResult<unknown>) => (r.status === "rejected" ? (r.reason instanceof Error ? r.reason.message : String(r.reason)) : null);
    const g = gsc.status === "fulfilled" ? gsc.value : null;
    const a = ga4.status === "fulfilled" ? ga4.value : null;
    // Do not cache a result where every linked source failed (e.g. a transient quota error).
    if (!((link.gscSite && g) || (link.ga4Property && a))) throw new AppError(err(gsc) ?? err(ga4) ?? "Google data could not be loaded.", 502);
    const result = { range, gsc: g, gscError: err(gsc), ga4: a, ga4Error: err(ga4), pages: joinPages(g, a) };
    // A partial failure (e.g. a transient quota error on one source) is shown but not cached.
    if (result.gscError || result.ga4Error) {
      partial = result;
      throw new AppError("partial", 502);
    }
    return result;
    });
  } catch (e) {
    if (partial) return { data: partial as OrganicInsights, source: "search-console" as const, fetchedAt: new Date().toISOString(), live: true };
    throw e;
  }
}
