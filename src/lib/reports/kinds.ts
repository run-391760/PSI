/** Client-safe labels for background job kinds ("<module>.<action>") and job statuses. */

export const JOB_MODULES: Record<string, { label: string; href: string }> = {
  "site-audit": { label: "Site Audit", href: "/site-audit" },
  "position-tracking": { label: "Position Tracking", href: "/position-tracking" },
  backlinks: { label: "Backlinks", href: "/backlink-analytics" },
  keywords: { label: "Keyword research", href: "/keyword-magic-tool" },
  competitive: { label: "Competitive research", href: "/domain-overview" },
  content: { label: "Content", href: "/on-page-checker" },
  local: { label: "Local SEO", href: "/local/listings" },
  monitoring: { label: "Monitoring", href: "/brand-monitoring" },
  "ai-visibility": { label: "AI Visibility", href: "/ai-visibility" },
  reports: { label: "Reports", href: "/reports" },
  sensor: { label: "SERP Sensor", href: "/sensor" },
  core: { label: "System", href: "/activity" },
};

const humanize = (s: string) =>
  s
    .replace(/[-_.]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim()
    .replace(/^./, (c) => c.toUpperCase());

/** "site-audit.crawl" -> { module: "site-audit", tool: "Site Audit", action: "Crawl" } */
export function jobKindLabel(kind: string) {
  const [prefix, ...rest] = kind.split(".");
  const meta = JOB_MODULES[prefix];
  return { module: prefix, tool: meta?.label ?? humanize(prefix), action: rest.length ? humanize(rest.join(" ")) : "Job", href: meta?.href ?? "/activity" };
}

export type JobStatusTone = "neutral" | "info" | "good" | "critical" | "warning";
export const JOB_STATUS: Record<string, { label: string; tone: JobStatusTone }> = {
  queued: { label: "Queued", tone: "neutral" },
  running: { label: "Running", tone: "info" },
  done: { label: "Done", tone: "good" },
  failed: { label: "Failed", tone: "critical" },
  cancelled: { label: "Cancelled", tone: "warning" },
};

/** Serializable job row for tables (joined with its project). */
export type JobListRow = {
  id: string;
  kind: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  progress: number;
  total: number;
  message: string | null;
  error: string | null;
  attempts: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  project_id: string | null;
  project_name: string | null;
  project_domain: string | null;
};

/** Seconds between start and finish (or now while running); null when never started. */
export function jobDuration(j: Pick<JobListRow, "started_at" | "finished_at" | "status">, now = Date.now()) {
  if (!j.started_at) return null;
  const end = j.finished_at ? new Date(j.finished_at).getTime() : j.status === "running" ? now : null;
  if (end == null) return null;
  return Math.max(0, (end - new Date(j.started_at).getTime()) / 1000);
}
export const jobPercent = (j: Pick<JobListRow, "progress" | "total" | "status">) =>
  j.status === "done" ? 100 : j.total > 0 ? Math.min(100, Math.round((j.progress / j.total) * 100)) : 0;
