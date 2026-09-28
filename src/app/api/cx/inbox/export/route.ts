import { NextResponse } from "next/server";
import { AppError } from "@/lib/domain";
import { brandUser } from "@/lib/cx/inbox/guard";
import { buildXlsx, toCsv } from "@/lib/cx/inbox/xlsx";
import { exportTicketRows } from "@/lib/cx/inbox/workspace";

export const dynamic = "force-dynamic";

/** Ticket export (Excel or CSV): the selected ids, or every ticket matching the current view + filters. */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const sp = url.searchParams;
    const brand = sp.get("brand") ?? "";
    const { user } = await brandUser(brand, { write: false });
    const ids = sp.get("ids")?.split(",").filter(Boolean).slice(0, 5000);
    const g = (k: string) => sp.get(k) ?? undefined;
    const rows = await exportTicketRows(brand, user.id, { view: (g("view") as never) ?? "open", q: g("q"), channel: g("channel"), priority: g("priority"), status: g("status"), tag: g("tag"), team: g("team"), sentiment: g("sentiment"), from: g("from"), to: g("to"), profile: g("profile"), topic: g("topic"), escalated: g("escalated"), email: g("email"), severity: g("severity"), sort: g("sort") }, ids);
    const stamp = new Date().toISOString().slice(0, 10);
    if (sp.get("format") === "csv")
      return new Response(toCsv(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="tickets-${stamp}.csv"` } });
    return new Response(new Uint8Array(buildXlsx([{ name: "Tickets", rows }])), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="tickets-${stamp}.xlsx"` } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Export failed" }, { status: e instanceof AppError ? e.status : 500 });
  }
}
