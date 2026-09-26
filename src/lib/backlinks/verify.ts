import { query } from "@/lib/db";
import { notify } from "@/lib/jobs/queue";
import type { JobContext, JobRow } from "@/lib/jobs/types";
import { getProject } from "@/lib/projects";
import type { LinkStatus } from "./types";
import { checkLink } from "./verify-check";

export async function runVerifyJob(job: JobRow, ctx: JobContext) {
  if (!job.project_id || !job.owner_id) throw new Error("Verification job without a project.");
  const project = await getProject(job.owner_id, job.project_id);
  const ids: string[] | null = Array.isArray(job.payload?.linkIds) ? job.payload.linkIds.map(String) : null;
  const links = await query<{ id: string; source_url: string; status: LinkStatus }>(
    `SELECT id, source_url, status FROM bl_lb_links WHERE project_id=$1 AND ($2::text[] IS NULL OR id = ANY($2::text[])) ORDER BY created_at`,
    [project.id, ids],
  );
  const summary = { checked: 0, active: 0, lost: 0, unknown: 0, newlyLost: [] as string[] };
  await ctx.progress(0, links.length, links.length ? `Checking ${links.length} link${links.length === 1 ? "" : "s"}` : "No links to check");
  for (const [i, link] of links.entries()) {
    if (await ctx.cancelled()) break;
    await ctx.progress(i, links.length, `Checking ${link.source_url}`);
    const r = await checkLink(link.source_url, project.domain);
    await query(
      `UPDATE bl_lb_links SET status=$2, reason=$3, anchor=$4, rel=$5::jsonb, target_url=$6, http_status=$7, checks=checks+1, last_checked_at=now(),
         first_active_at=CASE WHEN $2='active' THEN COALESCE(first_active_at, now()) ELSE first_active_at END,
         lost_at=CASE WHEN $2='lost' THEN COALESCE(lost_at, now()) WHEN $2='active' THEN NULL ELSE lost_at END
       WHERE id=$1`,
      [link.id, r.status, r.reason.slice(0, 500), r.anchor?.slice(0, 500) ?? null, JSON.stringify(r.rel), r.targetUrl, r.httpStatus],
    );
    summary.checked++;
    summary[r.status]++;
    if (r.status === "lost" && link.status === "active") summary.newlyLost.push(link.source_url);
  }
  if (summary.newlyLost.length)
    await notify({
      ownerId: job.owner_id,
      projectId: project.id,
      tool: "link-building",
      severity: "critical",
      title: `${summary.newlyLost.length} monitored backlink${summary.newlyLost.length === 1 ? "" : "s"} to ${project.domain} lost`,
      body: summary.newlyLost.slice(0, 3).join(", ") + (summary.newlyLost.length > 3 ? ` and ${summary.newlyLost.length - 3} more` : ""),
      link: `/link-building?project=${project.id}&tab=monitor`,
    });
  await ctx.progress(links.length, links.length, "Done");
  return { checked: summary.checked, active: summary.active, lost: summary.lost, unknown: summary.unknown, newlyLost: summary.newlyLost.length };
}
