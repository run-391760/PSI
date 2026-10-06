import type { z } from "zod";
import { aggregate, recommendable, STATUS_LABEL } from "../analyze";
import { CATEGORIES, CHECKS, featureById } from "../features";
import type { DraftInput, Finding, Report, Research, Severity } from "../types";
import { AgentCallError, type AgentLlm, type CallRequest, CancelledError, limiter, MAX_CONCURRENT } from "./call";
import * as P from "./prompts";
import {
  type CallRecord,
  type Confidence,
  type DecisionRow,
  type FinalAggregate,
  type ItemDef,
  type ItemId,
  type ItemResult,
  ITEMS,
  type LedgerRow,
  type QuoteCheck,
  type RunSummary,
  type StageId,
  type StageRecord,
  type StageStatus,
} from "./types";
import { agreementOf, applyScores, articleText, checkQuotes, confidenceOf, consensus, guardRationale, hasFabricated, needsTieBreak, overlap, PROMPT_BODY_CHARS, quoteCorpus, verifiedCount } from "./verify";

/**
 * The four-agent pipeline (server-side, LLM injected). For each of the 13 score-card outputs:
 *  1. Analyst — an LLM assesses the checks behind the output with verbatim evidence;
 *  2. Reviewer — another LLM (another provider when one is configured) accepts or rejects each claim
 *     seeing only the claims, not the analyst's reasoning;
 *  3. Verifier — code verifies every quote against the draft and applies the bounded consensus rule
 *     (a tie-break LLM call only settles the magnitude when both agents move a score the same way);
 *  4. Finalizer — code re-aggregates with the engine's own weights, caps and blocker rules, then an
 *     LLM writes a rationale that is rejected if it states a number or check that is not verified.
 * Score items run first (their verified check scores feed the counts, status and top recommendation).
 */

export type PipelineInput = { draft: DraftInput; report: Report; research: Research | null; fingerprint: string };
export type PipelineDeps = {
  llm: AgentLlm;
  onStage?: (item: ItemId, stage: StageId, status: StageStatus) => void;
  cancelled?: () => Promise<boolean>;
  /** Number of providers configured (decides whether the reviewer can be independent). */
  providers?: number;
};
export type PipelineResult = { items: ItemResult[]; summary: RunSummary; final: FinalAggregate; findings: Finding[] };

/** Above this share of failed analyst / reviewer stages the run counts as partly verified (confidence low). */
const MAX_FAILED_SHARE = 0.2;
const SEV_RANK: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1 };
const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;
const nameOf = (feature: string) => featureById(feature)?.name ?? feature;
const pct = (v: number | null) => (v == null ? "n/a" : `${Math.round(v * 100)}%`);
const fmt = (v: number | null) => (v == null ? "n/a" : v.toFixed(2));
const firstBy = <T extends { feature: string }>(xs: T[]) => {
  const m = new Map<string, T>();
  for (const x of xs) if (!m.has(x.feature)) m.set(x.feature, x);
  return m;
};

/** Scores must be on the 0..1 scale; a "7" meant as 0.7 would otherwise clamp to 1, so it voids the claim instead. */
const inRange = (n: number) => Number.isFinite(n) && n >= 0 && n <= 1;

const blankStage = (): StageRecord => ({ status: "pending", startedAt: null, finishedAt: null, calls: [], input: {}, output: null, notes: [], error: null });

type DecisionKind = "critical" | "high" | "passed";
const DECISION: Record<DecisionKind, { labels: [string, string]; rule: string; inClass: (f: Finding) => boolean }> = {
  critical: {
    labels: ["critical", "not-critical"],
    rule: "A check is a Critical issue when it carries a publication blocker, or when a critical-priority check fails (score below 0.50).",
    inClass: (f) => f.severity === "critical",
  },
  high: {
    labels: ["high", "not-high"],
    rule: "A check is a High priority issue when a high-priority check fails (score below 0.50) or a critical-priority check only reaches 'improve' (0.50 to 0.79), and it has no blocker.",
    inClass: (f) => f.severity === "high",
  },
  passed: { labels: ["passed", "not-passed"], rule: "A check passes when its score is 0.80 or more.", inClass: (f) => f.status === "pass" },
};

export async function runPipeline(input: PipelineInput, deps: PipelineDeps): Promise<PipelineResult> {
  const started = Date.now();
  const { draft, report, research } = input;
  // Quotes are verified against the author's words only (body and field values), never the labels the agents see.
  const corpus = quoteCorpus(draft);
  const article = P.articleBlock(articleText(draft, PROMPT_BODY_CHARS));
  const researchText = P.researchBlock(research);
  const draftRef = { fingerprint: input.fingerprint, articleChars: articleText(draft).length, truncated: draft.body.length > PROMPT_BODY_CHARS };
  const stages = Object.fromEntries(ITEMS.map((i) => [i.id, { analyst: blankStage(), reviewer: blankStage(), verifier: blankStage(), finalizer: blankStage() }])) as Record<ItemId, Record<StageId, StageRecord>>;
  const calls: CallRecord[] = [];
  const warnings: string[] = [];
  const gate = limiter(MAX_CONCURRENT);

  const set = (item: ItemId, stage: StageId, patch: Partial<StageRecord>) => {
    Object.assign(stages[item][stage], patch);
    if (patch.status) deps.onStage?.(item, stage, patch.status);
  };
  const start = (item: ItemId, stage: StageId, stageInput: Record<string, unknown>) => set(item, stage, { status: "running", startedAt: new Date().toISOString(), input: stageInput });
  const finish = (item: ItemId, stage: StageId, output: unknown, notes: string[] = [], status: StageStatus = "done") => set(item, stage, { status, output, notes: [...stages[item][stage].notes, ...notes], finishedAt: new Date().toISOString() });
  const skip = (item: ItemId, stage: StageId, note: string) => set(item, stage, { status: "skipped", notes: [note], finishedAt: new Date().toISOString() });
  const checkCancel = async () => {
    if (deps.cancelled && (await deps.cancelled())) throw new CancelledError();
  };

  /** One LLM call for a stage; null (stage marked failed) when it fails after its retry. */
  async function ask<T extends z.ZodType>(stage: StageId, req: CallRequest<T>): Promise<z.infer<T> | null> {
    try {
      await checkCancel();
      const { data, record } = await gate(() => deps.llm.call(req));
      calls.push(record);
      stages[req.item][stage].calls.push(record);
      return data;
    } catch (e) {
      if (e instanceof CancelledError) throw e;
      const message = e instanceof Error ? e.message : String(e);
      if (e instanceof AgentCallError) {
        calls.push(e.record);
        stages[req.item][stage].calls.push(e.record);
      }
      if (req.role !== "tie-break" && req.role !== "finalizer") set(req.item, stage, { status: "failed", error: message, finishedAt: new Date().toISOString() });
      else stages[req.item][stage].notes.push(`${req.role === "tie-break" ? "Tie-break" : "Finalizer"} call failed: ${message}`);
      return null;
    }
  }

  // ---------------------------------------------------------------------------- score items

  type ScoreState = { def: ItemDef; ledger: LedgerRow[]; failed: boolean; dropped: number; error: string | null };

  async function scoreItem(def: ItemDef): Promise<ScoreState> {
    const item = def.id;
    const cat = CATEGORIES.find((c) => c.id === def.category)!;
    const checks = report.findings.filter((f) => featureById(f.feature)?.category === def.category);
    const measured = checks.filter((f) => f.score != null);
    const ids = measured.map((f) => f.feature);
    const blocks = measured.map(P.checkBlock).join("\n\n");
    let analyst: { assessments: { feature: string; verdict: "agree" | "disagree"; score: number; evidence: string[]; reason: string }[]; summary: string } | null = null;
    let reviewer: { reviews: { feature: string; decision: "accept" | "reject"; score: number; evidence: string[]; reason: string }[]; summary: string } | null = null;
    let failed = false;

    if (!ids.length) {
      const note = "No check in this category could be measured yet (run SERP research), so there is nothing for the agents to verify.";
      skip(item, "analyst", note);
      skip(item, "reviewer", note);
    } else {
      await checkCancel();
      start(item, "analyst", { draft: draftRef, category: cat.label, research: !!research, checks: measured.map((f) => ({ feature: f.feature, name: nameOf(f.feature), engine: f.score, status: f.status })) });
      analyst = await ask("analyst", {
        role: "analyst",
        item,
        name: "analyst_checks",
        schema: P.analystScoreSchema(ids),
        system: P.ANALYST_SYSTEM,
        prompt: `Category: ${cat.label} (weight ${Math.round(cat.weight * 100)}%): ${cat.measures}.\nPrimary keyword: “${draft.keyword || "(none)"}”. Assess every one of these ${ids.length} checks.\n\n${blocks}\n\n${researchText}\n\n${article}`,
      });
      if (analyst) finish(item, "analyst", analyst, [`${analyst.assessments.length} of ${ids.length} checks assessed.`]);
      else failed = true;

      if (analyst) {
        await checkCancel();
        const claims = [...firstBy(analyst.assessments.filter((a) => a.verdict === "agree" || inRange(a.score))).values()].map((a) => {
          const engine = measured.find((f) => f.feature === a.feature)?.score ?? null;
          return { feature: a.feature, verdict: a.verdict, score: a.verdict === "agree" ? engine : r2(a.score), evidence: a.evidence };
        });
        start(item, "reviewer", { draft: draftRef, claims, sees: "claims and quotes only, not the analyst's reasoning" });
        reviewer = await ask("reviewer", {
          role: "reviewer",
          item,
          name: "reviewer_checks",
          schema: P.reviewerScoreSchema(ids),
          system: P.REVIEWER_SYSTEM,
          prompt: `Category: ${cat.label}: ${cat.measures}.\nPrimary keyword: “${draft.keyword || "(none)"}”.\n\nClaims to review (one per check):\n${JSON.stringify(claims, null, 1)}\n\nThe checks with the engine's measurements:\n\n${blocks}\n\n${researchText}\n\n${article}`,
        });
        if (reviewer) finish(item, "reviewer", reviewer, [`${reviewer.reviews.filter((r) => r.decision === "accept").length} accepted, ${reviewer.reviews.filter((r) => r.decision === "reject").length} rejected.`]);
        else failed = true;
      } else skip(item, "reviewer", "Skipped: the analyst did not answer.");
    }

    // Verifier: quotes, consensus and (only when needed) a tie-break on the magnitude.
    start(item, "verifier", { rule: "Engine score stands unless analyst and reviewer agree and the analyst's quotes are found in the draft; then it moves at most ±0.25.", checks: checks.length });
    const validA = (analyst?.assessments ?? []).filter((a) => a.verdict === "agree" || inRange(a.score));
    const validR = (reviewer?.reviews ?? []).filter((r) => inRange(r.score));
    const invalid = (analyst?.assessments.length ?? 0) - validA.length + (reviewer?.reviews.length ?? 0) - validR.length;
    const aBy = firstBy(validA);
    const rBy = firstBy(validR);
    const prepared = checks.map((f) => {
      const a = aBy.get(f.feature);
      const r = rBy.get(f.feature);
      const aq = checkQuotes(corpus, a?.evidence);
      const rq = checkQuotes(corpus, r?.evidence);
      const c = { engine: f.score, analyst: a ? { score: a.score, verdict: a.verdict, quotes: aq } : null, reviewer: r ? { decision: r.decision, score: r.score, quotes: rq } : null };
      return { f, a, r, aq, rq, c };
    });
    const disputed = prepared.filter((p) => needsTieBreak(p.c));
    let tie: { decisions: { feature: string; score: number; reason: string }[] } | null = null;
    if (disputed.length) {
      await checkCancel();
      const dIds = disputed.map((p) => p.f.feature);
      tie = await ask("verifier", {
        role: "tie-break",
        item,
        name: "verifier_tiebreak",
        schema: P.tieBreakSchema(dIds),
        system: P.TIEBREAK_SYSTEM,
        prompt: `${disputed
          .map((p) => `${P.checkBlock(p.f)}\nAnalyst score: ${fmt(p.a!.score)}; verified quotes: ${p.aq.filter((q) => q.result === "verified").map((q) => `“${q.text}”`).join(" ") || "none"}\nReviewer score: ${fmt(p.r!.score)}; verified quotes: ${p.rq.filter((q) => q.result === "verified").map((q) => `“${q.text}”`).join(" ") || "none"}`)
          .join("\n\n")}\n\n${article}`,
      });
    }
    const tBy = firstBy((tie?.decisions ?? []).filter((d) => inRange(d.score)));
    const ledger: LedgerRow[] = prepared.map(({ f, a, r, aq, rq, c }) => {
      const t = tBy.get(f.feature);
      const { final, outcome } = consensus({ ...c, tieBreak: t?.score ?? null });
      return {
        feature: f.feature,
        name: nameOf(f.feature),
        priority: featureById(f.feature)?.priority ?? "medium",
        engine: f.score,
        engineStatus: f.status,
        analyst: a ? (a.verdict === "agree" ? f.score : r2(a.score)) : null,
        analystVerdict: a?.verdict ?? null,
        analystReason: a?.reason ?? "",
        analystQuotes: aq,
        reviewerDecision: r?.decision ?? null,
        reviewer: r ? r2(r.score) : null,
        reviewerReason: r?.reason ?? "",
        reviewerQuotes: rq,
        tieBreak: t ? r2(t.score) : null,
        tieBreakReason: t?.reason ?? "",
        outcome,
        final,
        finalStatus: final == null ? f.status : final >= 0.8 ? "pass" : final >= 0.5 ? "warn" : "fail",
      };
    });
    const dropped = ledger.filter((l) => l.outcome === "dropped").length;
    const tally = Object.fromEntries([...new Set(ledger.map((l) => l.outcome))].map((o) => [o, ledger.filter((l) => l.outcome === o).length]));
    finish(item, "verifier", { outcomes: tally, tieBreak: tie, fabricatedQuotes: ledger.reduce((s, l) => s + l.analystQuotes.filter((q) => q.result === "fabricated").length + l.reviewerQuotes.filter((q) => q.result === "fabricated").length, 0) }, [
      disputed.length ? `${disputed.length} check${disputed.length === 1 ? "" : "s"} needed a tie-break on the magnitude.` : "No tie-break needed.",
      ...(dropped ? [`${dropped} claim${dropped === 1 ? "" : "s"} dropped: quoted text not found in the draft.`] : []),
      ...(invalid ? [`${invalid} score${invalid === 1 ? "" : "s"} outside 0–1 ignored.`] : []),
      ...(failed ? ["An agent stage failed, so engine scores were kept for this item."] : []),
    ]);
    return { def, ledger, failed, dropped, error: stages[item].analyst.error ?? stages[item].reviewer.error };
  }

  const scoreDefs = ITEMS.filter((i) => i.kind === "score");
  const scored = await Promise.all(scoreDefs.map(scoreItem));
  const attempted = scored.filter((s) => s.ledger.some((l) => l.engine != null));
  if (attempted.length && attempted.every((s) => s.failed && stages[s.def.id].analyst.status === "failed")) {
    throw new Error(`No analyst agent could run: ${attempted[0].error ?? "the AI provider did not answer"}`);
  }
  for (const s of scored) if (s.failed) warnings.push(`${s.def.label}: ${s.error ?? "an agent stage failed"}; engine scores were kept for its checks.`);

  // ---------------------------------------------------------------------------- aggregation

  const finals = new Map<string, number | null>();
  for (const s of scored) for (const l of s.ledger) finals.set(l.feature, l.final);
  const findings = applyScores(report.findings, finals);
  const engineAgg = aggregate(report.findings);
  const finalAgg = aggregate(findings);

  // ---------------------------------------------------------------------------- decision items

  type DecisionState = { def: ItemDef; rows: DecisionRow[]; failed: boolean; dropped: number; agreement: number | null; analystStatus?: string | null; reviewerStatus?: string | null; finalFeature?: string | null; analystPick?: string | null; agentPicked?: boolean };
  const allIds = CHECKS.map((c) => c.id).filter((id) => findings.some((f) => f.feature === id));
  const lines = findings.map(P.findingLine).join("\n");
  const head = `Primary keyword: “${draft.keyword || "(none)"}”. Overall score after verification: ${finalAgg.overall ?? "n/a"}/10 (engine ${engineAgg.overall ?? "n/a"}).`;

  function rowsFor(finalSet: Set<string>, labels: [string, string], claims: Map<string, { feature: string; label: string; evidence: string[]; reason: string }>, reviews: Map<string, { feature: string; decision: "accept" | "reject"; reason: string }>) {
    const features = [...new Set([...finalSet, ...claims.keys()])];
    let dropped = 0;
    const rows: DecisionRow[] = features.map((feature) => {
      const c = claims.get(feature);
      const r = reviews.get(feature);
      const qs: QuoteCheck[] = checkQuotes(corpus, c?.evidence);
      if (hasFabricated(qs)) dropped++;
      const agreed = !!c && r?.decision === "accept" && !hasFabricated(qs);
      const inFinal = finalSet.has(feature);
      return {
        feature,
        name: nameOf(feature),
        final: inFinal ? labels[0] : labels[1],
        analyst: c?.label ?? null,
        analystReason: c?.reason ?? "",
        analystQuotes: qs,
        reviewerDecision: r?.decision ?? null,
        reviewerReason: r?.reason ?? "",
        consensus: agreed,
        matches: agreed && (c!.label === labels[0]) === inFinal,
      };
    });
    const confirmed = rows.filter((r) => r.consensus && r.analyst === labels[0]).map((r) => r.feature);
    return { rows, dropped, agreement: overlap(finalSet, confirmed) };
  }

  async function countItem(def: ItemDef & { id: DecisionKind }): Promise<DecisionState> {
    const item = def.id;
    const spec = DECISION[def.id];
    const finalSet = new Set(findings.filter(spec.inClass).map((f) => f.feature));
    await checkCancel();
    start(item, "analyst", { draft: draftRef, rule: spec.rule, current: [...finalSet] });
    const analyst = await ask("analyst", {
      role: "analyst",
      item,
      name: `analyst_${item}`,
      schema: P.decisionAnalystSchema(allIds, spec.labels),
      system: P.DECISION_ANALYST_SYSTEM,
      prompt: `${head}\nQuestion: which checks are “${def.label}”? ${spec.rule}\nLabel every check currently in this class as ${spec.labels[0]} or ${spec.labels[1]}, and add any other check you believe belongs to it (label ${spec.labels[0]}). Currently in the class (${finalSet.size}): ${[...finalSet].join(", ") || "none"}.\n\nAll checks after verification (id | name | priority | score | status | severity | blocker | summary):\n${lines}\n\n${article}`,
    });
    if (analyst) finish(item, "analyst", analyst, [`${analyst.claims.filter((c) => c.label === spec.labels[0]).length} labelled ${spec.labels[0]}, ${analyst.claims.filter((c) => c.label === spec.labels[1]).length} ${spec.labels[1]}.`]);
    let reviewer: { reviews: { feature: string; decision: "accept" | "reject"; reason: string }[]; summary: string } | null = null;
    if (analyst) {
      await checkCancel();
      const claims = [...firstBy(analyst.claims).values()].map((c) => ({ feature: c.feature, label: c.label, evidence: c.evidence }));
      start(item, "reviewer", { claims, sees: "labels and quotes only" });
      reviewer = await ask("reviewer", {
        role: "reviewer",
        item,
        name: `reviewer_${item}`,
        schema: P.decisionReviewerSchema(allIds),
        system: P.DECISION_REVIEWER_SYSTEM,
        prompt: `${head}\nRule: ${spec.rule}\n\nClassifications to review:\n${JSON.stringify(claims, null, 1)}\n\nAll checks after verification:\n${lines}\n\n${article}`,
      });
      if (reviewer) finish(item, "reviewer", reviewer, [`${reviewer.reviews.filter((r) => r.decision === "accept").length} accepted, ${reviewer.reviews.filter((r) => r.decision === "reject").length} rejected.`]);
    } else skip(item, "reviewer", "Skipped: the analyst did not answer.");
    start(item, "verifier", { rule: "Quotes checked against the draft; the count follows the verified check scores; agent dissent lowers confidence.", finalSet: [...finalSet] });
    const { rows, dropped, agreement } = rowsFor(finalSet, spec.labels, firstBy(analyst?.claims ?? []), firstBy(reviewer?.reviews ?? []));
    const failed = !analyst || !reviewer;
    finish(item, "verifier", { finalCount: finalSet.size, confirmed: rows.filter((r) => r.consensus && r.analyst === spec.labels[0]).length, disputed: rows.filter((r) => !r.matches).map((r) => r.feature), dropped }, [
      `${rows.filter((r) => r.matches).length} of ${rows.length} classifications confirmed by both agents.`,
      ...(dropped ? [`${dropped} claim${dropped === 1 ? "" : "s"} dropped: quoted text not found in the draft.`] : []),
    ]);
    return { def, rows, failed, dropped, agreement: failed ? null : agreement };
  }

  async function statusItem(def: ItemDef): Promise<DecisionState> {
    const item = def.id;
    const finalSet = new Set(finalAgg.blockers.map((b) => b.feature));
    const rule = "Blocked when any publication blocker remains; otherwise Needs improvement when there is a critical issue or the overall score is below 7.0; otherwise Ready to publish.";
    await checkCancel();
    start(item, "analyst", { draft: draftRef, rule, blockers: finalAgg.blockers, counts: finalAgg.counts, overall: finalAgg.overall });
    const analyst = await ask("analyst", {
      role: "analyst",
      item,
      name: "analyst_status",
      schema: P.statusAnalystSchema(allIds),
      system: P.DECISION_ANALYST_SYSTEM,
      prompt: `${head}\nQuestion: what is the publish status? ${rule}\nCritical issues: ${finalAgg.counts.critical}. Blockers (${finalSet.size}): ${finalAgg.blockers.map((b) => `${b.feature}: ${b.message}`).join(" | ") || "none"}.\nLabel each blocker as blocker or not-blocker (quote the article), add any check you believe must block publication, and give the status you conclude.\n\nAll checks after verification:\n${lines}\n\n${article}`,
    });
    if (analyst) finish(item, "analyst", analyst, [`Analyst status: ${analyst.status}.`]);
    let reviewer: { status: string; reviews: { feature: string; decision: "accept" | "reject"; reason: string }[]; summary: string } | null = null;
    if (analyst) {
      await checkCancel();
      const claims = [...firstBy(analyst.claims).values()].map((c) => ({ feature: c.feature, label: c.label, evidence: c.evidence }));
      start(item, "reviewer", { status: analyst.status, claims, sees: "labels, quotes and the proposed status only" });
      reviewer = await ask("reviewer", {
        role: "reviewer",
        item,
        name: "reviewer_status",
        schema: P.statusReviewerSchema(allIds),
        system: P.DECISION_REVIEWER_SYSTEM,
        prompt: `${head}\nRule: ${rule}\nProposed status: ${analyst.status}\nBlocker classifications to review:\n${JSON.stringify(claims, null, 1)}\nGive your own status too.\n\nAll checks after verification:\n${lines}\n\n${article}`,
      });
      if (reviewer) finish(item, "reviewer", reviewer, [`Reviewer status: ${reviewer.status}.`]);
    } else skip(item, "reviewer", "Skipped: the analyst did not answer.");
    start(item, "verifier", { rule: "Status follows the engine rule on the verified scores; blockers are deterministic.", finalStatus: finalAgg.status });
    const { rows, dropped, agreement: blockerAgreement } = rowsFor(finalSet, ["blocker", "not-blocker"], firstBy(analyst?.claims ?? []), firstBy(reviewer?.reviews ?? []));
    const failed = !analyst || !reviewer;
    const votes = [analyst?.status === finalAgg.status, reviewer?.status === finalAgg.status];
    const agreement = failed ? null : r2((votes.filter(Boolean).length + blockerAgreement) / 3);
    finish(item, "verifier", { finalStatus: finalAgg.status, analystStatus: analyst?.status ?? null, reviewerStatus: reviewer?.status ?? null, blockerAgreement, dropped }, [
      `Final status by rule: ${STATUS_LABEL[finalAgg.status]}.`,
      ...(analyst && analyst.status !== finalAgg.status ? [`The analyst concluded “${analyst.status}”.`] : []),
      ...(reviewer && reviewer.status !== finalAgg.status ? [`The reviewer concluded “${reviewer.status}”.`] : []),
    ]);
    return { def, rows, failed, dropped, agreement, analystStatus: analyst?.status ?? null, reviewerStatus: reviewer?.status ?? null };
  }

  async function topItem(def: ItemDef): Promise<DecisionState> {
    const item = def.id;
    const candidates = recommendable(findings).slice(0, 8);
    const engineTop = candidates[0] ?? null;
    if (!engineTop) {
      const note = "No open issue with a recommendation: nothing to choose from.";
      skip(item, "analyst", note);
      skip(item, "reviewer", note);
      skip(item, "verifier", note);
      return { def, rows: [], failed: false, dropped: 0, agreement: null, finalFeature: null };
    }
    const ids = candidates.map((f) => f.feature);
    const list = candidates.map(P.findingLine).join("\n");
    await checkCancel();
    start(item, "analyst", { draft: draftRef, candidates: ids, engineTop: engineTop.feature });
    const analyst = await ask("analyst", {
      role: "analyst",
      item,
      name: "analyst_top",
      schema: P.topAnalystSchema(ids),
      system: P.DECISION_ANALYST_SYSTEM,
      prompt: `${head}\nQuestion: which ONE of these verified issues should the editor fix first to improve this article's chance to rank and serve the reader? Blockers come first. Quote the article to show the problem.\n\nCandidates (highest engine impact first):\n${list}\n\n${candidates.map(P.checkBlock).join("\n\n")}\n\n${article}`,
    });
    if (analyst) finish(item, "analyst", analyst, [`Analyst pick: ${nameOf(analyst.pick)}.`]);
    let reviewer: { decision: "accept" | "reject"; preferred: string; reason: string } | null = null;
    if (analyst) {
      await checkCancel();
      start(item, "reviewer", { pick: analyst.pick, evidence: analyst.evidence, sees: "the pick and its quotes only" });
      reviewer = await ask("reviewer", {
        role: "reviewer",
        item,
        name: "reviewer_top",
        schema: P.topReviewerSchema(ids),
        system: P.DECISION_REVIEWER_SYSTEM,
        prompt: `${head}\nAnother agent picked “${analyst.pick}” as the first fix, quoting: ${JSON.stringify(analyst.evidence)}.\nAccept it if it is the most valuable fix among the candidates; otherwise reject and give your own pick.\n\nCandidates (highest engine impact first):\n${list}\n\n${article}`,
      });
      if (reviewer) finish(item, "reviewer", reviewer, [reviewer.decision === "accept" ? "Pick accepted." : `Pick rejected${reviewer.preferred !== "none" ? `; prefers ${nameOf(reviewer.preferred)}` : ""}.`]);
    } else skip(item, "reviewer", "Skipped: the analyst did not answer.");
    start(item, "verifier", { rule: "Agents may change the engine's pick only when both agree, the quotes are verified and the pick is at least as severe (blockers first).", engineTop: engineTop.feature });
    const qs = checkQuotes(corpus, analyst?.evidence);
    const pick = analyst ? candidates.find((f) => f.feature === analyst.pick) : undefined;
    const severe = (f: Finding) => (f.blocker ? 10 : 0) + SEV_RANK[f.severity ?? "low"];
    const agentPicked = !!pick && reviewer?.decision === "accept" && !hasFabricated(qs) && verifiedCount(qs) > 0 && severe(pick) >= severe(engineTop);
    const finalFeature = agentPicked ? pick!.feature : engineTop.feature;
    const failed = !analyst || !reviewer;
    const votes = [engineTop.feature === finalFeature, analyst?.pick === finalFeature, (reviewer?.decision === "accept" && analyst?.pick === finalFeature) || reviewer?.preferred === finalFeature];
    const rows: DecisionRow[] = analyst
      ? [{ feature: analyst.pick, name: nameOf(analyst.pick), final: finalFeature === analyst.pick ? "top" : "not-top", analyst: "top", analystReason: analyst.reason, analystQuotes: qs, reviewerDecision: reviewer?.decision ?? null, reviewerReason: reviewer?.reason ?? "", consensus: reviewer?.decision === "accept" && !hasFabricated(qs), matches: finalFeature === analyst.pick }]
      : [];
    finish(item, "verifier", { engineTop: engineTop.feature, analystPick: analyst?.pick ?? null, reviewer: reviewer ? { decision: reviewer.decision, preferred: reviewer.preferred } : null, final: finalFeature, agentPicked }, [
      agentPicked && finalFeature !== engineTop.feature ? `Both agents chose ${nameOf(finalFeature)} with verified quotes; it replaces the engine's pick (${nameOf(engineTop.feature)}).` : `Final pick: ${nameOf(finalFeature)}${finalFeature === engineTop.feature ? " (the engine's highest-impact issue)" : ""}.`,
      ...(hasFabricated(qs) ? ["The analyst quoted text that is not in the draft; its pick was not used."] : []),
    ]);
    return { def, rows, failed, dropped: hasFabricated(qs) ? 1 : 0, agreement: failed ? null : r2(votes.filter(Boolean).length / 3), finalFeature, analystPick: analyst?.pick ?? null, agentPicked };
  }

  await checkCancel();
  const decisionDefs = ITEMS.filter((i) => i.kind !== "score");
  const decided = await Promise.all(decisionDefs.map((d) => (d.kind === "count" ? countItem(d as ItemDef & { id: DecisionKind }) : d.kind === "status" ? statusItem(d) : topItem(d))));

  // ---------------------------------------------------------------------------- finalizer

  const scoreBy = new Map(scored.map((s) => [s.def.id, s]));
  const decisionBy = new Map(decided.map((d) => [d.def.id, d]));
  const catScore = (agg: FinalAggregate, id: string) => agg.categories.find((c) => c.id === id)?.score ?? null;
  const catAgreement = (id: ItemId) => agreementOf(scoreBy.get(id)!.ledger.map((l) => l.outcome));

  function overallAgreement(): number | null {
    let w = 0;
    let s = 0;
    for (const st of scored) {
      const a = agreementOf(st.ledger.map((l) => l.outcome));
      if (a == null || st.failed) continue;
      const weight = CATEGORIES.find((c) => c.id === st.def.category)!.weight;
      w += weight;
      s += weight * a;
    }
    return w ? r2(s / w) : null;
  }

  /**
   * Why the overall result is only partly verified, or null. Any score item whose agents failed kept
   * unverified engine scores for its checks; a run where many agent stages failed is not a verification.
   */
  function partialReason(): string | null {
    const failedScores = scored.filter((s) => s.failed).map((s) => s.def.label);
    const agentStages = ITEMS.flatMap((i) => [stages[i.id].analyst, stages[i.id].reviewer]).filter((st) => st.status !== "skipped");
    const failedStages = agentStages.filter((st) => st.status === "failed").length;
    if (failedScores.length) return `the agents failed for ${failedScores.join(", ")}, so those checks keep unverified engine scores`;
    if (agentStages.length && failedStages / agentStages.length > MAX_FAILED_SHARE) return `${failedStages} of ${agentStages.length} analyst and reviewer stages failed`;
    return null;
  }

  function ledgerFacts(ledger: LedgerRow[]): string[] {
    const out: string[] = [];
    for (const l of ledger) {
      const q = l.analystQuotes.find((x) => x.result === "verified");
      if (l.outcome === "adjusted") out.push(`Adjusted: ${l.name} from ${fmt(l.engine)} to ${fmt(l.final)} (analyst ${fmt(l.analyst)}, reviewer ${fmt(l.reviewer)}${q ? `; verified quote “${q.text.slice(0, 140)}”` : ""}).`);
      else if (l.outcome === "rejected") out.push(`Kept at the engine score: ${l.name} (${fmt(l.engine)}); the reviewer rejected the analyst's ${fmt(l.analyst)}.`);
      else if (l.outcome === "dropped") out.push(`Dropped claim: ${l.name}; the analyst quoted text that is not in the draft.`);
      else if (l.outcome === "split" || l.outcome === "unresolved" || l.outcome === "unsupported") out.push(`Kept at the engine score: ${l.name} (${fmt(l.engine)}; ${l.outcome === "unsupported" ? "no verified quote for the proposed change" : "the agents disagreed"}).`);
    }
    return out.slice(0, 12);
  }

  type Computed = { engine: number | string | null; final: number | string | null; delta: number | null; agreement: number | null; confidence: Confidence; facts: string; rule: string; allowed: string[]; text?: string; topFinding?: Finding | null };

  function compute(def: ItemDef): Computed {
    if (def.kind === "score") {
      const st = scoreBy.get(def.id)!;
      const own = catAgreement(def.id);
      const measured = st.ledger.filter((l) => l.engine != null).length;
      const agreed = st.ledger.filter((l) => l.outcome === "confirmed" || l.outcome === "adjusted").length;
      const adjusted = st.ledger.filter((l) => l.outcome === "adjusted").length;
      if (def.id === "overall") {
        const agreement = overallAgreement();
        let confidence = confidenceOf(agreement, { dropped: st.dropped, failed: st.failed });
        const lows = scored.filter((s) => s.def.id !== "overall" && confidenceOf(catAgreement(s.def.id), { dropped: s.dropped, failed: s.failed }) === "low");
        if (confidence === "high" && lows.length) confidence = "medium";
        const partial = partialReason();
        if (partial) confidence = "low";
        const e = engineAgg.overall;
        const f = finalAgg.overall;
        const facts = [
          `Item: Overall Score out of 10 (weighted: Search Intent 20%, Content Quality 20%, Topical Coverage 15%, On-Page SEO 15%, E-E-A-T 10%, AI / SERP Readiness 10%, Linking / UX / Conversion 5%, Technical / Schema 5%).`,
          `Engine overall: ${e ?? "n/a"}. Final overall: ${f ?? "n/a"}. Change: ${e != null && f != null ? r1(f - e) : "n/a"}.`,
          `Category changes: ${finalAgg.categories.map((c) => `${c.label} ${catScore(engineAgg, c.id) ?? "n/a"} to ${c.score ?? "n/a"}`).join("; ")}.`,
          finalAgg.cap ? `Cap applied: ${finalAgg.cap.reason}` : "No cap applies.",
          `Weighted agreement across categories: ${pct(agreement)}. Confidence: ${confidence}${partial ? ` (partly verified: ${partial})` : ""}.`,
          ...ledgerFacts(st.ledger),
        ].join("\n");
        const rule = `Final ${f ?? "n/a"} vs engine ${e ?? "n/a"}: the engine's weights and caps re-applied to the verified check scores; agents agreed on ${pct(agreement)} of the weighted checks${finalAgg.cap ? `, and ${finalAgg.cap.reason.charAt(0).toLowerCase()}${finalAgg.cap.reason.slice(1)}` : "."}`;
        return { engine: e, final: f, delta: e != null && f != null ? r1(f - e) : null, agreement, confidence, facts, rule, allowed: st.ledger.map((l) => l.feature).concat("people-first") };
      }
      const e = catScore(engineAgg, def.category!);
      const f = catScore(finalAgg, def.category!);
      const confidence = confidenceOf(own, { dropped: st.dropped, failed: st.failed });
      const cat = CATEGORIES.find((c) => c.id === def.category)!;
      const facts = [
        `Item: ${def.label} (${cat.label}, weight ${Math.round(cat.weight * 100)}%), scored out of 10.`,
        `Engine score: ${e ?? "n/a"}. Final score: ${f ?? "n/a"}. Change: ${e != null && f != null ? r1(f - e) : "n/a"}.`,
        `Measured checks: ${measured}. Analyst and reviewer agreed on ${agreed} (${pct(own)}). Adjusted: ${adjusted}. Confidence: ${confidence}.`,
        ...ledgerFacts(st.ledger),
      ].join("\n");
      const rule = measured
        ? `Final ${f ?? "n/a"} vs engine ${e ?? "n/a"}: ${adjusted} of ${measured} checks adjusted where analyst and reviewer agreed with quotes found in the draft (max ±0.25 each); ${agreed} of ${measured} checks agreed${st.dropped ? `; ${st.dropped} claim${st.dropped === 1 ? "" : "s"} dropped for quotes not in the draft` : ""}.`
        : "No check in this category could be measured yet, so there is no score to verify.";
      return { engine: e, final: f, delta: e != null && f != null ? r1(f - e) : null, agreement: own, confidence, facts, rule, allowed: st.ledger.map((l) => l.feature) };
    }
    const d = decisionBy.get(def.id)!;
    const confidence = confidenceOf(d.agreement, { dropped: d.dropped, failed: d.failed });
    const disputed = d.rows.filter((r) => !r.matches);
    if (def.kind === "count") {
      const key = def.id as DecisionKind;
      const e = engineAgg.counts[key];
      const f = finalAgg.counts[key];
      const confirmed = d.rows.filter((r) => r.matches).length;
      const facts = [
        `Item: ${def.label}. Rule: ${DECISION[key].rule}`,
        `Engine count: ${e}. Final count on the verified scores: ${f}. Change: ${f - e}.`,
        `Classifications confirmed by both agents: ${confirmed} of ${d.rows.length}. Agreement: ${pct(d.agreement)}. Confidence: ${confidence}.`,
        disputed.length ? `Disputed: ${disputed.map((r) => `${r.name} (final ${r.final}, analyst ${r.analyst ?? "no claim"}, reviewer ${r.reviewerDecision ?? "no review"})`).join("; ")}.` : "No disputed classification.",
      ].join("\n");
      const rule = `${f} by the engine rule on the verified check scores (engine ${e}); both agents confirmed ${confirmed} of ${d.rows.length} classifications${disputed.length ? `, ${disputed.length} disputed` : ""}.`;
      return { engine: e, final: f, delta: f - e, agreement: d.agreement, confidence, facts, rule, allowed: d.rows.map((r) => r.feature) };
    }
    if (def.kind === "status") {
      const facts = [
        `Item: Publish Status. Rule: blocked when any publication blocker remains; needs improvement when there is a critical issue or the overall score is below 7; otherwise ready.`,
        `Engine status: ${STATUS_LABEL[engineAgg.status]}. Final status: ${STATUS_LABEL[finalAgg.status]}.`,
        `Final overall: ${finalAgg.overall ?? "n/a"}. Critical issues: ${finalAgg.counts.critical}. Blockers: ${finalAgg.blockers.map((b) => `${nameOf(b.feature)}: ${b.message}`).join(" | ") || "none"}.`,
        `Analyst concluded: ${d.analystStatus ?? "no answer"}. Reviewer concluded: ${d.reviewerStatus ?? "no answer"}. Agreement: ${pct(d.agreement)}. Confidence: ${confidence}.`,
      ].join("\n");
      const rule = `${STATUS_LABEL[finalAgg.status]}: ${finalAgg.blockers.length ? `${finalAgg.blockers.length} publication blocker${finalAgg.blockers.length === 1 ? "" : "s"} remain` : finalAgg.counts.critical ? `${finalAgg.counts.critical} critical issue${finalAgg.counts.critical === 1 ? "" : "s"} remain` : (finalAgg.overall ?? 0) < 7 ? `the verified overall ${finalAgg.overall ?? "n/a"} is below 7.0` : "no blocker or critical issue and the verified overall is 7.0 or more"}.`;
      return { engine: engineAgg.status, final: finalAgg.status, delta: null, agreement: d.agreement, confidence, facts, rule, allowed: finalAgg.blockers.map((b) => b.feature) };
    }
    // recommendation
    const f = d.finalFeature ? findings.find((x) => x.feature === d.finalFeature)! : null;
    const engineTopFeature = report.topRecommendation?.feature ?? null;
    if (!f) return { engine: engineTopFeature, final: null, delta: null, agreement: null, confidence: "none", facts: "", rule: "No open issue with a recommendation.", allowed: [], text: "", topFinding: null };
    const base = f.blocker ?? f.how ?? f.summary;
    const facts = [
      `Item: Top Recommendation. Chosen issue: ${nameOf(f.feature)} (severity ${f.severity ?? "n/a"}, score ${fmt(f.score)}${f.blocker ? ", publication blocker" : ""}).`,
      `Issue summary: ${f.summary}`,
      `Engine recommendation: ${base}`,
      `Why it matters: ${featureById(f.feature)?.why ?? ""}`,
      `Chosen by: ${d.agentPicked ? "both agents, with verified quotes" : "the engine's impact ranking"}. Agreement: ${pct(d.agreement)}. Confidence: ${confidence}.`,
    ].join("\n");
    const rule = `${nameOf(f.feature)} is the highest-impact verified issue${f.blocker ? " and blocks publication" : ` (${f.severity})`}${d.agentPicked && f.feature !== engineTopFeature ? "; both agents chose it over the engine's pick" : ""}.`;
    return { engine: engineTopFeature, final: f.feature, delta: null, agreement: d.agreement, confidence, facts, rule, allowed: [f.feature], text: base, topFinding: f };
  }

  async function finalize(def: ItemDef): Promise<ItemResult> {
    const item = def.id;
    const c = compute(def);
    start(item, "finalizer", { facts: c.facts, aggregation: def.kind === "score" ? "engine weights, caps and blocker rules re-applied to the verified scores" : "engine severity / status rule on the verified scores" });
    let rationale = c.rule;
    let rationaleSource: "ai" | "rule" = "rule";
    let text = c.text;
    const notes: string[] = [];
    let raw: unknown = null;
    const nothing = def.kind === "score" && def.id !== "overall" && c.engine == null && c.final == null;
    if (nothing) notes.push("Nothing was measured, so there is nothing to explain: no AI call.");
    else if (c.facts && (def.kind !== "recommendation" || c.topFinding)) {
      await checkCancel();
      const isTop = def.kind === "recommendation";
      const res = await ask("finalizer", {
        role: "finalizer",
        item,
        name: `finalizer_${item}`,
        effort: "low",
        maxTokens: 1500,
        schema: isTop ? P.topFinalizerSchema : P.finalizerSchema,
        system: P.FINALIZER_SYSTEM,
        prompt: `Verified facts:\n${c.facts}\n\nWrite the rationale${isTop ? " and the recommendation for the chosen issue only" : ""}.`,
      });
      raw = res;
      if (res) {
        const g = guardRationale(res.rationale, c.facts, c.allowed);
        if (g.ok) {
          rationale = res.rationale.trim();
          rationaleSource = "ai";
        } else notes.push(`AI rationale rejected because ${g.reason}; the rule-based rationale is shown.`);
        if (isTop && "recommendation" in res) {
          const gr = guardRationale(String(res.recommendation), c.facts, c.allowed);
          if (gr.ok && String(res.recommendation).trim()) text = String(res.recommendation).trim();
          else notes.push(`AI recommendation rejected because ${gr.ok ? "it was empty" : gr.reason}; the engine's recommendation is shown.`);
        }
      } else notes.push("The finalizer call failed; the rule-based rationale is shown.");
    }
    finish(item, "finalizer", { value: c.final, engine: c.engine, delta: c.delta, agreement: c.agreement, confidence: c.confidence, rationale, rationaleSource, ...(text != null ? { recommendation: text } : {}), ai: raw }, notes);
    const st = scoreBy.get(item);
    const dd = decisionBy.get(item);
    return {
      id: item,
      label: def.label,
      kind: def.kind,
      engine: c.engine,
      final: c.final,
      delta: c.delta,
      changed: c.engine !== c.final,
      confidence: c.confidence,
      agreement: c.agreement,
      rationale,
      rationaleSource,
      ...(def.kind === "recommendation" ? { text: text ?? "" } : {}),
      ...(st ? { ledger: st.ledger } : {}),
      ...(dd ? { decisions: dd.rows } : {}),
      stages: stages[item],
    };
  }

  const items = await Promise.all(ITEMS.map(finalize));

  // ---------------------------------------------------------------------------- summary

  const ok = calls.filter((c) => c.ok);
  const providers = [...new Set(ok.map((c) => c.providerLabel))];
  const pairs = ITEMS.map((i) => [stages[i.id].analyst.calls.find((c) => c.ok)?.provider, stages[i.id].reviewer.calls.find((c) => c.ok)?.provider]).filter(([a, b]) => a && b);
  const sum = (k: "inputTokens" | "outputTokens") => (ok.some((c) => c[k] != null) ? ok.reduce((s, c) => s + (c[k] ?? 0), 0) : null);
  const independentReviewer = pairs.length > 0 && pairs.every(([a, b]) => a !== b);
  if (!independentReviewer && pairs.length) warnings.push((deps.providers ?? providers.length) > 1 ? "Some reviews ran on the same AI provider as the analyst (fallback after a provider failed)." : "Only one AI provider is configured: the reviewer used the same provider with an independent prompt and without the analyst's reasoning.");
  const overall = items.find((i) => i.id === "overall")!;
  // The verified recommendation (the agents' pick when both chose it, the finalizer's guarded text), not the engine's ranking.
  const topResult = items.find((i) => i.id === "top");
  const final: FinalAggregate = { ...finalAgg, topRecommendation: typeof topResult?.final === "string" ? { feature: topResult.final, text: topResult.text ?? "" } : null };
  const partial = partialReason();
  if (partial) warnings.push(`Partly verified: ${partial}. Confidence is low.`);
  const summary: RunSummary = {
    engine: engineAgg,
    final,
    agreement: overall.agreement,
    confidence: overall.confidence,
    adjustedChecks: scored.reduce((s, st) => s + st.ledger.filter((l) => l.outcome === "adjusted").length, 0),
    droppedClaims: scored.reduce((s, st) => s + st.dropped, 0) + decided.reduce((s, d) => s + d.dropped, 0),
    calls: calls.length,
    failedCalls: calls.filter((c) => !c.ok).length,
    providers,
    independentReviewer,
    inputTokens: sum("inputTokens"),
    outputTokens: sum("outputTokens"),
    durationMs: Date.now() - started,
    warnings,
  };
  return { items, summary, final, findings };
}

/** Upper and lower bound of AI calls for a run (analyst + reviewer + finalizer per item, tie-breaks only when needed). */
export const callBudget = () => ({ min: ITEMS.length * 3, max: ITEMS.length * 3 + ITEMS.filter((i) => i.kind === "score").length });

