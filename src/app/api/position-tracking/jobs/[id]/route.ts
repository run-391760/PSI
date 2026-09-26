import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { AppError } from "@/lib/domain";
import type { JobRow } from "@/lib/jobs/types";

/** Progress of a Position Tracking check (polled by the progress banner). */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/position-tracking/jobs/[id]">) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const [job] = await query<JobRow>("SELECT * FROM jobs WHERE id=$1 AND owner_id=$2 AND kind LIKE 'position-tracking.%'", [id, user.id]);
    if (!job) throw new AppError("Job not found.", 404);
    return Response.json(
      { id: job.id, status: job.status, progress: job.progress, total: job.total, message: job.message, error: job.error, finishedAt: job.finished_at },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const status = e instanceof AppError ? e.status : 500;
    return Response.json({ error: e instanceof AppError ? e.message : "Something went wrong." }, { status });
  }
}
