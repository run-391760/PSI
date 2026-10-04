import type { JobHandler } from "@/lib/jobs/types";

/**
 * Background jobs of the CX operational modules (kinds "cx.ops.*"). Register in src/lib/jobs/registry.ts:
 *   import { jobs as cxOps } from "@/lib/cx/ops/jobs";  …  ...cxOps,
 * - cx.ops.tick: task due reminders + overdue alerts, daily digests and post-key sync for one brand (or all brands when the
 *   job has no project). Scheduled hourly per brand by ensureOpsJobs(); the inbox's 5-minute SLA chain also
 *   calls fireDueTasks so reminders fire on time even before this job is registered.
 */
export const jobs: Record<string, JobHandler> = {
  "cx.ops.tick": async (job) => {
    const { fireDueTasks, sendDailyDigests } = await import("./tasks");
    const fired = await fireDueTasks(job.project_id ?? undefined);
    const digests = job.project_id ? await sendDailyDigests(job.project_id).catch(() => 0) : 0;
    let posts = 0;
    if (job.project_id) posts = await import("./media").then((m) => m.syncPostKeys(job.project_id!)).catch(() => 0);
    return { fired, digests, posts };
  },
};

/** Hourly cx.ops.tick schedule for a brand (idempotent; call from page loads). */
export async function ensureOpsJobs(projectId: string) {
  const { handlers } = await import("@/lib/jobs/registry");
  if (!handlers["cx.ops.tick"]) return; // not registered yet: the inbox SLA chain covers reminders meanwhile
  const { getSchedule, setSchedule } = await import("@/lib/jobs/queue");
  const s = await getSchedule(projectId, "cx.ops.tick").catch(() => null);
  if (!s) await setSchedule(projectId, "cx.ops.tick", { cadence: "hourly", payload: {} }).catch(() => {});
}
