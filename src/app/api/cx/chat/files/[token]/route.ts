import { NextResponse } from "next/server";
import { chatFileByToken, readFileBytes } from "@/lib/cx/inbox/files";

export const dynamic = "force-dynamic";

/** Files an agent sent into a live chat, for the visitor (unguessable token; always downloaded, never rendered inline). */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const f = await chatFileByToken(token).catch(() => null);
  if (!f) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const buf = await readFileBytes(f);
  const inline = /^image\/(png|jpeg|gif|webp)$|^application\/pdf$/.test(f.mime);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": f.mime, "Content-Length": String(buf.length), "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${f.filename.replace(/["\\\r\n]/g, "_")}"`, "Access-Control-Allow-Origin": "*",
    },
  });
}
