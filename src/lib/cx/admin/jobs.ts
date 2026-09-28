import type { JobHandler } from "@/lib/jobs/types";

/**
 * Background jobs of the CX admin package (kinds "cx.admin.*").
 * - cx.admin.tick: every minute per brand — automation catch-up + webhook events, queue assignment and
 *   cleanup, break overruns, SLA pre-breach/escalations, alerts, webhook deliveries; polls Discord/Telegram
 *   every 5 min and Discourse every 30 min. Re-enqueues itself; an hourly schedule restarts the chain.
 */
const MIN = 60_000;
const slot = (t: number, every = MIN) => Math.floor(t / every);

export const jobs: Record<string, JobHandler> = {
  "cx.admin.tick": async (job) => {
    if (!job.project_id) return {};
    const projectId = job.project_id;
    const { query } = await import("@/lib/db");
    const { enqueue } = await import("@/lib/jobs/queue");
    const out: Record<string, unknown> = {};
    const step = async (name: string, fn: () => Promise<unknown>) => {
      try { out[name] = await fn(); } catch (e) { out[name] = { error: e instanceof Error ? e.message : String(e) }; }
    };
    const { catchUp } = await import("./hooks");
    const { runQueue, checkBreaks } = await import("./queue");
    const { slaTick } = await import("./sla");
    const { runAlerts } = await import("./alerts");
    const { deliverDue } = await import("./webhooks");
    const { syncConnector } = await import("./connectors");
    await step("catchUp", () => catchUp(projectId));
    await step("queue", () => runQueue(projectId));
    await step("breaks", () => checkBreaks(projectId));
    await step("sla", () => slaTick(projectId));
    await step("alerts", () => runAlerts(projectId));
    await step("webhooks", () => deliverDue(projectId));
    const chans = await query<{ id: string; project_id: string; kind: string; config: any; secret_enc: string | null; last_synced_at: string | null }>(
      "SELECT id,project_id,kind,config,secret_enc,last_synced_at FROM cx_channels WHERE project_id=$1 AND kind IN ('discord','discourse','telegram') AND status<>'paused'", [projectId]);
    for (const c of chans) {
      const every = (c.kind === "discourse" ? 30 : 5) * MIN;
      if (c.last_synced_at && Date.now() - new Date(c.last_synced_at).getTime() < every - 5000) continue;
      await step(`sync:${c.id}`, () => syncConnector(c));
    }
    if (job.owner_id && (await active(projectId))) {
      const next = Date.now() + MIN;
      await enqueue({ kind: "cx.admin.tick", ownerId: job.owner_id, projectId, payload: {}, dedupeKey: `cx.admin.tick:${projectId}:${slot(next)}`, runAfter: new Date(next) });
    }
    return out;
  },
};

/** Whether the brand uses anything that needs the minute tick. */
async function active(projectId: string) {
  const { query } = await import("@/lib/db");
  const [r] = await query<{ n: number }>(
    `SELECT (SELECT count(*) FROM cx_admin_automations WHERE project_id=$1 AND active) + (SELECT count(*) FROM cx_admin_queue_settings WHERE project_id=$1 AND enabled)
          + (SELECT count(*) FROM cx_admin_sla_rules WHERE project_id=$1 AND active) + (SELECT count(*) FROM cx_admin_escalations WHERE project_id=$1 AND active)
          + (SELECT count(*) FROM cx_admin_alerts WHERE project_id=$1 AND active) + (SELECT count(*) FROM cx_admin_webhooks WHERE project_id=$1 AND active)
          + (SELECT count(*) FROM cx_channels WHERE project_id=$1 AND kind IN ('discord','discourse','telegram')) AS n`, [projectId]);
  return Number(r?.n ?? 0) > 0;
}

/** Start the minute chain for a brand (idempotent) + hourly schedule backstop. Called from admin settings actions. */
export async function ensureAdminJobs(projectId: string, ownerId: string) {
  const { enqueue, getSchedule, setSchedule } = await import("@/lib/jobs/queue");
  await enqueue({ kind: "cx.admin.tick", ownerId, projectId, payload: {}, dedupeKey: `cx.admin.tick:${projectId}:${slot(Date.now())}` });
  if (!(await getSchedule(projectId, "cx.admin.tick"))) await setSchedule(projectId, "cx.admin.tick", { cadence: "hourly" });
}
