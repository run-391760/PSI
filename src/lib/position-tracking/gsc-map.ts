/**
 * Pure Search Console → Position Tracking mapping (no I/O, unit-tested in tests/position-tracking-real.test.ts).
 *
 * Search Console reports the *average* position of the user's own site for a query, per day and device, only
 * for days with at least one impression. A tracked keyword without a row for a day that Search Console has
 * data for is "not ranking / no data" (null), never position 100.
 */
import type { Device } from "./types";

export type GscApiRow = { keys?: string[]; clicks: number; impressions: number; ctr: number; position: number };

/** Search Console country filter values (ISO 3166-1 alpha-3, lowercase) for the regional databases. */
export const GSC_COUNTRY: Record<string, string> = {
  US: "usa",
  GB: "gbr",
  IN: "ind",
  CA: "can",
  AU: "aus",
  DE: "deu",
  FR: "fra",
  ES: "esp",
  IT: "ita",
  BR: "bra",
  MX: "mex",
  JP: "jpn",
  NL: "nld",
  AE: "are",
  SG: "sgp",
  ZA: "zaf",
  IE: "irl",
  NZ: "nzl",
  PH: "phl",
  SE: "swe",
};
export const gscCountry = (db: string) => GSC_COUNTRY[db.toUpperCase()] ?? null;

/** Search Analytics API: max rows per request. */
export const GSC_ROW_LIMIT = 25000;
/** How many days of history a new Search Console campaign backfills (GSC keeps 16 months). */
export const GSC_BACKFILL_DAYS = 90;
/** Search Console revises recent days; every daily run re-fetches this many days before the last stored one. */
export const GSC_REFETCH_DAYS = 3;
/** A page counts as a ranking URL for a keyword/day when it has at least this share of the top page's impressions. */
export const GSC_PAGE_MIN_SHARE = 0.1;

export const normQuery = (s: string) => s.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();

/** Escapes RE2 metacharacters. */
export const escapeRe2 = (s: string) => s.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");

/** Anchored, case-insensitive RE2 alternation matching exactly these queries. */
export function queryRegex(keywords: string[]) {
  return `(?i)^(?:${keywords.map(escapeRe2).join("|")})$`;
}

/**
 * Splits keywords into request batches: each batch's regex stays under `maxLen` characters (Search Console
 * rejects very long expressions) and holds at most `maxCount` keywords (keeps each response well below the row limit).
 */
export function keywordBatches(keywords: string[], maxLen = 3000, maxCount = 60): string[][] {
  const out: string[][] = [];
  let cur: string[] = [];
  let len = 0;
  for (const k of [...new Set(keywords.map(normQuery))].filter(Boolean)) {
    const add = escapeRe2(k).length + 1;
    if (cur.length && (len + add > maxLen || cur.length >= maxCount)) {
      out.push(cur);
      cur = [];
      len = 0;
    }
    cur.push(k);
    len += add;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** dimensionFilterGroups for a batch: exact query match (equals / anchored regex) AND the campaign's country. */
export function batchFilter(batch: string[], country: string | null) {
  const filters: { dimension: string; operator: string; expression: string }[] = [
    batch.length === 1 ? { dimension: "query", operator: "equals", expression: batch[0] } : { dimension: "query", operator: "includingRegex", expression: queryRegex(batch) },
  ];
  if (country) filters.push({ dimension: "country", operator: "equals", expression: country });
  return [{ groupType: "and", filters }];
}

export function gscDevice(v: string | undefined): Device | null {
  const d = (v ?? "").toLowerCase();
  return d === "desktop" ? "desktop" : d === "mobile" ? "mobile" : null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** One stored Search Console snapshot: the same shape as a SERP snapshot plus real clicks/impressions. */
export type GscSnapshot = {
  keyword_id: string;
  device: Device;
  day: string;
  positions: Record<string, number | null>;
  urls: Record<string, string | null>;
  own_urls: { url: string; position: number; clicks: number; impressions: number }[];
  features: [];
  owned: [];
  fs_owner: null;
  clicks: number;
  impressions: number;
};

type Acc = { clicks: number; impressions: number; posWeighted: number };
const accAdd = (a: Acc | undefined, r: GscApiRow): Acc => {
  const imp = Math.max(0, r.impressions || 0);
  const x = a ?? { clicks: 0, impressions: 0, posWeighted: 0 };
  x.clicks += r.clicks || 0;
  x.impressions += imp;
  x.posWeighted += (r.position || 0) * Math.max(imp, 1e-9);
  return x;
};
const accPos = (a: Acc) => (a.impressions > 0 ? round1(a.posWeighted / a.impressions) : null);

/**
 * Maps Search Analytics rows to one snapshot per keyword × device × day.
 * - `queryRows`: dimensions [date, query, device] → position, clicks, impressions of the site for the query.
 * - `pageRows`: dimensions [date, query, device, page] → ranking pages (top page = most clicks, then impressions).
 * - `days`: days Search Console has data for (site level). Only these days get snapshots, so days not yet
 *   processed by Google are left out instead of being stored as "not ranking".
 * Query variants that normalize to the same keyword are merged (impression-weighted average position).
 */
export function mapGscSnapshots(input: {
  domain: string;
  keywords: { id: string; keyword: string }[];
  devices: Device[];
  days: string[];
  queryRows: GscApiRow[];
  pageRows: GscApiRow[];
}): GscSnapshot[] {
  const { domain, devices } = input;
  const byKeyword = new Map(input.keywords.map((k) => [normQuery(k.keyword), k.id]));
  const wanted = new Set(devices);
  const daySet = new Set(input.days);
  const key = (id: string, device: Device, day: string) => `${id}\u0000${device}\u0000${day}`;

  const q = new Map<string, Acc>();
  for (const r of input.queryRows) {
    const [day, query, dev] = r.keys ?? [];
    const id = byKeyword.get(normQuery(query ?? ""));
    const device = gscDevice(dev);
    if (!id || !device || !wanted.has(device) || !daySet.has(day)) continue;
    const k = key(id, device, day);
    q.set(k, accAdd(q.get(k), r));
  }
  const pages = new Map<string, Map<string, Acc>>();
  for (const r of input.pageRows) {
    const [day, query, dev, page] = r.keys ?? [];
    const id = byKeyword.get(normQuery(query ?? ""));
    const device = gscDevice(dev);
    if (!id || !device || !wanted.has(device) || !daySet.has(day) || !page) continue;
    const k = key(id, device, day);
    const m = pages.get(k) ?? new Map<string, Acc>();
    m.set(page, accAdd(m.get(page), r));
    pages.set(k, m);
  }

  const out: GscSnapshot[] = [];
  const days = [...daySet].sort();
  for (const kw of input.keywords)
    for (const device of devices)
      for (const day of days) {
        const k = key(kw.id, device, day);
        const pm = pages.get(k);
        let own_urls = pm
          ? [...pm.entries()]
              .filter(([, a]) => a.impressions > 0)
              .map(([url, a]) => ({ url, position: accPos(a)!, clicks: Math.round(a.clicks), impressions: Math.round(a.impressions) }))
              .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions || a.position - b.position)
          : [];
        const topImp = own_urls[0]?.impressions ?? 0;
        own_urls = own_urls.filter((u, i) => i === 0 || u.clicks > 0 || u.impressions >= Math.max(1, topImp * GSC_PAGE_MIN_SHARE));
        // Query-level numbers are authoritative (Search Console aggregates by site for query rows); page rows are the fallback.
        let acc: Acc | undefined = q.get(k);
        if (!acc && pm) {
          const sum: Acc = { clicks: 0, impressions: 0, posWeighted: 0 };
          for (const a of pm.values()) {
            sum.clicks += a.clicks;
            sum.impressions += a.impressions;
            sum.posWeighted += a.posWeighted;
          }
          acc = sum;
        }
        const position = acc ? accPos(acc) : null;
        out.push({
          keyword_id: kw.id,
          device,
          day,
          positions: { [domain]: position },
          urls: { [domain]: position == null ? null : (own_urls[0]?.url ?? null) },
          own_urls: position == null ? [] : own_urls,
          features: [],
          owned: [],
          fs_owner: null,
          clicks: Math.round(acc?.clicks ?? 0),
          impressions: Math.round(acc?.impressions ?? 0),
        });
      }
  return out;
}

/** Days that have site-level Search Console data (rows of a dimensions [date] query), ascending. */
export function availableDays(rows: GscApiRow[], from: string, to: string) {
  return [...new Set(rows.map((r) => r.keys?.[0] ?? "").filter((d) => d >= from && d <= to))].sort();
}

/** Top queries of the site → keyword suggestions for setup (real Search Console data). */
export function suggestionsFromQueries(rows: GscApiRow[], limit = 150) {
  const merged = new Map<string, Acc>();
  for (const r of rows) {
    const k = normQuery(r.keys?.[0] ?? "");
    if (!k || k.length > 255 || /\b(site|inurl|intitle|allintitle|filetype):/.test(k)) continue;
    merged.set(k, accAdd(merged.get(k), r));
  }
  return [...merged.entries()]
    .map(([keyword, a]) => ({ keyword, position: accPos(a), clicks: Math.round(a.clicks), impressions: Math.round(a.impressions), volume: null, kd: null }))
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
    .slice(0, limit);
}

/** Day window a Search Console check fetches. */
export function gscWindow(opts: { end: string; lastDay: string | null; firstDay: string | null; backfill?: number; history?: boolean }) {
  const add = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
  const earliest = add(opts.end, -(GSC_BACKFILL_DAYS - 1));
  const max = (a: string, b: string) => (a > b ? a : b);
  if (opts.backfill) return { from: max(add(opts.end, -(Math.min(GSC_BACKFILL_DAYS, opts.backfill) - 1)), earliest), to: opts.end };
  if (opts.history || !opts.lastDay) return { from: opts.firstDay && opts.lastDay ? max(opts.firstDay, earliest) : earliest, to: opts.end };
  return { from: max(add(opts.lastDay, -(GSC_REFETCH_DAYS - 1)), earliest), to: opts.end };
}
