import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { query } from "./db";
import { AppError } from "./domain";

/** Name of the httpOnly session cookie. */
export const SESSION_COOKIE = "synapse_session";
const COOKIE = SESSION_COOKIE;
export type User = { id: string; email: string; name: string; monthly_budget_micros: string };

export const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
export function verifyPassword(password: string, encoded: string) {
  const [salt, stored] = encoded.split(":");
  const derived = scryptSync(password, salt, 64);
  const expected = Buffer.from(stored, "hex");
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

export async function rateLimit(key: string, limit: number, seconds = 60) {
  const [row] = await query<{ hits: number }>(
    `INSERT INTO rate_limits(key,hits,reset_at) VALUES($1,1,now()+($2 * interval '1 second'))
     ON CONFLICT(key) DO UPDATE SET
       hits=CASE WHEN rate_limits.reset_at<now() THEN 1 ELSE rate_limits.hits+1 END,
       reset_at=CASE WHEN rate_limits.reset_at<now() THEN excluded.reset_at ELSE rate_limits.reset_at END
     RETURNING hits`,
    [key, seconds],
  );
  if (row.hits > limit) throw new AppError("Too many requests. Please try again later.", 429);
}

export async function setSession(userId: string) {
  const token = randomBytes(32).toString("hex");
  await query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '30 days')", [hash(token), userId]);
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.APP_ORIGIN?.startsWith("https://") ?? false,
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 86400,
  });
}

/** The signed-in user, memoized per request. */
export const currentUser = cache(async (): Promise<User | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const [user] = await query<User>(
    `SELECT u.id,u.email,u.name,u.monthly_budget_micros FROM sessions s JOIN users u ON u.id=s.user_id
     WHERE s.token_hash=$1 AND s.expires_at>now()`,
    [hash(token)],
  );
  return user ?? null;
});

/** For route handlers and server actions: throws 401. */
export async function requireUser() {
  const user = await currentUser();
  if (!user) throw new AppError("Sign in to continue.", 401);
  return user;
}
/** For pages and layouts: redirects to /login. */
export async function requirePageUser() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

export async function logout() {
  const cookie = (await cookies()).get(COOKIE);
  if (cookie) await query("DELETE FROM sessions WHERE token_hash=$1", [hash(cookie.value)]);
  (await cookies()).delete(COOKIE);
}

export async function register(email: string, password: string, name: string, invite?: string) {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.ALLOW_SIGNUPS !== "true" &&
    (!process.env.SIGNUP_INVITE_CODE || invite !== process.env.SIGNUP_INVITE_CODE)
  )
    throw new AppError("An invitation code is required to sign up.", 403);
  const id = randomUUID();
  const inserted = await query(
    "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4) ON CONFLICT(email) DO NOTHING RETURNING id",
    [id, email, name, passwordHash(password)],
  );
  if (!inserted.length) throw new AppError("That email is already registered. Try signing in.", 409);
  await setSession(id);
  return id;
}

export async function login(email: string, password: string) {
  const [user] = await query<{ id: string; password_hash: string }>("SELECT id,password_hash FROM users WHERE email=$1", [email]);
  if (!user || !verifyPassword(password, user.password_hash)) throw new AppError("Email or password is incorrect.", 401);
  await setSession(user.id);
  return user.id;
}
