import type { JobHandler } from "@/lib/jobs/types";
import { enqueue } from "@/lib/jobs/queue";
import { findCxBrand } from "@/lib/cx/context";
import { runDetection } from "./crisis";
import { ingestBrand } from "./ingest";

/** Background job handlers of the CX listening module (kinds prefixed "cx.listening."). */
export const jobs: Record<string, JobHandler> = {
  /** Fetch mentions for every active topic of a brand, then run spike detection. */
  "cx.listening.fetch": async (job, ctx) => {
    const project = await findCxBrand(job.owner_id ?? "", job.project_id ?? "");
    if (!project) throw new Error("Brand not found.");
    const report = await ingestBrand(project, (d, t, m) => ctx.progress(d, t, m), () => ctx.cancelled());
    await enqueue({ kind: "cx.listening.detect", ownerId: project.owner_id, projectId: project.id, dedupeKey: `cx.listening.detect:${job.id}` });
    return report;
  },
  /** Volume / negative-sentiment spike detection → crisis events + alerts. */
  "cx.listening.detect": async (job, ctx) => {
    const project = await findCxBrand(job.owner_id ?? "", job.project_id ?? "");
    if (!project) throw new Error("Brand not found.");
    await ctx.progress(0, 1, "Detecting spikes");
    const r = await runDetection(project);
    await ctx.progress(1, 1, `${r.opened} new crisis events`);
    return { at: r.at, opened: r.opened, triggered: r.scopes.filter((s) => s.result.triggered).map((s) => s.name) };
  },
};
