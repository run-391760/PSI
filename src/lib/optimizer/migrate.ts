import { query } from "@/lib/db";
import { draftInputFromDoc, migratedDraftIdOf, migrationClaimable, pendingMarker, type WritingDoc } from "./migrate-doc";
import { createDraft } from "./store";
export { draftInputFromDoc, migratedDraftIdOf, type WritingDoc } from "./migrate-doc";

/**
 * One-time migration of SEO Writing Assistant documents (content_documents) into optimizer drafts.
 * The Writing Assistant was folded into the Pre-Publish Optimizer; each document becomes one draft
 * exactly once, and the new draft id is recorded in the document's settings (settings.migratedDraftId).
 * The documents table is left in place so old links keep resolving. Server-only.
 */

/**
 * Compare-and-swap the claim marker: succeeds only while migratedDraftId still holds the value this request
 * read (unset, or an abandoned "pending" claim), so two concurrent requests cannot both claim the document.
 */
async function claim(ownerId: string, docId: string, seen: unknown, marker: string) {
  const rows = await query<{ id: string }>(
    "UPDATE content_documents SET settings = COALESCE(settings,'{}'::jsonb) || jsonb_build_object('migratedDraftId', $3::text) WHERE id=$1 AND owner_id=$2 AND (settings->>'migratedDraftId') IS NOT DISTINCT FROM $4::text RETURNING id",
    [docId, ownerId, marker, typeof seen === "string" ? seen : null],
  );
  return rows.length > 0;
}

/** Record the migrated draft id on the document. Direct jsonb update: the documents zod schema strips unknown keys. */
async function setMigrated(ownerId: string, docId: string, draftId: string) {
  await query("UPDATE content_documents SET settings = COALESCE(settings,'{}'::jsonb) || jsonb_build_object('migratedDraftId', $3::text) WHERE id=$1 AND owner_id=$2", [docId, ownerId, draftId]);
}

/** Release this request's claim (only if it is still ours) so a later visit can retry. */
async function release(ownerId: string, docId: string, marker: string) {
  await query("UPDATE content_documents SET settings = settings - 'migratedDraftId' WHERE id=$1 AND owner_id=$2 AND (settings->>'migratedDraftId') = $3", [docId, ownerId, marker]);
}

/**
 * Migrate every not-yet-migrated document of the owner (oldest edit first, so the most recently edited
 * document becomes the newest draft). Returns docId → draftId for all migrated documents, old and new.
 */
export async function migrateWritingDocuments(ownerId: string): Promise<Map<string, string>> {
  const rows = await query<WritingDoc>("SELECT id,title,body,keywords,settings,updated_at FROM content_documents WHERE owner_id=$1 ORDER BY updated_at ASC", [ownerId]);
  const out = new Map<string, string>();
  for (const doc of rows) {
    const done = migratedDraftIdOf(doc.settings);
    if (done) {
      out.set(doc.id, done);
      continue;
    }
    // Skip documents another request is migrating right now; an abandoned claim is taken over once stale.
    if (!migrationClaimable(doc.settings)) continue;
    const marker = pendingMarker();
    if (!(await claim(ownerId, doc.id, doc.settings?.migratedDraftId, marker))) continue;
    let draftId: string;
    try {
      draftId = (await createDraft(ownerId, draftInputFromDoc(doc))).id;
    } catch (e) {
      // e.g. the 500-draft limit: no draft exists, so release the claim and let a later visit retry.
      await release(ownerId, doc.id, marker).catch(() => {});
      console.error(`[optimizer] Writing Assistant document ${doc.id} was not migrated:`, e instanceof Error ? e.message : e);
      continue;
    }
    // The draft exists now: never release the claim from here (a retry would create a second draft).
    out.set(doc.id, draftId);
    for (let attempt = 1; ; attempt++) {
      try {
        await setMigrated(ownerId, doc.id, draftId);
        break;
      } catch (e) {
        if (attempt < 3) continue;
        console.error(`[optimizer] Writing Assistant document ${doc.id} was migrated to draft ${draftId}, but recording it failed:`, e instanceof Error ? e.message : e);
        break;
      }
    }
  }
  return out;
}
