"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { requireUser } from "@/lib/auth";
import { getCxBrand } from "@/lib/cx/context";
import { actionError, type ActionResult } from "@/app/(app)/projects/actions";
import { deleteArticle, deleteCategory, saveArticle, saveCategory, searchKb, type articleInput, type KbHit } from "@/lib/cx/insights/kb";

async function brand(projectId: string, write = true) {
  const user = await requireUser();
  await getCxBrand(user.id, projectId, { write });
  return user;
}
const done = () => revalidatePath("/cx/knowledge");

export async function saveArticleAction(projectId: string, input: z.input<typeof articleInput>, id?: string): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await brand(projectId);
    const aid = await saveArticle(projectId, user.id, input, id);
    done();
    return { ok: true, data: { id: aid } };
  } catch (e) {
    return actionError(e);
  }
}
export async function deleteArticleAction(projectId: string, id: string): Promise<ActionResult<null>> {
  try {
    await brand(projectId);
    await deleteArticle(projectId, id);
    done();
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
}
export async function saveCategoryAction(projectId: string, input: { id?: string; name: string; parent_id?: string | null }): Promise<ActionResult<{ id: string }>> {
  try {
    await brand(projectId);
    const id = await saveCategory(projectId, input);
    done();
    return { ok: true, data: { id } };
  } catch (e) {
    return actionError(e);
  }
}
export async function deleteCategoryAction(projectId: string, id: string): Promise<ActionResult<null>> {
  try {
    await brand(projectId);
    await deleteCategory(projectId, id);
    done();
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
}
/** Ranked search over published articles (same ranking AI grounding uses). */
export async function searchKbAction(projectId: string, q: string): Promise<ActionResult<KbHit[]>> {
  try {
    await brand(projectId, false);
    return { ok: true, data: await searchKb(projectId, q.slice(0, 300), 10) };
  } catch (e) {
    return actionError(e);
  }
}
