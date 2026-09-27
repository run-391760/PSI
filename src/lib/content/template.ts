/**
 * SEO Content Template: a content brief built from the real Google top 10 (DataForSEO) for 1–5
 * keywords, with each result page crawled (robots.txt respected) to derive length, readability,
 * structure and related-word targets. Without DataForSEO the page shows <NeedsData>.
 */
import { createHash } from "node:crypto";
import { database, normalizeKeyword } from "@/lib/domain";
import { cached, type Sourced } from "@/lib/providers/source";
import type { SerpFeature } from "@/lib/seo/types";
import { keywordSnippets, mergeSerps, semanticFromTexts, summarizeRivals, type RealRival, type RivalAvg, type SemanticTerm } from "./bench-map";
import { crawlRivals, liveSerpTop } from "./real";
import { countKeyword, fleschLabel } from "./text";

import type { Snippet } from "./bench-map";
export type { Snippet };
export type ContentTemplate = {
  keywords: string[];
  db: string;
  serps: { keyword: string; features: SerpFeature[] }[];
  rivals: RealRival[];
  avg: RivalAvg | null;
  targets: { readabilityLabel: string | null; audience: string | null; mentions: { keyword: string; avg: number | null }[] };
  semantic: SemanticTerm[];
  related: string[];
  questions: string[];
  recommendations: { title: string[]; meta: string[]; h1: string[] };
  snippets: Snippet[];
  outline: string[];
  fetchedAt: string;
};

export const MAX_TEMPLATE_KEYWORDS = 5;
const ACRONYMS = new Set(["crm", "erp", "seo", "mba", "bba", "bca", "hr", "vpn", "api", "ai", "pdf", "usa", "uk", "ielts", "gre", "gst", "emi", "sip", "ppc", "cms", "ui", "ux", "tv", "diy", "faq"]);
export const cap = (s: string) => s.replace(/\b[a-z][a-z0-9]*/g, (w) => (ACRONYMS.has(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)));

export function parseTemplateKeywords(q: string) {
  return [...new Set(q.split(/[,\n;]+/).map(normalizeKeyword).filter((k) => k.length >= 2 && k.length <= 100 && /\p{L}/u.test(k)))].slice(0, MAX_TEMPLATE_KEYWORDS);
}

export async function buildTemplate(ownerId: string, keywordsInput: string[], dbInput: string): Promise<Sourced<ContentTemplate>> {
  const db = database(dbInput).code;
  const keywords = keywordsInput.slice(0, MAX_TEMPLATE_KEYWORDS);
  const key = createHash("sha1").update(`${db}|${keywords.join("|")}`).digest("hex").slice(0, 16);
  return cached(`content-tpl:v1:${key}`, "dataforseo", 24, async (): Promise<ContentTemplate> => {
    const serps = [];
    for (const k of keywords) serps.push(await liveSerpTop(ownerId, k, db, 10));
    const merged = mergeSerps(serps.map((s) => s.organic));
    const primary = keywords[0];
    const { rivals, texts } = await crawlRivals(merged, primary, 10);
    const avg = summarizeRivals(rivals);
    const fl = avg?.readability != null ? fleschLabel(avg.readability) : null;
    const mentions = keywords.map((k) => ({ keyword: k, avg: texts.length >= 3 ? Math.round(texts.reduce((s, t) => s + countKeyword(t.text, k), 0) / texts.length) : null }));
    const semantic = semanticFromTexts(keywords, texts, 24);
    const related = [...new Set(serps.flatMap((s) => s.related))].slice(0, 15);
    const questions = [...new Set(serps.flatMap((s) => s.questions))].slice(0, 8);
    const second = keywords[1];
    const outline = [...questions.slice(0, 4), ...related.slice(0, 3).map(cap), `${cap(primary)}: frequently asked questions`];
    const titleTopPct = avg ? avg.titleKw : null;
    return {
      keywords,
      db,
      serps: serps.map((s, i) => ({ keyword: keywords[i], features: s.features })),
      rivals,
      avg,
      targets: { readabilityLabel: fl?.label ?? null, audience: fl?.audience ?? null, mentions },
      semantic,
      related,
      questions,
      recommendations: {
        title: [
          `Include “${primary}”${second ? ` and, if it reads naturally, “${second}”` : ""} — ideally near the beginning.${titleTopPct != null ? ` ${titleTopPct}% of the top pages do.` : ""}`,
          "Keep it to 50–60 characters so it isn't truncated in results.",
          "Make each page title unique and specific about what the reader gets.",
        ],
        meta: [`Include “${primary}” and a clear benefit or call to action.`, "Aim for 120–155 characters.", "Summarize the page honestly — Google may rewrite descriptions that don't match the content."],
        h1: [`Use one H1 that contains “${primary}”.`, "It can differ from the title tag but should describe the same topic.", ...(avg ? [`Structure the body with about ${Math.max(3, avg.h2)} H2 sections, like the top pages.`] : [])],
      },
      snippets: keywordSnippets(merged, keywords),
      outline,
      fetchedAt: new Date().toISOString(),
    };
  });
}

/** Markdown export of the brief. */
export function templateMarkdown(t: ContentTemplate) {
  const lines: string[] = [];
  const n = (x: number) => x.toLocaleString("en-US");
  lines.push(`# SEO content template: ${t.keywords.join(", ")}`, "");
  lines.push(`Database: ${database(t.db).name} · Generated ${t.fetchedAt.slice(0, 10)} by SynapseSEO from the live Google top 10 (DataForSEO); ${t.avg?.crawled ?? 0} result pages crawled.`, "");
  lines.push("## Key recommendations", "");
  if (t.avg) {
    lines.push(`- **Text length:** about ${n(t.avg.words)} words (top-10 range ${n(t.avg.wordsRange[0])}–${n(t.avg.wordsRange[1])}).`);
    if (t.avg.readability != null) lines.push(`- **Readability:** Flesch reading ease around ${t.avg.readability} (${t.targets.readabilityLabel}, ${t.targets.audience}).`);
    lines.push(`- **Structure:** about ${t.avg.h2} H2 sections and ${t.avg.images} images${t.avg.video >= 40 ? `; ${t.avg.video}% of the top pages embed a video` : ""}.`);
  } else lines.push("- Too few top-10 pages could be crawled to set length and readability targets.");
  for (const m of t.targets.mentions) if (m.avg != null) lines.push(`- **Use “${m.keyword}”** about ${m.avg} times.`);
  lines.push("");
  if (t.semantic.length) lines.push("### Words the top pages use", "", t.semantic.map((s) => `${s.term} (${s.rivals}/${s.of})`).join(", "), "");
  lines.push("## Title, meta description and H1", "");
  lines.push("**Title tag**", "", ...t.recommendations.title.map((x) => `- ${x}`), "");
  lines.push("**Meta description**", "", ...t.recommendations.meta.map((x) => `- ${x}`), "");
  lines.push("**H1**", "", ...t.recommendations.h1.map((x) => `- ${x}`), "");
  lines.push("## Suggested outline", "", ...t.outline.map((o) => `- ${o}`), "");
  if (t.questions.length) lines.push("## Questions people also ask", "", ...t.questions.map((q) => `- ${q}`), "");
  if (t.related.length) lines.push("## Related searches", "", ...t.related.map((r) => `- ${r}`), "");
  lines.push("## Top 10", "", "| # | Page | Words | Readability | Mentions |", "|---|---|---|---|---|");
  for (const r of t.rivals) lines.push(`| ${r.position} | [${r.title.replace(/\|/g, "-")}](${r.url}) | ${r.words ?? "n/a"} | ${r.readability ?? "n/a"} | ${r.mentions ?? "n/a"} |`);
  lines.push("");
  return lines.join("\n");
}
