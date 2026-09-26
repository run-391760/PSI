import { randomBytes } from "node:crypto";
import { query } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { decryptSecret, encryptSecret } from "@/lib/secrets";

/**
 * Google OAuth 2.0 (web server flow) for Search Console and Analytics, read-only scopes.
 * Requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET from a Google Cloud "Web application" OAuth
 * client whose authorized redirect URI is `<APP_ORIGIN>/api/integrations/google/callback`.
 */
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/webmasters.readonly",
  "https://www.googleapis.com/auth/analytics.readonly",
];
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

export const googleConfigured = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

export function redirectUri(requestOrigin?: string) {
  const origin = (process.env.APP_ORIGIN || requestOrigin || "http://localhost:3200").replace(/\/$/, "");
  return `${origin}/api/integrations/google/callback`;
}

export type GoogleConnection = { email: string; scopes: string[]; connectedAt: string };

export async function getGoogleConnection(userId: string): Promise<GoogleConnection | null> {
  const [row] = await query<{ email: string; scopes: string; connected_at: Date | string }>("SELECT email,scopes,connected_at FROM google_connections WHERE user_id=$1", [userId]);
  return row ? { email: row.email, scopes: row.scopes.split(" ").filter(Boolean), connectedAt: new Date(row.connected_at).toISOString() } : null;
}

/** Start the consent flow: returns the Google URL to redirect the user to. */
export async function startGoogleAuth(userId: string, returnTo: string, requestOrigin?: string) {
  if (!googleConfigured()) throw new AppError("Google is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the server.", 503);
  const state = randomBytes(24).toString("hex");
  await query("DELETE FROM oauth_states WHERE created_at < now() - interval '1 hour'");
  await query("INSERT INTO oauth_states(state,user_id,provider,return_to) VALUES($1,$2,'google',$3)", [state, userId, safeReturn(returnTo)]);
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(requestOrigin),
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${params}`;
}

const safeReturn = (p: string) => (p.startsWith("/") && !p.startsWith("//") ? p : "/settings?tab=integrations");

async function tokenRequest(body: Record<string, string>) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, ...body }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; refresh_token?: string; scope?: string; id_token?: string; error?: string; error_description?: string };
  return { ok: res.ok, data };
}

/** Handle the redirect back from Google. Verifies state belongs to the signed-in user. */
export async function finishGoogleAuth(userId: string, code: string, state: string, requestOrigin?: string) {
  const [row] = await query<{ user_id: string; return_to: string }>(
    "DELETE FROM oauth_states WHERE state=$1 AND provider='google' AND created_at > now() - interval '15 minutes' RETURNING user_id, return_to",
    [state],
  );
  if (!row || row.user_id !== userId) throw new AppError("The Google sign-in link expired or was not started from this account. Try connecting again.", 400);
  const { ok, data } = await tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri(requestOrigin) });
  if (!ok || !data.access_token) throw new AppError(`Google did not accept the sign-in: ${data.error_description ?? data.error ?? "unknown error"}.`, 502);
  let refresh = data.refresh_token;
  if (!refresh) {
    // Google only returns a refresh token on first consent; keep the stored one when reconnecting.
    const [existing] = await query<{ refresh_token_enc: string }>("SELECT refresh_token_enc FROM google_connections WHERE user_id=$1", [userId]);
    if (!existing) throw new AppError("Google did not return offline access. Remove SynapseSEO from your Google account permissions and connect again.", 502);
    refresh = decryptSecret(existing.refresh_token_enc);
  }
  // The ID token comes straight from Google's token endpoint over TLS, so reading its payload is safe.
  let email = "";
  try {
    email = JSON.parse(Buffer.from((data.id_token ?? "").split(".")[1] ?? "", "base64url").toString("utf8")).email ?? "";
  } catch {
    /* email is informational only */
  }
  await query(
    `INSERT INTO google_connections(user_id,email,scopes,refresh_token_enc,access_token_enc,access_expires_at,connected_at)
     VALUES($1,$2,$3,$4,$5,now() + ($6 * interval '1 second'),now())
     ON CONFLICT(user_id) DO UPDATE SET email=excluded.email, scopes=excluded.scopes, refresh_token_enc=excluded.refresh_token_enc,
       access_token_enc=excluded.access_token_enc, access_expires_at=excluded.access_expires_at, connected_at=now()`,
    [userId, email, data.scope ?? GOOGLE_SCOPES.join(" "), encryptSecret(refresh), encryptSecret(data.access_token), Math.max(60, (data.expires_in ?? 3600) - 60)],
  );
  return row.return_to;
}

/** A valid access token, refreshed when needed. Revoked access removes the connection. */
export async function googleAccessToken(userId: string, forceRefresh = false) {
  const [row] = await query<{ refresh_token_enc: string; access_token_enc: string | null; valid: boolean }>(
    "SELECT refresh_token_enc, access_token_enc, (access_expires_at > now()) AS valid FROM google_connections WHERE user_id=$1",
    [userId],
  );
  if (!row) throw new AppError("Connect your Google account first.", 409);
  if (!forceRefresh && row.valid && row.access_token_enc) return decryptSecret(row.access_token_enc);
  const { ok, data } = await tokenRequest({ refresh_token: decryptSecret(row.refresh_token_enc), grant_type: "refresh_token" });
  if (!ok || !data.access_token) {
    if (data.error === "invalid_grant") {
      await query("DELETE FROM google_connections WHERE user_id=$1", [userId]);
      throw new AppError("Google access was revoked or expired. Connect your Google account again.", 409);
    }
    throw new AppError(`Could not refresh Google access: ${data.error_description ?? data.error ?? "unknown error"}.`, 502);
  }
  await query("UPDATE google_connections SET access_token_enc=$2, access_expires_at=now() + ($3 * interval '1 second') WHERE user_id=$1", [
    userId,
    encryptSecret(data.access_token),
    Math.max(60, (data.expires_in ?? 3600) - 60),
  ]);
  return data.access_token;
}

/** Authorized JSON request to a Google API (retries once after a token refresh on 401). */
export async function googleApi<T = Record<string, any>>(userId: string, url: string, body?: unknown): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await googleAccessToken(userId, attempt > 0);
    const res = await fetch(url, {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 401 && attempt === 0) continue;
    const data = (await res.json().catch(() => ({}))) as Record<string, any>;
    if (!res.ok) {
      const msg = data?.error?.message ?? `HTTP ${res.status}`;
      if (res.status === 403) throw new AppError(`Google denied access: ${msg}`, 403);
      if (res.status === 429) throw new AppError(`Google API quota reached: ${msg}`, 429);
      throw new AppError(`Google API error (${res.status}): ${msg}`, 502);
    }
    return data as T;
  }
  throw new AppError("Google rejected the access token. Connect your Google account again.", 401);
}

export async function disconnectGoogle(userId: string) {
  const [row] = await query<{ refresh_token_enc: string }>("DELETE FROM google_connections WHERE user_id=$1 RETURNING refresh_token_enc", [userId]);
  if (!row) return;
  try {
    await fetch(`${REVOKE_URL}?token=${encodeURIComponent(decryptSecret(row.refresh_token_enc))}`, { method: "POST", signal: AbortSignal.timeout(10_000) });
  } catch {
    /* the local connection is removed either way */
  }
}
