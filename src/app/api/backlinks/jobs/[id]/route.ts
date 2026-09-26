import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/domain";
import { getJob } from "@/lib/jobs/queue";

export const dynamic = "force-dynamic";

/** Progress of a backlinks job (Backlink Audit / link verification), polled by the UI. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const job = await getJob(user.id, id);
    if (!job.kind.startsWith("backlinks.")) throw new AppError("Job not found.", 404);
    return NextResponse.json(
      { id: job.id, kind: job.kind, status: job.status, progress: job.progress, total: job.total, message: job.message, error: job.error },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const status = e instanceof AppError ? e.status : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status });
  }
}
