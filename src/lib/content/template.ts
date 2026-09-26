/** SEO Content Template: a content brief built from the (demo) top-10 results for 1–5 keywords. */
import { database, normalizeKeyword } from "@/lib/domain";
import { demo, type Sourced } from "@/lib/providers/source";
import { hash, keywordMetrics, rng } from "@/lib/seo/engine";
import type { Intent } from "@/lib/seo/types";
import { backlinkSources, benchmark, semanticTerms, type BacklinkSource, type RelatedKeyword, type Rival, type SemanticTerm } from "./benchmark";
import { fleschLabel } from "./text";

export type Snippet = { position: number; domain: string; url: string; keyword: string; text: string };
export type ContentTemplate = {
  keywords: string[];
  db: string;
  metrics: { keyword: string; volume: number; kd: number; intents: Intent[] }[];
  rivals: Rival[];
  targets: { words: number; wordsRange: [number, number]; readability: number; readabilityLabel: string; audience: string; mentions: { keyword: string; avg: number }[]; h2: number; images: number; video: number };
  semantic: SemanticTerm[];
  backlinkSources: BacklinkSource[];
  related: RelatedKeyword[];
  questions: RelatedKeyword[];
  recommendations: { title: string[]; meta: string[]; h1: string[]; titleExamples: string[]; metaExample: string; h1Example: string };
  snippets: Snippet[];
  outline: string[];
};

export const MAX_TEMPLATE_KEYWORDS = 5;
const ACRONYMS = new Set(["crm", "erp", "seo", "mba", "bba", "bca", "hr", "vpn", "api", "ai", "pdf", "usa", "uk", "ielts", "gre", "gst", "emi", "sip", "ppc", "cms", "ui", "ux", "tv", "diy", "faq", "nba", "nfl", "b tech"]);
const cap = (s: string) => s.replace(/\b[a-z][a-z0-9]*/g, (w) => (ACRONYMS.has(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)));

export function parseTemplateKeywords(q: string) {
  return [...new Set(q.split(/[,\n;]+/).map(normalizeKeyword).filter((k) => k.length >= 2 && k.length <= 100 && /\p{L}/u.test(k)))].slice(0, MAX_TEMPLATE_KEYWORDS);
}

export function buildTemplate(keywordsInput: string[], dbInput: string): Sourced<ContentTemplate> {
  const db = database(dbInput).code;
  const keywords = keywordsInput.slice(0, MAX_TEMPLATE_KEYWORDS);
  const primary = keywords[0];
  const benches = keywords.map((k) => benchmark(k, db, null));
  const main = benches[0];
  // Merge rivals across keywords: best (lowest) average position first.
  const pool = new Map<string, { rival: Rival; score: number; hits: number }>();
  benches.forEach((b) =>
    b.rivals.forEach((r) => {
      const cur = pool.get(r.domain);
      if (cur) {
        cur.score += r.position;
        cur.hits++;
      } else pool.set(r.domain, { rival: r, score: r.position, hits: 1 });
    }),
  );
  const rivals = [...pool.values()]
    .map((p) => ({ ...p, rank: (p.score + (keywords.length - p.hits) * 12) / keywords.length }))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 10)
    .map((p, i) => ({ ...p.rival, position: keywords.length > 1 ? i + 1 : p.rival.position }));
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const words = rivals.map((r) => r.words).sort((a, b) => a - b);
  const readability = Math.round(avg(rivals.map((r) => r.readability)));
  const fl = fleschLabel(readability);
  const semantic = keywords.length > 1 ? semanticTerms(keywords, db, rivals, 24) : main.semantic;
  const intent = main.metrics.intents[0] ?? "informational";
  const year = new Date().getUTCFullYear();
  const K = cap(primary);
  const second = keywords[1];
  const r = rng(`content:tpl:${db}:${keywords.join("|")}`);
  const terms = semantic.map((s) => s.term);
  const t = (i: number) => terms[i % Math.max(1, terms.length)] ?? "details";

  const titleExamples =
    intent === "transactional"
      ? [`${K} — Prices, Deals & Fast Delivery`, `Buy ${K} Online${second ? ` | ${cap(second)}` : ""}`, `${K}: Compare ${cap(t(0))} & ${cap(t(1))} Options`]
      : intent === "commercial"
        ? [`${r.int(7, 15)} Best ${K} in ${year} (Compared & Reviewed)`, `${K}: Honest Comparison of ${cap(t(0))} and ${cap(t(1))}`, `Best ${K} for Every Budget (${year})`]
        : intent === "navigational"
          ? [`${K} — Official Information & Contacts`, `${K}: Everything in One Place`, `${K} Guide (${year})`]
          : [`${K}: The Complete Guide (${year})`, `What Is ${K}? ${cap(t(0))}, ${cap(t(1))} & More`, `${K} Explained in Plain English`];
  const metaExample = `${K}${second ? ` and ${second}` : ""}: ${intent === "transactional" ? "compare prices" : intent === "commercial" ? "compare the top options" : "learn what matters"}, including ${t(0)}, ${t(1)} and ${t(2)}. Updated ${year}.`.slice(0, 158);

  const snippetPatterns = [
    (k: string, a: string, b: string) => `When it comes to ${k}, most people start by looking at ${a} and ${b} before anything else.`,
    (k: string, a: string, b: string) => `Our ${k} guide covers ${a}, ${b} and the mistakes to avoid.`,
    (k: string, a: string, b: string) => `The right ${k} depends on ${a}, ${b} and how often you need it.`,
    (k: string, a: string, b: string) => `We compared ${r.int(8, 30)} options for ${k} based on ${a}, ${b} and real user reviews.`,
    (k: string, a: string, b: string) => `${cap(k)} can be confusing, so here is a simple breakdown of ${a} and ${b}.`,
    (k: string, a: string, b: string) => `Before choosing ${k}, check ${a} and ${b}, then read the FAQ below.`,
  ];
  const offset = hash(keywords.join("|")) % snippetPatterns.length;
  const snippets: Snippet[] = rivals.slice(0, 6).map((rv, i) => {
    const kw = keywords[i % keywords.length];
    return { position: rv.position, domain: rv.domain, url: rv.url, keyword: kw, text: snippetPatterns[(offset + i) % snippetPatterns.length](kw, t(i * 2), t(i * 2 + 1)) };
  });

  const related = benches.flatMap((b) => b.related).filter((x, i, a) => a.findIndex((y) => y.keyword === x.keyword) === i).sort((a, b) => b.volume - a.volume).slice(0, 15);
  const questions = benches.flatMap((b) => b.questions).filter((x, i, a) => a.findIndex((y) => y.keyword === x.keyword) === i).sort((a, b) => b.volume - a.volume).slice(0, 8);
  const outline = [
    ...questions.slice(0, 3).map((q) => cap(q.keyword) + "?"),
    ...related.slice(0, 3).map((x) => cap(x.keyword)),
    `${K}: frequently asked questions`,
  ];

  return demo({
    keywords,
    db,
    metrics: keywords.map((k) => {
      const m = keywordMetrics(k, db);
      return { keyword: k, volume: m.volume, kd: m.kd, intents: m.intents };
    }),
    rivals,
    targets: {
      words: Math.round(avg(words) / 10) * 10,
      wordsRange: [words[Math.floor(words.length * 0.2)] ?? 0, words[Math.min(words.length - 1, Math.floor(words.length * 0.8))] ?? 0],
      readability,
      readabilityLabel: fl.label,
      audience: fl.audience,
      mentions: benches.map((b) => ({ keyword: b.keyword, avg: b.avg.mentions })),
      h2: Math.round(avg(rivals.map((x) => x.h2))),
      images: Math.round(avg(rivals.map((x) => x.images))),
      video: Math.round((rivals.filter((x) => x.hasVideo).length / Math.max(1, rivals.length)) * 100),
    },
    semantic,
    backlinkSources: keywords.length > 1 ? backlinkSources(rivals.map((x) => x.domain), null, 15) : main.backlinkSources,
    related,
    questions,
    recommendations: {
      title: [
        `Include “${primary}”${second ? ` and, if it reads naturally, “${second}”` : ""} — ideally near the beginning.`,
        "Keep it to 50–60 characters so it isn't truncated in results.",
        "Make each page title unique and specific about what the reader gets.",
      ],
      meta: [`Include “${primary}” and a clear benefit or call to action.`, "Aim for 120–155 characters.", "Summarize the page honestly — Google may rewrite descriptions that don't match the content."],
      h1: [`Use one H1 that contains “${primary}”.`, "It can differ from the title tag but should describe the same topic.", `Structure the body with about ${Math.max(3, Math.round(avg(rivals.map((x) => x.h2))))} H2 sections covering the subtopics below.`],
      titleExamples,
      metaExample,
      h1Example: intent === "commercial" ? `The Best ${K} (${year})` : intent === "transactional" ? `Shop ${K}` : `${K}: What You Need to Know`,
    },
    snippets,
    outline,
  });
}

/** Markdown export of the brief. */
export function templateMarkdown(t: ContentTemplate) {
  const lines: string[] = [];
  lines.push(`# SEO content template: ${t.keywords.join(", ")}`, "");
  lines.push(`Database: ${database(t.db).name} · Generated ${new Date().toISOString().slice(0, 10)} by SynapseSEO · Benchmarks are demo data.`, "");
  lines.push("## Key recommendations", "");
  lines.push(`- **Text length:** about ${t.targets.words.toLocaleString("en-US")} words (top-10 range ${t.targets.wordsRange[0].toLocaleString("en-US")}–${t.targets.wordsRange[1].toLocaleString("en-US")}).`);
  lines.push(`- **Readability:** Flesch reading ease around ${t.targets.readability} (${t.targets.readabilityLabel}, ${t.targets.audience}).`);
  for (const m of t.targets.mentions) lines.push(`- **Use “${m.keyword}”** about ${m.avg} times.`);
  lines.push(`- **Structure:** about ${t.targets.h2} H2 sections and ${t.targets.images} images${t.targets.video >= 40 ? "; consider a video" : ""}.`, "");
  lines.push("### Semantically related words", "", t.semantic.map((s) => `${s.term} (${s.rivals}/10)`).join(", "), "");
  if (t.backlinkSources.length) {
    lines.push("### Backlink sources", "", "Domains that link to several of the top-10 pages:", "");
    for (const b of t.backlinkSources.slice(0, 10)) lines.push(`- ${b.domain} — Authority Score ${b.authorityScore}, links to ${b.rivals} rivals`);
    lines.push("");
  }
  lines.push("## Title, meta description and H1", "");
  lines.push("**Title tag**", "", ...t.recommendations.title.map((x) => `- ${x}`), "", "Examples:", "", ...t.recommendations.titleExamples.map((x) => `- ${x}`), "");
  lines.push("**Meta description**", "", ...t.recommendations.meta.map((x) => `- ${x}`), "", `Example: ${t.recommendations.metaExample}`, "");
  lines.push("**H1**", "", ...t.recommendations.h1.map((x) => `- ${x}`), "", `Example: ${t.recommendations.h1Example}`, "");
  lines.push("## Suggested outline", "", ...t.outline.map((o) => `- ${o}`), "");
  if (t.questions.length) lines.push("## Questions to answer", "", ...t.questions.map((q) => `- ${q.keyword}`), "");
  if (t.related.length) lines.push("## Related keywords", "", ...t.related.map((r) => `- ${r.keyword} (${r.volume.toLocaleString("en-US")}/mo)`), "");
  lines.push("## Top 10 rivals", "", "| # | Page | Words | Readability | Referring domains |", "|---|---|---|---|---|");
  for (const r of t.rivals) lines.push(`| ${r.position} | [${r.title.replace(/\|/g, "-")}](${r.url}) | ${r.words} | ${r.readability} | ${r.refDomains} |`);
  lines.push("");
  return lines.join("\n");
}
