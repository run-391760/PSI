import type { JobHandler } from "@/lib/jobs/types";

/**
 * WP1 job handlers (to be registered in src/lib/jobs/registry.ts by the orchestrator):
 * - cx.inbox.reminders: fires every due ticket reminder (in-app notification + activity log).
 *   Reminders also fire lazily whenever an agent has the inbox open (30 s poll), so this job only
 *   covers the time nobody is signed in. Suggested schedule: setSchedule(projectId, "cx.inbox.reminders", { cadence: "hourly" }).
 */
export const jobs: Record<string, JobHandler> = {
  "cx.inbox.reminders": async (job) => {
    const { fireDueReminders } = await import("./workspace");
    return { fired: await fireDueReminders(job.project_id ?? undefined) };
  },
};
