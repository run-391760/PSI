/**
 * Pure mapping from Search Console / GA4 API rows to the view models used by Domain Overview,
 * Organic Research and Traffic Analytics for the user's own (linked) sites.
 * No server imports: safe for unit tests and client components.
 */

// ------------------------------------------------------------------------------------------ ranges

export type OwnRangeId = "3m" | "6m" | "12m" | "16m";
/** Search Console keeps 16 months of data; ranges end 3 days ago (data lag). */
export const OWN_RANGES: { id: OwnRangeId; label: string; days: number }[] = [
  { id: "3m", label: "3 months", days: 90 },
  { id: "6m", label: "6 months", days: 180 },
  { id: "12m", label: "12 months", days: 365 },
  { id: "16m", label: "16 months", days: 480 },
];
export const GSC_RETENTION_DAYS = 480;
export const ownRange = (id: string | undefined) => OWN_RANGES.find((r) => r.id === id) ?? OWN_RANGES[0];
/** A previous period of the same length is fully inside Search Console's retention window. */
export const hasComparablePrevious = (days: number) => days * 2 <= GSC_RETENTION_DAYS;

/** Trend chart presets (number of trailing daily points). */
export const DAILY_RANGES = [
  { id: "3m", label: "3M", points: 90 },
  { id: "6m", label: "6M", points: 180 },
  { id: "12m", label: "12M", points: 365 },
  { id: "16m", label: "16M", points: GSC_RETENTION_DAYS },
];

// ------------------------------------------------------------------------------------------ Search Console

export type ApiGscRow = { keys?: string[]; clicks?: number; impressions?: number; ctr?: number; position?: number };
export type SearchTotals = { clicks: number; impressions: number; ctr: number; position: number | null };

const n0 = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
const r1 = (v: number) => Math.round(v * 10) / 10;

export function gscTotals(rows: ApiGscRow[]): SearchTotals | null {
  const r = rows[0];
  if (!r) return null;
  return { clicks: n0(r.clicks), impressions: n0(r.impressions), ctr: n0(r.ctr), position: r.position ? r1(n0(r.position)) : null };
}

/** Percent change (null when there is no comparable previous value). */
export function pctChange(current: number | null | undefined, previous: number | null | undefined) {
  if (current == null || previous == null || !previous) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export type DailyPoint = { date: string; clicks: number; impressions: number; ctr: number; position: number | null };
export function gscDaily(rows: ApiGscRow[]): DailyPoint[] {
  return rows
    .map((r) => ({ date: r.keys?.[0] ?? "", clicks: n0(r.clicks), impressions: n0(r.impressions), ctr: n0(r.ctr), position: r.position ? r1(n0(r.position)) : null }))
    .filter((r) => r.date)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Lowercased brand terms: project brand terms plus the domain label ("acme" for acme.co.uk). */
export function brandTerms(domain: string, terms: string[] = []) {
  const label = domain.replace(/^www\./, "").split(".")[0] ?? "";
  return [...new Set([label, ...terms].map((t) => t.toLowerCase().replace(/\s+/g, "")).filter((t) => t.length >= 3))];
}
export function isBranded(query: string, terms: string[]) {
  const q = query.toLowerCase().replace(/\s+/g, "");
  return terms.some((t) => q.includes(t));
}

export type QueryStatus = "new" | "improved" | "declined" | "unchanged" | "lost";
export type OwnQueryRow = {
  query: string;
  position: number | null;
  previousPosition: number | null;
  /** Positive = moved up. null when not comparable. */
  change: number | null;
  clicks: number;
  previousClicks: number | null;
  impressions: number;
  ctr: number;
  url: string | null;
  branded: boolean;
  status: QueryStatus | null;
};

/** Minimum average-position move (in positions) that counts as improved/declined. */
export const CHANGE_THRESHOLD = 1;

/**
 * Queries of the current period, compared with the previous period. `previous` null = no comparable
 * period (statuses stay null). Lost = queries in the previous period with no impressions now.
 */
export function buildQueries(input: { current: ApiGscRow[]; previous: ApiGscRow[] | null; pageQuery: ApiGscRow[]; brand: string[] }): OwnQueryRow[] {
  const topUrl = new Map<string, { url: string; clicks: number; impressions: number }>();
  for (const r of input.pageQuery) {
    const [page, q] = r.keys ?? [];
    if (!page || !q) continue;
    const cur = topUrl.get(q);
    const c = n0(r.clicks);
    const i = n0(r.impressions);
    if (!cur || c > cur.clicks || (c === cur.clicks && i > cur.impressions)) topUrl.set(q, { url: page, clicks: c, impressions: i });
  }
  const prev = new Map<string, ApiGscRow>();
  for (const r of input.previous ?? []) if (r.keys?.[0]) prev.set(r.keys[0], r);
  const seen = new Set<string>();
  const rows: OwnQueryRow[] = [];
  for (const r of input.current) {
    const query = r.keys?.[0];
    if (!query) continue;
    seen.add(query);
    const position = r1(n0(r.position));
    const p = prev.get(query);
    const previousPosition = p ? r1(n0(p.position)) : null;
    const change = previousPosition != null ? r1(previousPosition - position) : null;
    let status: QueryStatus | null = null;
    if (input.previous) status = previousPosition == null ? "new" : change! >= CHANGE_THRESHOLD ? "improved" : change! <= -CHANGE_THRESHOLD ? "declined" : "unchanged";
    rows.push({
      query,
      position,
      previousPosition,
      change,
      clicks: n0(r.clicks),
      previousClicks: input.previous ? n0(p?.clicks) : null,
      impressions: n0(r.impressions),
      ctr: n0(r.ctr),
      url: topUrl.get(query)?.url ?? null,
      branded: isBranded(query, input.brand),
      status,
    });
  }
  if (input.previous)
    for (const [query, p] of prev) {
      if (seen.has(query)) continue;
      rows.push({
        query,
        position: null,
        previousPosition: r1(n0(p.position)),
        change: null,
        clicks: 0,
        previousClicks: n0(p.clicks),
        impressions: 0,
        ctr: 0,
        url: null,
        branded: isBranded(query, input.brand),
        status: "lost",
      });
    }
  return rows.sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions || (b.previousClicks ?? 0) - (a.previousClicks ?? 0));
}

export function statusCounts(rows: OwnQueryRow[]) {
  const counts: Record<QueryStatus, number> = { new: 0, improved: 0, declined: 0, unchanged: 0, lost: 0 };
  for (const r of rows) if (r.status) counts[r.status]++;
  return counts;
}

export const POSITION_BANDS: [string, number, number][] = [
  ["1–3", 0, 3.5],
  ["4–10", 3.5, 10.5],
  ["11–20", 10.5, 20.5],
  ["21–50", 20.5, 50.5],
  ["51+", 50.5, Infinity],
];
/** Queries (with impressions in the period) by average-position band. */
export function positionBands(rows: OwnQueryRow[]) {
  return POSITION_BANDS.map(([label, lo, hi]) => ({ label, queries: rows.filter((r) => r.position != null && r.position > lo && r.position <= hi).length }));
}

export function brandSplit(rows: OwnQueryRow[]) {
  const out = { branded: { clicks: 0, impressions: 0, queries: 0 }, nonBranded: { clicks: 0, impressions: 0, queries: 0 } };
  for (const r of rows) {
    if (r.position == null) continue;
    const b = r.branded ? out.branded : out.nonBranded;
    b.clicks += r.clicks;
    b.impressions += r.impressions;
    b.queries++;
  }
  return out;
}

export type OwnPageRow = { url: string; clicks: number; impressions: number; ctr: number; position: number; previousClicks: number | null; clicksChange: number | null; queries: number; topQuery: string | null };
export function buildPages(current: ApiGscRow[], previous: ApiGscRow[] | null, pageQuery: ApiGscRow[]): OwnPageRow[] {
  const per = new Map<string, { count: number; top: string; clicks: number; impressions: number }>();
  for (const r of pageQuery) {
    const [page, q] = r.keys ?? [];
    if (!page || !q) continue;
    const cur = per.get(page) ?? { count: 0, top: q, clicks: -1, impressions: -1 };
    cur.count++;
    const c = n0(r.clicks);
    const i = n0(r.impressions);
    if (c > cur.clicks || (c === cur.clicks && i > cur.impressions)) Object.assign(cur, { top: q, clicks: c, impressions: i });
    per.set(page, cur);
  }
  const prev = new Map((previous ?? []).map((r) => [r.keys?.[0] ?? "", n0(r.clicks)]));
  return current
    .filter((r) => r.keys?.[0])
    .map((r) => {
      const url = r.keys![0];
      const clicks = n0(r.clicks);
      const previousClicks = previous ? (prev.get(url) ?? 0) : null;
      return {
        url,
        clicks,
        impressions: n0(r.impressions),
        ctr: n0(r.ctr),
        position: r1(n0(r.position)),
        previousClicks,
        clicksChange: previousClicks == null ? null : clicks - previousClicks,
        queries: per.get(url)?.count ?? 0,
        topQuery: per.get(url)?.top ?? null,
      };
    })
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);
}

// ------------------------------------------------------------------------------------------ countries

const A3: Record<string, string> = {
  usa: "US", gbr: "GB", ind: "IN", can: "CA", aus: "AU", deu: "DE", fra: "FR", esp: "ES", ita: "IT", nld: "NL", bel: "BE", che: "CH",
  aut: "AT", swe: "SE", nor: "NO", dnk: "DK", fin: "FI", irl: "IE", prt: "PT", pol: "PL", cze: "CZ", hun: "HU", rou: "RO", grc: "GR",
  tur: "TR", rus: "RU", ukr: "UA", isr: "IL", are: "AE", sau: "SA", qat: "QA", kwt: "KW", omn: "OM", bhr: "BH", egy: "EG", zaf: "ZA",
  nga: "NG", ken: "KE", gha: "GH", mar: "MA", pak: "PK", bgd: "BD", lka: "LK", npl: "NP", chn: "CN", hkg: "HK", twn: "TW", jpn: "JP",
  kor: "KR", sgp: "SG", mys: "MY", idn: "ID", tha: "TH", vnm: "VN", phl: "PH", nzl: "NZ", bra: "BR", mex: "MX", arg: "AR", col: "CO",
  chl: "CL", per: "PE", ven: "VE", ecu: "EC", ury: "UY", svk: "SK", svn: "SI", hrv: "HR", srb: "RS", bgr: "BG", ltu: "LT", lva: "LV",
  est: "EE", isl: "IS", lux: "LU", cyp: "CY", mlt: "MT", irn: "IR", irq: "IQ", jor: "JO", lbn: "LB", afg: "AF", uzb: "UZ", kaz: "KZ",
  tza: "TZ", uga: "UG", eth: "ET", zmb: "ZM", zwe: "ZW", mus: "MU", mdv: "MV", btn: "BT", mmr: "MM", khm: "KH",
};
let regionNames: Intl.DisplayNames | null = null;
/** Search Console country codes are ISO 3166-1 alpha-3 ("usa"); GA4 returns names ("United States"). */
export function countryInfo(code: string) {
  const a2 = A3[code.toLowerCase()] ?? (code.length === 2 ? code.toUpperCase() : null);
  let name = code.toUpperCase();
  if (a2) {
    try {
      regionNames ??= new Intl.DisplayNames(["en"], { type: "region" });
      name = regionNames.of(a2) ?? name;
    } catch {
      /* keep the code */
    }
  }
  const flag = a2 ? String.fromCodePoint(...[...a2].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : "🌐";
  return { code: a2 ?? code.toUpperCase(), name, flag };
}

export type OwnDimRow = { key: string; label: string; flag?: string; clicks: number; impressions: number; ctr: number; position: number; share: number };
export function gscDimension(rows: ApiGscRow[], kind: "country" | "device"): OwnDimRow[] {
  const total = rows.reduce((s, r) => s + n0(r.clicks), 0) || 0;
  return rows
    .filter((r) => r.keys?.[0])
    .map((r) => {
      const key = r.keys![0];
      const c = kind === "country" ? countryInfo(key) : null;
      const label = c ? c.name : key[0].toUpperCase() + key.slice(1).toLowerCase();
      const clicks = n0(r.clicks);
      return { key, label, flag: c?.flag, clicks, impressions: n0(r.impressions), ctr: n0(r.ctr), position: r1(n0(r.position)), share: total ? r1((clicks / total) * 100) : 0 };
    })
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);
}

// ------------------------------------------------------------------------------------------ GA4

export type ApiGa4Row = { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] };
export const GA4_METRICS = ["sessions", "totalUsers", "newUsers", "engagementRate", "averageSessionDuration", "screenPageViews", "keyEvents", "engagedSessions"] as const;
export type TrafficTotals = {
  sessions: number;
  users: number;
  newUsers: number;
  engagementRate: number;
  avgDuration: number;
  pageViews: number;
  pagesPerSession: number | null;
  keyEvents: number;
  engagedSessions: number;
};
/** Metric values in GA4_METRICS order. */
export function ga4Totals(m: { value?: string }[] | undefined): TrafficTotals {
  const v = (i: number) => Number(m?.[i]?.value ?? 0) || 0;
  const sessions = v(0);
  return {
    sessions,
    users: v(1),
    newUsers: v(2),
    engagementRate: v(3),
    avgDuration: v(4),
    pageViews: v(5),
    pagesPerSession: sessions ? Math.round((v(5) / sessions) * 100) / 100 : null,
    keyEvents: v(6),
    engagedSessions: v(7),
  };
}
const gaDate = (v: string) => (v.length === 8 ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6)}` : v);

export type TrafficDaily = { date: string; sessions: number; users: number };
/** Rows with dimension `date` and metrics [sessions, totalUsers]. */
export function ga4Daily(rows: ApiGa4Row[]): TrafficDaily[] {
  return rows
    .map((r) => ({ date: gaDate(r.dimensionValues?.[0]?.value ?? ""), sessions: Number(r.metricValues?.[0]?.value ?? 0) || 0, users: Number(r.metricValues?.[1]?.value ?? 0) || 0 }))
    .filter((r) => r.date)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export type TrafficDimRow = { key: string; label: string; flag?: string; share: number } & TrafficTotals;
/** Rows with one dimension and GA4_METRICS; share = % of sessions in these rows. */
export function ga4Dimension(rows: ApiGa4Row[], kind: "channel" | "country" | "device" | "landing" | "newReturning"): TrafficDimRow[] {
  const mapped = rows.map((r) => {
    const raw = r.dimensionValues?.[0]?.value ?? "";
    const t = ga4Totals(r.metricValues);
    let label = raw || "(not set)";
    let flag: string | undefined;
    if (kind === "device" || kind === "newReturning") label = raw ? raw[0].toUpperCase() + raw.slice(1) : "(not set)";
    if (kind === "landing") label = raw || "/";
    if (kind === "country") {
      const c = countryIdFromName(raw);
      flag = c ? countryInfo(c).flag : "🌐";
    }
    return { key: raw || "(not set)", label, flag, ...t, share: 0 };
  });
  const total = mapped.reduce((s, r) => s + r.sessions, 0);
  for (const r of mapped) r.share = total ? r1((r.sessions / total) * 100) : 0;
  return mapped.sort((a, b) => b.sessions - a.sessions);
}

let nameToA2: Map<string, string> | null = null;
function countryIdFromName(name: string) {
  if (!nameToA2) {
    nameToA2 = new Map();
    for (const a2 of Object.values(A3)) nameToA2.set(countryInfo(a2).name.toLowerCase(), a2);
  }
  return nameToA2.get(name.toLowerCase()) ?? null;
}

/** GA4 default channel group → share of sessions, ordered by sessions. */
export function channelShare(rows: TrafficDimRow[], channel: string) {
  return rows.find((r) => r.key.toLowerCase() === channel.toLowerCase())?.share ?? 0;
}

/** Clicks and impressions per host name (subdomain), from the page rows. */
export function subdomainsFromPages(pages: OwnPageRow[]) {
  const map = new Map<string, { subdomain: string; clicks: number; impressions: number; pages: number }>();
  for (const p of pages) {
    let host: string;
    try {
      host = new URL(p.url).hostname;
    } catch {
      continue;
    }
    const cur = map.get(host) ?? { subdomain: host, clicks: 0, impressions: 0, pages: 0 };
    cur.clicks += p.clicks;
    cur.impressions += p.impressions;
    cur.pages++;
    map.set(host, cur);
  }
  const total = [...map.values()].reduce((s, x) => s + x.clicks, 0);
  return [...map.values()].map((x) => ({ ...x, share: total ? r1((x.clicks / total) * 100) : 0 })).sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);
}
