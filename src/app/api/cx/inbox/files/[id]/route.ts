import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/domain";
import { fileForUser, readFileBytes } from "@/lib/cx/inbox/files";
import { serveBytes } from "@/lib/cx/publishing/serve";

export const dynamic = "force-dynamic";

/** Authenticated preview/download of a ticket attachment (members of the brand only). ?download=1 forces a download. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const f = await fileForUser(user.id, id);
    const res = serveBytes(req, await readFileBytes(f), f.mime, f.filename, "private, max-age=3600");
    const risky = !/^(image\/(png|jpeg|gif|webp)|video\/|audio\/|application\/pdf|text\/plain)/.test(f.mime);
    if (risky || new URL(req.url).searchParams.get("download") === "1") res.headers.set("Content-Disposition", `attachment; filename="${f.filename.replace(/["\\\r\n]/g, "_")}"`);
    res.headers.set("X-Content-Type-Options", "nosniff");
    return res;
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: e instanceof AppError ? e.status : 404 });
  }
}
