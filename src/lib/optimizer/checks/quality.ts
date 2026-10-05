import { hasKeyword, isComplexWord, isPassive, readabilityOf, wordList } from "@/lib/content/text";
import { answered, covered, STOP, type Ctx } from "../context";
import { hasCta } from "../intent";
import { contentTokens, isConclusionHeading, stem } from "../parse";
import type { Finding, FixOption } from "../types";
import { detectClaims, sourceQuality } from "./claims";
import { blend, clamp01, finding, na, pct, phraseHits, plural, quote } from "./util";

/** Content Quality module (people-first, completeness, depth, originality, … conclusion). */

export const GENERIC_PHRASES = [
  "in today's world",
  "in today's fast-paced world",
  "in today's digital age",
  "in the ever-evolving",
  "ever-changing landscape",
  "it is important to note",
  "it's important to note",
  "it is worth noting",
  "it's worth noting",
  "plays a crucial role",
  "plays a vital role",
  "plays a pivotal role",
  "a testament to",
  "delve into",
  "delves into",
  "dive into",
  "deep dive",
  "unlock the",
  "unlock your",
  "unleash",
  "navigate the",
  "navigating the",
  "embark on",
  "rich tapestry",
  "tapestry",
  "in the realm of",
  "the world of",
  "game-changer",
  "game changer",
  "cutting-edge",
  "state-of-the-art",
  "seamless",
  "seamlessly",
  "robust",
  "leverage",
  "harness the power",
  "elevate your",
  "foster",
  "holistic",
  "synergy",
  "paradigm",
  "look no further",
  "whether you're a",
  "whether you are a",
  "in conclusion",
  "to sum up",
  "all in all",
  "at the end of the day",
  "the bottom line is",
  "stands as",
  "serves as a",
  "it goes without saying",
  "needless to say",
  "first and foremost",
  "last but not least",
  "without further ado",
  "let's dive in",
  "let's explore",
  "ultimately",
];

export const FILLER_PHRASES: { phrase: string; replace?: string }[] = [
  { phrase: "it goes without saying that ", replace: "" },
  { phrase: "needless to say, ", replace: "" },
  { phrase: "without further ado, ", replace: "" },
  { phrase: "at the end of the day, ", replace: "" },
  { phrase: "in order to", replace: "to" },
  { phrase: "due to the fact that", replace: "because" },
  { phrase: "at this point in time", replace: "now" },
  { phrase: "for all intents and purposes", replace: "in effect" },
  { phrase: "in spite of the fact that", replace: "although" },
  { phrase: "it should be noted that ", replace: "" },
  { phrase: "it is worth noting that ", replace: "" },
  { phrase: "it is important to note that ", replace: "" },
  { phrase: "the fact of the matter is ", replace: "" },
  { phrase: "as we all know, ", replace: "" },
  { phrase: "as mentioned above" },
  { phrase: "in this article" },
  { phrase: "in this blog" },
  { phrase: "in this post" },
  { phrase: "we will discuss" },
  { phrase: "when it comes to" },
  { phrase: "a lot of" },
  { phrase: "kind of" },
  { phrase: "sort of" },
  { phrase: "basically" },
  { phrase: "literally" },
  { phrase: "really" },
  { phrase: "very" },
  { phrase: "quite" },
  { phrase: "actually" },
];

const EXPERIENCE = [
  "we tested",
  "i tested",
  "we tried",
  "i tried",
  "in our experience",
  "in my experience",
  "we found",
  "i found",
  "we noticed",
  "i noticed",
  "we observed",
  "our team",
  "our students",
  "our faculty",
  "our graduates",
  "our alumni",
  "our data",
  "our survey",
  "we surveyed",
  "we interviewed",
  "we analyzed",
  "we analysed",
  "i visited",
  "we visited",
  "hands-on",
  "first-hand",
  "firsthand",
  "case study",
  "when i",
  "when we",
  "i learned",
  "we learned",
  "i spoke",
  "we spoke",
  "told us",
  "shared with us",
];

const EXAMPLE = /\b(for example|for instance|e\.g\.|such as|case study|consider|imagine|here's how|let's say)\b/gi;
const NUMBER = /\b\d[\d,.]*\b/g;
const words = (s: string) => wordList(s).length;

function aiFix(id: string, label: string, task: NonNullable<FixOption["ai"]>["task"], instruction: string, target?: string): FixOption {
  return { id, label, description: "Claude writes a revision for you to review before it is applied.", ai: { task, instruction, target }, safe: false };
}

export function peopleFirst(ctx: Ctx): Finding {
  const d = ctx.doc;
  if (d.words < 50) return na("people-first", "Add the article text to audit it.");
  const per100 = (n: number) => (n / Math.max(1, d.words)) * 100;
  const you = per100((d.plain.match(/\b(you|your|you're|yourself)\b/gi) ?? []).length);
  const specifics = per100((d.plain.match(NUMBER) ?? []).length + (d.plain.match(EXAMPLE) ?? []).length * 2);
  const actionable = d.lists.length > 0 || /\b(step|tip|do this|try|check|make sure|start by|avoid)\b/i.test(d.plain);
  const early = ctx.kw ? hasKeyword(d.intro.text.split(/\s+/).slice(0, 120).join(" "), ctx.kw) || ctx.kwTokens.every((t) => new RegExp(`\\b${t}`, "i").test(d.intro.text)) : d.intro.words > 0;
  const seoFirst = phraseHits(d.plain, ["in this article", "in this blog", "seo", "keyword", "search engine", "rank on google"]).reduce((a, b) => a + b.count, 0);
  const density = ctx.kw ? ((d.plain.match(new RegExp(ctx.kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi")) ?? []).length * ctx.kw.split(" ").length) / Math.max(1, d.words) : 0;
  const scannable = d.headings.length >= Math.max(2, Math.floor(d.words / 350));
  const signals = [
    { label: "Speaks to the reader", ok: you >= 0.4, detail: `${you.toFixed(1)} reader references per 100 words` },
    { label: "Specific and concrete", ok: specifics >= 1, detail: `${specifics.toFixed(1)} numbers/examples per 100 words` },
    { label: "Actionable", ok: actionable, detail: actionable ? "Steps, tips or lists the reader can act on" : "No steps, tips or lists" },
    { label: "Answers early", ok: early, detail: early ? "The topic is addressed in the opening" : "The opening does not address the query" },
    { label: "Written for people, not search engines", ok: seoFirst === 0 && density <= 0.025, detail: seoFirst ? `${seoFirst} search-engine-first phrases (“in this article”, “SEO”…)` : density > 0.025 ? `Keyword density ${(density * 100).toFixed(1)}%` : "No search-engine-first patterns" },
    { label: "Easy to scan", ok: scannable, detail: `${d.headings.length} headings for ${d.words} words` },
  ];
  const h = signals.filter((s) => s.ok).length / signals.length;
  const score = blend(h, ctx.ai?.peopleFirst.score);
  return finding("people-first", score, `${signals.filter((s) => s.ok).length} of ${signals.length} people-first signals${ctx.ai ? `; Claude: ${pct(ctx.ai.peopleFirst.score)}` : ""}.`, ctx.ai ? ["content", "ai"] : ["content"], {
    items: [...signals.map((s) => ({ label: s.label, detail: s.detail, tone: s.ok ? ("good" as const) : ("warning" as const) })), ...(ctx.ai ? [{ label: "Claude's assessment", detail: ctx.ai.peopleFirst.reason, tone: "neutral" as const }] : [])],
    how: score < 0.8 ? `Write for the reader who searched “${ctx.kw || "this topic"}”: ${signals.filter((s) => !s.ok).map((s) => s.label.toLowerCase()).join("; ")}.` : undefined,
  });
}

export function completeness(ctx: Ctx): Finding {
  const d = ctx.doc;
  if (d.words < 50) return na("completeness", "Add the article text to audit it.");
  const subs = ctx.subtopics;
  const qs = ctx.questions;
  const items = [];
  let score: number;
  let summary: string;
  if (subs.length || qs.length) {
    const subCov = subs.length ? subs.filter((s) => covered(ctx, s.text) >= 0.6).length / subs.length : null;
    const qCov = qs.length ? qs.filter((q) => answered(ctx, q.text)).length / qs.length : null;
    const parts = [subCov, qCov].filter((x): x is number => x != null);
    const raw = subCov != null && qCov != null ? 0.6 * subCov + 0.4 * qCov : parts[0];
    score = blend(clamp01(raw / 0.8), ctx.ai?.completeness.score);
    summary = `Covers ${subCov != null ? `${pct(subCov)} of ${plural(subs.length, "subtopic")}` : ""}${subCov != null && qCov != null ? " and " : ""}${qCov != null ? `${pct(qCov)} of ${plural(qs.length, "related question")}` : ""}.`;
    for (const s of subs.filter((x) => covered(ctx, x.text) < 0.6).slice(0, 8)) items.push({ label: `Missing subtopic: ${s.text}`, detail: `Source: ${s.source}${s.support > 1 ? ` (${s.support} pages)` : ""}`, tone: "warning" as const });
    for (const q of qs.filter((x) => !answered(ctx, x.text)).slice(0, 6)) items.push({ label: `Unanswered: ${q.text}`, detail: `Source: ${q.source}`, tone: "warning" as const });
  } else {
    const h2 = d.headings.filter((h) => h.level === 2).length;
    const parts = [d.intro.words >= 30, h2 >= 3, !!d.conclusion, d.faqs.length > 0 || ctx.intent.dominant !== "informational"];
    // Structure alone cannot prove completeness: without coverage targets this check tops out at "Improve".
    score = blend((parts.filter(Boolean).length / parts.length) * 0.75, ctx.ai?.completeness.score);
    summary = "Structural completeness only: run SERP research or generate a brief to measure topic coverage.";
    items.push({ label: "No coverage targets yet", detail: "Subtopics and questions come from ranking pages, Google Autocomplete, a content brief or Claude.", tone: "warning" as const });
  }
  for (const m of ctx.ai?.completeness.missing ?? []) items.push({ label: `Claude: missing ${m}`, tone: "warning" as const });
  return finding("completeness", score, summary, [...new Set(["content" as const, ...subs.map((s) => (s.source === "paa" ? "serp" : s.source === "brief" ? "content" : s.source)), ...qs.map((q) => (q.source === "paa" ? "serp" : q.source === "brief" ? "content" : q.source))])] as Finding["sources"], {
    items,
    how: score < 0.8 ? "Cover the missing subtopics and questions listed (see Topical SEO for one-click section scaffolds)." : undefined,
  });
}

export function depth(ctx: Ctx): Finding {
  const d = ctx.doc;
  if (d.words < 50) return na("depth", "Add the article text to audit it.", undefined);
  const sections = d.sections.filter((s) => s.heading && !isConclusionHeading(s.heading.text));
  const thin = sections.filter((s) => s.words < 60 && !s.lists && !s.tables && !s.subheadings.length);
  const specifics = (d.plain.match(NUMBER) ?? []).length + (d.plain.match(EXAMPLE) ?? []).length;
  const perSection = sections.length ? sections.reduce((a, s) => a + s.words, 0) / sections.length : d.words;
  const thinShare = sections.length ? thin.length / sections.length : 0;
  const specificScore = clamp01(specifics / Math.max(3, d.words / 150));
  const tooShort = d.words < 300;
  const score = tooShort ? Math.min(0.3, d.words / 1000) : clamp01(1 - thinShare * 0.7) * 0.6 + specificScore * 0.4;
  return finding("depth", score, `${plural(sections.length, "section")}, ${Math.round(perSection)} words per section on average; ${plural(thin.length, "thin section")}; ${plural(specifics, "specific detail")} (numbers, examples).`, ["content"], {
    metrics: [
      { label: "Words", value: d.words.toLocaleString() },
      { label: "Avg words / section", value: String(Math.round(perSection)) },
      { label: "Thin sections", value: String(thin.length) },
      { label: "Specifics", value: String(specifics) },
    ],
    items: thin.map((s) => ({ label: `Thin section: ${s.heading!.text}`, detail: `${s.words} words, no list or table`, tone: "warning" as const })),
    fixes: thin.slice(0, 4).map((s, i) => aiFix(`depth-${i}`, `Expand “${s.heading!.text}”`, "section", `Expand the section “${s.heading!.text}” with specific, useful detail (examples, numbers, steps) for readers of “${ctx.kw}”. Keep facts verifiable; mark anything that needs a source with [source needed].`, s.heading!.text)),
    blocker: tooShort ? `The draft has only ${d.words} words of content: too short to publish as an article.` : undefined,
    how: score < 0.8 ? "Expand thin sections with examples, data, steps or explanations — depth comes from specifics, not word count." : undefined,
  });
}

function shingles(text: string, n = 8) {
  const w = wordList(text.toLowerCase());
  const out = new Set<string>();
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(" "));
  return out;
}

export function originality(ctx: Ctx): Finding {
  const d = ctx.doc;
  if (d.words < 50) return na("originality", "Add the article text to audit it.");
  const generic = phraseHits(d.plain, GENERIC_PHRASES);
  const genericCount = generic.reduce((a, b) => a + b.count, 0);
  const genericRate = (genericCount / d.words) * 1000;
  // Repeated 6-word sequences inside the draft.
  const seen = new Map<string, number>();
  const w = wordList(d.plain.toLowerCase());
  for (let i = 0; i + 6 <= w.length; i++) {
    const k = w.slice(i, i + 6).join(" ");
    if (k.split(" ").filter((x) => !STOP.has(x)).length < 3) continue;
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  const repeats = [...seen.entries()].filter(([, n]) => n >= 2);
  // Passages shared with competitor pages (8-word shingles).
  const mine = shingles(d.plain);
  const overlaps = ctx.competitors
    .map((c) => {
      const theirs = shingles(c.text);
      let n = 0;
      const sample: string[] = [];
      for (const s of mine)
        if (theirs.has(s)) {
          n++;
          if (sample.length < 2) sample.push(s);
        }
      return { domain: c.domain, url: c.url, share: mine.size ? n / mine.size : 0, sample };
    })
    .filter((o) => o.share >= 0.02)
    .sort((a, b) => b.share - a.share);
  const copied = overlaps[0]?.share ?? 0;
  const h = clamp01(1 - Math.min(0.5, genericRate / 12) - Math.min(0.25, repeats.length * 0.03) - Math.min(0.6, copied * 4));
  const score = blend(h, ctx.ai?.originality.score);
  return finding("originality", score, `${plural(genericCount, "generic phrase")}, ${plural(repeats.length, "repeated passage")}${ctx.competitors.length ? `, ${overlaps.length ? `${pct(copied)} of passages also appear on ${overlaps[0].domain}` : "no passages copied from ranking pages"}` : ""}.`, ctx.competitors.length ? ["content", "competitors", ...(ctx.ai ? (["ai"] as const) : [])] : ["content", ...(ctx.ai ? (["ai"] as const) : [])], {
    items: [
      ...overlaps.map((o) => ({ label: `Shares ${pct(o.share)} of passages with ${o.domain}`, detail: o.sample.map((s) => quote(s)).join(" · "), tone: o.share >= 0.1 ? ("critical" as const) : ("warning" as const), href: o.url })),
      ...generic.slice(0, 8).map((g) => ({ label: `Generic phrase: “${g.phrase}”`, detail: `${g.count}×`, tone: "warning" as const })),
      ...repeats.slice(0, 4).map(([k, n]) => ({ label: `Repeated: ${quote(k)}`, detail: `${n}×`, tone: "warning" as const })),
      ...(ctx.ai ? [{ label: "Claude's assessment", detail: ctx.ai.originality.reason, tone: "neutral" as const }] : []),
    ],
    how: score < 0.8 ? "Replace generic phrasing with your own observations, data and examples; rewrite any passage that matches a ranking page." : undefined,
    fixes: generic.length ? [aiFix("originality-rewrite", "Rewrite generic passages", "rewrite", `Rewrite the sentences containing these generic phrases so they say something specific instead: ${generic.slice(0, 8).map((g) => `“${g.phrase}”`).join(", ")}. Keep the meaning and facts.`)] : undefined,
  });
}

export function informationGain(ctx: Ctx): Finding {
  const d = ctx.doc;
  if (d.words < 50) return na("information-gain", "Add the article text to audit it.");
  const mineTokens = new Set(contentTokens(d.plain, STOP).map(stem));
  const numbers = new Set((d.plain.match(/\b\d[\d,.]*%?/g) ?? []).filter((n) => n.length > 1));
  if (ctx.competitors.length >= 2) {
    const theirs = new Set<string>();
    const theirNumbers = new Set<string>();
    for (const c of ctx.competitors) {
      for (const t of contentTokens(c.text, STOP)) theirs.add(stem(t));
      for (const n of c.text.match(/\b\d[\d,.]*%?/g) ?? []) theirNumbers.add(n);
    }
    const unique = [...mineTokens].filter((t) => !theirs.has(t));
    const uniqueNums = [...numbers].filter((n) => !theirNumbers.has(n));
    const ratio = unique.length / Math.max(1, mineTokens.size);
    const h = clamp01(ratio / 0.2) * 0.7 + clamp01(uniqueNums.length / 4) * 0.3;
    const score = blend(h, ctx.ai?.informationGain.score);
    return finding("information-gain", score, `${pct(ratio)} of your vocabulary and ${plural(uniqueNums.length, "figure")} do not appear on any of the ${ctx.competitors.length} ranking pages.`, ["content", "competitors", ...(ctx.ai ? (["ai"] as const) : [])], {
      items: [
        { label: "Terms only you use", detail: unique.slice(0, 18).join(", ") || "none", tone: unique.length >= 10 ? ("good" as const) : ("warning" as const) },
        { label: "Figures only you cite", detail: uniqueNums.slice(0, 12).join(", ") || "none", tone: uniqueNums.length ? ("good" as const) : ("warning" as const) },
        ...(ctx.ai ? [{ label: "Claude's assessment", detail: ctx.ai.informationGain.reason, tone: "neutral" as const }] : []),
      ],
      how: score < 0.8 ? "Add what the ranking pages lack: your own data, outcomes, examples, expert quotes, local details or a clearer framework." : undefined,
    });
  }
  const firsthand = phraseHits(d.plain, EXPERIENCE).length;
  const h = clamp01((numbers.size / 6) * 0.5 + (firsthand / 3) * 0.5) * 0.8;
  const score = blend(h, ctx.ai?.informationGain.score);
  return finding("information-gain", score, `Estimated from specifics only (${plural(numbers.size, "figure")}, ${plural(firsthand, "first-hand marker")}); run SERP research to compare against ranking pages.`, ctx.ai ? ["content", "ai"] : ["content"], {
    items: [{ label: "Not compared with competitors", detail: "Information gain is measured against the pages that rank. Run SERP research or add competitor URLs.", tone: "warning" as const }, ...(ctx.ai ? [{ label: "Claude's assessment", detail: ctx.ai.informationGain.reason, tone: "neutral" as const }] : [])],
    how: "Add original data, outcomes, examples or expert input that other pages don't have.",
  });
}

export function firstHand(ctx: Ctx): Finding {
  const d = ctx.doc;
  if (d.words < 50) return na("first-hand", "Add the article text to audit it.");
  const hits = phraseHits(d.plain, EXPERIENCE);
  const captioned = d.images.filter((i) => i.caption).length;
  const n = hits.reduce((a, b) => a + Math.min(2, b.count), 0) + Math.min(2, captioned);
  const h = n === 0 ? 0.15 : n === 1 ? 0.55 : n === 2 ? 0.75 : n <= 4 ? 0.9 : 1;
  const score = blend(h, ctx.ai?.experience.score);
  return finding("first-hand", score, n ? `${plural(n, "first-hand signal")}: ${hits.slice(0, 5).map((x) => `“${x.phrase}”`).join(", ")}${captioned ? `, ${plural(captioned, "captioned image")}` : ""}.` : "No first-hand experience, testing, case studies or original observations found.", ctx.ai ? ["content", "ai"] : ["content"], {
    items: [...hits.map((x) => ({ label: `“${x.phrase}”`, detail: `${x.count}×`, tone: "good" as const })), ...(ctx.ai ? [{ label: "Claude's assessment", detail: ctx.ai.experience.reason, tone: "neutral" as const }] : [])],
    how: score < 0.8 ? "Add what you saw or did: a case study, results from your own students/customers, a test, a site visit, original photos with captions, or a quote from someone with direct experience." : undefined,
    fixes: score < 0.8 ? [aiFix("firsthand-prompt", "Draft an experience section", "section", `Write a short section titled "From our experience" for an article about “${ctx.kw}” with clearly marked placeholders like [add a real example] where the author must insert their own first-hand observations. Do not invent experiences.`)] : undefined,
  });
}

export function factualClaims(ctx: Ctx): Finding {
  const claims = detectClaims(ctx.doc);
  const aiClaims = ctx.ai?.claims ?? [];
  if (!claims.length && !aiClaims.length) return finding("factual-claims", 1, "No factual claims that need verification were found.", ["content"]);
  const unsupported = claims.filter((c) => !c.supported);
  const score = claims.length ? 1 - unsupported.length / claims.length : 0.7;
  return finding("factual-claims", score, `${plural(claims.length, "factual claim")} found; ${unsupported.length} without a source nearby.`, ctx.ai ? ["content", "ai"] : ["content"], {
    metrics: [
      { label: "Claims", value: String(claims.length) },
      { label: "Supported", value: String(claims.length - unsupported.length) },
      { label: "Unsupported", value: String(unsupported.length) },
    ],
    items: [
      ...unsupported.slice(0, 12).map((c) => ({ label: quote(c.text, 180), detail: `${c.kinds.join(", ")} · needs a source`, tone: c.risk === "high" ? ("critical" as const) : ("warning" as const) })),
      ...aiClaims.filter((c) => c.risk !== "low").slice(0, 6).map((c) => ({ label: `Claude: ${quote(c.text, 160)}`, detail: c.reason, tone: c.risk === "high" ? ("critical" as const) : ("warning" as const) })),
    ],
    how: unsupported.length ? "Verify each listed statement and link the primary source (official body, study, report) in the same sentence or paragraph — or remove it." : undefined,
  });
}

export function citations(ctx: Ctx): Finding {
  const claims = detectClaims(ctx.doc);
  const ext = ctx.doc.links.filter((l) => !l.internal && /^https?:/i.test(l.url));
  const quality = ext.map((l) => ({ ...l, q: sourceQuality(l.url) }));
  const credible = quality.filter((l) => l.q === "credible");
  const weak = quality.filter((l) => l.q === "weak");
  if (!claims.length && !ext.length) return finding("citations", 0.85, "No claims that need sources and no outbound sources.", ["content"]);
  const supportedRatio = claims.length ? claims.filter((c) => c.supported).length / claims.length : 1;
  const credibleShare = ext.length ? (credible.length + 0.5 * (ext.length - credible.length - weak.length)) / ext.length : 0;
  const score = 0.6 * supportedRatio + 0.4 * credibleShare;
  return finding("citations", score, `${pct(supportedRatio)} of claims are supported; ${plural(ext.length, "outbound source")} (${credible.length} authoritative, ${weak.length} weak).`, ["content"], {
    items: [
      ...credible.slice(0, 6).map((l) => ({ label: l.text || l.url, detail: `Authoritative source · ${l.url}`, tone: "good" as const, href: l.url })),
      ...weak.map((l) => ({ label: l.text || l.url, detail: `Weak source (shortener, UGC or blog platform) · ${l.url}`, tone: "warning" as const, href: l.url })),
      ...(claims.length && !ext.length ? [{ label: "Claims but no sources", detail: "Link primary sources for your statistics and factual statements.", tone: "critical" as const }] : []),
    ],
    how: score < 0.8 ? "Cite primary, authoritative sources (official bodies, research, recognised publishers) next to the claims they support; replace weak sources." : undefined,
  });
}

export function aiPatterns(ctx: Ctx): Finding {
  const d = ctx.doc;
  if (d.words < 80) return na("ai-patterns", "Add more text to detect writing patterns.");
  const hits = phraseHits(d.plain, GENERIC_PHRASES);
  const rate = (hits.reduce((a, b) => a + b.count, 0) / d.words) * 1000;
  const lens = d.sentences.map(words).filter((n) => n > 2);
  const mean = lens.reduce((a, b) => a + b, 0) / Math.max(1, lens.length);
  const sd = Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, lens.length));
  const uniform = lens.length >= 15 && sd / Math.max(1, mean) < 0.35;
  const dashes = (d.plain.match(/—/g) ?? []).length;
  const dashRate = (dashes / d.words) * 100;
  const transitions = d.paragraphs.filter((p) => /^(moreover|furthermore|additionally|in addition|however|overall|ultimately|consequently|therefore|thus|notably|importantly)\b/i.test(p.text)).length;
  const transitionShare = transitions / Math.max(1, d.paragraphs.length);
  const triads = (d.plain.match(/\b\w+, \w+,? and \w+\b/g) ?? []).length;
  const score = clamp01(1 - Math.min(0.55, rate / 10) - (uniform ? 0.15 : 0) - (dashRate > 1 ? 0.1 : 0) - (transitionShare > 0.25 ? 0.15 : 0) - (triads / Math.max(1, d.sentences.length) > 0.2 ? 0.05 : 0));
  return finding("ai-patterns", score, rate || uniform || transitionShare > 0.25 ? `${plural(hits.reduce((a, b) => a + b.count, 0), "formulaic phrase")}${uniform ? ", uniform sentence rhythm" : ""}${transitionShare > 0.25 ? `, ${pct(transitionShare)} of paragraphs open with a stock transition` : ""}.` : "No formulaic AI-style patterns detected.", ["content"], {
    items: [
      ...hits.slice(0, 10).map((x) => ({ label: `“${x.phrase}”`, detail: `${x.count}×`, tone: "warning" as const })),
      ...(uniform ? [{ label: "Uniform sentence length", detail: `Average ${mean.toFixed(0)} words, little variation — vary rhythm with short and long sentences.`, tone: "warning" as const }] : []),
      ...(dashRate > 1 ? [{ label: "Heavy em-dash use", detail: `${dashes} em dashes`, tone: "warning" as const }] : []),
      ...(transitionShare > 0.25 ? [{ label: "Stock transitions", detail: `${transitions} paragraphs start with Moreover/Furthermore/Additionally…`, tone: "warning" as const }] : []),
    ],
    how: score < 0.8 ? "Edit for a human voice: cut stock phrases, vary sentence length, and replace abstract claims with specifics." : undefined,
    fixes: hits.length ? [aiFix("ai-patterns-rewrite", "Humanize flagged passages", "rewrite", `Rewrite only the sentences containing these phrases in a plain, specific, human voice (no clichés, no em dashes): ${hits.slice(0, 10).map((x) => `“${x.phrase}”`).join(", ")}.`)] : undefined,
  });
}

export function structure(ctx: Ctx): Finding {
  const d = ctx.doc;
  if (d.words < 50) return na("structure", "Add the article text to audit it.");
  const h2 = d.headings.filter((h) => h.level === 2);
  const sections = d.sections.filter((s) => s.heading);
  const biggest = sections.length ? Math.max(...sections.map((s) => s.words)) / Math.max(1, d.words) : 1;
  const avgPara = d.paragraphs.length ? d.paragraphs.reduce((a, p) => a + p.words, 0) / d.paragraphs.length : 0;
  const parts = [
    { label: "Introduction before the first section", ok: d.intro.words >= 30, detail: `${d.intro.words} words` },
    { label: "Enough sections", ok: h2.length >= (d.words > 600 ? 3 : 2), detail: `${h2.length} H2 sections` },
    { label: "Conclusion or summary", ok: !!d.conclusion || /\b(in short|to sum up|overall|in summary)\b/i.test(d.paragraphs[d.paragraphs.length - 1]?.text ?? ""), detail: d.conclusion?.heading?.text ?? "none found" },
    { label: "Lists or tables", ok: d.lists.length + d.tables.length >= Math.max(1, Math.floor(d.words / 900)), detail: `${d.lists.length} lists, ${d.tables.length} tables` },
    { label: "Balanced sections", ok: biggest <= 0.45 || sections.length < 2, detail: `largest section is ${pct(biggest)} of the article` },
    { label: "Short paragraphs", ok: avgPara <= 80, detail: `${Math.round(avgPara)} words per paragraph on average` },
  ];
  const score = parts.filter((p) => p.ok).length / parts.length;
  const fixes: FixOption[] = [];
  if (!parts[2].ok) fixes.push(aiFix("structure-conclusion", "Write a conclusion", "conclusion", `Write a conclusion section (## heading + 60–120 words) that summarizes the key takeaways of the article about “${ctx.kw}” and ends with one clear next step.`));
  if (!parts[0].ok) fixes.push(aiFix("structure-intro", "Write an introduction", "intro", `Write a 50–100 word introduction for the article about “${ctx.kw}” that states the reader's problem and what they will learn.`));
  return finding("structure", score, `${parts.filter((p) => p.ok).length} of ${parts.length} structure checks pass.`, ["content"], {
    items: parts.map((p) => ({ label: p.label, detail: p.detail, tone: p.ok ? ("good" as const) : ("warning" as const) })),
    fixes,
    blocker: d.placeholders.length ? `The draft still contains ${plural(d.placeholders.length, "placeholder")} (${d.placeholders.slice(0, 3).map((p) => p.text).join(", ")}): finish or remove them before publishing.` : undefined,
    how: score < 0.8 ? parts.filter((p) => !p.ok).map((p) => p.label).join("; ") + "." : undefined,
  });
}

export function readability(ctx: Ctx): Finding {
  const d = ctx.doc;
  if (d.words < 50) return na("readability", "Add the article text to audit it.");
  const r = readabilityOf(d.paragraphs.map((p) => p.text).join("\n"));
  const long = d.sentences.filter((s) => words(s) > 25);
  const passive = d.sentences.filter(isPassive);
  const longParas = d.paragraphs.filter((p) => p.words > 120);
  const all = wordList(d.plain);
  const complexShare = all.filter(isComplexWord).length / Math.max(1, all.length);
  const flesch = r.flesch ?? 0;
  const fScore = clamp01((flesch - 30) / 30);
  const lScore = clamp01(1 - (long.length / Math.max(1, d.sentences.length) - 0.1) * 4);
  const pScore = clamp01(1 - (passive.length / Math.max(1, d.sentences.length) - 0.1) * 4);
  const paraScore = clamp01(1 - longParas.length * 0.2);
  const score = 0.4 * fScore + 0.25 * lScore + 0.15 * pScore + 0.2 * paraScore;
  return finding("readability", score, `Flesch reading ease ${r.flesch ?? "n/a"} (grade ${r.grade ?? "n/a"}); ${plural(long.length, "long sentence")}, ${plural(passive.length, "passive sentence")}, ${plural(longParas.length, "long paragraph")}.`, ["content"], {
    metrics: [
      { label: "Flesch", value: String(r.flesch ?? "n/a") },
      { label: "Grade", value: String(r.grade ?? "n/a") },
      { label: "Avg sentence", value: `${r.avgSentenceLength} words` },
      { label: "Complex words", value: pct(complexShare) },
    ],
    items: [
      ...long.slice(0, 6).map((s) => ({ label: quote(s, 160), detail: `${words(s)} words — split it`, tone: "warning" as const })),
      ...longParas.slice(0, 3).map((p) => ({ label: `Long paragraph: ${quote(p.text, 90)}`, detail: `${p.words} words — break it up`, tone: "warning" as const })),
      ...passive.slice(0, 4).map((s) => ({ label: quote(s, 140), detail: "Passive voice", tone: "neutral" as const })),
    ],
    fixes: long.length ? [aiFix("readability-sentences", `Simplify ${plural(Math.min(long.length, 8), "long sentence")}`, "rewrite", `Split or simplify these long sentences without changing their meaning:\n${long.slice(0, 8).map((s) => `- ${s}`).join("\n")}`)] : undefined,
    how: score < 0.8 ? "Aim for Flesch 60+: sentences under 20 words on average, paragraphs under 4–5 lines, active voice and plain words." : undefined,
  });
}

export function redundancy(ctx: Ctx): Finding {
  const d = ctx.doc;
  if (d.words < 50) return na("redundancy", "Add the article text to audit it.");
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
  const counts = new Map<string, { text: string; n: number }>();
  for (const s of d.sentences) {
    if (words(s) < 6) continue;
    const k = norm(s);
    const hit = counts.get(k);
    if (hit) hit.n++;
    else counts.set(k, { text: s, n: 1 });
  }
  const dupes = [...counts.values()].filter((x) => x.n > 1);
  const sets = d.sentences.filter((s) => words(s) >= 8).map((s) => ({ s, t: new Set(contentTokens(s, STOP).map(stem)) }));
  const near: { a: string; b: string }[] = [];
  for (let i = 0; i < sets.length && near.length < 8; i++)
    for (let j = i + 1; j < sets.length; j++) {
      const a = sets[i].t,
        b = sets[j].t;
      if (a.size < 4 || norm(sets[i].s) === norm(sets[j].s)) continue;
      let n = 0;
      for (const x of a) if (b.has(x)) n++;
      if (n / (a.size + b.size - n) >= 0.75) {
        near.push({ a: sets[i].s, b: sets[j].s });
        break;
      }
    }
  const score = clamp01(1 - dupes.length * 0.15 - near.length * 0.08);
  return finding("redundancy", score, dupes.length || near.length ? `${plural(dupes.length, "duplicated sentence")} and ${plural(near.length, "near-duplicate pair")}.` : "No repeated sentences or concepts found.", ["content"], {
    items: [...dupes.map((x) => ({ label: quote(x.text, 160), detail: `Appears ${x.n}×`, tone: "warning" as const })), ...near.map((x) => ({ label: quote(x.a, 110), detail: `Says nearly the same as ${quote(x.b, 110)}`, tone: "warning" as const }))],
    fixes: dupes.length
      ? [
          {
            id: "redundancy-dedupe",
            label: `Remove ${plural(dupes.length, "repeated sentence")}`,
            description: "Keeps the first occurrence of each duplicated sentence and deletes the repeats.",
            fix: { kind: "batch", fixes: dupes.flatMap((x) => Array.from({ length: x.n - 1 }, () => ({ kind: "replace" as const, find: x.text, replace: "", last: true }))) },
            safe: true,
          },
        ]
      : undefined,
    how: score < 0.8 ? "Delete repeats and merge sentences that make the same point." : undefined,
  });
}

export function filler(ctx: Ctx): Finding {
  const d = ctx.doc;
  if (d.words < 50) return na("filler", "Add the article text to audit it.");
  const hits = phraseHits(d.plain, FILLER_PHRASES.map((f) => f.phrase.trim().replace(/,$/, "")));
  const count = hits.reduce((a, b) => a + b.count, 0);
  const empty = d.paragraphs.filter((p) => p.words >= 25 && !/\d/.test(p.text) && !EXAMPLE.test(p.text) && contentTokens(p.text, STOP).filter((t) => ctx.kwTokens.includes(t)).length === 0 && !/\b[A-Z][a-z]+ [A-Z]/.test(p.text));
  EXAMPLE.lastIndex = 0;
  const rate = (count / d.words) * 1000;
  const score = clamp01(1 - Math.min(0.6, rate / 15) - Math.min(0.4, (empty.length / Math.max(1, d.paragraphs.length)) * 0.8));
  const body = ctx.draft.body;
  const replaceable = FILLER_PHRASES.filter((f) => f.replace !== undefined && (body.includes(f.phrase) || (!!f.replace && body.includes(capFirstPhrase(f.phrase)))));
  return finding("filler", score, `${plural(count, "filler phrase")}; ${plural(empty.length, "paragraph")} without specifics.`, ["content"], {
    items: [...hits.slice(0, 10).map((x) => ({ label: `“${x.phrase}”`, detail: `${x.count}×`, tone: "warning" as const })), ...empty.slice(0, 4).map((p) => ({ label: quote(p.text, 140), detail: "Adds little: no figures, examples, names or topic terms", tone: "warning" as const }))],
    fixes: replaceable.length
      ? [
          {
            id: "filler-plain",
            label: `Tighten ${plural(replaceable.length, "wordy phrase")}`,
            description: `Plain-English edits: ${replaceable.map((f) => `“${f.phrase.trim()}” → ${f.replace ? `“${f.replace}”` : "removed"}`).join("; ")}.`,
            fix: { kind: "batch", fixes: replaceable.flatMap((f) => [{ kind: "replace" as const, find: f.phrase, replace: f.replace!, all: true }, ...(f.replace ? [{ kind: "replace" as const, find: capFirstPhrase(f.phrase), replace: capFirstPhrase(f.replace), all: true }] : [])]) },
            safe: true,
          },
        ]
      : undefined,
    how: score < 0.8 ? "Cut phrases that delay the point and give every paragraph a concrete detail." : undefined,
  });
}
const capFirstPhrase = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export function introduction(ctx: Ctx): Finding {
  const d = ctx.doc;
  if (d.words < 50) return na("introduction", "Add the article text to audit it.");
  const intro = d.intro;
  const first = d.sentences.find((s) => intro.text.startsWith(s.slice(0, 20))) ?? intro.text.split(/(?<=[.!?])\s/)[0] ?? "";
  const twoSentences = intro.text.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ");
  const parts = [
    { label: "Has an introduction", ok: intro.words >= 25, detail: `${intro.words} words` },
    { label: "Concise", ok: intro.words <= 160, detail: intro.words > 160 ? "Over 160 words: get to the point sooner" : "Under 160 words" },
    { label: "Topic in the first two sentences", ok: !ctx.kw || hasKeyword(twoSentences, ctx.kw) || ctx.kwTokens.every((t) => new RegExp(`\\b${t}`, "i").test(twoSentences)), detail: ctx.kw ? `“${ctx.kw}”` : "" },
    { label: "States the value for the reader", ok: /\b(you('ll| will)|this guide|we('ll| will)|here('s| is)|find out|learn|discover|explains?|covers?|answers?)\b|\?/i.test(intro.text), detail: "what the reader will get" },
    { label: "No throat-clearing opener", ok: !/^(in today's|in this (article|blog|post)|since the dawn|have you ever wondered|as we all know|in the modern|in recent years)/i.test(first.trim()), detail: quote(first, 80) },
  ];
  const score = parts.filter((p) => p.ok).length / parts.length;
  return finding("introduction", score, `${parts.filter((p) => p.ok).length} of ${parts.length} introduction checks pass.`, ["content"], {
    items: parts.map((p) => ({ label: p.label, detail: p.detail, tone: p.ok ? ("good" as const) : ("warning" as const) })),
    fixes: score < 0.8 ? [aiFix("intro-rewrite", "Rewrite the introduction", "intro", `Rewrite the introduction (50–110 words): mention “${ctx.kw}” in the first sentence, state the reader's problem and what they will learn, no clichés.`)] : undefined,
    how: score < 0.8 ? "Open with the reader's problem and the promise of the article in 2–4 short sentences, naming the topic early." : undefined,
  });
}

export function conclusion(ctx: Ctx): Finding {
  const d = ctx.doc;
  if (d.words < 50) return na("conclusion", "Add the article text to audit it.");
  const c = d.conclusion;
  const lastLines = c ? null : d.paragraphs.slice(-2).map((p) => p.text).join(" ");
  const has = !!c || /\b(in short|to sum up|overall|in summary|to conclude|the bottom line)\b/i.test(lastLines ?? "");
  const text = c ? c.text : (lastLines ?? "");
  const summarizes = c ? c.words >= 30 || c.lists > 0 : has;
  const nextStep = hasCta(text) || d.links.some((l) => c && l.section === c.index) || /\b(next step|get started|contact|apply|read|explore|download|book|check out|visit)\b/i.test(text);
  const parts = [
    { label: "Conclusion section", ok: has, detail: c?.heading?.text ?? (has ? "closing paragraph" : "none") },
    { label: "Summarizes the takeaways", ok: summarizes, detail: c ? `${c.words} words${c.lists ? ", with a list" : ""}` : "" },
    { label: "Gives a next step", ok: nextStep, detail: nextStep ? "call to action or link" : "no next step" },
  ];
  const score = parts.filter((p) => p.ok).length / parts.length;
  return finding("conclusion", score, `${parts.filter((p) => p.ok).length} of ${parts.length} conclusion checks pass.`, ["content"], {
    items: parts.map((p) => ({ label: p.label, detail: p.detail, tone: p.ok ? ("good" as const) : ("warning" as const) })),
    fixes: score < 1 ? [aiFix("conclusion-write", c ? "Rewrite the conclusion" : "Add a conclusion", "conclusion", `Write a conclusion (## heading + 60–120 words or 3–5 bullet takeaways) for the article about “${ctx.kw}” ending with one next step appropriate for ${ctx.intent.dominant} intent.`)] : undefined,
    how: score < 1 ? "End with the key takeaways and one clear next step (related guide, contact, apply…)." : undefined,
  });
}
