import type { JobHandler } from "@/lib/jobs/types";

/**
 * Background job handlers of the CX inbox module (kinds prefixed "cx.inbox.").
 * - cx.inbox.email-sync: IMAP import for every active email channel of the project, then re-enqueues
 *   itself in 5 minutes (an hourly schedule restarts the chain after a server restart).
 * - cx.inbox.sla-check: notifies once per ticket and SLA kind when first response / resolution is overdue.
 *   Enqueued at each ticket's due times, every 5 minutes while open tickets exist, and hourly.
 */
const EVERY = 5 * 60_000;
const slot = (t: number) => Math.floor(t / EVERY);

export const jobs: Record<string, JobHandler> = {
  "cx.inbox.email-sync": async (job, ctx) => {
    const { query } = await import("@/lib/db");
    const { syncEmailChannel } = await import("./email");
    const { enqueue } = await import("@/lib/jobs/queue");
    if (!job.project_id) return { channels: 0 };
    const only = (job.payload as { channelId?: string }).channelId;
    const chans = await query<{ id: string; project_id: string; config: any; secret_enc: string | null }>(
      "SELECT id,project_id,config,secret_enc FROM cx_channels WHERE project_id=$1 AND kind='email' AND status<>'paused' AND ($2::text IS NULL OR id=$2)",
      [job.project_id, only ?? null],
    );
    const results: Record<string, unknown> = {};
    for (const [i, ch] of chans.entries()) {
      await ctx.progress(i, chans.length, `Syncing mailbox ${ch.config?.user ?? ""}`);
      try {
        results[ch.id] = await syncEmailChannel(ch);
      } catch (e) {
        results[ch.id] = { error: e instanceof Error ? e.message : String(e) };
      }
    }
    if (chans.length && !only) {
      const next = Date.now() + EVERY;
      await enqueue({ kind: "cx.inbox.email-sync", ownerId: job.owner_id!, projectId: job.project_id, payload: {}, dedupeKey: `cx.inbox.email-sync:${job.project_id}:${slot(next)}`, runAfter: new Date(next) });
    }
    return { channels: chans.length, results };
  },

  "cx.inbox.sla-check": async (job) => {
    const { query } = await import("@/lib/db");
    const { notify, enqueue } = await import("@/lib/jobs/queue");
    if (!job.project_id) return { alerts: 0 };
    // Ticket reminders ride on this 5-minute chain so they fire while nobody has the inbox open.
    await import("./workspace").then((w) => w.fireDueReminders(job.project_id!)).catch((e) => console.error("[cx] reminders", e));
    // Instagram has no webhook for posts the account is tagged in; poll them (throttled to 15 minutes).
    await import("./social").then((s) => s.pollInstagramTags(job.project_id!)).catch((e) => console.error("[cx] instagram tags", e));
    const rows = await query<{ id: string; number: number; subject: string; kind: "first_response" | "resolution" }>(
      `WITH due AS (
         SELECT t.id,t.number,t.subject,'first_response' AS kind FROM cx_tickets t
          WHERE t.project_id=$1 AND t.status NOT IN ('solved','closed') AND t.first_response_at IS NULL AND t.first_response_due < now()
         UNION ALL
         SELECT t.id,t.number,t.subject,'resolution' FROM cx_tickets t
          WHERE t.project_id=$1 AND t.status NOT IN ('solved','closed') AND t.resolution_due < now())
       SELECT d.* FROM due d WHERE NOT EXISTS (SELECT 1 FROM cx_inbox_sla_alerts a WHERE a.ticket_id=d.id AND a.kind=d.kind)`,
      [job.project_id],
    );
    const [p] = await query<{ owner_id: string }>("SELECT owner_id FROM projects WHERE id=$1", [job.project_id]);
    let alerts = 0;
    for (const r of rows) {
      const [ins] = await query("INSERT INTO cx_inbox_sla_alerts(ticket_id,kind) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING ticket_id", [r.id, r.kind]);
      if (!ins || !p) continue;
      alerts++;
      await notify({
        ownerId: p.owner_id, projectId: job.project_id, tool: "CX Inbox", severity: r.kind === "resolution" ? "critical" : "warning",
        title: `SLA breached: ${r.kind === "first_response" ? "first response" : "resolution"} overdue on #${r.number}`,
        body: r.subject.slice(0, 200), link: `/cx/inbox?brand=${job.project_id}&t=${r.id}`,
      });
    }
    const [open] = await query<{ n: number }>("SELECT count(*)::int AS n FROM cx_tickets WHERE project_id=$1 AND status NOT IN ('solved','closed')", [job.project_id]);
    if (open?.n && p && !(job.payload as { ticketId?: string }).ticketId) {
      const next = Date.now() + EVERY;
      await enqueue({ kind: "cx.inbox.sla-check", ownerId: p.owner_id, projectId: job.project_id, payload: {}, dedupeKey: `cx.inbox.sla-check:${job.project_id}:${slot(next)}`, runAfter: new Date(next) });
    }
    return { alerts, checked: rows.length };
  },
};

/** Start the recurring chains for a project (idempotent: dedupe by 5-minute slot) + hourly schedule backstop. */
export async function ensureInboxJobs(projectId: string, ownerId: string, hasEmail: boolean) {
  const { enqueue, getSchedule, setSchedule } = await import("@/lib/jobs/queue");
  const s = slot(Date.now());
  await enqueue({ kind: "cx.inbox.sla-check", ownerId, projectId, payload: {}, dedupeKey: `cx.inbox.sla-check:${projectId}:${s}` });
  if (!(await getSchedule(projectId, "cx.inbox.sla-check"))) await setSchedule(projectId, "cx.inbox.sla-check", { cadence: "hourly" });
  if (hasEmail) {
    await enqueue({ kind: "cx.inbox.email-sync", ownerId, projectId, payload: {}, dedupeKey: `cx.inbox.email-sync:${projectId}:${s}` });
    if (!(await getSchedule(projectId, "cx.inbox.email-sync"))) await setSchedule(projectId, "cx.inbox.email-sync", { cadence: "hourly" });
  }
}
