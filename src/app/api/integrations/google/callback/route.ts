import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/lib/auth";
import { AppError } from "@/lib/domain";
import { finishGoogleAuth } from "@/lib/google/oauth";

export const dynamic = "force-dynamic";

/** Google redirects here after consent (must match the OAuth client's authorized redirect URI). */
export async function GET(request: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  const sp = request.nextUrl.searchParams;
  const fail = (message: string, to = "/settings?tab=integrations") => {
    const url = new URL(to, request.url);
    url.searchParams.set("google_error", message);
    return NextResponse.redirect(url);
  };
  if (sp.get("error")) return fail(sp.get("error") === "access_denied" ? "Google access was not granted." : `Google sign-in failed: ${sp.get("error")}`);
  const code = sp.get("code");
  const state = sp.get("state");
  if (!code || !state) return fail("Google sign-in returned no authorization code.");
  try {
    const returnTo = await finishGoogleAuth(user.id, code, state, request.nextUrl.origin);
    const url = new URL(returnTo, request.url);
    url.searchParams.set("google", "connected");
    return NextResponse.redirect(url);
  } catch (e) {
    return fail(e instanceof AppError ? e.message : "Google sign-in failed.");
  }
}
