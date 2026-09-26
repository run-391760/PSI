"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { setPrefs } from "@/lib/reports/platform";
import { actionError, type ActionResult } from "../projects/actions";

/** Hide (or show again) the Home onboarding checklist. */
export async function setOnboardingHiddenAction(hidden: boolean): Promise<ActionResult<null>> {
  try {
    const user = await requireUser();
    await setPrefs(user.id, { onboardingHidden: hidden });
    revalidatePath("/dashboard");
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
}
