import { latestJob } from "@/lib/jobs/queue";
import type { SummaryProvider } from "@/lib/projects/summary-types";
import { CRAWL_KIND } from "./config";
import { listCrawls } from "./data";

/** Project dashboard widget: Site Health with delta, errors/warnings, pages crawled, health sparkline. */
export const summaries: SummaryProvider[] = [
  async (project) => {
    const href = `/site-audit?project=${project.id}`;
    const [crawls, job] = await Promise.all([listCrawls(project.id, 12), latestJob(project.id, CRAWL_KIND)]);
    const done = crawls.filter((c) => c.status === "done" || c.status === "stopped");
    const running = job && (job.status === "queued" || job.status === "running");
    const last = done[0];
    if (!last) {
      if (running)
        return { tool: "site-audit", label: "Site Audit", href, state: "running", note: job.message ?? "Crawl queued…", stats: [{ label: "Progress", value: job.total ? `${job.progress} / ${job.total}` : "Starting" }] };
      const failed = crawls[0]?.status === "failed" ? crawls[0] : null;
      return failed
        ? { tool: "site-audit", label: "Site Audit", href, state: "error", note: failed.error ?? "The last crawl failed.", cta: "Retry" }
        : { tool: "site-audit", label: "Site Audit", href, state: "empty", cta: "Set up", note: "Crawl the site to find technical SEO issues." };
    }
    const prev = done[1];
    return {
      tool: "site-audit",
      label: "Site Audit",
      href,
      state: running ? "running" : "ready",
      headline: { label: "Site Health", value: `${last.health ?? 0}%`, delta: prev?.health != null && last.health != null ? last.health - prev.health : null, upIsGood: true },
      stats: [
        { label: "Errors", value: `${last.errors.toLocaleString()}${prev ? ` (${last.errors - prev.errors >= 0 ? "+" : ""}${last.errors - prev.errors})` : ""}` },
        { label: "Warnings", value: last.warnings.toLocaleString() },
        { label: "Pages crawled", value: last.pages_crawled.toLocaleString() },
      ],
      spark: done
        .slice()
        .reverse()
        .map((c) => c.health ?? 0),
      updatedAt: last.finished_at ?? last.started_at,
      note: running ? (job.message ?? "Re-crawling…") : last.status === "stopped" ? "Last crawl was stopped early" : undefined,
    };
  },
];
