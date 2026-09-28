import type { JobHandler } from "@/lib/jobs/types";

/** Background job handlers of the CX insights module (kinds prefixed "cx.insights."). */
export const jobs: Record<string, JobHandler> = {
  /** Hourly per brand (scheduled when a survey has auto-send on): creates survey invites for solved tickets. */
  "cx.insights.survey-dispatch": async (job) => {
    if (!job.project_id) return { skipped: "no project" };
    const { dispatchSurveys } = await import("./surveys");
    return dispatchSurveys(job.project_id);
  },
};
