import assert from "node:assert/strict";
import { test } from "node:test";
import type { z } from "zod";
import { aggregate, analyze } from "../src/lib/optimizer/analyze";
import { type AgentLlm, type CallRequest, CancelledError, limiter } from "../src/lib/optimizer/agents/call";
import { callBudget, runPipeline } from "../src/lib/optimizer/agents/pipeline";
import { ITEMS } from "../src/lib/optimizer/agents/types";
import { applyScores, checkQuote, checkQuotes, consensus, guardRationale, isStale, MAX_ADJUST, needsTieBreak, quoteCorpus, runFingerprint } from "../src/lib/optimizer/agents/verify";
import { featureById } from "../src/lib/optimizer/features";
import type { DraftInput, Report, Research } from "../src/lib/optimizer/types";

const NOW = new Date("2026-10-05T10:00:00Z");

const BODY = `# MBA Admission Process 2026: Eligibility, Exams and Steps

The MBA admission process is the sequence of eligibility checks, entrance exams, interviews and fee payment that business schools use to select students. This guide explains each step with the documents and dates you need.

## Eligibility criteria for MBA admission

You need a bachelor's degree with at least 50% marks (45% for reserved categories), according to the [AICTE approval handbook](https://www.aicte-india.org/approval-process). Final-year students can apply provisionally.

## Entrance exams accepted

Most universities accept CAT, MAT, XAT, CMAT and GMAT scores. In our experience counselling 1,200 applicants in 2025, students who took two exams had more options.

## Step-by-step MBA admission process

1. Register online and fill the application form
2. Upload mark sheets, the entrance score card and ID proof
3. Pay the application fee
4. Attend the group discussion and personal interview

## Frequently asked questions

### Can I do an MBA without CAT?

Yes. Many universities accept MAT, CMAT, XAT or their own entrance test, and some admit students on the basis of graduation marks and an interview.

## Key takeaways

Check eligibility early, take two entrance exams and keep every document ready before the interview.`;

const DRAFT: DraftInput = {
  title: "MBA Admission Process 2026: Eligibility, Exams and Steps",
  keyword: "mba admission process",
  keywords: ["mba eligibility"],
  metaDescription: "The MBA admission process step by step: eligibility, accepted entrance exams, documents and interviews, with dates for 2026 applicants.",
  slug: "mba-admission-process",
  url: "https://example.edu/blog/mba-admission-process",
  body: BODY,
  meta: { author: { name: "Priya Shah", credentials: "Admissions counsellor" }, publishedAt: "2026-09-01", robots: "index, follow" },
};

const engineReport = () => analyze(DRAFT, { now: NOW });

// ------------------------------------------------------------------------------ quotes

test("quote verification normalizes whitespace, typography and Markdown but not wording", () => {
  const corpus = quoteCorpus(DRAFT);
  assert.equal(checkQuote(corpus, "Most universities accept CAT, MAT, XAT,\n   CMAT and GMAT scores.").result, "verified");
  assert.equal(checkQuote(corpus, "according to the AICTE approval handbook").result, "verified", "link syntax is ignored");
  assert.equal(checkQuote(corpus, "You need a bachelor’s degree").result, "verified", "curly apostrophe matches the straight one");
  assert.equal(checkQuote(corpus, "Most universities accept CAT and GMAT scores.").result, "fabricated", "paraphrase is not a quote");
  assert.equal(checkQuote(corpus, "accredited by NAAC with an A++ grade").result, "fabricated");
  assert.equal(checkQuote(corpus, "CAT").result, "too-short");
  assert.equal(checkQuote(corpus, "In our experience counselling 1,200 applicants … students who took two exams").result, "verified", "every ellipsis fragment must exist");
  assert.equal(checkQuote(corpus, "In our experience counselling 1,200 applicants … students who took three exams").result, "fabricated");
  assert.equal(checkQuote(corpus, "Admissions counsellor").result, "verified", "settings shown to the agents are quotable");
});

test("only the author's words verify a quote: field labels and placeholders added for the agents do not", () => {
  const corpus = quoteCorpus(DRAFT);
  assert.notEqual(checkQuote(corpus, "Primary keyword").result, "verified");
  assert.notEqual(checkQuote(corpus, "Canonical: (none)").result, "verified");
  assert.notEqual(checkQuote(corpus, "Author bio: (none)").result, "verified");
  assert.notEqual(checkQuote(corpus, "Secondary keywords: mba eligibility").result, "fabricated", "a labelled value is matched on the author's value");
  assert.equal(checkQuote(corpus, "SEO title: MBA Admission Process 2026: Eligibility, Exams and Steps").result, "verified");
  assert.equal(checkQuote(corpus, "mba admission process Meta description: The MBA admission").result, "fabricated", "no quote spans two fields");
  const label = consensus({ engine: 0.4, analyst: { score: 0.9, verdict: "disagree", quotes: checkQuotes(corpus, ["Primary keyword"]) }, reviewer: { decision: "accept", score: 0.9, quotes: [] } });
  assert.deepEqual(label, { final: 0.4, outcome: "dropped" }, "a label the tool generated is not the author's text");
});

test("every quote is checked: a 7th invented quote still voids the claim", () => {
  const corpus = quoteCorpus(DRAFT);
  const real = "Final-year students can apply provisionally.";
  const qs = checkQuotes(corpus, [...Array(6).fill(real), "Ranked number one in India by every agency."]);
  assert.equal(qs.length, 7);
  assert.deepEqual(consensus({ engine: 0.4, analyst: { score: 0.6, verdict: "disagree", quotes: qs }, reviewer: { decision: "accept", score: 0.6, quotes: [] } }), { final: 0.4, outcome: "dropped" });
});

// ------------------------------------------------------------------------------ consensus

const v = (text = "Most universities accept CAT, MAT, XAT, CMAT and GMAT scores.") => [{ text, result: "verified" as const }];
const fab = [{ text: "made up", result: "fabricated" as const }];

test("consensus keeps the engine score unless analyst and reviewer agree with verified evidence", () => {
  assert.deepEqual(consensus({ engine: null, analyst: { score: 1, verdict: "disagree", quotes: v() }, reviewer: { decision: "accept", score: 1, quotes: [] } }), { final: null, outcome: "not-measured" });
  assert.deepEqual(consensus({ engine: 0.6, analyst: null, reviewer: null }), { final: 0.6, outcome: "no-claim" });
  assert.deepEqual(consensus({ engine: 0.6, analyst: { score: 0.8, verdict: "disagree", quotes: [...v(), ...fab] }, reviewer: { decision: "accept", score: 0.8, quotes: [] } }), { final: 0.6, outcome: "dropped" });
  assert.deepEqual(consensus({ engine: 0.6, analyst: { score: 0.8, verdict: "disagree", quotes: v() }, reviewer: null }), { final: 0.6, outcome: "unreviewed" });
  assert.deepEqual(consensus({ engine: 0.6, analyst: { score: 0.8, verdict: "disagree", quotes: v() }, reviewer: { decision: "reject", score: 0.6, quotes: [] } }), { final: 0.6, outcome: "rejected" });
  assert.deepEqual(consensus({ engine: 0.6, analyst: { score: 0.8, verdict: "disagree", quotes: v() }, reviewer: { decision: "accept", score: 0.8, quotes: fab } }), { final: 0.6, outcome: "rejected" }, "a reviewer's invented quote voids its acceptance");
  assert.deepEqual(consensus({ engine: 0.6, analyst: { score: 0.8, verdict: "disagree", quotes: [] }, reviewer: { decision: "accept", score: 0.8, quotes: [] } }), { final: 0.6, outcome: "unsupported" });
  assert.deepEqual(consensus({ engine: 0.6, analyst: { score: 0.8, verdict: "disagree", quotes: v() }, reviewer: { decision: "accept", score: 0.7, quotes: [] } }), { final: 0.75, outcome: "adjusted" }, "mean of analyst and reviewer");
  assert.deepEqual(consensus({ engine: 0.6, analyst: { score: 0.35, verdict: "agree", quotes: [] }, reviewer: { decision: "accept", score: 0.62, quotes: [] } }), { final: 0.6, outcome: "confirmed" }, "agree means the engine's score");
  assert.deepEqual(consensus({ engine: 0.6, analyst: { score: 0.9, verdict: "disagree", quotes: v() }, reviewer: { decision: "accept", score: 0.3, quotes: [] } }), { final: 0.6, outcome: "split" });
});

test("adjustments are bounded to ±0.25 of the engine score and tie-breaks stay between the two agents", () => {
  const up = consensus({ engine: 0.3, analyst: { score: 1, verdict: "disagree", quotes: v() }, reviewer: { decision: "accept", score: 0.95, quotes: [] } });
  assert.deepEqual(up, { final: 0.55, outcome: "adjusted" });
  const down = consensus({ engine: 0.9, analyst: { score: 0.1, verdict: "disagree", quotes: v() }, reviewer: { decision: "accept", score: 0.2, quotes: [] } });
  assert.equal(down.final, 0.9 - MAX_ADJUST);
  const disputed = { engine: 0.4, analyst: { score: 0.9, verdict: "disagree" as const, quotes: v() }, reviewer: { decision: "accept" as const, score: 0.6, quotes: [] } };
  assert.equal(needsTieBreak(disputed), true);
  assert.deepEqual(consensus(disputed), { final: 0.4, outcome: "unresolved" }, "no tie-break result: engine kept");
  assert.deepEqual(consensus({ ...disputed, tieBreak: 0.62 }), { final: 0.62, outcome: "adjusted" });
  assert.deepEqual(consensus({ ...disputed, tieBreak: 1 }), { final: 0.65, outcome: "adjusted" }, "clamped to the analyst, then to the ±0.25 bound");
  assert.deepEqual(consensus({ ...disputed, tieBreak: 0.1 }), { final: 0.6, outcome: "adjusted" }, "clamped up to the reviewer's score");
  assert.equal(needsTieBreak({ ...disputed, analyst: { ...disputed.analyst, quotes: fab } }), false);
  assert.equal(needsTieBreak({ ...disputed, reviewer: { ...disputed.reviewer, score: 0.3 } }), false, "opposite directions are a split, not a tie-break");
});

// ------------------------------------------------------------------------------ aggregation

test("final aggregation equals analyze() when no score is adjusted", () => {
  const r = engineReport();
  const agg = aggregate(r.findings);
  for (const k of ["overall", "weighted", "cap", "categories", "counts", "blockers", "status", "readiness", "topRecommendation"] as const) assert.deepEqual(agg[k], r[k], k);
  const same = applyScores(r.findings, new Map(r.findings.map((f) => [f.feature, f.score])));
  assert.deepEqual(aggregate(same), agg);
});

test("applied scores re-derive status and severity with the engine's rules", () => {
  const r = engineReport();
  const f = r.findings.find((x) => x.score != null && x.score < 0.5 && !x.blocker && featureById(x.feature)?.priority === "critical");
  if (!f) return; // the fixture has no failing critical check without a blocker
  const [g] = applyScores([f], new Map([[f.feature, Math.min(1, f.score! + 0.25)]]));
  assert.equal(g.status, g.score! >= 0.8 ? "pass" : g.score! >= 0.5 ? "warn" : "fail");
  assert.equal(g.severity, g.status === "warn" ? "high" : g.status === "fail" ? "critical" : null);
});

// ------------------------------------------------------------------------------ staleness

test("a run goes stale when the draft or its research changes", () => {
  const research = { fetchedAt: "2026-10-01T00:00:00Z" } as Research;
  const fp = runFingerprint(DRAFT, { research, ai: null, links: null, live: null });
  assert.equal(fp, runFingerprint({ ...DRAFT, meta: { ...DRAFT.meta } }, { research, ai: null, links: null, live: null }));
  assert.equal(isStale(fp, runFingerprint({ ...DRAFT, body: `${BODY}\n\nOne more line.` }, { research, ai: null, links: null, live: null })), true);
  assert.equal(isStale(fp, runFingerprint({ ...DRAFT, title: "Another title" }, { research, ai: null, links: null, live: null })), true);
  assert.equal(isStale(fp, runFingerprint(DRAFT, { research: { ...research, fetchedAt: "2026-10-02T00:00:00Z" }, ai: null, links: null, live: null })), true);
  assert.equal(isStale(fp, runFingerprint(DRAFT, null)), true);
});

test("a run goes stale when the engine scores the draft differently (other drafts, the date)", () => {
  const fp = runFingerprint(DRAFT, null);
  const then = aggregate(engineReport().findings);
  assert.equal(isStale(fp, fp, { run: then, current: aggregate(engineReport().findings) }), false);
  const later = analyze(DRAFT, { now: new Date("2028-01-05T10:00:00Z") });
  if (JSON.stringify(aggregate(later.findings)) !== JSON.stringify(then)) assert.equal(isStale(fp, fp, { run: then, current: aggregate(later.findings) }), true, "time passing changed the engine result");
  const report = engineReport();
  const f = report.findings.find((x) => x.score != null && x.score < 0.75)!;
  assert.equal(isStale(fp, fp, { run: then, current: aggregate(applyScores(report.findings, new Map([[f.feature, 1]]))) }), true, "any engine change marks the run stale");
});

// ------------------------------------------------------------------------------ finalizer guard

test("the finalizer guard rejects numbers and checks that are not in the verified facts", () => {
  const facts = "Engine score: 6.8. Final score: 7. Change: 0.2. Adjusted: Originality Analyzer from 0.55 to 0.7.";
  assert.deepEqual(guardRationale("Two agents agreed, so the score rose from 6.8 to 7.0.", facts, ["originality"]), { ok: true });
  assert.deepEqual(guardRationale("Originality rose to 70% after verification.", facts, ["originality"]), { ok: true }, "0..1 scores may be written as percentages");
  assert.equal(guardRationale("The score rose to 7.4.", facts, ["originality"]).ok, false);
  assert.equal(guardRationale("Weak Title Optimizer results held it back.", facts, ["originality"]).ok, false);
  assert.equal(guardRationale("  ", facts, []).ok, false);
});

// ------------------------------------------------------------------------------ pipeline (mocked LLM)

type Plan = { analystDelta?: Record<string, { score: number; quote: string }>; reviewerAgrees?: boolean; failAnalysts?: boolean; finalizerText?: string };

/** Mock LLM that answers each role from the prompt and validates its answer against the requested schema. */
function mockLlm(report: Report, plan: Plan = {}): AgentLlm & { calls: CallRequest<z.ZodType>[]; maxActive: number } {
  const engine = new Map(report.findings.map((f) => [f.feature, f.score]));
  let active = 0;
  const self = {
    calls: [] as CallRequest<z.ZodType>[],
    maxActive: 0,
    async call<T extends z.ZodType>(req: CallRequest<T>) {
      self.calls.push(req as CallRequest<z.ZodType>);
      active++;
      self.maxActive = Math.max(self.maxActive, active);
      await new Promise((r) => setTimeout(r, 2));
      active--;
      const record = { role: req.role, provider: req.role === "reviewer" ? "openai" : "anthropic", providerLabel: req.role === "reviewer" ? "OpenAI" : "Claude (Anthropic)", model: "mock", latencyMs: 2, attempts: 1, inputTokens: 10, outputTokens: 5, ok: true, error: null };
      if (plan.failAnalysts && req.role === "analyst") throw new Error("provider down");
      const ids = [...req.prompt.matchAll(/<check id="([^"]+)"/g)].map((m) => m[1]);
      const lineIds = [...req.prompt.matchAll(/^- ([a-z-]+) \|/gm)].map((m) => m[1]);
      let data: unknown;
      if (req.name === "analyst_checks")
        data = {
          assessments: ids.map((id) => (plan.analystDelta?.[id] ? { feature: id, verdict: "disagree", score: plan.analystDelta[id].score, evidence: [plan.analystDelta[id].quote], reason: "mock" } : { feature: id, verdict: "agree", score: engine.get(id) ?? 0, evidence: [], reason: "mock" })),
          summary: "mock",
        };
      else if (req.name === "reviewer_checks") data = { reviews: ids.map((id) => ({ feature: id, decision: plan.reviewerAgrees === false && plan.analystDelta?.[id] ? "reject" : "accept", score: plan.analystDelta?.[id]?.score ?? engine.get(id) ?? 0, evidence: [], reason: "mock" })), summary: "mock" };
      else if (req.name === "verifier_tiebreak") data = { decisions: ids.map((id) => ({ feature: id, score: engine.get(id) ?? 0, reason: "mock" })) };
      else if (/^analyst_(critical|high|passed)$/.test(req.name)) {
        const current = (/Currently in the class \(\d+\): (.*)\./.exec(req.prompt)?.[1] ?? "none").split(", ").filter((x) => x && x !== "none");
        const label = req.name.replace("analyst_", "");
        data = { claims: current.map((id) => ({ feature: id, label, evidence: [], reason: "mock" })), summary: "mock" };
      } else if (/^reviewer_(critical|high|passed)$/.test(req.name)) data = { reviews: lineIds.map((id) => ({ feature: id, decision: "accept", reason: "mock" })), summary: "mock" };
      else if (req.name === "analyst_status") data = { status: report.status, claims: report.blockers.map((b) => ({ feature: b.feature, label: "blocker", evidence: [], reason: "mock" })), summary: "mock" };
      else if (req.name === "reviewer_status") data = { status: report.status, reviews: lineIds.map((id) => ({ feature: id, decision: "accept", reason: "mock" })), summary: "mock" };
      else if (req.name === "analyst_top") data = { pick: lineIds[0], evidence: [], reason: "mock", summary: "mock" };
      else if (req.name === "reviewer_top") data = { decision: "accept", preferred: "none", reason: "mock" };
      else if (req.name === "finalizer_top") data = { rationale: plan.finalizerText ?? "Verified by both agents.", recommendation: "Fix this issue first." };
      else if (req.name.startsWith("finalizer_")) data = { rationale: plan.finalizerText ?? "Verified by both agents." };
      else throw new Error(`unexpected call ${req.name}`);
      return { data: req.schema.parse(data) as z.infer<T>, record };
    },
  };
  return self;
}

/** An aggregate with the recommendation reduced to its issue (the finalizer may reword its text). */
const scoresOf = (a: ReturnType<typeof aggregate>) => ({ ...a, topRecommendation: a.topRecommendation?.feature ?? null });

const run = (report: Report, llm: AgentLlm, cancelled?: () => Promise<boolean>) => runPipeline({ draft: DRAFT, report, research: null, fingerprint: "fp" }, { llm, cancelled, providers: 2 });

test("pipeline: when every agent agrees with the engine, all 13 finals equal the engine values", async () => {
  const report = engineReport();
  const llm = mockLlm(report);
  const stages: string[] = [];
  const res = await runPipeline({ draft: DRAFT, report, research: null, fingerprint: "fp" }, { llm, providers: 2, onStage: (i, s, st) => stages.push(`${i}:${s}:${st}`) });
  assert.equal(res.items.length, ITEMS.length);
  const { topRecommendation, ...rest } = res.final;
  const { topRecommendation: engineTop, ...engineRest } = aggregate(report.findings);
  assert.deepEqual(rest, engineRest);
  assert.equal(topRecommendation?.feature ?? null, engineTop?.feature ?? null);
  assert.equal(topRecommendation?.text ?? null, engineTop ? "Fix this issue first." : null, "the finalizer's guarded recommendation is the verified one");
  assert.deepEqual(res.summary.final, res.final);
  for (const it of res.items) {
    assert.deepEqual(it.final, it.engine, it.id);
    assert.equal(it.changed, false, it.id);
    for (const s of ["analyst", "reviewer", "verifier", "finalizer"] as const) assert.ok(["done", "skipped"].includes(it.stages[s].status), `${it.id} ${s} ${it.stages[s].status}`);
  }
  assert.equal(res.items.find((i) => i.id === "overall")!.final, report.overall);
  assert.equal(res.items.find((i) => i.id === "critical")!.final, report.counts.critical);
  assert.equal(res.items.find((i) => i.id === "passed")!.final, report.counts.passed);
  assert.equal(res.items.find((i) => i.id === "status")!.final, report.status);
  assert.equal(res.items.find((i) => i.id === "top")!.final, report.topRecommendation?.feature ?? null);
  assert.equal(res.items.find((i) => i.id === "quality")!.confidence, "high");
  assert.equal(res.summary.independentReviewer, true);
  assert.ok(res.summary.calls >= callBudget().min - ITEMS.length && res.summary.calls <= callBudget().max, `calls ${res.summary.calls}`);
  assert.ok(llm.maxActive <= 4, "at most four calls at once");
  assert.ok(stages.includes("overall:finalizer:done"));
});

test("pipeline: an agreed, evidenced change moves one check by at most 0.25 and re-aggregates with the engine's math", async () => {
  const report = engineReport();
  const target = report.findings.find((f) => f.score != null && f.score <= 0.6 && featureById(f.feature)?.category === "quality") ?? report.findings.find((f) => f.score != null && f.score <= 0.6)!;
  const quote = "In our experience counselling 1,200 applicants in 2025, students who took two exams had more options.";
  const res = await run(report, mockLlm(report, { analystDelta: { [target.feature]: { score: 1, quote } } }));
  const row = res.items.flatMap((i) => i.ledger ?? []).find((l) => l.feature === target.feature)!;
  assert.equal(row.outcome, "adjusted");
  assert.equal(row.final, Math.round((target.score! + MAX_ADJUST) * 100) / 100);
  assert.deepEqual(scoresOf(res.final), scoresOf(aggregate(applyScores(report.findings, new Map([[target.feature, row.final]])))));
  const cat = featureById(target.feature)!.category!;
  const item = res.items.find((i) => i.kind === "score" && (i.id === cat || (cat === "linking" && i.id === "overall")))!;
  assert.ok((item.delta ?? 0) >= 0);
});

test("pipeline: fabricated quotes and rejected claims leave the engine score untouched", async () => {
  const report = engineReport();
  const target = report.findings.find((f) => f.score != null && f.score < 0.75)!;
  const fabricated = await run(report, mockLlm(report, { analystDelta: { [target.feature]: { score: 1, quote: "This university is ranked number one in India by every agency." } } }));
  const row = fabricated.items.flatMap((i) => i.ledger ?? []).find((l) => l.feature === target.feature)!;
  assert.equal(row.outcome, "dropped");
  assert.equal(row.final, target.score);
  assert.deepEqual(scoresOf(fabricated.final), scoresOf(aggregate(report.findings)));
  assert.ok(fabricated.summary.droppedClaims >= 1);
  const rejected = await run(report, mockLlm(report, { analystDelta: { [target.feature]: { score: 1, quote: "Final-year students can apply provisionally." } }, reviewerAgrees: false }));
  assert.equal(rejected.items.flatMap((i) => i.ledger ?? []).find((l) => l.feature === target.feature)!.outcome, "rejected");
  assert.deepEqual(scoresOf(rejected.final), scoresOf(aggregate(report.findings)));
});

test("pipeline: a score on the wrong scale (8 meant as 0.8) voids the claim instead of clamping to 100%", async () => {
  const report = engineReport();
  const target = report.findings.find((f) => f.score != null && f.score < 0.75)!;
  const res = await run(report, mockLlm(report, { analystDelta: { [target.feature]: { score: 8, quote: "Final-year students can apply provisionally." } } }));
  const row = res.items.flatMap((i) => i.ledger ?? []).find((l) => l.feature === target.feature)!;
  assert.equal(row.outcome, "no-claim");
  assert.equal(row.final, target.score);
});

test("pipeline: a finalizer rationale with invented numbers is replaced by the rule-based one", async () => {
  const report = engineReport();
  const res = await run(report, mockLlm(report, { finalizerText: "The score is 9.9 after review." }));
  for (const it of res.items) assert.equal(it.rationaleSource, "rule", it.id);
  assert.ok(res.items[0].stages.finalizer.notes.some((n) => n.includes("rejected")));
});

test("pipeline: fails loudly when no analyst can run, and stops when cancelled", async () => {
  const report = engineReport();
  await assert.rejects(run(report, mockLlm(report, { failAnalysts: true })), /No analyst agent could run/);
  await assert.rejects(run(report, mockLlm(report), async () => true), CancelledError);
});

test("pipeline: a run where a category's agents failed is only partly verified (confidence low)", async () => {
  const report = engineReport();
  const base = mockLlm(report);
  let n = 0;
  // The reviewer fails for one score item (both attempts are one call here).
  const llm: AgentLlm = {
    async call(req) {
      if (req.name === "reviewer_checks" && n++ === 0) throw new Error("provider down");
      return base.call(req);
    },
  };
  const res = await run(report, llm);
  assert.equal(res.summary.confidence, "low");
  assert.equal(res.items.find((i) => i.id === "overall")!.confidence, "low");
  assert.ok(res.summary.warnings.some((w) => w.startsWith("Partly verified")));
});

test("limiter never runs more than its maximum at once", async () => {
  const gate = limiter(4);
  let active = 0;
  let peak = 0;
  await Promise.all(
    Array.from({ length: 20 }, () =>
      gate(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 3));
        active--;
      }),
    ),
  );
  assert.equal(peak, 4);
});

test("the reviewer and tie-breaker run on other providers whenever more than one is configured", async () => {
  const { rolePlan } = await import("../src/lib/optimizer/agents/llm");
  assert.deepEqual(rolePlan(["anthropic", "sarvam"]), { analyst: "anthropic", reviewer: "sarvam", "tie-break": "sarvam", verifier: "sarvam", finalizer: "anthropic" }, "two providers: the analyst never settles its own dispute");
  assert.deepEqual(rolePlan(["openai", "gemini", "sarvam"]), { analyst: "openai", reviewer: "gemini", "tie-break": "sarvam", verifier: "sarvam", finalizer: "openai" });
  assert.equal(rolePlan(["gemini"]).reviewer, "gemini", "one provider: same provider, independent prompt");
  assert.equal(rolePlan([]).analyst, null);
});

test("a run is not stale just because its stored engine result came back from jsonb with keys reordered", () => {
  const report = analyze({ title: "MBA admission process", keyword: "mba admission process", keywords: [], metaDescription: "", slug: "", url: "", body: "# MBA admission process\n\nSteps to apply for an MBA.\n\n## Eligibility\n\nA bachelor's degree.", meta: {} });
  // Postgres jsonb returns object keys in its own order (shorter keys first).
  const reorder = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.length - b.length || a.localeCompare(b)));
  const stored = JSON.parse(JSON.stringify({ ...report, counts: reorder(report.counts) }));
  assert.notEqual(JSON.stringify(stored.counts), JSON.stringify(report.counts), "the fixture really reorders the keys");
  assert.equal(isStale("fp", "fp", { run: stored, current: report }), false);
  assert.equal(isStale("fp", "fp", { run: { ...stored, counts: { ...stored.counts, critical: stored.counts.critical + 1 } }, current: report }), true);
});
