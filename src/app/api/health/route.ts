import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { enqueue, getJob } from "@/lib/jobs/queue";
import { AppError } from "@/lib/domain";

export const dynamic = "force-dynamic";

/** Liveness: database reachable + job counts. */
export async function GET() {
  const [jobs] = await query<{ queued: number; running: number; failed: number }>(
    "SELECT count(*) FILTER (WHERE status='queued')::int AS queued, count(*) FILTER (WHERE status='running')::int AS running, count(*) FILTER (WHERE status='failed')::int AS failed FROM jobs",
  );
  return NextResponse.json({ ok: true, jobs }, { headers: { "Cache-Control": "no-store" } });
}

/** Signed-in users can run a ping job to verify the worker (POST), then poll with ?id=. */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const id = new URL(request.url).searchParams.get("id");
    if (id) return NextResponse.json(await getJob(user.id, id));
    const job = await enqueue({ kind: "core.ping", ownerId: user.id, payload: { hello: "world" } });
    return NextResponse.json(job);
  } catch (e) {
    const status = e instanceof AppError ? e.status : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status });
  }
}
