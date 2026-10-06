import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/domain";
import { cancelJob } from "@/lib/jobs/queue";
import { endRun, getRun } from "@/lib/optimizer/agents/store";

export const dynamic = "force-dynamic";

const error = (e: unknown) => NextResponse.json({ error: e instanceof AppError ? e.message : "Something went wrong." }, { status: e instanceof AppError ? e.status : 500 });

/** Live progress of an agent audit run (owner-scoped): status and the item × stage grid. Results are read by the page once it is done. */
export async function GET(_req: Request, ctx: { params: Promise<{ runId: string }> }) {
  try {
    const user = await requireUser();
    const { runId } = await ctx.params;
    const run = await getRun(user.id, runId);
    return NextResponse.json(
      { id: run.id, status: run.status, progress: run.progress, error: run.error, startedAt: run.startedAt, finishedAt: run.finishedAt },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return error(e);
  }
}

/** Cancel a queued or running agent audit. */
export async function DELETE(_req: Request, ctx: { params: Promise<{ runId: string }> }) {
  try {
    const user = await requireUser();
    const { runId } = await ctx.params;
    const run = await getRun(user.id, runId);
    if (run.jobId && (run.status === "queued" || run.status === "running")) await cancelJob(user.id, run.jobId);
    await endRun(run.id, "cancelled", null);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return error(e);
  }
}
