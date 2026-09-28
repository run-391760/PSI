import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/auth";
import { deviceOf, isShortCode, referrerHost } from "@/lib/cx/publishing/core";
import { recordClick } from "@/lib/cx/publishing/data";

export const dynamic = "force-dynamic";

/** Public short link: records a real click (device class + referrer host only) and redirects. */
export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  if (!isShortCode(code)) return new NextResponse("Link not found.", { status: 404 });
  let device = deviceOf(req.headers.get("user-agent"));
  // Very high request rates from one client are recorded as bot traffic (excluded from reports).
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "local";
  try {
    await rateLimit(`short-link:${ip}:${code}`, 30, 60);
  } catch {
    device = "bot";
  }
  const target = await recordClick(code, device, referrerHost(req.headers.get("referer")));
  if (!target) return new NextResponse("Link not found.", { status: 404 });
  return NextResponse.redirect(target, { status: 302, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer-when-downgrade" } });
}
