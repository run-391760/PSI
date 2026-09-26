import { query } from "@/lib/db";
import { timeAgo } from "@/lib/format";
import type { SummaryProvider } from "@/lib/projects/summary-types";
import { AUDIT_JOB, getAuditSettings, listAuditRuns } from "./audit";
import { overallScore } from "./audit-score";
import { getLbSettings, projectProspects, VERIFY_JOB } from "./link-building";
import { latestJob } from "@/lib/jobs/queue";
import { POTENTIAL_MIN, TOXIC_MIN } from "./types";

const LEVEL_LABEL = { low: "Low", medium: "Medium", high: "High" } as const;

/** Project dashboard widgets for the backlinks module. */
export const summaries: SummaryProvider[] = [
  // Backlink Audit: overall toxic score (effective, after whitelist/disavow), toxic domains, last audit.
  async (project) => {
    const href = `/backlink-audit?project=${project.id}`;
    const [settings, runs, job] = await Promise.all([getAuditSettings(project.id), listAuditRuns(project.id, 12), latestJob(project.id, AUDIT_JOB)]);
    const running = !!job && (job.status === "queued" || job.status === "running");
    if (!runs.length)
      return running
        ? { tool: "backlink-audit", label: "Backlink Audit", href, state: "running", note: job?.message ?? "Auditing referring domains…" }
        : { tool: "backlink-audit", label: "Backlink Audit", href, state: "empty", cta: settings ? "Run audit" : "Set up", note: "Find toxic backlinks and build a disavow file." };
    const latest = runs[0];
    const [counts] = await query<{ toxic: number; potentially: number; analyzed: number; disavowed: number; removal: number }>(
      `SELECT count(*) FILTER (WHERE d.toxicity >= $2 AND COALESCE(l.list,'') NOT IN ('whitelist','disavow'))::int AS toxic,
              count(*) FILTER (WHERE d.toxicity >= $3 AND d.toxicity < $2 AND COALESCE(l.list,'') NOT IN ('whitelist','disavow'))::int AS potentially,
              count(*)::int AS analyzed,
              (SELECT count(*)::int FROM bl_audit_lists x WHERE x.project_id=$1 AND x.list='disavow') AS disavowed,
              (SELECT count(*)::int FROM bl_audit_lists x WHERE x.project_id=$1 AND x.list='remove') AS removal
       FROM bl_audit_domains d LEFT JOIN bl_audit_lists l ON l.project_id=d.project_id AND l.domain=d.domain WHERE d.project_id=$1`,
      [project.id, TOXIC_MIN, POTENTIAL_MIN],
    );
    const { score, level } = overallScore(counts.toxic, counts.potentially, counts.analyzed);
    const prev = runs[1];
    return {
      tool: "backlink-audit",
      label: "Backlink Audit",
      href,
      state: running ? "running" : "ready",
      headline: { label: `Toxic score · ${LEVEL_LABEL[level]}`, value: String(score), delta: prev && prev.toxicScore ? Math.round(((score - prev.toxicScore) / prev.toxicScore) * 1000) / 10 : null, upIsGood: false },
      stats: [
        { label: "Toxic domains", value: String(counts.toxic) },
        { label: "Disavowed", value: String(counts.disavowed) },
        { label: "Last audit", value: timeAgo(latest.createdAt) },
      ],
      spark: runs.length > 1 ? [...runs].reverse().map((r) => r.toxic) : undefined,
      updatedAt: latest.createdAt,
      note: latest.newToxic ? `${latest.newToxic} new toxic domain${latest.newToxic === 1 ? "" : "s"} in the last audit` : undefined,
    };
  },
  // Link Building Tool: prospects, outreach in progress, acquired / active links.
  async (project) => {
    const href = `/link-building?project=${project.id}`;
    const settings = await getLbSettings(project.id);
    if (!settings) return { tool: "link-building", label: "Link Building", href, state: "empty", cta: "Set up", note: "Find link prospects and monitor the links you earn." };
    const [[pipe], [links], job] = await Promise.all([
      query<{ in_progress: number; acquired: number; sent: number; acted: number }>(
        `SELECT count(*) FILTER (WHERE state='in_progress')::int AS in_progress, count(*) FILTER (WHERE status='acquired')::int AS acquired,
                count(*) FILTER (WHERE status IN ('sent','replied','acquired'))::int AS sent, count(*)::int AS acted
         FROM bl_lb_prospects WHERE project_id=$1`,
        [project.id],
      ),
      query<{ active: number; lost: number; total: number; checked: string | null }>(
        "SELECT count(*) FILTER (WHERE status='active')::int AS active, count(*) FILTER (WHERE status='lost')::int AS lost, count(*)::int AS total, max(last_checked_at) AS checked FROM bl_lb_links WHERE project_id=$1",
        [project.id],
      ),
      latestJob(project.id, VERIFY_JOB),
    ]);
    const prospects = Math.max(0, (settings.prospectCount ?? projectProspects(project, settings).length) - pipe.acted);
    const running = !!job && (job.status === "queued" || job.status === "running");
    return {
      tool: "link-building",
      label: "Link Building",
      href,
      state: running ? "running" : "ready",
      headline: { label: "Active links", value: `${links.active}${links.total ? ` / ${links.total}` : ""}` },
      stats: [
        { label: "Prospects", value: prospects.toLocaleString() },
        { label: "In progress", value: String(pipe.in_progress) },
        { label: "Acquired", value: String(pipe.acquired) },
      ],
      updatedAt: links.checked ? new Date(links.checked).toISOString() : settings.updatedAt,
      note: links.lost ? `${links.lost} monitored link${links.lost === 1 ? "" : "s"} lost` : `${pipe.sent} outreach email${pipe.sent === 1 ? "" : "s"} sent`,
    };
  },
];
