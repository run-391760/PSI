import { NextResponse } from "next/server";
import { AppError } from "@/lib/domain";
import { brandUser } from "@/lib/cx/inbox/guard";
import { buildXlsx } from "@/lib/cx/inbox/xlsx";
import { ticketTranscript } from "@/lib/cx/inbox/workspace";

export const dynamic = "force-dynamic";

/** Conversation history download: ?format=txt (default) or xlsx (Messages + Activity sheets). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const sp = new URL(req.url).searchParams;
    const brand = sp.get("brand") ?? "";
    await brandUser(brand, { write: false });
    const t = await ticketTranscript(brand, id);
    if (sp.get("format") === "xlsx")
      return new Response(new Uint8Array(buildXlsx([{ name: "Messages", rows: t.rows }, { name: "Activity", rows: t.activity }])), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="ticket-${t.number}-history.xlsx"` } });
    return new Response(t.text, { headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `attachment; filename="ticket-${t.number}-history.txt"` } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Error" }, { status: e instanceof AppError ? e.status : 500 });
  }
}
