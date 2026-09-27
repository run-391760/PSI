import { cached } from "@/lib/providers/source";
import { googleConfigured } from "@/lib/google/oauth";
import { dateRange, getProjectGoogle, gscQuery, type GscRow } from "@/lib/google/data";
import { availableDays, batchFilter, GSC_ROW_LIMIT, gscCountry, keywordBatches, mapGscSnapshots, suggestionsFromQueries, type GscApiRow, type GscSnapshot } from "./gsc-map";
import type { Device } from "./types";

/** Search Console site linked to the project, when Google access is configured on the server. */
export async function linkedGscSite(projectId: string) {
  if (!googleConfigured()) return null;
  return (await getProjectGoogle(projectId)).gscSite;
}

/** Latest day to ask Search Console for (fresh data reaches ~1 day back; missing days are trimmed via availableDays). */
export function gscEndDay() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - 1)).toISOString().slice(0, 10);
}

/** Paginates a Search Analytics query (25k rows per page) up to `maxRows`. */
async function allRows(userId: string, site: string, body: Record<string, unknown>, maxRows = 200000): Promise<GscApiRow[]> {
  const out: GscRow[] = [];
  for (let startRow = 0; startRow < maxRows; startRow += GSC_ROW_LIMIT) {
    const rows = await gscQuery(userId, site, { ...body, rowLimit: GSC_ROW_LIMIT, startRow });
    out.push(...rows);
    if (rows.length < GSC_ROW_LIMIT) break;
  }
  return out;
}

/**
 * Daily Search Console snapshots for tracked keywords over [from, to]: one query per keyword batch for
 * position/clicks/impressions (date × query × device) and one for ranking pages (date × query × device × page).
 */
export async function fetchGscSnapshots(opts: {
  userId: string;
  site: string;
  domain: string;
  db: string;
  keywords: { id: string; keyword: string }[];
  devices: Device[];
  from: string;
  to: string;
  onBatch?: (done: number, total: number) => Promise<void>;
  cancelled?: () => Promise<boolean>;
}): Promise<{ days: string[]; snapshots: GscSnapshot[] }> {
  const { userId, site } = opts;
  const country = gscCountry(opts.db);
  const base = { startDate: opts.from, endDate: opts.to };
  const siteDays = await gscQuery(userId, site, { ...base, dimensions: ["date"], rowLimit: 1000 });
  const days = availableDays(siteDays, opts.from, opts.to);
  if (!days.length) return { days, snapshots: [] };
  const batches = keywordBatches(opts.keywords.map((k) => k.keyword));
  const snapshots: GscSnapshot[] = [];
  const byNorm = new Map(opts.keywords.map((k) => [k.keyword.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase(), k]));
  let done = 0;
  for (const batch of batches) {
    if (opts.cancelled && (await opts.cancelled())) break;
    const filter = { dimensionFilterGroups: batchFilter(batch, country) };
    const queryRows = await allRows(userId, site, { ...base, dimensions: ["date", "query", "device"], ...filter });
    const pageRows = await allRows(userId, site, { ...base, dimensions: ["date", "query", "device", "page"], ...filter });
    const keywords = batch.map((b) => byNorm.get(b)).filter((k): k is { id: string; keyword: string } => Boolean(k));
    snapshots.push(...mapGscSnapshots({ domain: opts.domain, keywords, devices: opts.devices, days, queryRows, pageRows }));
    done += batch.length;
    if (opts.onBatch) await opts.onBatch(done, opts.keywords.length);
  }
  return { days, snapshots };
}

/** Real keyword suggestions: the site's top Search Console queries over the last 28 days (cached 6 h). */
export async function gscSuggestions(userId: string, site: string, db: string | null) {
  const range = dateRange(28);
  const country = db ? gscCountry(db) : null;
  const key = `pt:gsc-suggest:v1:${userId}:${site}:${country ?? "all"}:${range.start}:${range.end}`;
  const res = await cached(key, "search-console", 6, async () => {
    const rows = await gscQuery(userId, site, {
      startDate: range.start,
      endDate: range.end,
      dimensions: ["query"],
      rowLimit: 500,
      ...(country ? { dimensionFilterGroups: [{ groupType: "and", filters: [{ dimension: "country", operator: "equals", expression: country }] }] } : {}),
    });
    return suggestionsFromQueries(rows, 150);
  });
  return res.data;
}
