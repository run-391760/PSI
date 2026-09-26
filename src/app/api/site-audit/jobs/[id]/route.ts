import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { getJob } from "@/lib/jobs/queue";

export const dynamic = "force-dynamic";

/** Progress of a Site Audit job (polled by the live crawl view). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const job = await getJob(user.id, id);
    if (!job.kind.startsWith("site-audit.")) throw new AppError("Job not found.", 404);
    const [crawl] = await query<{ id: string; live: unknown; status: string }>("SELECT id, live, status FROM audit_crawls WHERE job_id=$1 ORDER BY started_at DESC LIMIT 1", [id]);
    return NextResponse.json(
      {
        id: job.id,
        kind: job.kind,
        status: job.status,
        progress: job.progress,
        total: job.total,
        message: job.message,
        error: job.error,
        startedAt: job.started_at,
        crawlId: crawl?.id ?? null,
        crawlStatus: crawl?.status ?? null,
        live: crawl?.live ?? null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const status = e instanceof AppError ? e.status : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status });
  }
}
