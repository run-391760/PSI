import { hasKeyword, wordList } from "@/lib/content/text";
import { answered, covered, type Ctx, type Target } from "../context";
import { isConclusionHeading } from "../parse";
import type { Finding, FixOption } from "../types";
import { detectClaims } from "./claims";
import { capFirst, clamp01, finding, na, pct, plural, quote } from "./util";

/** SERP & AI Search (snippets, PAA, answerability) and Topical SEO (entities, clusters, gaps). */

const SRC: Record<Target["source"], "serp" | "autocomplete" | "competitors" | "content" | "ai"> = { paa: "serp", autocomplete: "autocomplete", competitors: "competitors", brief: "content", ai: "ai" };
const srcLabel = (t: Target) => (t.source === "paa" ? "People Also Ask" : t.source === "autocomplete" ? "Google Autocomplete" : t.source === "competitors" ? `${t.support} ranking pages` : t.source === "brief" ? "content brief" : "Claude");

/** Insert an FAQ block for unanswered questions: Claude writes answers, or a scaffold with placeholders. */
export function faqFixes(ctx: Ctx, qs: string[], id: string): FixOption[] {
  if (!qs.length) return [];
  const list = qs.slice(0, 6);
  const hasFaq = ctx.doc.headings.some((h) => /^(faqs?|frequently asked questions)/i.test(h.text));
  const heading = hasFaq ? "" : "## Frequently asked questions\n\n";
  const scaffold = `${heading}${list.map((q) => `### ${capFirst(q.replace(/\?*$/, "?"))}\n\n[Write: a direct 40–60 word answer]`).join("\n\n")}`;
  const position = hasFaq ? { afterHeading: ctx.doc.headings.find((h) => /^(faqs?|frequently asked questions)/i.test(h.text))!.text } : ("before-conclusion" as const);
  return [
    { id: `${id}-ai`, label: `Answer ${plural(list.length, "question")} with Claude`, description: "Claude writes concise 40–60 word answers under question headings for you to review.", ai: { task: "faq", instruction: `Write an FAQ block answering these questions about “${ctx.kw}” in 40–60 words each, under ### question headings:\n${list.map((q) => `- ${q}`).join("\n")}` }, safe: false },
    { id: `${id}-scaffold`, label: `Add FAQ scaffold (${list.length})`, description: "Adds question headings with [Write: …] placeholders. Placeholders block publishing until you replace them.", fix: { kind: "insert", markdown: scaffold, position }, safe: false },
  ];
}

export function sectionFixes(ctx: Ctx, topics: Target[], id: string): FixOption[] {
  return topics.slice(0, 5).flatMap((t, i) => [
    { id: `${id}-ai-${i}`, label: `Write “${capFirst(t.text)}” with Claude`, description: `Claude drafts a section on this subtopic (seen in ${srcLabel(t)}).`, ai: { task: "section" as const, instruction: `Write a new section (## heading + 120–220 words, lists where useful) covering “${t.text}” for the article about “${ctx.kw}”. Keep facts verifiable and mark anything needing a source with [source needed].`, target: t.text }, safe: false },
    { id: `${id}-scaffold-${i}`, label: `Add section “${capFirst(t.text)}”`, description: "Adds an H2 with a [Write: …] placeholder at the end of the body (before the conclusion).", fix: { kind: "insert" as const, markdown: `## ${capFirst(t.text)}\n\n[Write: cover ${t.text}]`, position: "before-conclusion" as const }, safe: false },
  ]);
}

export function featuredSnippet(ctx: Ctx): Finding {
  const d = ctx.doc;
  if (d.words < 50) return na("featured-snippet", "Add the article text to audit it.");
  const candidates: { kind: string; text: string }[] = [];
  for (const p of d.paragraphs) {
    const first = p.text.split(/(?<=[.!?])\s/)[0] ?? "";
    const defin = ctx.kw ? hasKeyword(first, ctx.kw) && /\b(is|are|means|refers to|is defined as)\b/i.test(first) : /\b(is|are|means)\b/.test(first);
    const afterQ = d.headings.some((h) => /\?\s*$/.test(h.text) && h.line < p.line && !d.headings.some((x) => x.line > h.line && x.line < p.line) && p.line - h.line <= 3);
    if (p.words >= 35 && p.words <= 65 && (defin || afterQ)) candidates.push({ kind: defin ? "Definition paragraph" : "Answer under a question heading", text: p.text });
  }
  for (const l of d.lists) if (l.ordered && l.items.length >= 3) candidates.push({ kind: "Numbered list", text: l.items.slice(0, 3).join(" / ") });
  for (const t of d.tables) if (t.rows >= 2) candidates.push({ kind: "Table", text: t.headers.join(" | ") });
  const kinds = new Set(candidates.map((c) => c.kind));
  const score = candidates.length === 0 ? 0.2 : kinds.size >= 2 ? 1 : 0.75;
  const fixes: FixOption[] = [];
  if (!candidates.some((c) => c.kind === "Definition paragraph") && ctx.kw)
    fixes.push({ id: "snippet-definition", label: "Add a 40–60 word definition", description: `Claude writes a direct answer to “what is ${ctx.kw}” to place right after the H1.`, ai: { task: "intro", instruction: `Write a 40–60 word paragraph that directly defines/answers “${ctx.kw}” in the first sentence (e.g. "${capFirst(ctx.kw)} is …"). It will be placed at the top of the article.`, target: "definition" }, safe: false });
  return finding("featured-snippet", score, candidates.length ? `${plural(candidates.length, "snippet-ready block")}: ${[...kinds].join(", ")}.` : "No section is formatted for a featured snippet.", ["content"], {
    items: candidates.slice(0, 8).map((c) => ({ label: c.kind, detail: quote(c.text, 150), tone: "good" as const })),
    fixes,
    how: score < 0.8 ? "Under a question heading, answer in one 40–60 word paragraph; use numbered lists for steps and tables for comparisons." : undefined,
  });
}

export function paaCoverage(ctx: Ctx): Finding {
  const paa = ctx.questions.filter((q) => q.source === "paa");
  const pool = paa.length ? paa : ctx.questions.filter((q) => q.source === "autocomplete" || q.source === "competitors");
  if (!pool.length) return na("paa-coverage", "No People Also Ask questions yet.", "Run SERP research: live People Also Ask with DataForSEO, otherwise question-style Google Autocomplete suggestions.");
  const missing = pool.filter((q) => !answered(ctx, q.text));
  const ratio = 1 - missing.length / pool.length;
  return finding("paa-coverage", clamp01(ratio / 0.7), `Answers ${pool.length - missing.length} of ${plural(pool.length, paa.length ? "People Also Ask question" : "related question")}${paa.length ? "" : " (from autocomplete/ranking pages; no live PAA data)"}.`, [paa.length ? "serp" : SRC[pool[0].source]], {
    items: pool.map((q) => ({ label: q.text, detail: answered(ctx, q.text) ? "Answered" : `Not answered · ${srcLabel(q)}`, tone: answered(ctx, q.text) ? ("good" as const) : ("warning" as const) })),
    fixes: faqFixes(ctx, missing.map((q) => q.text), "paa"),
  });
}

export function answerability(ctx: Ctx): Finding {
  const d = ctx.doc;
  if (d.words < 50) return na("answerability", "Add the article text to audit it.");
  const introSentences = d.intro.text.split(/(?<=[.!?])\s+/).slice(0, 3).join(" ");
  const direct = ctx.kw ? hasKeyword(introSentences, ctx.kw) && /\b(is|are|means|refers to|helps|lets|allows|costs?|takes)\b/i.test(introSentences) : false;
  const dangling = d.paragraphs.filter((p) => /^(this|it|these|that|they|those|such|here)\b/i.test(p.text)).length / Math.max(1, d.paragraphs.length);
  const qh = d.headings.filter((h) => /\?\s*$/.test(h.text));
  const crisp = qh.filter((h) => {
    const p = d.paragraphs.find((x) => x.line > h.line);
    return p && wordList(p.text.split(/(?<=[.!?])\s/)[0] ?? "").length <= 30;
  }).length;
  const summary = d.headings.some((h) => /\b(key takeaways|takeaways|summary|tl;?dr|at a glance|quick answer|in short)\b/i.test(h.text)) || /^\*\*(tl;?dr|in short|quick answer)/im.test(ctx.draft.body);
  const claims = detectClaims(d);
  const supported = claims.length ? claims.filter((c) => c.supported).length / claims.length : 1;
  const parts = [
    { label: "Direct answer up front", ok: direct, detail: direct ? "The opening answers the query" : "Open with a sentence that answers the query directly" },
    { label: "Self-contained paragraphs", ok: dangling <= 0.2, detail: `${pct(dangling)} of paragraphs start with “this/it/these…” (need context to make sense)` },
    { label: "Question headings answered crisply", ok: !qh.length || crisp / qh.length >= 0.7, detail: qh.length ? `${crisp} of ${qh.length} answer in the first sentence` : "No question headings" },
    { label: "Summary / key takeaways", ok: summary, detail: summary ? "Present" : "Add a short key-takeaways block" },
    { label: "Supported facts", ok: supported >= 0.6, detail: `${pct(supported)} of claims have a source` },
  ];
  const score = parts.filter((p) => p.ok).length / parts.length;
  const fixes: FixOption[] = [];
  const firsts = d.sections.filter((s) => s.heading && !isConclusionHeading(s.heading.text)).map((s) => d.paragraphs.find((p) => p.section === s.index)?.text.split(/(?<=[.!?])\s/)[0]).filter((x): x is string => !!x && x.length > 25 && x.length < 220);
  if (!summary && firsts.length >= 3)
    fixes.push({ id: "takeaways", label: "Add key takeaways (from your sections)", description: "Inserts a “Key takeaways” list after the introduction built from the first sentence of each section.", fix: { kind: "insert", markdown: `## Key takeaways\n\n${firsts.slice(0, 5).map((f) => `- ${f}`).join("\n")}`, position: "after-intro" }, safe: false });
  if (!direct && ctx.kw) fixes.push({ id: "answer-first", label: "Write a direct opening answer", description: "Claude writes a 1–2 sentence direct answer to open the article.", ai: { task: "intro", instruction: `Rewrite the first paragraph so its first sentence directly answers “${ctx.kw}” in plain words, followed by what the article covers. Under 90 words.` }, safe: false });
  return finding("answerability", score, `${parts.filter((p) => p.ok).length} of ${parts.length} answerability checks pass.`, ["content"], { items: parts.map((p) => ({ label: p.label, detail: p.detail, tone: p.ok ? ("good" as const) : ("warning" as const) })), fixes, how: score < 0.8 ? "Answer first, then explain. Make each paragraph understandable on its own and back facts with sources." : undefined });
}

export function entities(ctx: Ctx): Finding {
  const list = ctx.entities;
  if (!list.length) return na("entities", "No entity list yet.", "Run SERP research (entities used by ranking pages), run a Claude review, or generate a brief.");
  const plain = `${ctx.draft.title}\n${ctx.doc.plain}`.toLowerCase();
  const has = (e: string) => plain.includes(e.toLowerCase());
  const missing = list.filter((e) => !has(e.text));
  const ratio = 1 - missing.length / list.length;
  return finding("entities", clamp01(ratio / 0.7), `Mentions ${list.length - missing.length} of ${plural(list.length, "important entity", "important entities")}.`, [...new Set(list.map((e) => SRC[e.source]))], {
    items: [...missing.map((e) => ({ label: e.text, detail: `Missing · ${srcLabel(e)}`, tone: "warning" as const })), ...list.filter((e) => has(e.text)).map((e) => ({ label: e.text, detail: "Mentioned", tone: "good" as const }))],
    how: missing.length ? "Mention the relevant organizations, programs, places, standards and concepts where they help the reader (and link to them when useful)." : undefined,
  });
}

export function topicCluster(ctx: Ctx): Finding {
  const subs = ctx.subtopics;
  if (!subs.length) return na("topic-cluster", "No subtopic map yet.", "Run SERP research or generate a content brief to map the subtopics around this topic.");
  const cov = subs.filter((s) => covered(ctx, s.text) >= 0.6);
  const ratio = cov.length / subs.length;
  const bySource = [...new Set(subs.map((s) => s.source))].map((src) => {
    const all = subs.filter((s) => s.source === src);
    return { label: `From ${srcLabel(all[0]).replace(/^\d+ /, "")}`, detail: `${all.filter((s) => covered(ctx, s.text) >= 0.6).length}/${all.length} covered`, tone: "neutral" as const };
  });
  return finding("topic-cluster", clamp01(ratio / 0.75), `Covers ${cov.length} of ${plural(subs.length, "subtopic")} around “${ctx.kw}” (${pct(ratio)}).`, [...new Set(subs.map((s) => SRC[s.source]))], {
    metrics: [
      { label: "Subtopics", value: String(subs.length) },
      { label: "Covered", value: String(cov.length) },
      { label: "Coverage", value: pct(ratio) },
    ],
    items: [...bySource, ...subs.map((s) => ({ label: capFirst(s.text), detail: covered(ctx, s.text) >= 0.6 ? "Covered" : `Missing · ${srcLabel(s)}`, tone: covered(ctx, s.text) >= 0.6 ? ("good" as const) : ("warning" as const) }))],
    how: ratio < 0.75 ? "Add sections for the missing subtopics (Subtopic Gap Finder lists them by importance)." : undefined,
  });
}

export function subtopicGaps(ctx: Ctx): Finding {
  const subs = ctx.subtopics;
  if (!subs.length) return na("subtopic-gaps", "No subtopic map yet.", "Run SERP research or generate a content brief.");
  const important = subs.filter((s) => s.support >= 2);
  const pool = important.length ? important : subs;
  const missing = pool.filter((s) => covered(ctx, s.text) < 0.6).sort((a, b) => b.support - a.support);
  const score = 1 - missing.length / pool.length;
  return finding("subtopic-gaps", score, missing.length ? `${plural(missing.length, "important subtopic")} missing: ${missing.slice(0, 4).map((m) => m.text).join(", ")}${missing.length > 4 ? "…" : ""}.` : "No important subtopic is missing.", [...new Set(pool.map((s) => SRC[s.source]))], {
    items: missing.map((m) => ({ label: capFirst(m.text), detail: srcLabel(m), tone: m.support >= 3 ? ("critical" as const) : ("warning" as const) })),
    fixes: sectionFixes(ctx, missing, "subtopic"),
  });
}

export function competitorGaps(ctx: Ctx): Finding {
  const comps = ctx.competitors;
  if (!comps.length) return na("competitor-gaps", "No competitor pages analyzed.", "Run SERP research or add competitor URLs in the Search Intent tab.");
  const rows = comps.map((c) => {
    const h2 = c.headings.filter((h) => h.level === 2 && !/^(conclusion|faq|frequently|related|table of contents|contents|share)/i.test(h.text));
    const miss = h2.filter((h) => covered(ctx, h.text) < 0.6);
    const extras = [c.hasFaq && ctx.doc.faqs.length < 2 && "FAQ", c.tables > 0 && !ctx.doc.tables.length && "tables", c.hasVideo && !ctx.doc.embeds.some((e) => e.kind === "video") && "video"].filter(Boolean) as string[];
    return { c, cov: h2.length ? 1 - miss.length / h2.length : 1, miss, extras };
  });
  const avg = rows.reduce((a, r) => a + r.cov, 0) / rows.length;
  return finding("competitor-gaps", clamp01(avg / 0.8), `You cover ${pct(avg)} of the sections the ${plural(comps.length, "competitor")} have on average.`, [ctx.research?.serpSource === "serp" ? "serp" : "competitors", "content"], {
    items: rows.map((r) => ({
      label: `${r.c.position ? `#${r.c.position} ` : ""}${r.c.domain} — ${pct(r.cov)} covered`,
      detail: [r.miss.length ? `They cover: ${r.miss.slice(0, 5).map((m) => m.text).join("; ")}` : "Nothing they cover is missing", r.extras.length ? `They also use: ${r.extras.join(", ")}` : "", `${r.c.words.toLocaleString()} words vs your ${ctx.doc.words.toLocaleString()}`].filter(Boolean).join(" · "),
      tone: r.cov >= 0.8 ? ("good" as const) : ("warning" as const),
      href: r.c.url,
    })),
  });
}

export function questionGaps(ctx: Ctx): Finding {
  const qs = ctx.questions;
  if (!qs.length) return na("question-gaps", "No related questions yet.", "Run SERP research (People Also Ask, Autocomplete, competitor FAQs) or generate a brief.");
  const missing = qs.filter((q) => !answered(ctx, q.text));
  const score = clamp01((1 - missing.length / qs.length) / 0.75);
  return finding("question-gaps", score, missing.length ? `${plural(missing.length, "related question")} not answered.` : "Every related question is answered.", [...new Set(qs.map((q) => SRC[q.source]))], {
    items: missing.map((q) => ({ label: q.text, detail: srcLabel(q), tone: "warning" as const })),
    fixes: faqFixes(ctx, missing.map((q) => q.text), "questions"),
  });
}
