"use server";

import { runOps } from "@/lib/cx/ops/run";
import { deleteBookmark, toggleBookmark, updateBookmarkNote } from "@/lib/cx/ops/bookmarks";

const PATHS = ["/cx/bookmarks", "/cx/inbox", "/cx/messages"];
/** Bookmarks are personal: viewers may bookmark too (write: false). */
export const toggleBookmarkAction = async (brand: string, input: { ticketId: string; messageId?: string | null; note?: string }) =>
  runOps(brand, (u) => toggleBookmark(brand, u.id, input), { write: false, paths: PATHS });
export const bookmarkNoteAction = async (brand: string, id: string, note: string) => runOps(brand, async (u) => { await updateBookmarkNote(brand, u.id, id, note); return null; }, { write: false, paths: PATHS });
export const deleteBookmarkAction = async (brand: string, id: string) => runOps(brand, async (u) => { await deleteBookmark(brand, u.id, id); return null; }, { write: false, paths: PATHS });
