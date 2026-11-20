import { NextResponse, type NextRequest } from "next/server";
import { SIGNIN_COOKIE, appOrigin, encodeState, googleSignInEnabled, startSignIn } from "@/lib/google/signin";

export const dynamic = "force-dynamic";

/** "Continue with Google": remember state/PKCE/nonce in a 10-minute httpOnly cookie and go to Google. */
export async function GET(request: NextRequest) {
  const origin = appOrigin(request.nextUrl.origin);
  if (!googleSignInEnabled()) return NextResponse.redirect(new URL("/login?error=google_off", origin));
  // The cookie must be set on the host Google returns to (APP_ORIGIN). Opened on another host name
  // (e.g. 127.0.0.1 vs localhost)? Restart there once; `hop` prevents a redirect loop behind proxies.
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";
  if (host && host !== new URL(origin).host && !request.nextUrl.searchParams.has("hop")) {
    const again = new URL("/api/auth/google/start", origin);
    request.nextUrl.searchParams.forEach((v, k) => again.searchParams.set(k, v));
    again.searchParams.set("hop", "1");
    return NextResponse.redirect(again);
  }
  const { url, cookie } = startSignIn(request.nextUrl.origin, request.nextUrl.searchParams.get("next"));
  const res = NextResponse.redirect(url);
  res.cookies.set(SIGNIN_COOKIE, encodeState(cookie), {
    httpOnly: true,
    secure: origin.startsWith("https://"),
    sameSite: "lax",
    path: "/api/auth/google",
    maxAge: 600,
  });
  return res;
}
