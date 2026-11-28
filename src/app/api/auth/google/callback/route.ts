import { NextResponse, type NextRequest } from "next/server";
import { AppError } from "@/lib/domain";
import { SIGNIN_COOKIE, appOrigin, decodeState, finishSignIn } from "@/lib/google/signin";

export const dynamic = "force-dynamic";

/** Google redirects here after the account chooser (authorized redirect URI of the OAuth client). */
export async function GET(request: NextRequest) {
  const origin = appOrigin(request.nextUrl.origin);
  const sp = request.nextUrl.searchParams;
  const saved = decodeState(request.cookies.get(SIGNIN_COOKIE)?.value);
  const done = (to: string) => {
    const res = NextResponse.redirect(new URL(to, origin));
    res.cookies.set(SIGNIN_COOKIE, "", { path: "/api/auth/google", maxAge: 0 });
    return res;
  };
  const fail = (message: string) => {
    const u = new URLSearchParams({ error: message });
    if (saved?.next && saved.next !== "/dashboard") u.set("next", saved.next);
    return done(`/login?${u}`);
  };
  if (sp.get("error")) return fail(sp.get("error") === "access_denied" ? "Google sign-in was cancelled." : `Google sign-in failed: ${sp.get("error")}`);
  const code = sp.get("code");
  const state = sp.get("state");
  if (!code || !state) return fail("Google sign-in returned no authorization code.");
  try {
    return done(await finishSignIn(request.nextUrl.origin, code, state, saved));
  } catch (e) {
    return fail(e instanceof AppError ? e.message : "Google sign-in failed. Try again.");
  }
}
