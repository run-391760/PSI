import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { brandUser } from "@/lib/cx/inbox/guard";
import { heartbeat } from "@/lib/cx/inbox/store";

/** Agent conversation polling: presence heartbeat (collision indicator) + change detection. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const url = new URL(req.url);
    const brand = url.searchParams.get("brand") ?? "";
    const { user } = await brandUser(brand);
    const viewers = await heartbeat(brand, id, user, url.searchParams.get("typing") === "1");
    const [t] = await query<{ updated_at: string; last: string | null; n: number; seen: string | null; typing: string | null }>(
      `SELECT t.updated_at, (SELECT max(created_at) FROM cx_messages WHERE ticket_id=t.id)::text AS last, (SELECT count(*)::int FROM cx_messages WHERE ticket_id=t.id) AS n,
              (SELECT max(visitor_seen_at) FROM cx_inbox_chat_sessions WHERE ticket_id=t.id)::text AS seen,
              (SELECT max(visitor_typing_at) FROM cx_inbox_chat_sessions WHERE ticket_id=t.id)::text AS typing
         FROM cx_tickets t WHERE t.id=$1 AND t.project_id=$2`,
      [id, brand],
    );
    if (!t) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const now = Date.now();
    return NextResponse.json({
      version: `${new Date(t.updated_at).toISOString()}|${t.n}`,
      viewers: viewers.map((v) => ({ name: v.user_name, typing: v.typing })),
      visitorOnline: t.seen ? now - new Date(t.seen).getTime() < 30_000 : null,
      visitorTyping: t.typing ? now - new Date(t.typing).getTime() < 8_000 : false,
    });
  } catch (e) {
    const status = e instanceof AppError ? e.status : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : "Error" }, { status });
  }
}
