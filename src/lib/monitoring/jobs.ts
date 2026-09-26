import { query } from "@/lib/db";
import type { JobHandler } from "@/lib/jobs/types";
import { notify } from "@/lib/jobs/queue";
import { findProject } from "@/lib/projects";
import { getBrandSettings, ingestMentions } from "./brand";

const DAY = 86400000;

/** Background job handlers owned by the monitoring module, keyed by job kind (prefix kinds with "monitoring."). */
export const jobs: Record<string, JobHandler> = {
  /** Fetch new brand mentions (Google News + optional demo social) and alert on spikes / negative press. */
  "monitoring.brand": async (job, ctx) => {
    const project = await findProject(job.owner_id ?? "", job.project_id);
    if (!project) throw new Error("Project not found.");
    const settings = await getBrandSettings(project.id);
    if (!settings) return { skipped: "Brand monitoring is not set up for this project." };
    const firstRun = !settings.lastRunAt;
    const { insertedOwn, errors } = await ingestMentions(project, settings, (done, total, message) => ctx.progress(done, total, message));
    await query("UPDATE bm_settings SET last_run_at=now(), last_error=$2 WHERE project_id=$1", [project.id, errors.length ? errors.join(" · ").slice(0, 1000) : null]);
    const link = `/brand-monitoring?project=${project.id}`;
    const now = Date.now();

    if (firstRun) {
      await notify({ ownerId: project.owner_id, projectId: project.id, tool: "brand-monitoring", severity: "info", title: `Brand monitoring is live: ${insertedOwn.length} mentions found`, body: "New mentions are fetched daily from Google News.", link });
    } else if (insertedOwn.length) {
      const negative = insertedOwn.filter((m) => m.sentiment === "negative" && now - new Date(m.published_at).getTime() < 7 * DAY);
      if (negative.length)
        await notify({
          ownerId: project.owner_id,
          projectId: project.id,
          tool: "brand-monitoring",
          severity: negative.length >= 3 ? "critical" : "warning",
          title: `${negative.length} new negative mention${negative.length === 1 ? "" : "s"}`,
          body: negative
            .slice(0, 3)
            .map((m) => `“${m.title.slice(0, 120)}”`)
            .join(" · "),
          link: `${link}&sentiment=negative`,
        });
      // Spike: mentions published in the last 24h vs the average day of the previous 14 days.
      const [row] = await query<{ recent: number; baseline: number }>(
        `SELECT count(*) FILTER (WHERE published_at > now() - interval '1 day')::int AS recent,
                count(*) FILTER (WHERE published_at <= now() - interval '1 day' AND published_at > now() - interval '15 days')::int AS baseline
         FROM bm_mentions WHERE project_id=$1 AND subject=''`,
        [project.id],
      );
      const avg = row.baseline / 14;
      if (row.recent >= Math.max(5, avg * 2.5))
        await notify({
          ownerId: project.owner_id,
          projectId: project.id,
          tool: "brand-monitoring",
          severity: "warning",
          title: `Mention spike: ${row.recent} mentions in 24 hours`,
          body: `That is ${avg > 0 ? `${(row.recent / avg).toFixed(1)}× the daily average` : "well above normal"} for the last two weeks.`,
          link,
        });
    }
    return { newMentions: insertedOwn.length, errors };
  },
};
