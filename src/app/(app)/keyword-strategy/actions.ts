"use server";

import { revalidatePath } from "next/cache";
import { actionError } from "@/app/(app)/projects/actions";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/domain";
import { ideaPool, selectIdeas } from "@/lib/keywords/ideas";
import { addToList, createList, deleteList, listLists, refreshList, removeFromList, renameList } from "@/lib/keywords/lists";
import { normalizeKw } from "@/lib/keywords/text";
import type { ActionResult, KeywordList } from "@/lib/keywords/types";

export async function listKeywordListsAction(): Promise<ActionResult<KeywordList[]>> {
  try {
    const user = await requireUser();
    return { ok: true, data: await listLists(user.id) };
  } catch (e) {
    return actionError(e);
  }
}

/** Creates a list (optionally with keywords) and returns its id. */
export async function createListAction(input: { name: string; db: string; keywords?: string[]; from?: string }): Promise<ActionResult<{ id: string; added: number; skipped: number }>> {
  try {
    const user = await requireUser();
    const id = await createList(user.id, String(input.name ?? ""), String(input.db ?? "US"));
    let added = 0,
      skipped = 0;
    if (input.keywords?.length) ({ added, skipped } = await addToList(user.id, id, input.keywords.map(String), String(input.from ?? "manual")));
    revalidatePath("/keyword-strategy");
    return { ok: true, data: { id, added, skipped } };
  } catch (e) {
    return actionError(e);
  }
}

export async function addKeywordsAction(listId: string, keywords: string[], from = "manual"): Promise<ActionResult<{ id: string; added: number; skipped: number }>> {
  try {
    const user = await requireUser();
    const res = await addToList(user.id, String(listId), (keywords ?? []).map(String), String(from));
    revalidatePath("/keyword-strategy");
    return { ok: true, data: { id: listId, ...res } };
  } catch (e) {
    return actionError(e);
  }
}

export async function removeKeywordsAction(listId: string, keywords: string[]): Promise<ActionResult<{ removed: number }>> {
  try {
    const user = await requireUser();
    const removed = await removeFromList(user.id, String(listId), (keywords ?? []).map(String));
    revalidatePath("/keyword-strategy");
    return { ok: true, data: { removed } };
  } catch (e) {
    return actionError(e);
  }
}

export async function renameListAction(listId: string, name: string): Promise<ActionResult<null>> {
  try {
    const user = await requireUser();
    await renameList(user.id, String(listId), String(name ?? ""));
    revalidatePath("/keyword-strategy");
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
}

export async function deleteListAction(listId: string): Promise<ActionResult<null>> {
  try {
    const user = await requireUser();
    await deleteList(user.id, String(listId));
    revalidatePath("/keyword-strategy");
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
}

export async function refreshListAction(listId: string): Promise<ActionResult<{ refreshed: number }>> {
  try {
    const user = await requireUser();
    const refreshed = await refreshList(user.id, String(listId));
    revalidatePath("/keyword-strategy");
    return { ok: true, data: { refreshed } };
  } catch (e) {
    return actionError(e);
  }
}

/** Creates a list from the top broad-match ideas of a seed keyword (by volume). */
export async function createListFromSeedAction(input: { seed: string; db: string; size: number }): Promise<ActionResult<{ id: string; added: number }>> {
  try {
    const user = await requireUser();
    const seed = normalizeKw(String(input.seed ?? ""));
    if (!seed || seed.length > 80 || !/[\p{L}\p{N}]/u.test(seed)) throw new AppError("Enter a seed keyword (up to 80 characters).");
    const size = [25, 50, 100, 200, 500].includes(Number(input.size)) ? Number(input.size) : 100;
    const pool = await ideaPool(user.id, seed, String(input.db ?? "US"));
    const ideas = selectIdeas(pool, "broad", false, size).rows.map((r) => r.keyword);
    if (!ideas.length) throw new AppError("No keyword ideas were found for that seed.");
    const id = await createList(user.id, seed, pool.db);
    const { added } = await addToList(user.id, id, ideas, "keyword-magic-tool");
    revalidatePath("/keyword-strategy");
    return { ok: true, data: { id, added } };
  } catch (e) {
    return actionError(e);
  }
}
