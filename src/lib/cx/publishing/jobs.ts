import type { JobHandler } from "@/lib/jobs/types";

/** Background job handlers of the CX publishing module (kinds prefixed "cx.publishing."). */
export const jobs: Record<string, JobHandler> = {
  /** Every minute while posts are scheduled (self-chaining) + hourly safety-net schedule: publish due posts. */
  "cx.publishing.dispatch": async (job, ctx) => {
    const { dispatchDue } = await import("./dispatch");
    await ctx.progress(0, 1, "Publishing due posts");
    const r = await dispatchDue(job.owner_id);
    await ctx.progress(1, 1, `${r.published} published, ${r.failed} not published`);
    return r;
  },
};
