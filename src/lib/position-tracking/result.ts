import { AppError } from "@/lib/domain";

export type ActionResult<T = null> = { ok: true; data: T } | { ok: false; error: string };

/** Maps thrown errors to a user-facing action result (AppError / zod messages pass through). */
export function failure(e: unknown): { ok: false; error: string } {
  if (e instanceof AppError) return { ok: false, error: e.message };
  if (e && typeof e === "object" && "issues" in e) return { ok: false, error: (e as { issues: { message: string }[] }).issues[0]?.message ?? "Invalid input." };
  console.error("[position-tracking]", e);
  return { ok: false, error: "Something went wrong. Please try again." };
}
