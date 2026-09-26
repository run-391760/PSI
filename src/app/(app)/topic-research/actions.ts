"use server";

import { revalidatePath } from "next/cache";
import { actionError } from "@/app/(app)/projects/actions";
import { requireUser } from "@/lib/auth";
import { removeFavorite, toggleFavorite } from "@/lib/keywords/topics";
import type { ActionResult } from "@/lib/keywords/types";

export async function toggleFavoriteAction(input: { topic: string; db: string; kind: string; text: string; subtopic?: string }): Promise<ActionResult<{ saved: boolean }>> {
  try {
    const user = await requireUser();
    const saved = await toggleFavorite(user.id, {
      topic: String(input.topic ?? ""),
      db: String(input.db ?? "US"),
      kind: String(input.kind ?? ""),
      text: String(input.text ?? ""),
      subtopic: input.subtopic == null ? "" : String(input.subtopic),
    });
    revalidatePath("/topic-research");
    return { ok: true, data: { saved } };
  } catch (e) {
    return actionError(e);
  }
}

export async function removeFavoriteAction(id: string): Promise<ActionResult<null>> {
  try {
    const user = await requireUser();
    await removeFavorite(user.id, String(id));
    revalidatePath("/topic-research");
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
}
