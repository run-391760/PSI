"use server";

import { revalidatePath } from "next/cache";
import { actionError, type ActionResult } from "@/app/(app)/projects/actions";
import { addContactNote, deleteContact, deleteContactNote, mergeContacts, updateContact } from "@/lib/cx/inbox/contacts";
import { brandUser } from "@/lib/cx/inbox/guard";

async function run<T>(brand: string, fn: (user: { id: string; name: string }) => Promise<T>): Promise<ActionResult<T>> {
  try {
    const { user } = await brandUser(brand);
    const data = await fn(user);
    revalidatePath("/cx/contacts", "layout");
    return { ok: true, data };
  } catch (e) {
    return actionError(e);
  }
}
export const updateContactAction = async (brand: string, id: string, p: Parameters<typeof updateContact>[2]) => run(brand, () => updateContact(brand, id, p));
export const addNoteAction = async (brand: string, id: string, body: string) => run(brand, (u) => addContactNote(brand, id, u, body));
export const deleteNoteAction = async (brand: string, noteId: string) => run(brand, () => deleteContactNote(brand, noteId));
export const mergeContactsAction = async (brand: string, targetId: string, sourceIds: string[]) => run(brand, () => mergeContacts(brand, targetId, sourceIds));
export const deleteContactAction = async (brand: string, id: string) => run(brand, () => deleteContact(brand, id));
