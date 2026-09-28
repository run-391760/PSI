import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/auth";
import { AppError } from "@/lib/domain";
import { submitResponse } from "@/lib/cx/insights/surveys";

/** Public endpoint: stores a survey response (no sign-in). Rate limited per IP and survey. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
    await rateLimit(`cx-survey:${id}:${ip}`, 20, 600);
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") throw new AppError("Invalid request.", 400);
    const res = await submitResponse(id, body);
    return NextResponse.json({ ok: true, thankYou: res.thankYou, redirect: res.redirect });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
    if (e && typeof e === "object" && "issues" in e) return NextResponse.json({ ok: false, error: "Please check your answers." }, { status: 400 });
    console.error(e);
    return NextResponse.json({ ok: false, error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
