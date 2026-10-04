"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { actionError, type ActionResult } from "@/app/(app)/projects/actions";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/domain";
import { requireBrand, type Access } from "@/lib/cx/publishing/data";
import { createTest, declareWinner, deleteTest, endTest, startTest, type CreateResult } from "@/lib/cx/ops/ab";
import type { AbInput } from "@/lib/cx/ops/ab-model";

type U = { id: string; name: string; email: string };

async function origin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

/** Signed-in author on the brand (publishing roles apply: viewers are read-only). */
async function run<T>(brandId: string, fn: (a: Access, u: U) => Promise<T>): Promise<ActionResult<T>> {
  try {
    const user = await requireUser();
    const access = await requireBrand(user.id, brandId, "author");
    const data = await fn(access, { id: user.id, name: user.name || user.email, email: user.email });
    revalidatePath("/cx/ab-testing", "layout");
    revalidatePath("/cx/publishing", "layout");
    return { ok: true, data };
  } catch (e) {
    if (!(e instanceof AppError) && e instanceof Error && /URL|http/.test(e.message)) return { ok: false, error: e.message };
    return actionError(e);
  }
}

export async function createAbTestAction(brandId: string, input: AbInput): Promise<ActionResult<CreateResult>> {
  return run(brandId, async (a, u) => createTest(a, u, input, await origin()));
}
export async function startAbTestAction(brandId: string, id: string, mode: "publish" | "schedule", at: string | null): Promise<ActionResult<{ pendingApproval: boolean }>> {
  return run(brandId, (a, u) => startTest(a, u, id, mode, at));
}
export async function declareWinnerAction(brandId: string, id: string, choice: "winner" | "none"): Promise<ActionResult<"a" | "b" | "none">> {
  return run(brandId, (a) => declareWinner(a.brand.id, id, choice));
}
export async function endAbTestAction(brandId: string, id: string): Promise<ActionResult<void>> {
  return run(brandId, (a) => endTest(a.brand.id, id));
}
export async function deleteAbTestAction(brandId: string, id: string): Promise<ActionResult<void>> {
  return run(brandId, (a) => deleteTest(a.brand.id, id));
}
