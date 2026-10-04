"use server";

import { requireUser } from "@/lib/auth";
import { normalizePatch } from "./prefs-logic";
import { saveUiPrefs } from "./prefs";

/** Persist part of the signed-in user's UI preferences (focus, density, collapsed, nav, panels). */
export async function saveUiPrefsAction(patch: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const user = await requireUser();
    const clean = normalizePatch(patch);
    if (!Object.keys(clean).length) return { ok: false, error: "Nothing to save." };
    await saveUiPrefs(user.id, clean);
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Couldn't save your display preferences." };
  }
}
