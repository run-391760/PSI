import type { JobContext, JobHandler } from "@/lib/jobs/types";
import { getBundle, getDraft, inputOf, reportFor } from "../store";
import { CancelledError } from "./call";
import { configuredProviders, liveLlm } from "./llm";
import { runPipeline } from "./pipeline";
import { completeRun, endRun, markRunning, pruneRuns, runOwner, saveProgress, TOTAL_STAGES } from "./store";
import { emptyGrid, type ItemId, itemDef, type RunProgress, type StageId, STAGES, type StageStatus } from "./types";
import { runFingerprint } from "./verify";

/** Background job of the agent audit: runs the pipeline on the draft as it is when the job starts. */

const TERMINAL: StageStatus[] = ["done", "skipped", "failed"];
/** The job lease (10 minutes) is extended this often while the pipeline runs, even when a stage takes long. */
const HEARTBEAT_MS = 60_000;

/** Pipelines running in this process, by run: a re-delivered job joins the running one instead of starting a second. */
const inFlight = ((globalThis as unknown as { synapseAgentRuns?: Map<string, Promise<unknown>> }).synapseAgentRuns ??= new Map());

export const jobs: Record<string, JobHandler> = {
  "optimizer.agents": async (job, ctx) => {
    const runId = String(job.payload.runId ?? "");
    const running = inFlight.get(runId);
    if (running) return running;
    const p = runAgents(runId, job.owner_id, ctx).finally(() => inFlight.delete(runId));
    inFlight.set(runId, p);
    return p;
  },
};

async function runAgents(runId: string, ownerId: string | null, ctx: JobContext) {
  const run = await runOwner(runId);
  if (!run || run.owner_id !== ownerId) throw new Error("Agent run not found.");
  if (run.status === "cancelled") return { runId, cancelled: true };
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  try {
    const draft = await getDraft(run.owner_id, run.draft_id);
    const bundle = await getBundle(draft.id);
    const report = await reportFor(run.owner_id, draft, bundle);
    const input = inputOf(draft);
    const fingerprint = runFingerprint(input, bundle);
    const progress: RunProgress = { grid: emptyGrid(), done: 0, total: TOTAL_STAGES, message: "Starting the agents" };
    if (!(await markRunning(runId, fingerprint, progress))) return { runId, cancelled: true };
    await ctx.progress(0, TOTAL_STAGES, progress.message);
    heartbeat = setInterval(() => void ctx.progress(progress.done, progress.total, progress.message).catch(() => {}), HEARTBEAT_MS);

    // Progress writes are chained so a slow write never lands after a newer one.
    let chain: Promise<unknown> = Promise.resolve();
    const onStage = (item: ItemId, stage: StageId, status: StageStatus) => {
      progress.grid[item][stage] = status;
      progress.done = Object.values(progress.grid).reduce((s, row) => s + Object.values(row).filter((x) => TERMINAL.includes(x)).length, 0);
      progress.message = `${STAGES.find((s) => s.id === stage)!.label} · ${itemDef(item).label}: ${status}`;
      const snapshot = structuredClone(progress);
      chain = chain.then(() => saveProgress(runId, snapshot)).then(() => ctx.progress(snapshot.done, snapshot.total, snapshot.message)).catch((e) => console.warn("[optimizer.agents] progress", e instanceof Error ? e.message : e));
    };

    const res = await runPipeline({ draft: input, report, research: bundle.research, fingerprint }, { llm: liveLlm({ cancelled: ctx.cancelled }), onStage, cancelled: ctx.cancelled, providers: configuredProviders().length });
    await chain;
    progress.message = "Finished";
    if (!(await completeRun(runId, res.items, res.summary, progress))) return { runId, cancelled: true };
    await pruneRuns(draft.id);
    return { runId, engine: res.summary.engine.overall, final: res.summary.final.overall, calls: res.summary.calls, confidence: res.summary.confidence };
  } catch (e) {
    if (e instanceof CancelledError) {
      await endRun(runId, "cancelled", null);
      return { runId, cancelled: true };
    }
    await endRun(runId, "failed", e instanceof Error ? e.message : String(e));
    throw e;
  } finally {
    if (heartbeat) clearInterval(heartbeat);
  }
}
