import { briefCompetitors } from "./brief-export";
import { buildContext } from "./context";
import { FORMAT_LABEL, FUNNEL_FOR, INTENT_LABEL } from "./intent";
import { titleVariants } from "./checks/onpage";
import { cap, capFirst } from "./checks/util";
import type { Brief, ContentFormat, Research } from "./types";

/**
 * Content brief from research alone (no AI): intent and format from the ranking pages or the query,
 * an outline from the subtopics ranking pages share and the words searchers add in Autocomplete,
 * questions, entities, related terms and a length range from the competitors. Pure.
 */
export function researchBrief(keyword: string, db: string, research: Research | null): Brief {
  const ctx = buildContext({ title: "", keyword, keywords: [], metaDescription: "", slug: "", url: "", body: "", meta: { db } }, { research });
  const intent = ctx.intent.dominant;
  const serpFormat = Object.entries(ctx.intent.serpFormats).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0]?.[0] as ContentFormat | undefined;
  const format: ContentFormat = serpFormat ?? (intent === "commercial" ? "listicle" : intent === "transactional" || intent === "navigational" ? "landing" : /^how\b/.test(keyword) ? "how-to" : "guide");
  const words = ctx.competitors.map((c) => c.words).sort((a, b) => a - b);
  const q = (p: number) => words[Math.min(words.length - 1, Math.floor(p * (words.length - 1)))];
  const outline: Brief["outline"] = [];
  if (intent === "informational" || format === "guide") outline.push({ level: 2, text: `What is ${keyword}?`, notes: "Answer directly in 40–60 words (featured snippet and AI overview candidate)." });
  for (const s of ctx.subtopics.slice(0, 8)) outline.push({ level: 2, text: s.source === "autocomplete" ? `${cap(keyword)}: ${s.text}` : capFirst(s.text), notes: s.source === "competitors" ? `Covered by ${s.support} ranking pages.` : s.source === "autocomplete" ? "Searchers add this to the query in Google Autocomplete." : "From the research." });
  if (ctx.questions.length) {
    outline.push({ level: 2, text: "Frequently asked questions", notes: "Answer each in 40–60 words under its own heading." });
    for (const x of ctx.questions.slice(0, 6)) outline.push({ level: 3, text: x.text, notes: x.source === "paa" ? "People Also Ask" : x.source === "autocomplete" ? "Google Autocomplete" : "Asked on ranking pages" });
  }
  outline.push({ level: 2, text: intent === "transactional" ? "How to apply / next steps" : "Key takeaways", notes: "Summarize and give one clear next step." });
  const sources = [
    ...(research?.serpSource === "serp" ? ["Live Google results (DataForSEO)"] : []),
    ...(ctx.competitors.length ? [`${ctx.competitors.length} competitor pages crawled`] : []),
    ...(research?.paa.length ? ["People Also Ask"] : []),
    ...(research?.autocomplete.length ? ["Google Autocomplete"] : []),
  ];
  return {
    keyword,
    db,
    intent,
    format,
    funnel: FUNNEL_FOR[intent],
    audience: `People searching “${keyword}” with ${INTENT_LABEL[intent].toLowerCase()} intent; best served by a ${FORMAT_LABEL[format].toLowerCase()}.`,
    titleIdeas: titleVariants(ctx),
    metaDescription: `${cap(keyword)}: ${intent === "transactional" ? "fees, eligibility, process and how to apply" : intent === "commercial" ? "the main options compared, with pros, cons and who each suits" : "a clear explanation with key facts, examples and answers to common questions"}.`.slice(0, 158),
    outline,
    entities: ctx.entities.map((e) => e.text).slice(0, 20),
    questions: ctx.questions.map((x) => x.text).slice(0, 12),
    coverage: ctx.terms.map((t) => t.text).slice(0, 20),
    wordRange: words.length >= 2 ? [Math.round(q(0.25) / 50) * 50, Math.round(q(0.75) / 50) * 50] : null,
    sources: sources.length ? sources : ["Query wording only (add competitor URLs or configure DataForSEO for richer briefs)"],
    generatedBy: "research",
    createdAt: new Date().toISOString(),
    competitors: briefCompetitors(research),
    serpFeatures: research?.serpSource === "serp" ? research.features : [],
  };
}

/** Markdown skeleton of a brief: H1, outline headings and [Write: …] placeholders with the notes. */
export function briefToMarkdown(b: Brief) {
  const title = b.titleIdeas[0] ?? cap(b.keyword);
  const out = [`# ${title}`, "", `[Write: introduction — state the reader's problem and what they will learn about ${b.keyword}]`, ""];
  for (const o of b.outline) out.push(`${o.level === 2 ? "##" : "###"} ${o.text}`, "", `[Write: ${o.notes || o.text}]`, "");
  return out.join("\n").trim() + "\n";
}
