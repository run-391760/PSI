import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/auth";
import { AppError } from "@/lib/domain";

/** Public endpoints are called from customers' websites: permissive CORS, no cookies, IP rate limits. */
export const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type", "access-control-max-age": "86400" };
export const preflight = () => new NextResponse(null, { status: 204, headers: CORS });
export const ipOf = (req: Request) => (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
export const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { ...CORS, "cache-control": "no-store" } });
export async function guarded(req: Request, key: string, limit: number, fn: () => Promise<Response>) {
  try {
    await rateLimit(`cx:${key}:${ipOf(req)}`, limit, 60);
    return await fn();
  } catch (e) {
    if (e instanceof AppError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
}
