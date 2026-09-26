import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/domain";
import { cancelJob, getJob } from "@/lib/jobs/queue";

export const dynamic = "force-dynamic";

function fail(e: unknown) {
  const status = e instanceof AppError ? e.status : 500;
  return NextResponse.json({ error: e instanceof Error ? e.message : "Request failed." }, { status });
}

/** Progress of a content-module job (polled by the progress bar). */
export async function GET(_req: Request, ctx: RouteContext<"/api/content/jobs/[id]">) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const job = await getJob(user.id, id);
    if (!job.kind.startsWith("content.")) throw new AppError("Job not found.", 404);
    return NextResponse.json(
      { id: job.id, kind: job.kind, status: job.status, progress: job.progress, total: job.total, message: job.message, error: job.error },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return fail(e);
  }
}

/** Cancel a queued or running job. */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/content/jobs/[id]">) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const job = await getJob(user.id, id);
    if (!job.kind.startsWith("content.")) throw new AppError("Job not found.", 404);
    await cancelJob(user.id, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
