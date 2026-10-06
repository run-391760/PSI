import assert from "node:assert/strict";
import { test } from "node:test";
import { analyze, severityOf } from "../src/lib/optimizer/analyze";
import { researchBrief, briefToMarkdown } from "../src/lib/optimizer/brief";
import { briefCompetitors, briefDocumentMarkdown } from "../src/lib/optimizer/brief-export";
import { cap } from "../src/lib/optimizer/checks/util";
import { CATEGORIES, CHECKS, FEATURES, MODULES } from "../src/lib/optimizer/features";
import { applyFix } from "../src/lib/optimizer/fixes";
import { aiFresh, bodyHash } from "../src/lib/optimizer/hash";
import { dataforseoIntent, detectFormat, keywordIntent } from "../src/lib/optimizer/intent";
import { draftInputFromDoc, migratedDraftIdOf } from "../src/lib/optimizer/migrate-doc";
import { parseDraft } from "../src/lib/optimizer/parse";
import { moduleScores, workflowState } from "../src/lib/optimizer/progress";
import { generateSchema, validateSchema } from "../src/lib/optimizer/schema";
import { gscFor, gscQueryEvidence, toneEvidence, toneOf } from "../src/lib/optimizer/signals";
import type { AiReview, CompetitorPage, DraftInput, GscPerformance, Research } from "../src/lib/optimizer/types";

const NOW = new Date("2026-10-05T10:00:00Z");

const GOOD = `# MBA Admission Process 2026: Eligibility, Exams and Steps

The MBA admission process is the sequence of eligibility checks, entrance exams, interviews and fee payment that business schools use to select students. This guide explains each step with the documents and dates you need, so you can plan your application.

## Eligibility criteria for MBA admission

You need a bachelor's degree with at least 50% marks (45% for reserved categories), according to the [AICTE approval handbook](https://www.aicte-india.org/approval-process). Final-year students can apply provisionally. For example, a BCom student in the final semester can apply and submit the degree later.

## Entrance exams accepted

Most universities accept CAT, MAT, XAT, CMAT and GMAT scores. In our experience counselling 1,200 applicants in 2025, students who took two exams had more options. The [CAT 2025 notification](https://iimcat.ac.in) lists 25 exam cities in Gujarat.

## Step-by-step MBA admission process

1. Register online and fill the application form
2. Upload mark sheets, the entrance score card and ID proof
3. Pay the application fee
4. Attend the group discussion and personal interview
5. Accept the offer and pay the first-semester fee

![MBA students at the admission interview](https://example.edu/images/mba-admission-interview.jpg)
*Applicants waiting for the personal interview on campus*

## Documents required

| Document | Why it is needed | Original or copy |
| --- | --- | --- |
| Mark sheets | Eligibility check | Original |
| Entrance score card | Merit list | Copy |

## Frequently asked questions

### Can I do an MBA without CAT?

Yes. Many universities accept MAT, CMAT, XAT or their own entrance test, and some admit students on the basis of graduation marks and an interview. Check each program's admission notice for the exams it accepts this year before you apply anywhere.

### How long does the MBA admission process take?

From registration to the offer letter the process usually takes four to eight weeks, depending on the interview schedule. Universities publish the timeline in their admission brochure, so keep it handy and track every deadline on your calendar.

## Key takeaways

Check eligibility first, take at least one accepted entrance exam, keep your documents ready and attend the interview. Read our [MBA fees guide](/mba-fees) or [download the brochure](https://example.edu/mba/brochure) to plan the next step.
`;

const draft = (over: Partial<DraftInput> = {}): DraftInput => ({
  title: "MBA Admission Process 2026: Eligibility, Exams and Steps",
  keyword: "mba admission process",
  keywords: [],
  metaDescription: "Learn the MBA admission process step by step: eligibility, entrance exams, documents, interviews and fees, with tips to plan your 2026 application.",
  slug: "mba-admission-process",
  url: "https://example.edu/blog/mba-admission-process",
  body: GOOD,
  meta: { author: { name: "Dr. Priya Shah", bio: "Professor of Management with 12 years of experience leading MBA admissions and counselling.", credentials: "Professor of Management", url: "https://example.edu/faculty/priya-shah" }, organization: { name: "Example University", url: "https://example.edu" }, publishedAt: "2026-09-01", modifiedAt: "2026-10-01", canonical: "https://example.edu/blog/mba-admission-process", robots: "index, follow" },
  ...over,
});

test("catalogue has all 70 PDF features, 17 modules and weights summing to 100%", () => {
  assert.equal(FEATURES.length, 70);
  assert.equal(CHECKS.length, 58);
  assert.equal(MODULES.length, 17);
  assert.equal(Math.round(CATEGORIES.reduce((s, c) => s + c.weight, 0) * 100), 100);
  for (const c of CHECKS) assert.ok(c.category, `${c.id} has a scoring category`);
  for (const f of FEATURES) assert.ok(MODULES.some((m) => m.id === f.module), `${f.id} belongs to a module`);
});

test("parser finds headings, sections, intro, conclusion, lists, tables, links, images and FAQs", () => {
  const d = parseDraft(GOOD, "example.edu");
  assert.equal(d.h1s.length, 1);
  assert.equal(d.headings.filter((h) => h.level === 2).length, 6);
  assert.ok(d.intro.words > 30);
  assert.equal(d.conclusion?.heading?.text, "Key takeaways");
  assert.equal(d.lists[0].ordered, true);
  assert.equal(d.lists[0].items.length, 5);
  assert.equal(d.tables[0].cols, 3);
  assert.equal(d.images[0].caption, "Applicants waiting for the personal interview on campus");
  assert.ok(d.links.some((l) => l.url === "/mba-fees" && l.internal));
  assert.ok(d.links.some((l) => l.url.includes("aicte") && !l.internal));
  assert.equal(d.faqs.length, 2);
  assert.equal(parseDraft("Intro [Write: answer here] and TODO later").placeholders.length, 2);
});

test("keyword intent and article format", () => {
  assert.equal(keywordIntent("best mba colleges in india").intent, "commercial");
  assert.equal(keywordIntent("apply for mba admission").intent, "transactional");
  assert.equal(keywordIntent("mba admission process").intent, "informational");
  assert.equal(keywordIntent("parul university login").intent, "navigational");
  assert.equal(keywordIntent("mba colleges near me").intent, "local");
  assert.equal(keywordIntent("how much does an mba cost").intent, "transactional");
  assert.equal(detectFormat("BBA vs BCom: which is better", parseDraft("# BBA vs BCom")).format, "comparison");
  assert.equal(detectFormat("10 best MBA colleges", parseDraft("# 10 best")).format, "listicle");
  assert.equal(detectFormat("How to apply for MBA", parseDraft("# How to apply")).format, "how-to");
});

test("a complete, well-optimized draft scores high and is ready to publish", () => {
  const r = analyze(draft(), { now: NOW });
  assert.equal(r.blockers.length, 0, JSON.stringify(r.blockers));
  assert.ok(r.overall! >= 7, `overall ${r.overall}`);
  assert.equal(r.counts.total, 58);
  assert.equal(r.categories.find((c) => c.id === "topical")!.score, null, "topical is unmeasured without research");
  assert.notEqual(r.status, "blocked");
});

test("blockers stop publishing regardless of score: noindex, placeholders, missing H1, invalid JSON-LD, risky claims", () => {
  const r = analyze(draft({ meta: { ...draft().meta, robots: "noindex, follow", schema: "{ not json" }, body: GOOD.replace(/^# .*$/m, "").replace("Final-year students", "We offer 100% placement guaranteed. [Write: add fee] Final-year students") }), { now: NOW });
  const by = new Set(r.blockers.map((b) => b.feature));
  for (const f of ["indexability", "structure", "headings", "schema-validate", "claim-risk"]) assert.ok(by.has(f), `blocker from ${f}`);
  assert.equal(r.status, "blocked");
  assert.ok(r.findings.filter((f) => f.blocker).every((f) => f.severity === "critical"));
});

test("intent failure caps the overall score (scoring principle)", () => {
  // A sales page targeting an informational "what is" query.
  const sales = `# Apply now for our MBA\n\nApply now! Enrol now and book a campus tour. Contact us today.\n\n## Fees\n\nFees are low. Apply now.\n\n## Contact\n\nCall us. Enquire now.`;
  const r = analyze(draft({ keyword: "what is an mba", title: "Apply Now for Our MBA", body: sales }), { now: NOW });
  assert.ok(r.cap, "score is capped");
  assert.ok(r.overall! <= r.cap!.value);
});

test("severity follows feature priority and status", () => {
  assert.equal(severityOf({ feature: "title", status: "fail" }), "critical");
  assert.equal(severityOf({ feature: "title", status: "warn" }), "high");
  assert.equal(severityOf({ feature: "slug", status: "warn" }), "low");
  assert.equal(severityOf({ feature: "slug", status: "pass", blocker: "x" }), "critical");
  assert.equal(severityOf({ feature: "slug", status: "pass" }), null);
});

test("fixes: set, meta, replace (all/last), insert positions, H1, link and alt", () => {
  const d = draft();
  assert.equal(applyFix(d, { kind: "set", field: "slug", value: "mba-admission" }).draft.slug, "mba-admission");
  assert.equal(applyFix(d, { kind: "meta", patch: { robots: "noindex" } }).draft.meta.robots, "noindex");
  const twice = { ...d, body: "A x. B x. C" };
  assert.equal(applyFix(twice, { kind: "replace", find: "x.", replace: "y.", last: true }).draft.body, "A x. B y. C");
  assert.equal(applyFix(twice, { kind: "replace", find: "x.", replace: "y.", all: true }).draft.body, "A y. B y. C");
  const before = applyFix(d, { kind: "insert", markdown: "## New section\n\nText", position: "before-conclusion" }).draft.body;
  assert.ok(before.indexOf("## New section") < before.indexOf("## Key takeaways") && before.indexOf("## New section") > before.indexOf("## Frequently asked questions"));
  const under = applyFix(d, { kind: "insert", markdown: "Extra row note.", position: { afterHeading: "Documents required" } }).draft.body;
  assert.ok(under.indexOf("Extra row note.") < under.indexOf("## Frequently asked questions"));
  assert.ok(applyFix({ ...d, body: "Intro\n\n## A" }, { kind: "set-h1", text: "Title" }).draft.body.startsWith("# Title\n"));
  const linked = applyFix(d, { kind: "link", phrase: "group discussion", url: "/gd-tips" }).draft.body;
  assert.ok(linked.includes("[group discussion](/gd-tips)"));
  const alt = applyFix({ ...d, body: "![](https://x.com/a/campus-tour.jpg)" }, { kind: "alt", src: "https://x.com/a/campus-tour.jpg", alt: "Campus tour" }).draft.body;
  assert.equal(alt, "![Campus tour](https://x.com/a/campus-tour.jpg)");
  assert.equal(applyFix(d, { kind: "replace", find: "not in the text", replace: "z" }).changed, false);
});

test("safe fixes raise the score and never add placeholders", () => {
  const rough = draft({ metaDescription: "", slug: "", meta: { robots: "index, follow" }, body: GOOD.replace(/^# .*\n/m, "") });
  const before = analyze(rough, { now: NOW });
  let cur = rough;
  for (const f of before.findings) for (const o of f.fixes ?? []) if (o.safe && o.fix) cur = applyFix(cur, o.fix).draft;
  const after = analyze(cur, { now: NOW });
  assert.ok(after.overall! > before.overall!, `${before.overall} → ${after.overall}`);
  assert.equal(parseDraft(cur.body).placeholders.length, 0);
  assert.ok(cur.meta.schema && validateSchema(cur.meta.schema, cur, parseDraft(cur.body)).valid);
});

test("generated JSON-LD is valid, matches visible content and validation catches problems", () => {
  const d = draft();
  const doc = parseDraft(d.body);
  const json = generateSchema(d, doc, "how-to") as { "@graph": { "@type": string }[] };
  const types = json["@graph"].map((n) => n["@type"]);
  for (const t of ["BlogPosting", "FAQPage", "HowTo", "BreadcrumbList"]) assert.ok(types.includes(t), t);
  assert.ok(!types.includes("Course"), "an admission-process article is not a Course page");
  assert.equal(validateSchema(JSON.stringify(json), d, doc).valid, true);
  const bad = validateSchema(JSON.stringify({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: [{ "@type": "Question", name: "Is this hidden?", acceptedAnswer: { "@type": "Answer", text: "Yes" } }] }), d, doc);
  assert.equal(bad.valid, false);
  assert.ok(validateSchema("{oops", d, doc).parseError);
});

const comp = (url: string, h2: string[], text: string, words = 1500): CompetitorPage => ({ url, domain: new URL(url).hostname, position: 1, title: "MBA admission process guide", metaDescription: "", h1: "", headings: h2.map((t) => ({ level: 2, text: t })), words, format: "guide", hasFaq: true, tables: 1, lists: 3, images: 2, hasVideo: false, schemaTypes: [], questions: ["What is the MBA admission process?"], text, error: null });

test("research drives topical coverage, questions and the brief", () => {
  const research: Research = {
    keyword: "mba admission process",
    db: "IN",
    serpSource: "urls",
    features: [],
    paa: ["What is the last date for MBA admission?"],
    related: [],
    autocomplete: ["mba admission process in gujarat", "mba admission process reddit", "how to get mba admission"],
    competitors: [
      comp("https://a.com/x", ["Eligibility criteria", "Entrance exams", "Scholarships for MBA students", "Placement statistics"], "The Graduate Management Admission Council runs GMAT. AICTE approves programs. Scholarships and placement statistics matter."),
      comp("https://b.com/y", ["Eligibility", "Scholarships for MBA", "Placement statistics and salary"], "AICTE approval and the Graduate Management Admission Council. Scholarships help. Placement statistics."),
      comp("https://c.com/z", ["Scholarships available", "Placement record"], "Scholarships. Graduate Management Admission Council. AICTE."),
    ],
    fetchedAt: NOW.toISOString(),
    notes: [],
  };
  const r = analyze(draft(), { research, now: NOW });
  assert.notEqual(r.categories.find((c) => c.id === "topical")!.score, null);
  const gaps = r.findings.find((f) => f.feature === "subtopic-gaps")!;
  assert.ok(gaps.items!.some((i) => /scholarship/i.test(i.label)), "scholarships flagged as a missing subtopic");
  assert.ok(!gaps.items!.some((i) => /reddit/i.test(i.label)), "platform modifiers are not subtopics");
  const paa = r.findings.find((f) => f.feature === "paa-coverage")!;
  assert.equal(paa.status === "na", false);
  const b = researchBrief("mba admission process", "IN", research);
  assert.ok(b.outline.some((o) => /scholarship/i.test(o.text)));
  assert.ok(b.questions.includes("What is the last date for MBA admission?"));
  assert.ok(briefToMarkdown(b).startsWith("# "));
});

test("Claude review is used only while fresh and blends into subjective checks", () => {
  const d = draft();
  const ai: AiReview = { model: "claude-opus-5-5", reviewedAt: NOW.toISOString(), bodyHash: bodyHash(d.body), bodyLength: d.body.length, intent: { dominant: "informational", match: 0.2, reason: "x" }, peopleFirst: { score: 0, reason: "x" }, originality: { score: 0, reason: "" }, informationGain: { score: 0, reason: "" }, experience: { score: 0, reason: "" }, completeness: { score: 0, missing: ["Scholarships"] }, entities: [], claims: [], recommendations: [] };
  assert.ok(aiFresh(ai, d.body));
  assert.ok(aiFresh(ai, d.body + " small edit"));
  assert.ok(!aiFresh(ai, d.body.slice(0, d.body.length / 2)));
  const withAi = analyze(d, { ai, now: NOW });
  const without = analyze(d, { now: NOW });
  assert.ok(withAi.findings.find((f) => f.feature === "people-first")!.score! < without.findings.find((f) => f.feature === "people-first")!.score!);
});

test("module scores and workflow progress", () => {
  const r = analyze(draft(), { now: NOW });
  const mods = moduleScores(r);
  assert.equal(mods.length, 17);
  assert.equal(mods.find((m) => m.id === "workflow")!.checks, 0);
  const steps = workflowState({ meta: {}, status: "draft", score: r.overall, baselineScore: 5 }, r, null, ["create", "fix"]);
  assert.equal(steps.length, 10);
  assert.ok(steps.find((s) => s.n === 7)!.done);
  assert.ok(!steps.find((s) => s.n === 10)!.done);
});

test("title casing keeps acronyms and small words", () => {
  assert.equal(cap("bba vs bcom which is better"), "BBA vs BCom Which Is Better");
  assert.equal(cap("mba admission process in gujarat"), "MBA Admission Process in Gujarat");
});

const baseResearch = (over: Partial<Research> = {}): Research => ({ keyword: "mba admission process", db: "IN", serpSource: "none", features: [], paa: [], related: [], autocomplete: [], competitors: [], fetchedAt: NOW.toISOString(), notes: [], ...over });

const GSC: GscPerformance = {
  source: "search-console",
  site: "sc-domain:example.edu",
  project: { id: "p1", name: "Example University" },
  url: "https://example.edu/blog/mba-admission-process/",
  start: "2026-09-07",
  end: "2026-10-04",
  page: { clicks: 120, impressions: 4800, ctr: 0.025, position: 8.4 },
  queries: [
    { query: "mba admission process", clicks: 60, impressions: 2000, ctr: 0.03, position: 6.2 },
    { query: "mba eligibility", clicks: 20, impressions: 900, ctr: 0.022, position: 9.1 },
  ],
  keywordPages: [
    { url: "https://example.edu/blog/mba-admission-process", clicks: 60, impressions: 2000, position: 6.2 },
    { url: "https://example.edu/mba", clicks: 5, impressions: 700, position: 14 },
  ],
  fetchedAt: NOW.toISOString(),
};

test("DataForSEO keyword data is an intent signal and is shown as evidence (only for the current keyword)", () => {
  const keywordData = { source: "dataforseo" as const, keyword: "mba admission process", db: "IN", volume: 9900, kd: 41, cpc: 1.2, competition: 0.4, intents: ["transactional" as const, "informational" as const], fetchedAt: NOW.toISOString() };
  const research = baseResearch({ keywordData });
  assert.equal(dataforseoIntent("mba admission process", research), "transactional");
  assert.equal(dataforseoIntent("mba fees", research), null, "stale keyword data is ignored");
  const r = analyze(draft(), { research, now: NOW });
  assert.equal(r.intent.dataforseo, "transactional");
  assert.equal(r.intent.dominant, "transactional", "without ranking pages, DataForSEO's intent outranks the query wording");
  const analyzer = r.findings.find((f) => f.feature === "intent-analyzer")!;
  assert.ok(analyzer.items!.some((i) => /DataForSEO keyword intent: Transactional/.test(i.label)));
  assert.ok(analyzer.sources.includes("keyword-data"));
  const relevance = r.findings.find((f) => f.feature === "keyword-relevance")!;
  assert.deepEqual(relevance.metrics?.map((m) => m.value), ["9,900", "41", "$1.20"]);
  // Ranking pages still win over the classifier.
  const serp = analyze(draft(), { research: { ...research, serpSource: "urls", competitors: [comp("https://a.com/x", ["Eligibility", "Exams", "Steps"], "Guide text."), comp("https://b.com/y", ["Eligibility", "Steps"], "Guide text.")] }, now: NOW });
  assert.equal(serp.intent.dominant, serp.intent.serp);
  assert.equal(CHECKS.length, 58, "no new checks");
});

test("Search Console data for the draft URL becomes evidence for keyword relevance and URL mapping", () => {
  const d = draft();
  assert.ok(gscFor(d, baseResearch({ gsc: GSC })), "trailing slash and www do not matter");
  assert.equal(gscFor({ ...d, url: "https://example.edu/other", meta: {} }, baseResearch({ gsc: GSC })), null, "data for another URL is not used");
  const ev = gscQueryEvidence(GSC, "mba admission process");
  assert.match(ev[0].label, /ranks for 2 queries/);
  assert.match(ev[1].label, /already ranks at #6\.2/);
  assert.equal(gscQueryEvidence(GSC, "bba fees")[1].tone, "warning");
  const r = analyze(d, { research: baseResearch({ gsc: GSC }), now: NOW });
  const relevance = r.findings.find((f) => f.feature === "keyword-relevance")!;
  assert.ok(relevance.sources.includes("search-console"));
  assert.ok(relevance.items!.some((i) => /Search Console: the page ranks for/.test(i.label)));
  const mapping = r.findings.find((f) => f.feature === "keyword-url")!;
  assert.ok(mapping.items!.some((i) => /example\.edu\/mba also ranks/.test(i.label)), "other ranking URL flagged");
  assert.ok(!mapping.items!.some((i) => /mba-admission-process also ranks/.test(i.label)), "the draft's own URL is not a clash");
  const plain = analyze(d, { now: NOW });
  assert.equal(plain.findings.find((f) => f.feature === "keyword-relevance")!.score, relevance.score, "evidence only: the score is unchanged");
});

test("readability carries the tone of voice as evidence", () => {
  const casual = toneOf(["Honestly, you'll love this stuff because it's super easy and fun!", "Don't worry, we've got you covered with tons of cool tips!"]);
  const formal = toneOf(["Accordingly, the institution shall furnish comprehensive documentation regarding the aforementioned eligibility requirements.", "Applicants are required to demonstrate proficiency through standardized examinations administered nationally."]);
  assert.ok(casual.score < 0 && /casual/i.test(casual.label));
  assert.ok(formal.score > 0 && /formal/i.test(formal.label));
  assert.equal(toneEvidence(toneOf([])), null);
  const r = analyze(draft(), { now: NOW });
  const readability = r.findings.find((f) => f.feature === "readability")!;
  const tone = readability.items!.find((i) => i.label.startsWith("Tone of voice:"));
  assert.ok(tone, "tone item present");
  assert.match(tone!.detail!, /−1 \(casual\) to \+1 \(formal\)/);
});

test("Writing Assistant documents map to optimizer drafts once", () => {
  const input = draftInputFromDoc({ id: "d1", title: "MBA guide", body: "# MBA guide\n\nText", keywords: ["MBA Admission", "mba fees", "mba admission"], settings: { db: "in", tone: "neutral" } });
  assert.equal(input.keyword, "mba admission");
  assert.deepEqual(input.keywords, ["mba fees"]);
  assert.equal(input.title, "MBA guide");
  assert.equal(input.body, "# MBA guide\n\nText");
  assert.equal(input.meta?.db, "IN");
  assert.equal(draftInputFromDoc({ id: "d2", title: "Untitled document", body: "", keywords: null, settings: null }).title, "");
  assert.equal(migratedDraftIdOf({ migratedDraftId: "abc" }), "abc");
  assert.equal(migratedDraftIdOf({ migratedDraftId: "pending" }), null, "a claim in progress is not a migration");
  assert.equal(migratedDraftIdOf({ tone: "neutral" }), null);
  assert.equal(migratedDraftIdOf(null), null);
});

test("briefs keep the pages analysed and SERP features, and export as Markdown", () => {
  const research = baseResearch({
    serpSource: "serp",
    features: ["featured_snippet", "people_also_ask"],
    competitors: [comp("https://a.com/x", ["Eligibility", "Exams"], "Text"), { ...comp("https://b.com/y", [], ""), error: "HTTP 403", words: 0 }],
  });
  assert.equal(briefCompetitors(research).length, 1, "pages that failed to crawl are left out");
  const b = researchBrief("mba admission process", "IN", research);
  assert.deepEqual(b.serpFeatures, ["featured_snippet", "people_also_ask"]);
  assert.equal(b.competitors![0].domain, "a.com");
  const md = briefDocumentMarkdown(b);
  assert.ok(md.startsWith("# Content brief: mba admission process"));
  assert.match(md, /## Pages analysed/);
  assert.match(md, /\[MBA admission process guide\]\(https:\/\/a\.com\/x\)/);
  assert.match(md, /featured snippet, people also ask/);
});
