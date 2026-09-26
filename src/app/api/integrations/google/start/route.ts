import { NextResponse, type NextRequest } from "next/server";
import { currentUser, rateLimit } from "@/lib/auth";
import { AppError } from "@/lib/domain";
import { startGoogleAuth } from "@/lib/google/oauth";

export const dynamic = "force-dynamic";

/** Begin Google sign-in for Search Console + Analytics (read-only). */
export async function GET(request: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  const returnTo = request.nextUrl.searchParams.get("returnTo") || "/settings?tab=integrations";
  try {
    await rateLimit(`google-oauth:${user.id}`, 10, 600);
    return NextResponse.redirect(await startGoogleAuth(user.id, returnTo, request.nextUrl.origin));
  } catch (e) {
    const message = e instanceof AppError ? e.message : "Could not start Google sign-in.";
    const back = new URL(returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/settings", request.url);
    back.searchParams.set("google_error", message);
    return NextResponse.redirect(back);
  }
}
