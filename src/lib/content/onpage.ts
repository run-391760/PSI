import { randomUUID } from "node:crypto";
import { crawlPage, parseLinks } from "@/lib/crawler";
import { query, transaction } from "@/lib/db";
import { AppError, database, matchesDomain, normalizeKeyword, safeUrl } from "@/lib/domain";
import type { JobRow } from "@/lib/jobs/types";
import type { Project } from "@/lib/projects";
import { brandPhrase, domainKeywords, domainPages, keywordMetrics } from "@/lib/seo/engine";
import type { PageFacts } from "./extract";
import type { Idea, IdeaType, KeywordUse, StoredBenchmark } from "./ideas";
import { STOPWORDS, normalizeText, wordList } from "./text";

export const MAX_TARGETS = 50;
export const ONPAGE_JOB = "content.onpage";

export type Target = { id: string; project_id: string; url: string; keyword: string; origin: string; created_at: string };
export type Run = { id: string; project_id: string; job_id: string | null; status: "running" | "done" | "failed" | "cancelled"; db: string; pages: number; ideas: number; summary: RunSummary; created_at: string; finished_at: string | null };
export type RunSummary = { byType?: Partial<Record<IdeaType, number>>; bySource?: { live: number; demo: number }; high?: number; fetched?: number; failed?: number };
export type ResultRow = {
  run_id: string;
  target_id: string;
  url: string;
  keyword: string;
  fetch_status: number | null;
  fetch_error: string | null;
  page: (PageFacts & { kw: KeywordUse }) | null;
  benchmark: StoredBenchmark;
  ideas: Idea[];
  ideas_count: number;
  priority: number;
};
export type Suggestion = { url: string; keyword: string; volume: number; position: number | null; traffic: number | null; origin: "ranking" | "live"; note?: string };

// ------------------------------------------------------------------------------------------------ targets

export async function listTargets(projectId: string) {
  return query<Target>("SELECT * FROM content_onpage_targets WHERE project_id=$1 ORDER BY created_at, url", [projectId]);
}

export function cleanTargetUrl(input: string, domain: string) {
  const raw = input.trim();
  if (!raw) throw new AppError("Enter a URL.");
  let url: string;
  try {
    url = safeUrl(new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/+/, "")}`).toString());
  } catch (e) {
    throw e instanceof AppError ? e : new AppError(`“${raw}” is not a valid URL.`);
  }
  if (!matchesDomain(url, domain)) throw new AppError(`${raw} is not on ${domain}.`);
  return url;
}

export async function addTargets(project: Project, pairs: { url: string; keyword: string; origin?: string }[]) {
  const existing = await listTargets(project.id);
  const seen = new Set(existing.map((t) => `${t.url}|${t.keyword}`));
  const skipped: { input: string; reason: string }[] = [];
  const rows: { url: string; keyword: string; origin: string }[] = [];
  for (const p of pairs) {
    const label = `${p.url} — ${p.keyword}`;
    try {
      const url = cleanTargetUrl(p.url, project.domain);
      const keyword = normalizeKeyword(p.keyword);
      if (!keyword) throw new AppError("Keyword is empty.");
      if (keyword.length > 120) throw new AppError("Keyword is too long.");
      const key = `${url}|${keyword}`;
      if (seen.has(key)) throw new AppError("Already added.");
      seen.add(key);
      rows.push({ url, keyword, origin: p.origin ?? "manual" });
    } catch (e) {
      skipped.push({ input: label, reason: e instanceof AppError ? e.message : "Invalid." });
    }
  }
  const room = MAX_TARGETS - existing.length;
  if (rows.length > room) {
    for (const r of rows.slice(Math.max(0, room))) skipped.push({ input: `${r.url} — ${r.keyword}`, reason: `Limit of ${MAX_TARGETS} pages per project.` });
    rows.length = Math.max(0, room);
  }
  await transaction(async (q) => {
    for (const r of rows)
      await q("INSERT INTO content_onpage_targets(id,project_id,url,keyword,origin) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING", [randomUUID(), project.id, r.url, r.keyword, r.origin]);
  });
  return { added: rows.length, skipped };
}

export async function removeTargets(projectId: string, ids: string[]) {
  await query("DELETE FROM content_onpage_targets WHERE project_id=$1 AND id = ANY($2::text[])", [projectId, ids]);
}

// ------------------------------------------------------------------------------------------------ suggestions

/** Pages + keywords from the (demo) organic ranking index. */
export function rankingSuggestions(domain: string, db: string, limit = 20): Suggestion[] {
  const kws = domainKeywords(domain, db);
  const out: Suggestion[] = [];
  for (const p of domainPages(domain, db)) {
    const best = kws.filter((k) => k.url === p.url && !k.keyword.includes(".")).sort((a, b) => b.traffic - a.traffic)[0];
    if (!best) continue;
    out.push({ url: p.url, keyword: best.keyword, volume: best.metrics.volume, position: best.position, traffic: p.traffic, origin: "ranking" });
    if (out.length >= limit) break;
  }
  return out;
}

const SKIP_PATH = /\/(wp-admin|wp-login|login|logout|signin|sign-in|register|cart|checkout|account|my-account|search|feed|tag|author|page\/\d+|cdn-cgi)(\/|$)|\.(pdf|jpe?g|png|gif|webp|svg|zip|docx?|xlsx?|pptx?|mp4|mp3|xml|txt|css|js)$/i;

/** Discover real pages from the live homepage and pair each with the best-matching keyword. */
export async function liveSuggestions(domain: string, db: string, limit = 30): Promise<{ fetchedUrl: string; suggestions: Suggestion[] }> {
  let res: Awaited<ReturnType<typeof crawlPage>>;
  try {
    res = await crawlPage(`https://${domain}/`);
  } catch (e) {
    throw new AppError(`Couldn't fetch https://${domain}/: ${e instanceof Error ? e.message : "request failed"}`);
  }
  if (res.status >= 400) throw new AppError(`The homepage returned HTTP ${res.status}.`);
  const links = parseLinks(res.body, res.url, domain);
  const anchors = new Map<string, string>();
  for (const l of links) {
    let u: URL;
    try {
      u = new URL(l.target);
    } catch {
      continue;
    }
    u.hash = "";
    if (u.search) continue;
    if (SKIP_PATH.test(u.pathname)) continue;
    const key = u.toString();
    const anchor = l.anchor.replace(/\s+/g, " ").trim();
    if (!anchors.has(key) || (anchor.length > (anchors.get(key) ?? "").length && anchor.length < 80)) anchors.set(key, anchor);
  }
  const kws = domainKeywords(domain, db).filter((k) => !k.keyword.includes("."));
  const brand = brandPhrase(domain);
  const home = res.url.replace(/\/?$/, "/");
  const out: Suggestion[] = [];
  const homeKw = brand.includes(" ") ? brand : (kws.find((k) => k.branded && k.keyword.includes(" "))?.keyword ?? brand);
  out.push(suggest(home, homeKw, db, kws, "Homepage"));
  for (const [url, anchor] of anchors) {
    if (url.replace(/\/?$/, "/") === home) continue;
    const path = decodeURIComponent(new URL(url).pathname);
    const pathTokens = wordList(path.replace(/[-_/.]+/g, " ").toLowerCase()).filter((t) => !STOPWORDS.has(t) && !/^\d+$/.test(t) && !["html", "htm", "php", "aspx"].includes(t));
    const anchorTokens = wordList(normalizeText(anchor)).filter((t) => !STOPWORDS.has(t));
    const tokens = new Set([...pathTokens, ...anchorTokens]);
    if (!tokens.size) continue;
    let best: { keyword: string; score: number } | null = null;
    for (const k of kws) {
      const kt = wordList(k.keyword).filter((t) => !STOPWORDS.has(t));
      const overlap = kt.filter((t) => tokens.has(t) || tokens.has(t.replace(/s$/, "")) || tokens.has(`${t}s`)).length;
      if (!overlap) continue;
      const score = (overlap / kt.length) * 10 + overlap * 2 + Math.log10(k.metrics.volume + 1);
      if (!best || score > best.score) best = { keyword: k.keyword, score };
    }
    const fallback = anchorTokens.length >= 1 && anchorTokens.length <= 6 ? anchorTokens.join(" ") : pathTokens.slice(-4).join(" ");
    const keyword = best && best.score >= 7 ? best.keyword : fallback;
    if (!keyword) continue;
    out.push(suggest(url, keyword, db, kws, best && best.score >= 7 ? "Matched to a ranking keyword" : "From link text / URL"));
    if (out.length >= limit) break;
  }
  return { fetchedUrl: res.url, suggestions: out };
}
function suggest(url: string, keyword: string, db: string, kws: ReturnType<typeof domainKeywords>, note: string): Suggestion {
  const k = normalizeKeyword(keyword);
  const ranked = kws.find((x) => x.keyword === k);
  return { url, keyword: k, volume: keywordMetrics(k, db).volume, position: ranked?.position ?? null, traffic: ranked?.traffic ?? null, origin: "live", note };
}

// ------------------------------------------------------------------------------------------------ runs

export async function activeJob(projectId: string) {
  const [job] = await query<JobRow>("SELECT * FROM jobs WHERE project_id=$1 AND kind=$2 AND status IN ('queued','running') ORDER BY created_at DESC LIMIT 1", [projectId, ONPAGE_JOB]);
  return job ?? null;
}

export async function startRun(ownerId: string, project: Project) {
  const running = await activeJob(project.id);
  if (running) return running;
  const targets = await listTargets(project.id);
  if (!targets.length) throw new AppError("Add at least one page and keyword first.");
  const runId = randomUUID();
  const db = database(project.country).code;
  await query("INSERT INTO content_onpage_runs(id,project_id,db,pages) VALUES($1,$2,$3,$4)", [runId, project.id, db, targets.length]);
  // Imported lazily: the job registry imports this module (via jobs.ts), so a static import would be circular.
  const { enqueue } = await import("@/lib/jobs/queue");
  const job = await enqueue({ kind: ONPAGE_JOB, ownerId, projectId: project.id, payload: { runId }, dedupeKey: `${ONPAGE_JOB}:${runId}` });
  await query("UPDATE content_onpage_runs SET job_id=$2 WHERE id=$1", [runId, job.id]);
  return job;
}

const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);
const normRun = (r: Run): Run => ({ ...r, created_at: iso(r.created_at)!, finished_at: iso(r.finished_at) });

export async function latestRun(projectId: string) {
  const [run] = await query<Run>("SELECT * FROM content_onpage_runs WHERE project_id=$1 AND status='done' ORDER BY created_at DESC LIMIT 1", [projectId]);
  return run ? normRun(run) : null;
}
export async function recentRuns(projectId: string, limit = 8) {
  return (await query<Run>("SELECT * FROM content_onpage_runs WHERE project_id=$1 AND status='done' ORDER BY created_at DESC LIMIT $2", [projectId, limit])).map(normRun);
}
export async function runResults(runId: string) {
  return query<ResultRow>("SELECT run_id,target_id,url,keyword,fetch_status,fetch_error,page,benchmark,ideas,ideas_count,priority FROM content_onpage_results WHERE run_id=$1 ORDER BY priority DESC, url", [runId]);
}
export async function resultFor(runId: string, targetId: string) {
  const [row] = await query<ResultRow>("SELECT run_id,target_id,url,keyword,fetch_status,fetch_error,page,benchmark,ideas,ideas_count,priority FROM content_onpage_results WHERE run_id=$1 AND target_id=$2", [runId, targetId]);
  return row ?? null;
}
export async function doneIdeas(projectId: string) {
  const rows = await query<{ target_id: string; idea_id: string }>("SELECT target_id, idea_id FROM content_onpage_done WHERE project_id=$1", [projectId]);
  const map = new Map<string, Set<string>>();
  for (const r of rows) map.set(r.target_id, (map.get(r.target_id) ?? new Set()).add(r.idea_id));
  return map;
}
export async function setIdeaDone(projectId: string, targetId: string, ideaId: string, done: boolean) {
  if (done) await query("INSERT INTO content_onpage_done(project_id,target_id,idea_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [projectId, targetId, ideaId]);
  else await query("DELETE FROM content_onpage_done WHERE project_id=$1 AND target_id=$2 AND idea_id=$3", [projectId, targetId, ideaId]);
}

/** Keep the most recent runs per project. */
export async function pruneRuns(projectId: string, keep = 6) {
  await query(
    `DELETE FROM content_onpage_runs WHERE project_id=$1 AND id NOT IN (SELECT id FROM content_onpage_runs WHERE project_id=$1 ORDER BY created_at DESC LIMIT $2)`,
    [projectId, keep],
  );
}

/** Latest finished run per project of a user (for the project picker). */
export async function latestRunsByProject(ownerId: string) {
  const rows = await query<{ project_id: string; ideas: number; pages: number; finished_at: string }>(
    `SELECT DISTINCT ON (r.project_id) r.project_id, r.ideas, r.pages, r.finished_at FROM content_onpage_runs r
     JOIN projects p ON p.id=r.project_id WHERE p.owner_id=$1 AND r.status='done' ORDER BY r.project_id, r.created_at DESC`,
    [ownerId],
  );
  return new Map(rows.map((r) => [r.project_id, { ...r, finished_at: iso(r.finished_at)! }]));
}

/** Open (not done) ideas of a result. */
export function openIdeas(row: Pick<ResultRow, "ideas" | "target_id">, done: Map<string, Set<string>>) {
  const d = done.get(row.target_id);
  return d ? row.ideas.filter((i) => !d.has(i.id)) : row.ideas;
}
