import { NextResponse } from "next/server";
import { assetByToken, assetFile } from "@/lib/cx/publishing/data";
import { serveBytes } from "@/lib/cx/publishing/serve";

export const dynamic = "force-dynamic";

/** Unguessable public media URL (per-asset random token) for networks that fetch media themselves (Meta). */
export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const a = /^[\w-]{20,64}$/.test(token) ? await assetByToken(token) : null;
  if (!a) return new NextResponse("Not found.", { status: 404 });
  try {
    return serveBytes(req, await assetFile(a), a.mime, a.filename, "public, max-age=86400");
  } catch {
    return new NextResponse("Not found.", { status: 404 });
  }
}
