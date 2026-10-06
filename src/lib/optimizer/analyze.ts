import { buildContext, type Ctx, type OtherDraft } from "./context";
import { CATEGORIES, CHECKS, featureById, PRIORITY_WEIGHT } from "./features";
import * as intent from "./checks/intent";
import * as quality from "./checks/quality";
import * as onpage from "./checks/onpage";
import * as topical from "./checks/topical";
import * as trust from "./checks/trust";
import * as exp from "./checks/experience";
import * as tech from "./checks/technical";
import type { AiReview, CategoryId, CategoryScore, DraftInput, Finding, LinkCheck, LiveCheck, Report, ReportSummary, Research, Severity } from "./types";

/**
 * Runs every check and turns the findings into the report: category scores weighted as in the PDF
 * (intent 20%, quality 20%, topical 15%, on-page 15%, E-E-A-T 10%, SERP/AI 10%, linking/UX 5%,
 * technical 5%), the overall score out of 10, severities, publication blockers and publish status.
 * Pure and deterministic (client-safe): the editor re-scores live while you type.
 */

const RUN: Record<string, (ctx: Ctx) => Finding> = {
  "intent-analyzer": intent.intentAnalyzer,
  "intent-match": intent.intentMatch,
  "intent-mismatch": intent.intentMismatch,
  "serp-content": intent.serpContent,
  "serp-features": intent.serpFeatures,
  "people-first": quality.peopleFirst,
  completeness: quality.completeness,
  depth: quality.depth,
  originality: quality.originality,
  "information-gain": quality.informationGain,
  "first-hand": quality.firstHand,
  "factual-claims": quality.factualClaims,
  citations: quality.citations,
  "ai-patterns": quality.aiPatterns,
  "keyword-url": onpage.keywordUrl,
  "keyword-relevance": onpage.keywordRelevance,
  "keyword-placement": onpage.keywordPlacement,
  "keyword-overuse": onpage.keywordOveruse,
  "semantic-coverage": onpage.semanticCoverage,
  title: onpage.title,
  "meta-description": onpage.metaDescription,
  headings: onpage.headings,
  slug: onpage.slug,
  "featured-snippet": topical.featuredSnippet,
  "paa-coverage": topical.paaCoverage,
  answerability: topical.answerability,
  entities: topical.entities,
  "topic-cluster": topical.topicCluster,
  "subtopic-gaps": topical.subtopicGaps,
  "competitor-gaps": topical.competitorGaps,
  "question-gaps": topical.questionGaps,
  structure: quality.structure,
  readability: quality.readability,
  redundancy: quality.redundancy,
  filler: quality.filler,
  introduction: quality.introduction,
  conclusion: quality.conclusion,
  author: trust.author,
  "experience-signals": trust.experienceSignals,
  "trust-signals": trust.trustSignals,
  "claim-risk": trust.claimRisk,
  freshness: trust.freshness,
  "external-links": trust.externalLinks,
  "internal-opportunities": exp.internalLinks,
  "anchor-text": exp.anchorText,
  cta: exp.cta,
  "conversion-alignment": exp.conversionAlignment,
  "image-seo": exp.imageSeo,
  "media-opportunities": exp.mediaOpportunities,
  "schema-recommend": tech.schemaRecommend,
  "schema-generate": tech.schemaGenerate,
  "schema-validate": tech.schemaValidate,
  "article-metadata": tech.articleMetadata,
  canonical: tech.canonical,
  indexability: tech.indexability,
  mobile: exp.mobile,
  "page-experience": exp.pageExperience,
  accessibility: exp.accessibility,
};

/** Failing a Critical feature is a Critical issue; a warning one level lower (Issue Severity Engine). */
export function severityOf(f: Pick<Finding, "status" | "blocker" | "feature">): Severity | null {
  if (f.blocker) return "critical";
  const p = featureById(f.feature)?.priority ?? "medium";
  if (f.status === "fail") return p === "critical" ? "critical" : p === "high" ? "high" : "medium";
  if (f.status === "warn") return p === "critical" ? "high" : p === "high" ? "medium" : "low";
  return null;
}

const SEV_RANK: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1 };
export const bySeverity = (a: Finding, b: Finding) => (SEV_RANK[b.severity ?? "low"] ?? 0) - (SEV_RANK[a.severity ?? "low"] ?? 0) || (a.score ?? 1) - (b.score ?? 1);

const r1 = (v: number) => Math.round(v * 10) / 10;

/** Top recommendation ranking: the biggest weighted gap among the most severe issues (blockers first). */
export const impactOf = (f: Finding) => (SEV_RANK[f.severity ?? "low"] ?? 0) * 10 + (CATEGORIES.find((c) => c.id === featureById(f.feature)?.category)?.weight ?? 0) * 10 * (1 - (f.score ?? 0)) + (f.blocker ? 50 : 0);
/** Issues that can be recommended (they have a fix description or a blocker), highest impact first. */
export const recommendable = (findings: Finding[]) => findings.filter((f) => f.severity && (f.how || f.blocker)).sort((a, b) => impactOf(b) - impactOf(a));

export type AnalyzeInput = { research?: Research | null; ai?: AiReview | null; links?: LinkCheck | null; live?: LiveCheck | null; others?: OtherDraft[]; now?: Date };

export function analyze(draft: DraftInput, extra: AnalyzeInput = {}): Report {
  const ctx = buildContext(draft, extra);
  const findings: Finding[] = CHECKS.map((def) => {
    let f: Finding;
    try {
      f = RUN[def.id](ctx);
    } catch (e) {
      f = { feature: def.id, status: "na", score: null, summary: `Check failed: ${e instanceof Error ? e.message : "error"}`, sources: ["content"], severity: null };
    }
    return { ...f, severity: severityOf(f) };
  });

  return { ...aggregate(findings), findings, intent: ctx.intent, words: ctx.doc.words, analyzedAt: (extra.now ?? new Date()).toISOString() };
}

/** Report fields computed from the findings alone (shared with the agent finalizer, so both use the same math). */
export type Aggregate = Pick<Report, "overall" | "weighted" | "cap" | "categories" | "counts" | "blockers" | "status" | "readiness" | "topRecommendation">;

/**
 * Category scores (priority-weighted checks), the weighted overall with its intent / people-first caps,
 * severity counts, blockers, publish status, readiness and the top recommendation. Findings must
 * already carry their severity (see severityOf).
 */
export function aggregate(findings: Finding[]): Aggregate {
  const categories: CategoryScore[] = CATEGORIES.map((c) => {
    const fs = findings.filter((f) => featureById(f.feature)?.category === c.id);
    const measured = fs.filter((f) => f.score != null);
    const w = measured.reduce((s, f) => s + PRIORITY_WEIGHT[featureById(f.feature)!.priority], 0);
    const score = measured.length ? r1((measured.reduce((s, f) => s + PRIORITY_WEIGHT[featureById(f.feature)!.priority] * f.score!, 0) / w) * 10) : null;
    return { id: c.id, label: c.label, weight: c.weight, score, checks: fs.length, measured: measured.length };
  });
  const avail = categories.filter((c) => c.score != null);
  const weighted = avail.length ? r1(avail.reduce((s, c) => s + c.weight * c.score!, 0) / avail.reduce((s, c) => s + c.weight, 0)) : null;

  // Scoring principle: a technically optimized article must not score highly if it fails intent or the reader.
  let cap: Report["cap"] = null;
  const intentScore = categories.find((c) => c.id === "intent")?.score;
  const peopleFirst = findings.find((f) => f.feature === "people-first")?.score;
  if (intentScore != null && intentScore < 3) cap = { value: 4, reason: `Search intent is not satisfied (${intentScore}/10), so the overall score is capped at 4.0.` };
  else if (intentScore != null && intentScore < 5) cap = { value: 5.9, reason: `Search intent is only partly satisfied (${intentScore}/10), so the overall score is capped at 5.9.` };
  if (peopleFirst != null && peopleFirst < 0.5 && (!cap || cap.value > 6)) cap = { value: 6, reason: `The article does not yet serve the reader (people-first ${Math.round(peopleFirst * 100)}%), so the overall score is capped at 6.0.` };
  const overall = weighted == null ? null : cap ? Math.min(weighted, cap.value) : weighted;
  if (cap && weighted != null && weighted <= cap.value) cap = null;

  const blockers = findings.filter((f) => f.blocker).map((f) => ({ feature: f.feature, message: f.blocker! }));
  const counts = { critical: 0, high: 0, medium: 0, low: 0, passed: 0, na: 0, total: findings.length };
  for (const f of findings) {
    if (f.status === "na") counts.na++;
    else if (f.status === "pass") counts.passed++;
    if (f.severity) counts[f.severity]++;
  }
  const status: Report["status"] = blockers.length ? "blocked" : counts.critical > 0 || (overall ?? 0) < 7 ? "needs-improvement" : "ready";
  const readiness = Math.max(0, Math.min(100, Math.round(100 - blockers.length * 25 - counts.critical * 10 - counts.high * 3 - counts.medium)));
  const top = recommendable(findings)[0];
  return {
    overall: overall == null ? null : r1(overall),
    weighted,
    cap,
    categories,
    counts,
    blockers,
    status,
    readiness,
    topRecommendation: top ? { feature: top.feature, text: top.blocker ?? top.how ?? top.summary } : null,
  };
}

export function summarize(r: Report): ReportSummary {
  return {
    overall: r.overall,
    status: r.status,
    readiness: r.readiness,
    categories: Object.fromEntries(r.categories.map((c) => [c.id, c.score])) as Record<CategoryId, number | null>,
    counts: r.counts,
    blockers: r.blockers.length,
  };
}

export const STATUS_LABEL: Record<Report["status"], string> = { ready: "Ready to publish", "needs-improvement": "Needs improvement", blocked: "Blocked" };
