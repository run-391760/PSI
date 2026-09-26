import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { addDays } from "@/lib/position-tracking/metrics";
import { keywordDetail, parseRange } from "@/lib/position-tracking/reports";
import { getCampaign } from "@/lib/position-tracking/store";
import type { Device } from "@/lib/position-tracking/types";

/** Keyword drawer data: daily positions/URLs of every tracked domain over the range + latest SERP. */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/position-tracking/keywords/[id]">) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const [kw] = await query<{ id: string; project_id: string; keyword: string; domain: string }>(
      "SELECT k.id, k.project_id, k.keyword, p.domain FROM pt_keywords k JOIN projects p ON p.id=k.project_id WHERE k.id=$1 AND p.owner_id=$2",
      [id, user.id],
    );
    if (!kw) throw new AppError("Keyword not found.", 404);
    const campaign = await getCampaign(kw.project_id);
    if (!campaign?.lastDay) return Response.json({ rows: [], serp: null, domains: [] });
    const devices: Device[] = campaign.device === "both" ? ["desktop", "mobile"] : [campaign.device];
    const param = req.nextUrl.searchParams.get("device") as Device | null;
    const device = param && devices.includes(param) ? param : devices[0];
    const range = parseRange(req.nextUrl.searchParams.get("range"));
    const detail = await keywordDetail(kw.project_id, kw.id, device, addDays(campaign.lastDay, -(range - 1)));
    return Response.json({ ...detail, device, domains: [kw.domain, ...campaign.competitors] }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const status = e instanceof AppError ? e.status : 500;
    return Response.json({ error: e instanceof AppError ? e.message : "Something went wrong." }, { status });
  }
}
