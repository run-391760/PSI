import { randomUUID } from "node:crypto";
import { query } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { notify } from "@/lib/jobs/queue";
import type { JobHandler } from "@/lib/jobs/types";
import { getProject } from "@/lib/projects";
import { analyze, type Issue } from "./analyze";
import { getConfig } from "./config";
import { crawlSite, type CrawlOutput } from "./crawl";
import { measureCwv } from "./cwv";
import { scoreCrawl } from "./score";
import type { CwvSummary, LiveProgress } from "./types";

const KEEP_DETAILED = 6;
const KEEP_SUMMARY = 60;

async function insertJson(sql: string, rows: unknown[], chunk: number, extra: unknown[]) {
  for (let i = 0; i < rows.length; i += chunk) await query(sql, [...extra, JSON.stringify(rows.slice(i, i + chunk))]);
}

async function storeIssues(crawlId: string, issues: Issue[]) {
  await insertJson(
    `INSERT INTO audit_issues(crawl_id,check_id,page_id,url,detail)
     SELECT $1, x.check_id, x.page_id, x.url, x.detail FROM jsonb_to_recordset($2::jsonb) AS x(check_id text, page_id int, url text, detail text)`,
    issues.map((i) => ({ check_id: i.check, page_id: i.pageId, url: i.url, detail: i.detail })),
    3000,
    [crawlId],
  );
}

/** Persist a finished crawl: pages, links, issues, totals and scores. */
async function storeCrawl(crawlId: string, out: CrawlOutput, cwv: CwvSummary | null) {
  const result = analyze(out, cwv);
  const scored = scoreCrawl(
    out.pages.map((p) => ({ id: p.id, status: p.status, noindex: !!p.data.html?.noindex })),
    result.issues,
    cwv,
    out.durationMs,
  );
  scored.stats.htmlPages = out.pages.filter((p) => p.data.html).length;
  const pageRows = out.pages.map((p) => {
    const c = scored.perPageCounts.get(p.id);
    return {
      id: p.id,
      url: p.url,
      final_url: p.finalUrl,
      status: p.status,
      depth: p.depth,
      content_type: p.contentType,
      response_ms: p.responseMs,
      size_bytes: p.sizeBytes,
      title: p.data.html?.title?.slice(0, 500) ?? null,
      indexable: result.indexable(p),
      in_sitemap: p.inSitemap,
      inlinks: result.inlinkCount(p.id),
      errors: c?.errors ?? 0,
      warnings: c?.warnings ?? 0,
      notices: c?.notices ?? 0,
      data: p.data,
    };
  });
  await insertJson(
    `INSERT INTO audit_pages(crawl_id,id,url,final_url,status,depth,content_type,response_ms,size_bytes,title,indexable,in_sitemap,inlinks,errors,warnings,notices,data)
     SELECT $1, x.id, x.url, x.final_url, x.status, x.depth, x.content_type, x.response_ms, x.size_bytes, x.title, x.indexable, x.in_sitemap, x.inlinks, x.errors, x.warnings, x.notices, x.data
     FROM jsonb_to_recordset($2::jsonb) AS x(id int, url text, final_url text, status int, depth int, content_type text, response_ms int, size_bytes int, title text, indexable boolean, in_sitemap boolean, inlinks int, errors int, warnings int, notices int, data jsonb)`,
    pageRows,
    150,
    [crawlId],
  );
  const idByUrl = new Map(out.pages.map((p) => [p.url, p.id]));
  const linkRows = out.links
    .filter((l) => l.kind === "a")
    .map((l) => {
      const ex = l.internal ? null : out.external.get(l.target);
      return {
        source_id: l.sourceId,
        target: l.target.slice(0, 2000),
        target_id: l.internal ? (idByUrl.get(l.target) ?? null) : null,
        anchor: l.anchor,
        internal: l.internal,
        nofollow: l.nofollow,
        rel: l.rel ?? "",
        status: l.internal ? result.statusOf(l.target).status : ex ? (ex.status ?? 0) : null,
      };
    });
  await insertJson(
    `INSERT INTO audit_links(crawl_id,source_id,target,target_id,anchor,internal,nofollow,rel,status)
     SELECT $1, x.source_id, x.target, x.target_id, x.anchor, x.internal, x.nofollow, COALESCE(x.rel, ''), x.status
     FROM jsonb_to_recordset($2::jsonb) AS x(source_id int, target text, target_id int, anchor text, internal boolean, nofollow boolean, rel text, status int)`,
    linkRows,
    3000,
    [crawlId],
  );
  await storeIssues(crawlId, result.issues);
  return scored;
}

/** URLs to measure with PageSpeed: the homepage plus the 5 best-linked indexable pages. */
function cwvTargets(out: CrawlOutput) {
  const home = out.site.homepage.finalUrl ?? out.site.homepage.url;
  const inl = new Map<string, number>();
  for (const l of out.links) if (l.kind === "a" && l.internal) inl.set(l.target, (inl.get(l.target) ?? 0) + 1);
  const top = out.pages
    .filter((p) => p.status === 200 && p.data.html && !p.data.html.noindex && p.url !== home)
    .sort((a, b) => (inl.get(b.url) ?? 0) - (inl.get(a.url) ?? 0))
    .slice(0, 5)
    .map((p) => p.url);
  return [home, ...top];
}

async function pruneOld(projectId: string) {
  const old = await query<{ id: string }>(
    `SELECT id FROM audit_crawls WHERE project_id=$1 AND status IN ('done','stopped') AND NOT details_pruned ORDER BY started_at DESC OFFSET ${KEEP_DETAILED}`,
    [projectId],
  );
  for (const { id } of old) {
    await query("DELETE FROM audit_links WHERE crawl_id=$1", [id]);
    await query("DELETE FROM audit_pages WHERE crawl_id=$1", [id]);
    await query("DELETE FROM audit_issues WHERE crawl_id=$1", [id]);
    await query("UPDATE audit_crawls SET details_pruned=true WHERE id=$1", [id]);
  }
  await query(`DELETE FROM audit_crawls WHERE id IN (SELECT id FROM audit_crawls WHERE project_id=$1 ORDER BY started_at DESC OFFSET ${KEEP_SUMMARY})`, [projectId]);
}

const crawlHandler: JobHandler = async (job, ctx) => {
  if (!job.owner_id || !job.project_id) throw new AppError("Site Audit jobs need a project.");
  const project = await getProject(job.owner_id, job.project_id);
  const config = getConfig(project);
  // A retried job (worker restarted mid-crawl) starts over with a fresh crawl row.
  await query("DELETE FROM audit_crawls WHERE job_id=$1", [job.id]);
  await query("UPDATE audit_crawls SET status='failed', error='Interrupted', finished_at=now() WHERE project_id=$1 AND status='running'", [project.id]);
  const crawlId = randomUUID();
  await query("INSERT INTO audit_crawls(id,project_id,job_id,status,config,start_url) VALUES($1,$2,$3,'running',$4::jsonb,$5)", [crawlId, project.id, job.id, JSON.stringify(config), config.startUrl]);
  const link = `/site-audit?project=${project.id}`;
  const onProgress = async (live: LiveProgress) => {
    const total = Math.max(1, Math.min(live.limit, Math.max(live.discovered, live.crawled)));
    const message = live.phase === "Crawling" ? `Crawled ${live.crawled} of ${total} pages` : live.phase;
    await ctx.progress(live.crawled, total, message);
    await query("UPDATE audit_crawls SET live=$2::jsonb, pages_crawled=$3 WHERE id=$1", [crawlId, JSON.stringify(live), live.crawled]);
  };
  try {
    const out = await crawlSite({ domain: project.domain, config, onProgress, isCancelled: ctx.cancelled });
    let cwv: CwvSummary | null = null;
    if (!out.stopped && out.pages.some((p) => p.status === 200 && p.data.html)) {
      const targets = cwvTargets(out);
      const live = { phase: "Measuring Core Web Vitals", crawled: out.pages.filter((p) => p.status != null).length, discovered: out.pages.length, queued: 0, limit: config.limit, broken: 0, redirects: 0, recent: [], startedAt: new Date().toISOString() };
      await onProgress(live);
      cwv = await measureCwv(targets, config.device === "mobile" ? "mobile" : "desktop", async (d, t) => onProgress({ ...live, phase: `Measuring Core Web Vitals (${d}/${t})` }));
    }
    await ctx.progress(out.pages.length, out.pages.length, "Analyzing pages");
    const scored = await storeCrawl(crawlId, out, cwv);
    const status = out.stopped ? "stopped" : "done";
    await query(
      `UPDATE audit_crawls SET status=$2, pages_crawled=$3, health=$4, errors=$5, warnings=$6, notices=$7, stats=$8::jsonb, site=$9::jsonb, cwv=$10::jsonb, finished_at=now(), live='{}'::jsonb WHERE id=$1`,
      [crawlId, status, out.pages.filter((p) => p.status != null).length, scored.health, scored.errors, scored.warnings, scored.notices, JSON.stringify(scored.stats), JSON.stringify(out.site), cwv ? JSON.stringify(cwv) : null],
    );
    const [prev] = await query<{ health: number | null; errors: number }>(
      "SELECT health, errors FROM audit_crawls WHERE project_id=$1 AND status IN ('done','stopped') AND id<>$2 ORDER BY started_at DESC LIMIT 1",
      [project.id, crawlId],
    );
    const delta = prev?.health != null ? scored.health - prev.health : null;
    const worse = prev != null && scored.errors > prev.errors;
    await notify({
      ownerId: job.owner_id,
      projectId: project.id,
      tool: "site-audit",
      severity: worse ? "critical" : "success",
      title: worse ? `Site Audit: errors increased on ${project.domain}` : `Site Audit finished for ${project.domain}`,
      body: `Site Health ${scored.health}%${delta != null ? ` (${delta >= 0 ? "+" : ""}${delta})` : ""} · ${scored.errors} errors${worse ? ` (was ${prev.errors})` : ""} · ${scored.warnings} warnings · ${out.pages.length} pages crawled${out.stopped ? " (stopped early)" : ""}.`,
      link,
    });
    await pruneOld(project.id);
    return { crawlId, health: scored.health, errors: scored.errors, warnings: scored.warnings, notices: scored.notices, pages: out.pages.length, stopped: out.stopped };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await query("UPDATE audit_crawls SET status='failed', error=$2, finished_at=now(), live='{}'::jsonb WHERE id=$1", [crawlId, message.slice(0, 1000)]);
    await notify({ ownerId: job.owner_id, projectId: project.id, tool: "site-audit", severity: "warning", title: `Site Audit failed for ${project.domain}`, body: message.slice(0, 300), link });
    throw e;
  }
};

/** Re-measure Core Web Vitals for an existing crawl and refresh its CWV issues and scores. */
const cwvHandler: JobHandler = async (job, ctx) => {
  if (!job.owner_id || !job.project_id) throw new AppError("Site Audit jobs need a project.");
  const project = await getProject(job.owner_id, job.project_id);
  const crawlId = String(job.payload.crawlId ?? "");
  const [crawl] = await query<{ id: string; site: { homepage?: { finalUrl?: string; url?: string } }; config: { device?: string }; stats: { durationMs?: number } }>(
    "SELECT id, site, config, stats FROM audit_crawls WHERE id=$1 AND project_id=$2 AND status IN ('done','stopped') AND NOT details_pruned",
    [crawlId, project.id],
  );
  if (!crawl) throw new AppError("Crawl not found.", 404);
  const home = crawl.site.homepage?.finalUrl ?? crawl.site.homepage?.url;
  const top = await query<{ url: string }>("SELECT url FROM audit_pages WHERE crawl_id=$1 AND status=200 AND indexable AND url<>$2 ORDER BY inlinks DESC, id LIMIT 5", [crawlId, home ?? ""]);
  await ctx.progress(0, 6, "Measuring Core Web Vitals");
  const cwv = await measureCwv([home, ...top.map((t) => t.url)].filter((u): u is string => !!u), crawl.config.device === "mobile" ? "mobile" : "desktop", (d, t) => ctx.progress(d, t, `Measuring Core Web Vitals (${d}/${t})`));
  // Replace CWV issues, then rescore from stored rows.
  const cwvChecks = ["cwv-lcp", "cwv-cls", "cwv-inp", "cwv-tbt", "psi-low-score"];
  await query("DELETE FROM audit_issues WHERE crawl_id=$1 AND check_id = ANY($2::text[])", [crawlId, cwvChecks]);
  const pages = await query<{ id: number; url: string; status: number | null; noindex: boolean | null }>(
    "SELECT id, url, status, (data->'html'->>'noindex')::boolean AS noindex FROM audit_pages WHERE crawl_id=$1",
    [crawlId],
  );
  const idByUrl = new Map(pages.map((p) => [p.url, p.id]));
  const fresh: Issue[] = [];
  for (const r of cwv.pages) {
    if (!r.ok) continue;
    const pageId = idByUrl.get(r.url) ?? null;
    const lcp = r.field?.lcp.value ?? r.lab.lcp.value;
    const cls = r.field?.cls.value ?? r.lab.cls.value;
    if (lcp != null && lcp > 2500) fresh.push({ check: "cwv-lcp", pageId, url: r.url, detail: `LCP ${(lcp / 1000).toFixed(1)} s (${r.field?.lcp.value != null ? "field" : "lab"})` });
    if (cls != null && cls > 0.1) fresh.push({ check: "cwv-cls", pageId, url: r.url, detail: `CLS ${cls.toFixed(2)} (${r.field?.cls.value != null ? "field" : "lab"})` });
    if (r.field?.inp.value != null && r.field.inp.value > 200) fresh.push({ check: "cwv-inp", pageId, url: r.url, detail: `INP ${Math.round(r.field.inp.value)} ms (field)` });
    if (r.lab.tbt.value != null && r.lab.tbt.value > 200) fresh.push({ check: "cwv-tbt", pageId, url: r.url, detail: `TBT ${Math.round(r.lab.tbt.value)} ms (lab)` });
    if (r.score != null && r.score < 50) fresh.push({ check: "psi-low-score", pageId, url: r.url, detail: `Performance score ${r.score}/100 (${r.strategy})` });
  }
  await storeIssues(crawlId, fresh);
  const issues = await query<{ check_id: string; page_id: number | null }>("SELECT check_id, page_id FROM audit_issues WHERE crawl_id=$1", [crawlId]);
  const scored = scoreCrawl(
    pages.map((p) => ({ id: p.id, status: p.status, noindex: !!p.noindex })),
    issues.map((i) => ({ check: i.check_id, pageId: i.page_id })),
    cwv,
    crawl.stats.durationMs ?? 0,
  );
  scored.stats.htmlPages = (crawl.stats as { htmlPages?: number }).htmlPages ?? 0;
  for (const p of pages) {
    const c = scored.perPageCounts.get(p.id);
    await query("UPDATE audit_pages SET errors=$3, warnings=$4, notices=$5 WHERE crawl_id=$1 AND id=$2", [crawlId, p.id, c?.errors ?? 0, c?.warnings ?? 0, c?.notices ?? 0]);
  }
  await query("UPDATE audit_crawls SET health=$2, errors=$3, warnings=$4, notices=$5, stats=$6::jsonb, cwv=$7::jsonb WHERE id=$1", [
    crawlId,
    scored.health,
    scored.errors,
    scored.warnings,
    scored.notices,
    JSON.stringify(scored.stats),
    JSON.stringify(cwv),
  ]);
  return { crawlId, status: cwv.status, measured: cwv.pages.filter((p) => p.ok).length };
};

/** Background job handlers owned by the site-audit module, keyed by job kind (prefix kinds with "site-audit."). */
// String-literal keys (not imported constants) so this module is safe inside the queue → registry import cycle.
export const jobs: Record<string, JobHandler> = {
  "site-audit.crawl": crawlHandler,
  "site-audit.cwv": cwvHandler,
};
