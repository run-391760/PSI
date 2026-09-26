"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { hash, passwordHash, rateLimit, requireUser, SESSION_COOKIE, verifyPassword } from "@/lib/auth";
import { query } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { maxMonthlyUsd } from "@/lib/reports/platform";
import { actionError, type ActionResult } from "../projects/actions";

/** Session cookie name used by src/lib/auth.ts (not exported there). */

async function currentTokenHash() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? hash(token) : null;
}

async function checkPassword(userId: string, password: string) {
  const [row] = await query<{ password_hash: string }>("SELECT password_hash FROM users WHERE id=$1", [userId]);
  if (!row || !verifyPassword(password, row.password_hash)) throw new AppError("Your current password is incorrect.", 400);
}

export async function updateProfileAction(input: { name: string }): Promise<ActionResult<{ name: string }>> {
  try {
    const user = await requireUser();
    const name = z.string().trim().min(1, "Enter your name.").max(80, "Use at most 80 characters.").parse(input.name);
    await query("UPDATE users SET name=$2 WHERE id=$1", [user.id, name]);
    revalidatePath("/", "layout");
    return { ok: true, data: { name } };
  } catch (e) {
    return actionError(e);
  }
}

const passwordInput = z
  .object({
    current: z.string().min(1, "Enter your current password.").max(128),
    next: z.string().min(10, "Use at least 10 characters for the new password.").max(128, "Use at most 128 characters."),
    confirm: z.string().max(128),
    signOutOthers: z.boolean().default(true),
  })
  .refine((v) => v.next === v.confirm, { message: "The new passwords do not match.", path: ["confirm"] })
  .refine((v) => v.next !== v.current, { message: "Choose a password different from the current one.", path: ["next"] });

export async function changePasswordAction(input: z.input<typeof passwordInput>): Promise<ActionResult<{ signedOut: number }>> {
  try {
    const user = await requireUser();
    const v = passwordInput.parse(input);
    await rateLimit(`password:${user.id}`, 5, 900);
    await checkPassword(user.id, v.current);
    await query("UPDATE users SET password_hash=$2 WHERE id=$1", [user.id, passwordHash(v.next)]);
    let signedOut = 0;
    if (v.signOutOthers) {
      const current = await currentTokenHash();
      const rows = await query("DELETE FROM sessions WHERE user_id=$1 AND token_hash<>$2 RETURNING token_hash", [user.id, current ?? ""]);
      signedOut = rows.length;
    }
    return { ok: true, data: { signedOut } };
  } catch (e) {
    return actionError(e);
  }
}

export async function signOutOtherSessionsAction(): Promise<ActionResult<{ signedOut: number }>> {
  try {
    const user = await requireUser();
    const current = await currentTokenHash();
    const rows = await query("DELETE FROM sessions WHERE user_id=$1 AND token_hash<>$2 RETURNING token_hash", [user.id, current ?? ""]);
    revalidatePath("/settings");
    return { ok: true, data: { signedOut: rows.length } };
  } catch (e) {
    return actionError(e);
  }
}

export async function updateBudgetAction(input: { usd: number }): Promise<ActionResult<{ usd: number }>> {
  try {
    const user = await requireUser();
    const cap = maxMonthlyUsd();
    const usd = z
      .number({ error: "Enter an amount in USD." })
      .min(0, "The budget can't be negative.")
      .max(cap, `The deployment allows at most $${cap} per user per month (MAX_MONTHLY_API_USD).`)
      .parse(input.usd);
    const micros = Math.round(usd * 100) * 10000;
    await query("UPDATE users SET monthly_budget_micros=$2 WHERE id=$1", [user.id, micros]);
    revalidatePath("/settings");
    revalidatePath("/activity");
    return { ok: true, data: { usd: micros / 1e6 } };
  } catch (e) {
    return actionError(e);
  }
}

/** Permanently deletes the account and all of its data (projects, reports, jobs, usage). */
export async function deleteAccountAction(input: { email: string; password: string }): Promise<ActionResult<null>> {
  try {
    const user = await requireUser();
    if (String(input.email || "").trim().toLowerCase() !== user.email.toLowerCase()) throw new AppError("Type your account email exactly to confirm.");
    await rateLimit(`delete-account:${user.id}`, 5, 900);
    await checkPassword(user.id, String(input.password || ""));
    await query("DELETE FROM users WHERE id=$1", [user.id]);
    (await cookies()).delete(SESSION_COOKIE);
  } catch (e) {
    return actionError(e);
  }
  redirect("/register");
}
