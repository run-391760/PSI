import { query } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { CHECK_MAP } from "./checks";
import type { AuditConfig, CrawlStats, CrawlStatus, CwvSummary, LiveProgress, PageData, SiteFacts } from "./types";

export type CrawlRow = {
  id: string;
  project_id: string;
  job_id: string | null;
  status: CrawlStatus;
  config: AuditConfig;
  start_url: string;
  pages_crawled: number;
  health: number | null;
  errors: number;
  warnings: number;
  notices: number;
  stats: CrawlStats;
  site: SiteFacts;
  cwv: CwvSummary | null;
  live: Partial<LiveProgress>;
  error: string | null;
  details_pruned: boolean;
  started_at: string;
  finished_at: string | null;
};
export type CrawlBrief = Pick<CrawlRow, "id" | "status" | "pages_crawled" | "health" | "errors" | "warnings" | "notices" | "error" | "details_pruned" | "started_at" | "finished_at" | "start_url"> & {
  byCheck: Record<string, number>;
  themes: CrawlStats["themes"] | null;
  durationMs: number | null;
};

const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : (d as string));
const fixDates = <T extends { started_at: unknown; finished_at: unknown }>(r: T) => ({ ...r, started_at: iso(r.started_at), finished_at: r.finished_at ? iso(r.finished_at) : null });

export async function getCrawl(projectId: string, crawlId: string) {
  const [row] = await query<CrawlRow>("SELECT * FROM audit_crawls WHERE id=$1 AND project_id=$2", [crawlId, projectId]);
  return row ? (fixDates(row) as CrawlRow) : null;
}
/** Latest finished (done or stopped) crawl, optionally before a given crawl. */
export async function latestCompleted(projectId: string) {
  const [row] = await query<CrawlRow>("SELECT * FROM audit_crawls WHERE project_id=$1 AND status IN ('done','stopped') ORDER BY started_at DESC LIMIT 1", [projectId]);
  return row ? (fixDates(row) as CrawlRow) : null;
}
export async function latestAny(projectId: string) {
  const [row] = await query<CrawlRow>("SELECT * FROM audit_crawls WHERE project_id=$1 ORDER BY started_at DESC LIMIT 1", [projectId]);
  return row ? (fixDates(row) as CrawlRow) : null;
}
/** Crawl history (newest first), light columns only. */
export async function listCrawls(projectId: string, limit = 30): Promise<CrawlBrief[]> {
  const rows = await query<CrawlBrief & { stats: CrawlStats | null }>(
    `SELECT id,status,pages_crawled,health,errors,warnings,notices,error,details_pruned,started_at,finished_at,start_url,
            COALESCE(stats->'byCheck','{}'::jsonb) AS "byCheck", stats->'themes' AS themes, (stats->>'durationMs')::int AS "durationMs"
     FROM audit_crawls WHERE project_id=$1 ORDER BY started_at DESC LIMIT $2`,
    [projectId, limit],
  );
  return rows.map((r) => fixDates(r) as CrawlBrief);
}
/** Health of each project's latest finished crawl (for the project gate). */
export async function latestByProject(ownerId: string) {
  const rows = await query<{ project_id: string; health: number | null; started_at: string; status: string; errors: number }>(
    `SELECT DISTINCT ON (c.project_id) c.project_id, c.health, c.started_at, c.status, c.errors FROM audit_crawls c JOIN projects p ON p.id=c.project_id
     WHERE p.owner_id=$1 AND c.status IN ('done','stopped') ORDER BY c.project_id, c.started_at DESC`,
    [ownerId],
  );
  return new Map(rows.map((r) => [r.project_id, { ...r, started_at: iso(r.started_at) }]));
}

export type IssueSample = { check_id: string; url: string; detail: string; page_id: number | null };
export async function issueSamples(crawlId: string, perCheck = 3) {
  return query<IssueSample>(
    `SELECT check_id,url,detail,page_id FROM (
       SELECT *, row_number() OVER (PARTITION BY check_id ORDER BY page_id NULLS FIRST, url) AS rn FROM audit_issues WHERE crawl_id=$1
     ) t WHERE rn <= $2`,
    [crawlId, perCheck],
  );
}

export type IssueRow = { page_id: number | null; url: string; detail: string; status: number | null; depth: number | null; inlinks: number | null; title: string | null };
export async function issueRows(crawlId: string, checkId: string) {
  return query<IssueRow>(
    `SELECT i.page_id, i.url, i.detail, p.status, p.depth, p.inlinks, p.title FROM audit_issues i
     LEFT JOIN audit_pages p ON p.crawl_id=i.crawl_id AND p.id=i.page_id
     WHERE i.crawl_id=$1 AND i.check_id=$2 ORDER BY i.page_id NULLS FIRST, i.url LIMIT 20000`,
    [crawlId, checkId],
  );
}

export type PageRow = {
  id: number;
  url: string;
  final_url: string | null;
  status: number | null;
  depth: number | null;
  content_type: string | null;
  response_ms: number | null;
  size_bytes: number | null;
  title: string | null;
  indexable: boolean;
  in_sitemap: boolean;
  inlinks: number;
  errors: number;
  warnings: number;
  notices: number;
  words: number | null;
  blocked: string | null;
  source: string | null;
  error: string | null;
};
export async function pageTable(crawlId: string) {
  return query<PageRow>(
    `SELECT id,url,final_url,status,depth,content_type,response_ms,size_bytes,title,indexable,in_sitemap,inlinks,errors,warnings,notices,
            (data->'html'->>'wordCount')::int AS words, data->>'blocked' AS blocked, data->>'source' AS source, data->>'error' AS error
     FROM audit_pages WHERE crawl_id=$1 ORDER BY id`,
    [crawlId],
  );
}

export type StatRow = {
  id: number;
  url: string;
  status: number | null;
  depth: number | null;
  content_type: string | null;
  response_ms: number | null;
  size_bytes: number | null;
  indexable: boolean;
  in_sitemap: boolean;
  inlinks: number;
  errors: number;
  warnings: number;
  ttfb: number | null;
  enc: string | null;
  words: number | null;
  ratio: number | null;
  int_links: number | null;
  ext_links: number | null;
  images: number | null;
  missing_alt: number | null;
  ld_types: string[] | null;
  ld_count: number | null;
  ld_errors: number | null;
  microdata: number | null;
  has_og: boolean | null;
  has_tw: boolean | null;
  hreflang: number | null;
  lang: string | null;
  noindex: boolean | null;
  blocked: string | null;
  canonical: string | null;
  hsts: string | null;
  https: boolean;
  scripts: number | null;
  styles: number | null;
  title: string | null;
  xcto: string | null;
  csp: string | null;
  xfo: string | null;
  refpol: string | null;
  viewport: string | null;
  doctype: boolean | null;
  charset: string | null;
};
export async function statRows(crawlId: string) {
  return query<StatRow>(
    `SELECT id,url,status,depth,content_type,response_ms,size_bytes,indexable,in_sitemap,inlinks,errors,warnings,title,
            (data->>'ttfbMs')::int AS ttfb, data->'headers'->>'encoding' AS enc,
            (data->'html'->>'wordCount')::int AS words, (data->'html'->>'textRatio')::float AS ratio,
            (data->'html'->>'internalLinks')::int AS int_links, (data->'html'->>'externalLinks')::int AS ext_links,
            (data->'html'->>'images')::int AS images, (data->'html'->>'imagesMissingAlt')::int AS missing_alt,
            data->'html'->'jsonLd'->'types' AS ld_types, (data->'html'->'jsonLd'->>'count')::int AS ld_count,
            jsonb_array_length(COALESCE(data->'html'->'jsonLd'->'errors','[]'::jsonb)) AS ld_errors,
            jsonb_array_length(COALESCE(data->'html'->'microdata','[]'::jsonb)) AS microdata,
            (data->'html'->'og' ? 'title') AS has_og, (data->'html'->'twitter' ? 'card') AS has_tw,
            jsonb_array_length(COALESCE(data->'html'->'hreflang','[]'::jsonb)) AS hreflang, data->'html'->>'lang' AS lang,
            (data->'html'->>'noindex')::boolean AS noindex, data->>'blocked' AS blocked, data->'html'->>'canonical' AS canonical,
            data->'headers'->>'hsts' AS hsts, url LIKE 'https:%' AS https,
            (data->'html'->>'scripts')::int AS scripts, (data->'html'->>'stylesheets')::int AS styles,
            data->'headers'->>'xcto' AS xcto, data->'headers'->>'csp' AS csp, data->'headers'->>'xfo' AS xfo, data->'headers'->>'referrer' AS refpol,
            data->'html'->>'viewport' AS viewport, (data->'html'->>'doctype')::boolean AS doctype, data->'html'->>'charset' AS charset
     FROM audit_pages WHERE crawl_id=$1 ORDER BY id`,
    [crawlId],
  );
}

export async function hreflangRows(crawlId: string) {
  return query<{ id: number; url: string; lang: string | null; hreflang: { lang: string; href: string | null; raw: string }[] }>(
    `SELECT id, url, data->'html'->>'lang' AS lang, data->'html'->'hreflang' AS hreflang FROM audit_pages
     WHERE crawl_id=$1 AND jsonb_array_length(COALESCE(data->'html'->'hreflang','[]'::jsonb)) > 0 ORDER BY depth NULLS LAST, id LIMIT 100`,
    [crawlId],
  );
}

export type PageDetail = PageRow & { data: PageData };
export async function pageDetail(crawlId: string, pageId: number) {
  const [row] = await query<PageDetail>(
    `SELECT id,url,final_url,status,depth,content_type,response_ms,size_bytes,title,indexable,in_sitemap,inlinks,errors,warnings,notices,data,
            (data->'html'->>'wordCount')::int AS words, data->>'blocked' AS blocked, data->>'source' AS source, data->>'error' AS error
     FROM audit_pages WHERE crawl_id=$1 AND id=$2`,
    [crawlId, pageId],
  );
  if (!row) return null;
  const [issues, outlinks, inlinks] = await Promise.all([
    query<{ check_id: string; detail: string }>("SELECT check_id, detail FROM audit_issues WHERE crawl_id=$1 AND page_id=$2", [crawlId, pageId]),
    query<{ target: string; target_id: number | null; anchor: string; internal: boolean; nofollow: boolean; rel: string; status: number | null }>(
      "SELECT target,target_id,anchor,internal,nofollow,rel,status FROM audit_links WHERE crawl_id=$1 AND source_id=$2 ORDER BY internal DESC, target LIMIT 500",
      [crawlId, pageId],
    ),
    query<{ id: number; url: string; anchor: string; nofollow: boolean; rel: string }>(
      `SELECT p.id, p.url, l.anchor, l.nofollow, l.rel FROM audit_links l JOIN audit_pages p ON p.crawl_id=l.crawl_id AND p.id=l.source_id
       WHERE l.crawl_id=$1 AND l.target_id=$2 ORDER BY p.depth NULLS LAST, p.id LIMIT 200`,
      [crawlId, pageId],
    ),
  ]);
  issues.sort((a, b) => sevRank(a.check_id) - sevRank(b.check_id));
  return { page: row, issues, outlinks, inlinks };
}
const sevRank = (id: string) => ({ error: 0, warning: 1, notice: 2 })[CHECK_MAP[id]?.severity ?? "notice"];

export async function allIssues(crawlId: string) {
  return query<{ check_id: string; url: string; detail: string; page_id: number | null }>(
    "SELECT check_id,url,detail,page_id FROM audit_issues WHERE crawl_id=$1 ORDER BY check_id, page_id NULLS FIRST, url",
    [crawlId],
  );
}
export async function allLinks(crawlId: string) {
  return query<{ source: string; target: string; anchor: string; internal: boolean; nofollow: boolean; rel: string; status: number | null }>(
    `SELECT p.url AS source, l.target, l.anchor, l.internal, l.nofollow, l.rel, l.status FROM audit_links l
     JOIN audit_pages p ON p.crawl_id=l.crawl_id AND p.id=l.source_id WHERE l.crawl_id=$1 ORDER BY p.id, l.target`,
    [crawlId],
  );
}
export async function pageExport(crawlId: string) {
  return query<Record<string, unknown>>(
    `SELECT url, status, final_url, depth, content_type, response_ms, size_bytes, title, indexable, in_sitemap, inlinks, errors, warnings, notices,
            (data->'html'->>'wordCount')::int AS words, data->'html'->>'description' AS description, data->'html'->'h1'->>0 AS h1,
            data->'html'->>'canonical' AS canonical, data->'html'->>'metaRobots' AS meta_robots, data->'html'->>'lang' AS lang
     FROM audit_pages WHERE crawl_id=$1 ORDER BY id`,
    [crawlId],
  );
}

/** Verifies the crawl belongs to one of the user's projects. */
export async function ownedCrawl(ownerId: string, crawlId: string) {
  const [row] = await query<{ id: string; project_id: string; domain: string; started_at: string }>(
    "SELECT c.id, c.project_id, p.domain, c.started_at FROM audit_crawls c JOIN projects p ON p.id=c.project_id WHERE c.id=$1 AND p.owner_id=$2",
    [crawlId, ownerId],
  );
  if (!row) throw new AppError("Crawl not found.", 404);
  return { ...row, started_at: iso(row.started_at) };
}

const LINK_SCOPED = new Set(Object.values(CHECK_MAP).filter((c) => c.scope === "link").map((c) => c.id));
/** New and fixed issues between two crawls (b = newer). */
export async function diffCrawls(olderId: string, newerId: string) {
  const [a, b, newerPages] = await Promise.all([allIssues(olderId), allIssues(newerId), query<{ url: string }>("SELECT url FROM audit_pages WHERE crawl_id=$1 AND status > 0", [newerId])]);
  // An issue only counts as fixed if its page was crawled again (a smaller page limit is not a fix).
  const recrawled = new Set(newerPages.map((p) => p.url));
  const key = (i: { check_id: string; url: string; detail: string }) => (LINK_SCOPED.has(i.check_id) ? `${i.check_id}|${i.url}|${i.detail}` : `${i.check_id}|${i.url}`);
  const ka = new Set(a.map(key));
  const kb = new Set(b.map(key));
  const out = new Map<string, { added: { url: string; detail: string }[]; fixed: { url: string; detail: string }[] }>();
  const get = (id: string) => out.get(id) ?? out.set(id, { added: [], fixed: [] }).get(id)!;
  const seenB = new Set<string>();
  for (const i of b) {
    const k = key(i);
    if (seenB.has(k)) continue;
    seenB.add(k);
    if (!ka.has(k)) get(i.check_id).added.push({ url: i.url, detail: i.detail });
  }
  const seenA = new Set<string>();
  for (const i of a) {
    const k = key(i);
    if (seenA.has(k)) continue;
    seenA.add(k);
    if (!kb.has(k) && (i.page_id == null || recrawled.has(i.url))) get(i.check_id).fixed.push({ url: i.url, detail: i.detail });
  }
  return out;
}
