"use server";

import { revalidatePath } from "next/cache";
import { actionError, type ActionResult } from "@/app/(app)/projects/actions";
import { requireUser } from "@/lib/auth";
import { brandUser } from "@/lib/cx/inbox/guard";
import type { InboxPrefs } from "@/lib/cx/inbox/model";
import { savePrefs } from "@/lib/cx/inbox/settings";
import { getSignature, saveSignature } from "@/lib/cx/inbox/workspace";
import type { NotifyPrefs } from "@/lib/cx/ops/model";
import { saveNotifyPrefs, updateUserName } from "@/lib/cx/ops/profile";

export async function updateNameAction(name: string): Promise<ActionResult<{ name: string }>> {
  try {
    const user = await requireUser();
    const clean = await updateUserName(user.id, String(name ?? ""));
    revalidatePath("/", "layout");
    return { ok: true, data: { name: clean } };
  } catch (e) {
    return actionError(e);
  }
}

/** Save the signed-in user's email signature for a brand; an existing signature image is kept as is. */
export async function saveSignatureAction(brandId: string, input: { body: string; enabled: boolean }): Promise<ActionResult<null>> {
  try {
    const { user, project } = await brandUser(brandId, { write: false });
    const cur = await getSignature(project.id, user.id);
    await saveSignature(project.id, user.id, { body: String(input.body ?? "").slice(0, 2000), imageFileId: cur.imageFileId, enabled: !!input.enabled });
    revalidatePath("/cx/profile");
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
}

export async function saveNotifyAction(patch: Partial<NotifyPrefs>): Promise<ActionResult<NotifyPrefs>> {
  try {
    const user = await requireUser();
    return { ok: true, data: await saveNotifyPrefs(user.id, patch ?? {}) };
  } catch (e) {
    return actionError(e);
  }
}

/** Inbox preferences editable from My Profile (sound alerts, Enter to send). */
export async function saveInboxPrefsAction(patch: Partial<Pick<InboxPrefs, "soundNewTicket" | "soundNewMessage" | "enterToSend">>): Promise<ActionResult<null>> {
  try {
    const user = await requireUser();
    const clean: Partial<InboxPrefs> = {};
    for (const k of ["soundNewTicket", "soundNewMessage", "enterToSend"] as const) if (typeof patch?.[k] === "boolean") clean[k] = patch[k];
    await savePrefs(user.id, clean);
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
}
