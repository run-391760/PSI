import { AppError } from "@/lib/domain";

export type ActionResult<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

/** Map an error thrown inside a server action to a user-facing message. */
export function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof AppError) return { ok: false, error: e.message };
  if (e && typeof e === "object" && "issues" in e) return { ok: false, error: (e as { issues: { message: string }[] }).issues[0]?.message ?? "Invalid input." };
  console.error("[content]", e);
  return { ok: false, error: "Something went wrong. Please try again." };
}
