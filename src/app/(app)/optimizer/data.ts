import "server-only";
import { requirePageUser } from "@/lib/auth";
import { aiAvailable } from "@/lib/optimizer/ai";
import { agentPlan } from "@/lib/optimizer/agents/llm";
import { latestDoneRun, latestRun } from "@/lib/optimizer/agents/store";
import type { AgentRunView } from "@/lib/optimizer/agents/types";
import { isStale, runFingerprint } from "@/lib/optimizer/agents/verify";
import { aiFresh, findDraft, getBundle, inputOf, listDrafts, listRevisions, otherDrafts, reportFor } from "@/lib/optimizer/store";
import type { Draft, Report, ResearchBundle } from "@/lib/optimizer/types";
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

/** The agent audit of a draft: the latest run (maybe in progress), the latest finished one, whether it is stale, and the plan for a new run. */
export async function loadAgentAudit(userId: string, draft: Draft, bundle: ResearchBundle, report?: Report) {
  const [latest, lastDone] = await Promise.all([latestRun(userId, draft.id), latestDoneRun(userId, draft.id)]);
  // Also stale when the engine now scores the draft differently (other drafts, the date), not only when the draft changed.
  const current = lastDone?.summary ? (report ?? (await reportFor(userId, draft, bundle))) : null;
  const stale = !!lastDone && isStale(lastDone.fingerprint, runFingerprint(inputOf(draft), bundle), lastDone.summary && current ? { run: lastDone.summary.engine, current } : undefined);
  return { latest, lastDone, stale, plan: agentPlan() };
}

export type AgentAuditData = Awaited<ReturnType<typeof loadAgentAudit>>;

/** What the score card needs to show the agent-verified values (null when there is no finished run). */
export function verifiedScore(a: AgentAuditData) {
  const run: AgentRunView | null = a.lastDone;
  if (!run?.summary) return null;
  // The recommendation the agents verified (runs before it was stored in summary.final kept the engine's ranking there).
  const top = run.items.find((i) => i.id === "top");
  const final = top ? { ...run.summary.final, topRecommendation: typeof top.final === "string" ? { feature: top.final, text: top.text ?? "" } : null } : run.summary.final;
  return { final, engineOverall: run.summary.engine.overall, confidence: run.summary.confidence, finishedAt: run.finishedAt ?? run.createdAt, stale: a.stale };
}
