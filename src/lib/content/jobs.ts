import { randomUUID } from "node:crypto";
import { crawlPage } from "@/lib/crawler";
import { database } from "@/lib/domain";
import { query } from "@/lib/db";
import { notify } from "@/lib/jobs/queue";
import type { JobHandler } from "@/lib/jobs/types";
import type { Project } from "@/lib/projects";
import { benchmark, ownPageRefDomains, ownPosition } from "./benchmark";
import { extractPage } from "./extract";
import { generateIdeas, keywordUse, priorityScore, type IdeaType, type StoredBenchmark } from "./ideas";
import { listTargets, pruneRuns, type RunSummary } from "./onpage";

/** Fetch every target page for real, benchmark it against the (demo) top 10 and store ideas. */
const onpage: JobHandler = async (job, ctx) => {
  const [project] = await query<Project>("SELECT * FROM projects WHERE id=$1", [job.project_id]);
  if (!project) throw new Error("Project no longer exists.");
  let runId = String(job.payload.runId ?? "");
  if (!runId) {
    // Scheduled (weekly) re-check: create the run here.
    const count = (await listTargets(project.id)).length;
    if (!count) return { skipped: "No pages to check." };
    runId = randomUUID();
    await query("INSERT INTO content_onpage_runs(id,project_id,job_id,db,pages) VALUES($1,$2,$3,$4,$5)", [runId, project.id, job.id, database(project.country).code, count]);
  }
  const [run] = await query<{ db: string }>("SELECT db FROM content_onpage_runs WHERE id=$1", [runId]);
  if (!run) throw new Error("Run no longer exists.");
  const db = run.db;
  try {
    const targets = await listTargets(project.id);
    const summary: RunSummary = { byType: {}, bySource: { live: 0, demo: 0 }, high: 0, fetched: 0, failed: 0 };
    let totalIdeas = 0;
    await ctx.progress(0, targets.length, "Starting");
    for (const [i, t] of targets.entries()) {
      if (await ctx.cancelled()) {
        await query("UPDATE content_onpage_runs SET status='cancelled', finished_at=now() WHERE id=$1", [runId]);
        return { cancelled: true, checked: i };
      }
      await ctx.progress(i, targets.length, `Fetching ${t.url}`);
      let status: number | null = null;
      let error: string | null = null;
      let extracted: ReturnType<typeof extractPage> | null = null;
      try {
        const res = await crawlPage(t.url);
        status = res.status;
        const type = String(res.headers["content-type"] ?? "text/html");
        if (res.status >= 400) error = `HTTP ${res.status}`;
        else if (!/html|xml|text\/plain/i.test(type)) error = `Not an HTML page (${type.split(";")[0]}).`;
        else extracted = extractPage(res.body, res.url, res.status, res.headers, project.domain);
      } catch (e) {
        error = e instanceof Error ? e.message : "Request failed.";
      }
      const bench = benchmark(t.keyword, db, project.domain);
      const own = ownPosition(t.keyword, db, project.domain);
      const stored: StoredBenchmark = {
        metrics: bench.metrics,
        position: own?.position ?? null,
        rankingUrl: own?.url ?? null,
        ownRefDomains: ownPageRefDomains(t.url, project.domain, db),
        avg: bench.avg,
        rivals: bench.rivals.map(({ position, domain, url, title, words, mentions, readability, refDomains }) => ({ position, domain, url, title, words, mentions, readability, refDomains })),
        semantic: bench.semantic,
        related: bench.related.slice(0, 8),
        questions: bench.questions.slice(0, 6),
        backlinkSources: bench.backlinkSources.slice(0, 12),
      };
      const use = extracted ? keywordUse(extracted.facts, extracted.text, extracted.alts, t.url, t.keyword, bench.semantic) : null;
      const ideas = generateIdeas({ url: t.url, keyword: t.keyword, domain: project.domain, facts: extracted?.facts ?? null, use, fetchError: error, fetchStatus: status, bench: stored });
      const priority = priorityScore(bench.metrics.volume, stored.position, ideas, bench.metrics.serpFeatures);
      for (const idea of ideas) {
        summary.byType![idea.type as IdeaType] = (summary.byType![idea.type as IdeaType] ?? 0) + 1;
        summary.bySource![idea.source]++;
        if (idea.priority === "high") summary.high!++;
      }
      if (extracted) summary.fetched!++;
      else summary.failed!++;
      totalIdeas += ideas.length;
      await query(
        `INSERT INTO content_onpage_results(run_id,target_id,project_id,url,keyword,fetch_status,fetch_error,page,benchmark,ideas,ideas_count,priority)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12)
         ON CONFLICT(run_id,target_id) DO UPDATE SET page=excluded.page, benchmark=excluded.benchmark, ideas=excluded.ideas, ideas_count=excluded.ideas_count, priority=excluded.priority`,
        [runId, t.id, project.id, t.url, t.keyword, status, error, extracted ? JSON.stringify({ ...extracted.facts, kw: use }) : null, JSON.stringify(stored), JSON.stringify(ideas), ideas.length, priority],
      );
    }
    await query("UPDATE content_onpage_runs SET status='done', finished_at=now(), pages=$2, ideas=$3, summary=$4::jsonb WHERE id=$1", [runId, targets.length, totalIdeas, JSON.stringify(summary)]);
    await ctx.progress(targets.length, targets.length, "Done");
    await pruneRuns(project.id);
    if (!job.payload.scheduled)
      await notify({
        ownerId: project.owner_id,
        projectId: project.id,
        tool: "on-page-checker",
        severity: summary.failed ? "warning" : "success",
        title: `On Page SEO Checker: ${totalIdeas} ideas for ${targets.length} page${targets.length === 1 ? "" : "s"}`,
        body: `${summary.high} high-priority ideas.${summary.failed ? ` ${summary.failed} page(s) could not be fetched.` : ""}`,
        link: `/on-page-checker?project=${project.id}`,
      });
    return { runId, pages: targets.length, ideas: totalIdeas };
  } catch (e) {
    await query("UPDATE content_onpage_runs SET status='failed', finished_at=now() WHERE id=$1", [runId]);
    throw e;
  }
};

/** Background job handlers owned by the content module, keyed by job kind (prefix kinds with "content."). */
export const jobs: Record<string, JobHandler> = { "content.onpage": onpage };
