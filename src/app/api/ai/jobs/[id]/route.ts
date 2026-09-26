import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/domain";
import { cancelJob, getJob } from "@/lib/jobs/queue";

export const dynamic = "force-dynamic";

const PREFIX = "ai-visibility.";

/** Job progress for polling UIs (owner-scoped). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const job = await getJob(user.id, id);
    if (!job.kind.startsWith(PREFIX)) throw new AppError("Job not found.", 404);
    return NextResponse.json(
      { id: job.id, kind: job.kind, status: job.status, progress: job.progress, total: job.total, message: job.message, error: job.error, result: job.result },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: e instanceof AppError ? e.status : 500 });
  }
}

/** Cancel a queued or running job. */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const job = await getJob(user.id, id);
    if (!job.kind.startsWith(PREFIX)) throw new AppError("Job not found.", 404);
    await cancelJob(user.id, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: e instanceof AppError ? e.status : 500 });
  }
}
