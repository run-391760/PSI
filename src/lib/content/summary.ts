import { query } from "@/lib/db";
import type { SummaryProvider } from "@/lib/projects/summary-types";
import { displayUrl } from "@/lib/format";
import { priorityScore } from "./ideas";
import { ONPAGE_JOB, doneIdeas, listTargets, openIdeas, recentRuns, runResults } from "./onpage";

/** Project dashboard widget: On Page SEO Checker. */
const onPageChecker: SummaryProvider = async (project) => {
  const href = `/on-page-checker?project=${project.id}`;
  const base = { tool: "on-page-checker", label: "On Page SEO Checker", href };
  const [runs, targets, [active]] = await Promise.all([
    recentRuns(project.id, 8),
    listTargets(project.id),
    query<{ id: string }>("SELECT id FROM jobs WHERE project_id=$1 AND kind=$2 AND status IN ('queued','running') LIMIT 1", [project.id, ONPAGE_JOB]),
  ]);
  const run = runs[0];
  if (!run) {
    if (active) return { ...base, state: "running", note: "Collecting ideas…" };
    return { ...base, state: "empty", cta: targets.length ? "Collect ideas" : "Set up", note: targets.length ? `${targets.length} pages ready to check` : "Get optimization ideas for your pages from top-10 rivals." };
  }
  const [results, done] = await Promise.all([runResults(run.id), doneIdeas(project.id)]);
  const rows = results.map((r) => {
    const open = openIdeas(r, done);
    return { url: r.url, open, priority: priorityScore(r.benchmark.metrics.volume, r.benchmark.position, open, r.benchmark.metrics.serpFeatures) };
  });
  const openCount = rows.reduce((s, r) => s + r.open.length, 0);
  const optimized = rows.filter((r) => !r.open.some((i) => i.priority === "high")).length;
  const top = [...rows].sort((a, b) => b.priority - a.priority)[0];
  const prev = runs[1];
  return {
    ...base,
    state: active ? "running" : "ready",
    headline: { label: "Open ideas", value: openCount.toLocaleString("en-US"), delta: prev?.ideas ? Math.round(((run.ideas - prev.ideas) / prev.ideas) * 1000) / 10 : null, upIsGood: false },
    stats: [
      { label: "Optimized", value: `${optimized} / ${rows.length}` },
      { label: "High priority", value: String(rows.reduce((s, r) => s + r.open.filter((i) => i.priority === "high").length, 0)) },
      { label: "Top page", value: top ? displayUrl(top.url).replace(/^www\./, "").replace(/^[^/]+/, "") || "/" : "n/a" },
    ],
    spark: runs.length > 1 ? [...runs].reverse().map((r) => r.ideas) : undefined,
    updatedAt: run.finished_at ?? run.created_at,
    note: active ? "Collecting fresh ideas…" : undefined,
  };
};

/** Project dashboard widgets for the content module. */
export const summaries: SummaryProvider[] = [onPageChecker];
