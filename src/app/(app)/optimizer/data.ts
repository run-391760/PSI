import "server-only";
import { requirePageUser } from "@/lib/auth";
import { aiAvailable } from "@/lib/optimizer/ai";
import { aiFresh, findDraft, getBundle, listDrafts, listRevisions, otherDrafts, reportFor } from "@/lib/optimizer/store";
import { migrateWritingDocuments } from "@/lib/optimizer/migrate";
import { liveEnabled } from "@/lib/providers/source";

/** Everything an optimizer page needs: the user's drafts, the open draft (?doc= or the latest), its research and report. */
export async function loadOptimizer(sp: Record<string, string | string[] | undefined>, opts: { revisions?: boolean } = {}) {
  const user = await requirePageUser();
  // Writing Assistant documents (a retired duplicate tool) become optimizer drafts the first time they are seen.
  await migrateWritingDocuments(user.id).catch((e) => console.error("[optimizer] writing assistant migration", e));
  const drafts = await listDrafts(user.id);
  const wanted = typeof sp.doc === "string" ? sp.doc : null;
  const draft = (await findDraft(user.id, wanted)) ?? (drafts[0] ? await findDraft(user.id, drafts[0].id) : null);
  const flags = { aiOn: aiAvailable(), serpOn: liveEnabled() };
  if (!draft) return { user, drafts, draft: null, bundle: null, report: null, revisions: [], others: [], aiStale: false, missing: !!wanted, ...flags };
  const bundle = await getBundle(draft.id);
  const [report, revisions, others] = await Promise.all([reportFor(user.id, draft, bundle), opts.revisions ? listRevisions(user.id, draft.id) : Promise.resolve([]), otherDrafts(user.id, draft.id)]);
  return { user, drafts, draft, bundle, report, revisions, others, aiStale: !!bundle.ai && !aiFresh(bundle.ai, draft.body), missing: !!wanted && wanted !== draft.id, ...flags };
}

export type OptimizerData = Awaited<ReturnType<typeof loadOptimizer>>;
