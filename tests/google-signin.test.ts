import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

process.env.GOOGLE_CLIENT_ID = "client-123.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "secret";
const g = await import("../src/lib/google/signin");

const jwt = (claims: Record<string, unknown>) => `${Buffer.from('{"alg":"RS256"}').toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;
const NOW = 1_800_000_000;
const good = { iss: "https://accounts.google.com", aud: "client-123.apps.googleusercontent.com", exp: NOW + 600, nonce: "n1", sub: "42", email: "Staff@ParulUniversity.ac.in", email_verified: true, name: "Staff Member" };
const opts = { clientId: "client-123.apps.googleusercontent.com", nonce: "n1", now: NOW };

test("id token: valid claims give a lower-cased verified identity", () => {
  assert.deepEqual(g.identityFromIdToken(jwt(good), opts), { sub: "42", email: "staff@paruluniversity.ac.in", name: "Staff Member" });
});

test("id token: rejects wrong audience, issuer, expiry, nonce and unverified email", () => {
  assert.throws(() => g.identityFromIdToken(jwt({ ...good, aud: "other-app" }), opts), /different app/);
  assert.throws(() => g.identityFromIdToken(jwt({ ...good, iss: "https://evil.example" }), opts), /not issued by Google/);
  assert.throws(() => g.identityFromIdToken(jwt({ ...good, exp: NOW - 3600 }), opts), /expired/);
  assert.throws(() => g.identityFromIdToken(jwt({ ...good, nonce: "replayed" }), opts), /could not be verified/);
  assert.throws(() => g.identityFromIdToken(jwt({ ...good, email_verified: false }), opts), /not verified/);
  assert.throws(() => g.identityFromIdToken("garbage", opts), /invalid sign-in token/);
});

test("safeNext only allows same-site paths", () => {
  assert.equal(g.safeNext("/cx/ask?brand=1"), "/cx/ask?brand=1");
  assert.equal(g.safeNext("//evil.example"), "/dashboard");
  assert.equal(g.safeNext("/\\evil.example"), "/dashboard");
  assert.equal(g.safeNext("https://evil.example"), "/dashboard");
  assert.equal(g.safeNext(undefined), "/dashboard");
});

test("new accounts: allowed domains always; otherwise only when sign-ups are open", () => {
  const prod = { NODE_ENV: "production", ALLOW_SIGNUPS: "false", GOOGLE_SIGNUP_DOMAINS: "paruluniversity.ac.in, @pu.example" };
  assert.equal(g.canCreateAccount("a@paruluniversity.ac.in", prod), true);
  assert.equal(g.canCreateAccount("a@pu.example", prod), true);
  assert.equal(g.canCreateAccount("a@gmail.com", prod), false);
  assert.equal(g.canCreateAccount("a@gmail.com", { NODE_ENV: "production", ALLOW_SIGNUPS: "true" }), true);
  assert.equal(g.canCreateAccount("a@gmail.com", { NODE_ENV: "development" }), true);
});

test("start: PKCE S256 challenge, state and nonce in the URL; cookie round-trips", () => {
  const { url, cookie } = g.startSignIn("http://127.0.0.1:3200", "/cx/ask");
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(u.searchParams.get("client_id"), "client-123.apps.googleusercontent.com");
  assert.equal(u.searchParams.get("scope"), "openid email profile");
  assert.equal(u.searchParams.get("state"), cookie.state);
  assert.equal(u.searchParams.get("nonce"), cookie.nonce);
  assert.equal(u.searchParams.get("code_challenge"), createHash("sha256").update(cookie.verifier).digest("base64url"));
  assert.equal(u.searchParams.get("redirect_uri")?.endsWith("/api/auth/google/callback"), true);
  assert.equal(cookie.next, "/cx/ask");
  assert.deepEqual(g.decodeState(g.encodeState(cookie)), cookie);
  assert.equal(g.decodeState("not-base64-json"), null);
  assert.equal(g.decodeState(g.encodeState({ ...cookie, next: "//evil.example" }))?.next, "/dashboard");
});
