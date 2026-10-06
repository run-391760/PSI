import type { DraftInput } from "./types";

/** Pure parts of the Writing Assistant → optimizer migration (see migrate.ts). */

export type WritingDoc = { id: string; title: string; body: string; keywords: string[] | null; settings: Record<string, unknown> | null; updated_at?: string | Date };

/**
 * Claim marker written before the draft exists, so two concurrent requests never migrate a document twice.
 * Stored as "pending:<iso time>"; a bare "pending" (older builds) counts as stale.
 */
export const MIGRATION_PENDING = "pending";
/** A claim older than this is treated as abandoned (the process died mid-migration) and may be taken over. */
export const MIGRATION_STALE_MS = 5 * 60_000;

const isPending = (v: unknown): v is string => typeof v === "string" && (v === MIGRATION_PENDING || v.startsWith(`${MIGRATION_PENDING}:`));

/** Claim marker for a migration starting now. Pure. */
export function pendingMarker(now: Date = new Date()) {
  return `${MIGRATION_PENDING}:${now.toISOString()}`;
}

/** The draft id recorded on a migrated document (null while not migrated or still being migrated). Pure. */
export function migratedDraftIdOf(settings: Record<string, unknown> | null | undefined): string | null {
  const v = settings?.migratedDraftId;
  return typeof v === "string" && v && !isPending(v) ? v : null;
}

/** True when a migration may start: never claimed, or claimed so long ago (or without a time) that the claim was abandoned. Pure. */
export function migrationClaimable(settings: Record<string, unknown> | null | undefined, now: number = Date.now()): boolean {
  const v = settings?.migratedDraftId;
  if (v == null) return true;
  if (!isPending(v)) return false;
  const at = Date.parse(v.slice(MIGRATION_PENDING.length + 1));
  return !Number.isFinite(at) || now - at > MIGRATION_STALE_MS;
}

/** Draft fields for a Writing Assistant document: first keyword is the primary, the rest are secondary. Pure. */
export function draftInputFromDoc(doc: WritingDoc): Partial<DraftInput> {
  const keywords = [...new Set((doc.keywords ?? []).map((k) => String(k).trim().toLowerCase()).filter(Boolean))];
  const db = typeof doc.settings?.db === "string" && /^[A-Za-z]{2,4}$/.test(doc.settings.db) ? doc.settings.db.toUpperCase() : undefined;
  const title = doc.title?.trim() && doc.title.trim() !== "Untitled document" ? doc.title.trim().slice(0, 300) : "";
  return {
    title,
    keyword: (keywords[0] ?? "").slice(0, 120),
    keywords: keywords.slice(1, 10).map((k) => k.slice(0, 120)),
    body: doc.body ?? "",
    meta: { ...(db ? { db } : {}), robots: "index, follow" },
  };
}
