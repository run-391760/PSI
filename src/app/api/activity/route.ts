import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { iso } from "@/lib/reports/platform";

export const dynamic = "force-dynamic";

type Row = { id: string; status: string; progress: number; total: number; message: string | null; error: string | null; started_at: string | Date | null; finished_at: string | Date | null };

/**
 * Job progress polling for Activity and project pages.
 * GET /api/activity?ids=a,b,c → those jobs (owner-scoped); without ids → the user's active jobs.
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const ids = (new URL(request.url).searchParams.get("ids") || "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => /^[0-9a-f-]{8,64}$/i.test(s))
      .slice(0, 200);
    const rows = ids.length
      ? await query<Row>("SELECT id,status,progress,total,message,error,started_at,finished_at FROM jobs WHERE owner_id=$1 AND id = ANY($2::text[])", [user.id, ids])
      : await query<Row>("SELECT id,status,progress,total,message,error,started_at,finished_at FROM jobs WHERE owner_id=$1 AND status IN ('queued','running') ORDER BY created_at DESC LIMIT 100", [user.id]);
    const jobs = rows.map((r) => ({ ...r, started_at: iso(r.started_at), finished_at: iso(r.finished_at) }));
    return NextResponse.json({ jobs, active: jobs.filter((j) => j.status === "queued" || j.status === "running").length }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const status = e instanceof AppError ? e.status : 500;
    return NextResponse.json({ error: e instanceof AppError ? e.message : "Could not load activity." }, { status });
  }
}
