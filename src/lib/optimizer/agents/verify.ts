import { type Aggregate, severityOf } from "../analyze";
import { statusOf } from "../checks/util";
import { FEATURES } from "../features";
import { bodyHash } from "../hash";
import type { DraftInput, Finding, ResearchBundle } from "../types";
import type { Confidence, Outcome, QuoteCheck } from "./types";

/**
 * Deterministic parts of the agent pipeline (pure, client-safe, unit-tested): the article text agents
 * see and quote from, quote verification, the bounded consensus rule, agreement / confidence, applying
 * verified scores to the engine findings, staleness and the finalizer's output guard.
 */

/** Largest change agents may make to one check score (0..1 scale). */
export const MAX_ADJUST = 0.25;
/** Analyst and reviewer scores within this distance count as agreement on the magnitude. */
export const AGREE_WITHIN = 0.15;
/** Smaller differences from the engine are treated as agreeing with it. */
export const SAME_AS_ENGINE = 0.05;
/** Quotes shorter than this (after normalization) prove nothing and are ignored. */
export const MIN_QUOTE = 8;
/** Body characters given to the agents (quotes are verified against the full body). */
export const PROMPT_BODY_CHARS = 60_000;

const round2 = (v: number) => Math.round(v * 100) / 100;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// ------------------------------------------------------------------------------ article & quotes

/** Every field a check reads, with the label the agents see it under. */
function articleFields(d: DraftInput): [string, string | undefined][] {
  const m = d.meta ?? {};
  const a = m.author;
  return [
    ["SEO title", d.title],
    ["Meta description", d.metaDescription],
    ["Primary keyword", d.keyword],
    ["Secondary keywords", d.keywords?.join(", ")],
    ["URL", d.url],
    ["Slug", d.slug],
    ["Page type", m.pageType],
    ["Funnel stage", m.funnel],
    ["Robots", m.robots],
    ["Canonical", m.canonical],
    ["Author", a ? [a.name, a.credentials, a.url].filter(Boolean).join(" · ") : undefined],
    ["Author bio", a?.bio],
    ["Organization", m.organization ? [m.organization.name, m.organization.url].filter(Boolean).join(" · ") : undefined],
    ["Published", m.publishedAt],
    ["Modified", m.modifiedAt],
    ["Featured image", m.featuredImage],
    ["CTA", m.cta ? [m.cta.text, m.cta.url].filter(Boolean).join(" → ") : undefined],
    ["JSON-LD", m.schema ? m.schema.slice(0, 4000) : undefined],
  ];
}

/** Field labels articleText adds; they are the tool's words, not the author's. */
const FIELD_LABELS = articleFields({ title: "", keyword: "", body: "" } as DraftInput).map(([k]) => k);
const LABEL_PREFIX = new RegExp(`^(?:(?:${FIELD_LABELS.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")}):\\s*)+`, "i");

/** The article as the agents see it: every field a check reads, then the body. */
export function articleText(d: DraftInput, maxBody = Number.POSITIVE_INFINITY): string {
  const fields = articleFields(d);
  const head = fields.map(([k, v]) => `${k}: ${v?.trim() ? v.trim() : "(none)"}`).join("\n");
  const body = d.body.length > maxBody ? `${d.body.slice(0, maxBody)}\n[… body truncated for the agents at ${maxBody.toLocaleString("en-US")} characters …]` : d.body;
  return `${head}\n\n${body}`;
}

/**
 * Normalization applied to both the draft and a quote before matching: Unicode compatibility forms,
 * straight quotes and hyphens, Markdown link / emphasis / heading syntax removed, whitespace collapsed.
 * Case is kept: a quote has to be copied, not paraphrased.
 */
export function canon(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`>#|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Separator between the author's values in the quote corpus: never produced by canon, so no quote spans two fields. */
const SEP = "\u0001";

/**
 * What quotes are verified against: the author's own words only — the body and every non-empty field
 * value, each canonicalized and kept apart. The labels and "(none)" placeholders articleText adds are
 * not in it, so a quote of "Primary keyword" or "Canonical: (none)" proves nothing.
 */
export function quoteCorpus(d: DraftInput): string {
  const values = articleFields(d)
    .map(([, v]) => canon(v ?? ""))
    .filter(Boolean);
  return [canon(d.body), ...values].join(SEP);
}

/** Quote verification against quoteCorpus(). Fragments joined by an ellipsis must each be present. */
export function checkQuote(corpus: string, quote: string): QuoteCheck {
  const fragments = quote
    .split(/…|\.\.\./)
    // Agents see the fields as "Label: value": the label is dropped so the author's value is what gets matched.
    .map((f) => canon(f).replace(/^["']+|["']+$/g, "").trim().replace(LABEL_PREFIX, "").replace(/^["']+|["']+$/g, "").trim())
    .filter((f) => f && f !== "(none)");
  const meaningful = fragments.filter((f) => f.length >= MIN_QUOTE);
  if (!meaningful.length) return { text: quote, result: "too-short" };
  return { text: quote, result: meaningful.every((f) => corpus.includes(f)) ? "verified" : "fabricated" };
}

/** Every quote is checked: one invented quote, wherever it sits in the list, voids the claim. */
export function checkQuotes(corpus: string, quotes: string[] | undefined): QuoteCheck[] {
  return (quotes ?? []).map((q) => checkQuote(corpus, String(q)));
}

export const hasFabricated = (qs: QuoteCheck[]) => qs.some((q) => q.result === "fabricated");
export const verifiedCount = (qs: QuoteCheck[]) => qs.filter((q) => q.result === "verified").length;

// ------------------------------------------------------------------------------ consensus

export type ConsensusInput = {
  engine: number | null;
  analyst: { score: number; verdict: "agree" | "disagree"; quotes: QuoteCheck[] } | null;
  reviewer: { decision: "accept" | "reject"; score: number; quotes: QuoteCheck[] } | null;
  /** Score from the verifier's tie-break call (only asked for when needsTieBreak). */
  tieBreak?: number | null;
};

/** Analyst score as a number: "agree" means the engine score, whatever number came with it. */
const analystScore = (c: ConsensusInput) => (c.analyst!.verdict === "agree" ? c.engine! : clamp(c.analyst!.score, 0, 1));

/** Analyst and reviewer move the score the same way but disagree on how far: the verifier settles the magnitude. */
export function needsTieBreak(c: ConsensusInput): boolean {
  if (c.engine == null || !c.analyst || !c.reviewer || c.reviewer.decision !== "accept") return false;
  if (hasFabricated(c.analyst.quotes) || hasFabricated(c.reviewer.quotes) || !verifiedCount(c.analyst.quotes)) return false;
  const a = analystScore(c);
  const r = clamp(c.reviewer.score, 0, 1);
  const da = a - c.engine;
  const dr = r - c.engine;
  return Math.abs(da) >= SAME_AS_ENGINE && Math.abs(dr) >= SAME_AS_ENGINE && Math.sign(da) === Math.sign(dr) && Math.abs(a - r) > AGREE_WITHIN;
}

/**
 * The verifier's rule for one check. The engine score stands unless the analyst and the reviewer agree
 * on a different value and the analyst's evidence is verified in the draft; even then the score moves
 * at most MAX_ADJUST from the engine's. Any fabricated quote drops the claim.
 */
export function consensus(c: ConsensusInput): { final: number | null; outcome: Outcome } {
  const e = c.engine;
  if (e == null) return { final: null, outcome: "not-measured" };
  if (!c.analyst) return { final: e, outcome: "no-claim" };
  if (hasFabricated(c.analyst.quotes)) return { final: e, outcome: "dropped" };
  if (!c.reviewer) return { final: e, outcome: "unreviewed" };
  if (c.reviewer.decision === "reject" || hasFabricated(c.reviewer.quotes)) return { final: e, outcome: "rejected" };
  const a = analystScore(c);
  const r = clamp(c.reviewer.score, 0, 1);
  // The analyst backs the engine: the reviewer's acceptance confirms it unless its own score is far off.
  if (Math.abs(a - e) < SAME_AS_ENGINE) return { final: e, outcome: Math.abs(r - e) <= AGREE_WITHIN ? "confirmed" : "split" };
  if (!verifiedCount(c.analyst.quotes)) return { final: e, outcome: "unsupported" };
  let target: number;
  if (Math.abs(a - r) <= AGREE_WITHIN) target = (a + r) / 2;
  else if (Math.sign(a - e) === Math.sign(r - e) && Math.abs(r - e) >= SAME_AS_ENGINE) {
    if (c.tieBreak == null || !Number.isFinite(c.tieBreak)) return { final: e, outcome: "unresolved" };
    target = clamp(c.tieBreak, Math.min(a, r), Math.max(a, r));
  } else return { final: e, outcome: "split" };
  const final = round2(clamp(e + clamp(target - e, -MAX_ADJUST, MAX_ADJUST), 0, 1));
  return { final, outcome: Math.abs(final - e) < 0.005 ? "confirmed" : "adjusted" };
}

export const AGREED: Outcome[] = ["confirmed", "adjusted"];

/** Share of measured checks on which analyst and reviewer endorsed the final score. */
export function agreementOf(outcomes: Outcome[]): number | null {
  const measured = outcomes.filter((o) => o !== "not-measured");
  if (!measured.length) return null;
  return round2(measured.filter((o) => AGREED.includes(o)).length / measured.length);
}

/** high: ≥80% agreement and no fabricated quote; medium: ≥50%; low otherwise or when a stage failed; none when nothing was compared. */
export function confidenceOf(agreement: number | null, opts: { dropped?: number; failed?: boolean } = {}): Confidence {
  if (opts.failed) return "low";
  if (agreement == null) return "none";
  if (agreement >= 0.8 && !opts.dropped) return "high";
  return agreement >= 0.5 ? "medium" : "low";
}

/** Jaccard overlap of two sets of features (1 when both are empty). */
export function overlap(a: Iterable<string>, b: Iterable<string>): number {
  const A = new Set(a);
  const B = new Set(b);
  const union = new Set([...A, ...B]);
  if (!union.size) return 1;
  return round2([...A].filter((x) => B.has(x)).length / union.size);
}

// ------------------------------------------------------------------------------ findings

/**
 * Engine findings with the verified scores applied. Status follows the score exactly as in the checks
 * (statusOf) and severity is recomputed with the engine's rule; blockers are deterministic and kept.
 * Unmeasured checks stay unmeasured.
 */
export function applyScores(findings: Finding[], finals: Map<string, number | null>): Finding[] {
  return findings.map((f) => {
    if (!finals.has(f.feature) || f.score == null) return f;
    const s = finals.get(f.feature);
    if (s == null || s === f.score) return f;
    const next: Finding = { ...f, score: s, status: f.status === "na" ? "na" : statusOf(s) };
    return { ...next, severity: severityOf(next) };
  });
}

// ------------------------------------------------------------------------------ staleness

/**
 * Fingerprint of everything the engine scored: the draft fields and the research it used. A run whose
 * fingerprint differs from the current one is stale.
 */
export function runFingerprint(d: DraftInput, bundle: Pick<ResearchBundle, "research" | "ai" | "links" | "live"> | null): string {
  const parts = [
    JSON.stringify([d.title, d.keyword, d.keywords, d.metaDescription, d.slug, d.url, d.meta ?? {}]),
    d.body,
    bundle?.research?.fetchedAt ?? "",
    bundle?.ai?.reviewedAt ?? "",
    bundle?.links?.checkedAt ?? "",
    bundle?.live?.checkedAt ?? "",
  ];
  return `${bodyHash(d.body)}-${bodyHash(parts.join("\u0000"))}`;
}

/** The parts of an engine aggregate the score card shows, in a comparable form. */
const engineKey = (a: Aggregate) =>
  JSON.stringify([
    a.overall,
    a.weighted,
    a.cap?.reason ?? null,
    a.categories.map((c) => [c.id, c.score, c.measured]),
    // Field by field: the stored copy comes back from jsonb with its keys reordered.
    [a.counts.critical, a.counts.high, a.counts.medium, a.counts.low, a.counts.passed, a.counts.na, a.counts.total],
    a.blockers.map((b) => [b.feature, b.message]),
    a.status,
    a.readiness,
    a.topRecommendation?.feature ?? null,
  ]);

/**
 * A run is stale when the draft or its research changed (fingerprint) or when the engine now scores the
 * draft differently from the run's starting point. The second catches every input the fingerprint does
 * not cover: other drafts (cannibalisation, internal-link opportunities) and the date (freshness checks).
 */
export function isStale(runFingerprint_: string, current: string, engine?: { run: Aggregate; current: Aggregate }): boolean {
  if (runFingerprint_ !== current) return true;
  return !!engine && engineKey(engine.run) !== engineKey(engine.current);
}

// ------------------------------------------------------------------------------ finalizer guard

const numKey = (s: string) => {
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : s;
};

/** Every number in a text, normalized ("7.0" → "7", "1,200" → "1200"). */
export const numbersIn = (text: string) => (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map(numKey);

/**
 * The finalizer may only restate the facts it was given: every number it writes must appear in the
 * facts, and it may not name a check that is not among the allowed ones.
 */
export function guardRationale(text: string, facts: string, allowedFeatures: string[]): { ok: true } | { ok: false; reason: string } {
  const t = text.trim();
  if (!t) return { ok: false, reason: "empty rationale" };
  // Facts give check scores on a 0..1 scale; the same value written as a percentage is allowed too.
  const factNums = numbersIn(facts);
  const allowed = new Set([...factNums, ...factNums.filter((n) => Number(n) > 0 && Number(n) < 1).map((n) => String(Math.round(Number(n) * 100))), "0", "1", "10", "100"]);
  const extra = numbersIn(t).filter((n) => !allowed.has(n));
  if (extra.length) return { ok: false, reason: `it stated numbers that are not in the verified facts (${[...new Set(extra)].slice(0, 4).join(", ")})` };
  const ok = new Set(allowedFeatures);
  const lower = t.toLowerCase();
  const named = FEATURES.filter((f) => f.kind === "check" && !ok.has(f.id) && lower.includes(f.name.toLowerCase()));
  if (named.length) return { ok: false, reason: `it named checks outside the verified findings (${named.map((f) => f.name).join(", ")})` };
  return { ok: true };
}
