import { createHash, randomBytes, randomUUID } from "node:crypto";
import { hash, passwordHash, rateLimit, setSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { oauthConfigured } from "./oauth";

/**
 * "Continue with Google" sign-in (OpenID Connect, authorization-code flow with PKCE + state + nonce).
 * Reuses the Search Console OAuth client (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET); add
 * `<APP_ORIGIN>/api/auth/google/callback` to that client's authorized redirect URIs.
 *
 * - An existing account signs in when Google confirms the same, verified email address.
 * - A new account is created only when sign-ups are open (ALLOW_SIGNUPS=true, or not production) or the
 *   email's domain is listed in GOOGLE_SIGNUP_DOMAINS (comma-separated, e.g. "paruluniversity.ac.in").
 */

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const SIGNIN_COOKIE = "synapse_google_signin";
export const googleSignInEnabled = () => oauthConfigured();

export const appOrigin = (requestOrigin: string) => (process.env.APP_ORIGIN || requestOrigin).replace(/\/$/, "");
export const signInRedirectUri = (requestOrigin: string) => `${appOrigin(requestOrigin)}/api/auth/google/callback`;
const b64url = (b: Buffer) => b.toString("base64url");

/** Where to go after sign-in: only same-site paths. */
export const safeNext = (next: unknown) => (typeof next === "string" && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next.slice(0, 500) : "/dashboard");

export const signupDomains = (env: Record<string, string | undefined> = process.env) => (env.GOOGLE_SIGNUP_DOMAINS ?? "").split(",").map((d) => d.trim().toLowerCase().replace(/^@/, "")).filter(Boolean);

/** May a brand-new account be created for this (Google-verified) email? */
export function canCreateAccount(email: string, env: Record<string, string | undefined> = process.env) {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  if (signupDomains(env).includes(domain)) return true;
  return env.NODE_ENV !== "production" || env.ALLOW_SIGNUPS === "true";
}

export type SignInState = { state: string; verifier: string; nonce: string; next: string };

/** Google authorization URL plus the secrets to keep in the short-lived httpOnly cookie. */
export function startSignIn(requestOrigin: string, next: unknown): { url: string; cookie: SignInState } {
  const cookie: SignInState = { state: b64url(randomBytes(24)), verifier: b64url(randomBytes(48)), nonce: b64url(randomBytes(24)), next: safeNext(next) };
  const domains = signupDomains();
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: signInRedirectUri(requestOrigin),
    response_type: "code",
    scope: "openid email profile",
    state: cookie.state,
    nonce: cookie.nonce,
    code_challenge: b64url(createHash("sha256").update(cookie.verifier).digest()),
    code_challenge_method: "S256",
    prompt: "select_account",
    ...(domains.length === 1 ? { hd: domains[0] } : {}),
  });
  return { url: `${AUTH_URL}?${params}`, cookie };
}

export const encodeState = (s: SignInState) => Buffer.from(JSON.stringify(s)).toString("base64url");
export function decodeState(raw: string | undefined): SignInState | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as SignInState;
    return s.state && s.verifier && s.nonce ? { ...s, next: safeNext(s.next) } : null;
  } catch {
    return null;
  }
}

export type GoogleIdentity = { sub: string; email: string; name: string };

/**
 * Validate the ID token's claims. The token comes straight from Google's token endpoint over TLS, so
 * per OpenID Connect Core 3.1.3.7 the claims are checked rather than the signature.
 */
export function identityFromIdToken(idToken: string, opts: { clientId: string; nonce: string; now?: number }): GoogleIdentity {
  const part = idToken.split(".")[1];
  if (!part) throw new AppError("Google returned an invalid sign-in token.", 502);
  let c: Record<string, unknown>;
  try {
    c = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    throw new AppError("Google returned an invalid sign-in token.", 502);
  }
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (!aud.includes(opts.clientId)) throw new AppError("This Google sign-in was issued for a different app.", 401);
  if (c.iss !== "https://accounts.google.com" && c.iss !== "accounts.google.com") throw new AppError("The sign-in token was not issued by Google.", 401);
  if (typeof c.exp !== "number" || c.exp < now - 60) throw new AppError("The Google sign-in expired. Try again.", 401);
  if (c.nonce !== opts.nonce) throw new AppError("The Google sign-in could not be verified. Try again.", 401);
  const email = typeof c.email === "string" ? c.email.trim().toLowerCase() : "";
  if (!email || (c.email_verified !== true && c.email_verified !== "true")) throw new AppError("Your Google account's email address is not verified.", 403);
  return { sub: String(c.sub ?? ""), email, name: typeof c.name === "string" ? c.name.slice(0, 80) : email.split("@")[0] };
}

/** Exchange the code, verify the identity, then sign in (or create) the user. Returns where to go next. */
export async function finishSignIn(requestOrigin: string, code: string, returnedState: string, saved: SignInState | null) {
  if (!googleSignInEnabled()) throw new AppError("Google sign-in is not configured.", 503);
  if (!saved || saved.state !== returnedState) throw new AppError("The Google sign-in expired or was started in another tab. Try again.", 400);
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri: signInRedirectUri(requestOrigin),
      grant_type: "authorization_code",
      code_verifier: saved.verifier,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string; error_description?: string };
  if (!res.ok || !data.id_token) throw new AppError(`Google sign-in failed: ${data.error_description ?? data.error ?? `HTTP ${res.status}`}.`, 502);
  const who = identityFromIdToken(data.id_token, { clientId: process.env.GOOGLE_CLIENT_ID ?? "", nonce: saved.nonce });
  await rateLimit(`login:${hash(who.email)}`, 10, 900);

  const [existing] = await query<{ id: string }>("SELECT id FROM users WHERE email=$1", [who.email]);
  if (existing) {
    await setSession(existing.id);
    return saved.next;
  }
  if (!canCreateAccount(who.email)) throw new AppError(`There is no account for ${who.email}. Ask an administrator to invite you, or sign in with your work account.`, 403);
  const id = randomUUID();
  // Google-only accounts get an unusable random password; they can always sign in with Google.
  const inserted = await query("INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4) ON CONFLICT(email) DO NOTHING RETURNING id", [id, who.email, who.name, passwordHash(b64url(randomBytes(32)))]);
  if (!inserted.length) {
    const [u] = await query<{ id: string }>("SELECT id FROM users WHERE email=$1", [who.email]);
    await setSession(u.id);
    return saved.next;
  }
  await setSession(id);
  return saved.next === "/dashboard" ? "/dashboard?welcome=1" : saved.next;
}
