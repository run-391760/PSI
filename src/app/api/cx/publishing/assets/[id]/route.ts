import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/domain";
import { assetFile, assetForUser } from "@/lib/cx/publishing/data";
import { serveBytes } from "@/lib/cx/publishing/serve";

export const dynamic = "force-dynamic";

/** Authenticated download/preview of a library asset (supports Range for video). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const a = await assetForUser(user.id, id);
    return serveBytes(req, await assetFile(a), a.mime, a.filename, "private, max-age=3600");
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: e instanceof AppError ? e.status : 404 });
  }
}
