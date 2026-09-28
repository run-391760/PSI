import type { JobHandler } from "@/lib/jobs/types";

/** Background job handlers of the CX insights module (kinds prefixed "cx.insights."). */
export const jobs: Record<string, JobHandler> = {
  /** Hourly per brand (scheduled when a survey has auto-send on): creates survey invites for solved tickets. */
  "cx.insights.survey-dispatch": async (job) => {
    if (!job.project_id) return { skipped: "no project" };
    const { dispatchSurveys } = await import("./surveys");
    return dispatchSurveys(job.project_id);
  },
  /** Hourly per brand: scheduled email exports, executive briefs and QA auto-accept of overdue evaluations. */
  "cx.insights.hourly": async (job) => {
    if (!job.project_id) return { skipped: "no project" };
    const [{ runDueSchedules }, { runDueBriefs }, { autoAcceptDue }] = await Promise.all([import("./exports"), import("./intelligence"), import("./quality")]);
    const out: Record<string, unknown> = {};
    for (const [k, fn] of [["exports", runDueSchedules], ["briefs", runDueBriefs], ["qa", autoAcceptDue]] as const) {
      try {
        out[k] = await fn(job.project_id);
      } catch (e) {
        out[k] = { error: e instanceof Error ? e.message : "failed" };
      }
    }
    return out;
  },
};
