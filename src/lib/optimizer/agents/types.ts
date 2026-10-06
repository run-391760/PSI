import type { Aggregate } from "../analyze";
import type { CategoryId, Status } from "../types";

/**
 * Multi-agent scoring pipeline of the Pre-Publish Optimizer — shared types (client-safe).
 * Every one of the 13 score-card outputs goes through four agents in sequence: Analyst → Reviewer →
 * Verifier → Finalizer. The deterministic engine (analyze.ts) is the ground truth; agents may only
 * move a check score within ±0.25 when two of them agree and their quotes are found in the draft.
 */

export type ItemId = "overall" | "intent" | "quality" | "topical" | "onpage" | "eeat" | "serp" | "technical" | "critical" | "high" | "passed" | "status" | "top";
export type StageId = "analyst" | "reviewer" | "verifier" | "finalizer";
export type StageStatus = "pending" | "running" | "done" | "skipped" | "failed";
/** "none": nothing could be compared (e.g. no measured check in the category). */
export type Confidence = "high" | "medium" | "low" | "none";
export type ItemKind = "score" | "count" | "status" | "recommendation";

export type ItemDef = {
  id: ItemId;
  label: string;
  kind: ItemKind;
  /** Category whose checks this item's analyst and reviewer assess ("overall" covers Linking / UX / Conversion, the one category without its own row). */
  category?: CategoryId;
  description: string;
};

export const ITEMS: ItemDef[] = [
  { id: "overall", label: "Overall Score", kind: "score", category: "linking", description: "Weighted overall out of 10 with the intent / people-first caps. Its agents also verify the Linking / UX / Conversion checks." },
  { id: "intent", label: "Search Intent", kind: "score", category: "intent", description: "Search intent category (20%)." },
  { id: "quality", label: "Content Quality", kind: "score", category: "quality", description: "Content quality & usefulness category (20%)." },
  { id: "topical", label: "Topical Coverage", kind: "score", category: "topical", description: "Topical coverage category (15%)." },
  { id: "onpage", label: "On-Page SEO", kind: "score", category: "onpage", description: "On-page SEO category (15%)." },
  { id: "eeat", label: "E-E-A-T & Trust", kind: "score", category: "eeat", description: "E-E-A-T & trust category (10%)." },
  { id: "serp", label: "AI / SERP Readiness", kind: "score", category: "serp", description: "SERP & AI search readiness category (10%)." },
  { id: "technical", label: "Technical / Schema", kind: "score", category: "technical", description: "Technical / schema category (5%)." },
  { id: "critical", label: "Critical Issues", kind: "count", description: "Blockers and failed critical-priority checks." },
  { id: "high", label: "High Priority Issues", kind: "count", description: "Failed high-priority checks and warnings on critical ones." },
  { id: "passed", label: "Passed Checks", kind: "count", description: "Checks scoring 80% or more." },
  { id: "status", label: "Publish Status", kind: "status", description: "Blocked when any blocker remains; ready at 7.0+ with no critical issue." },
  { id: "top", label: "Top Recommendation", kind: "recommendation", description: "The highest-impact fix among the verified issues." },
];
export const STAGES: { id: StageId; label: string; does: string }[] = [
  { id: "analyst", label: "Analyst", does: "Assesses each check against the draft with verbatim evidence" },
  { id: "reviewer", label: "Reviewer", does: "Independently accepts or rejects each claim (different AI provider when available)" },
  { id: "verifier", label: "Verifier", does: "Checks every quote exists in the draft and applies the bounded consensus rule" },
  { id: "finalizer", label: "Finalizer", does: "Aggregates with the engine's weights, caps and blocker rules and writes the rationale" },
];
export const itemDef = (id: ItemId) => ITEMS.find((i) => i.id === id)!;

/** One LLM call (keys are never recorded). Token counts are null when the provider layer does not report them. */
export type CallRecord = {
  role: StageId | "tie-break";
  provider: string;
  providerLabel: string;
  model: string;
  latencyMs: number;
  attempts: number;
  inputTokens: number | null;
  outputTokens: number | null;
  ok: boolean;
  error: string | null;
};

/** A quote checked against the draft: verified (found), fabricated (not found) or ignored (too short to prove anything). */
export type QuoteCheck = { text: string; result: "verified" | "fabricated" | "too-short" };

export type Outcome =
  | "confirmed" // analyst and reviewer agree with the engine
  | "adjusted" // analyst and reviewer agree on a different score, evidence verified: bounded adjustment
  | "rejected" // the reviewer rejected the analyst's claim: engine kept
  | "split" // analyst and reviewer disagree in direction: engine kept
  | "unresolved" // same direction, different magnitude and no tie-break result: engine kept
  | "unsupported" // a change was proposed without any verified quote: engine kept
  | "dropped" // the analyst quoted text that is not in the draft: claim dropped, engine kept
  | "no-claim" // the analyst did not assess this check
  | "unreviewed" // a stage failed: engine kept
  | "not-measured"; // the engine could not measure the check (n/a): agents cannot create a measurement

/** Per-check record of a score item: engine → analyst → reviewer → verifier → final. Scores are 0..1. */
export type LedgerRow = {
  feature: string;
  name: string;
  priority: string;
  engine: number | null;
  engineStatus: Status;
  analyst: number | null;
  analystVerdict: "agree" | "disagree" | null;
  analystReason: string;
  analystQuotes: QuoteCheck[];
  reviewerDecision: "accept" | "reject" | null;
  reviewer: number | null;
  reviewerReason: string;
  reviewerQuotes: QuoteCheck[];
  tieBreak: number | null;
  tieBreakReason: string;
  outcome: Outcome;
  final: number | null;
  finalStatus: Status;
};

/** Per-finding record of a count / status / recommendation item. */
export type DecisionRow = {
  feature: string;
  name: string;
  /** Classification by the deterministic rule on the verified scores (e.g. "critical", "pass", "blocker"). */
  final: string;
  analyst: string | null;
  analystReason: string;
  analystQuotes: QuoteCheck[];
  reviewerDecision: "accept" | "reject" | null;
  reviewerReason: string;
  /** Analyst label confirmed by the reviewer with no fabricated quote. */
  consensus: boolean;
  /** The confirmed agent view matches the final classification. */
  matches: boolean;
};

export type StageRecord = {
  status: StageStatus;
  startedAt: string | null;
  finishedAt: string | null;
  calls: CallRecord[];
  /** What the stage was given (the draft itself is referenced by its fingerprint, not copied). */
  input: Record<string, unknown>;
  /** What it returned (raw structured output for LLM stages, computed results for code stages). */
  output: unknown;
  notes: string[];
  error: string | null;
};

export type ItemValue = number | string | null;

export type ItemResult = {
  id: ItemId;
  label: string;
  kind: ItemKind;
  engine: ItemValue;
  final: ItemValue;
  /** final − engine for numbers; null for status / recommendation. */
  delta: number | null;
  changed: boolean;
  confidence: Confidence;
  /** 0..1 share of claims on which the agents and the final value agree; null when nothing could be compared. */
  agreement: number | null;
  rationale: string;
  rationaleSource: "ai" | "rule";
  /** Top recommendation text (recommendation item only). */
  text?: string;
  ledger?: LedgerRow[];
  decisions?: DecisionRow[];
  stages: Record<StageId, StageRecord>;
};

export type FinalAggregate = Aggregate;

export type RunSummary = {
  engine: FinalAggregate;
  final: FinalAggregate;
  /** Weighted agreement over the score items. */
  agreement: number | null;
  confidence: Confidence;
  adjustedChecks: number;
  droppedClaims: number;
  calls: number;
  failedCalls: number;
  providers: string[];
  /** True when the reviewer ran on a different provider than the analyst for every item. */
  independentReviewer: boolean;
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number;
  warnings: string[];
};

export type RunStatus = "queued" | "running" | "done" | "failed" | "cancelled";

/** Live progress kept in opt_agent_runs.stages while the job runs. */
export type StageGrid = Record<ItemId, Record<StageId, StageStatus>>;
export type RunProgress = { grid: StageGrid; done: number; total: number; message: string };

export type AgentRunView = {
  id: string;
  draftId: string;
  jobId: string | null;
  status: RunStatus;
  fingerprint: string;
  progress: RunProgress;
  items: ItemResult[];
  summary: RunSummary | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

/** Agent-verified values for the score card (from the latest finished run). */
export type VerifiedScore = { final: FinalAggregate; engineOverall: number | null; confidence: Confidence; finishedAt: string; stale: boolean };

/** Estimate shown before a run (AI calls are billed to the configured keys). */
export type AgentPlan = { configured: boolean; providers: string[]; minCalls: number; maxCalls: number; independentReviewer: boolean };

export const emptyGrid = (): StageGrid => Object.fromEntries(ITEMS.map((i) => [i.id, { analyst: "pending", reviewer: "pending", verifier: "pending", finalizer: "pending" }])) as StageGrid;
