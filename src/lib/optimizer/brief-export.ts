import { FORMAT_LABEL, INTENT_LABEL } from "./intent";
import type { Brief, BriefCompetitor, Research } from "./types";

/** Brief exports and the research snapshot a brief keeps (pure, client-safe). */

/** The pages a brief was built from: crawled competitors that returned content, in SERP order. */
export function briefCompetitors(research: Research | null): BriefCompetitor[] {
  return (research?.competitors ?? [])
    .filter((c) => !c.error && c.words > 0)
    .slice(0, 10)
    .map((c) => ({ title: c.title, domain: c.domain, url: c.url, position: c.position, words: c.words, format: c.format }));
}

/** Readable SERP feature name ("people_also_ask" → "people also ask"). */
export const featureName = (f: string) => f.replace(/_/g, " ");

const mdCell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();

/** The whole brief as a Markdown document (for download or sharing with a writer). */
export function briefDocumentMarkdown(b: Brief): string {
  const out: string[] = [`# Content brief: ${b.keyword}`, ""];
  out.push(`- **Market:** ${b.db}`);
  out.push(`- **Search intent:** ${INTENT_LABEL[b.intent]}`);
  out.push(`- **Format:** ${FORMAT_LABEL[b.format]}`);
  out.push(`- **Funnel stage:** ${b.funnel}`);
  if (b.wordRange) out.push(`- **Length of ranking pages:** ${b.wordRange[0].toLocaleString("en-US")}–${b.wordRange[1].toLocaleString("en-US")} words`);
  out.push(`- **Created:** ${b.createdAt.slice(0, 10)} (${b.generatedBy === "ai" ? "written by AI from research" : "built from research"})`, "");
  if (b.audience) out.push("## Audience", "", b.audience, "");
  if (b.titleIdeas.length) out.push("## Title ideas", "", ...b.titleIdeas.map((t) => `- ${t}`), "");
  if (b.metaDescription) out.push("## Meta description", "", b.metaDescription, "");
  if (b.outline.length) {
    out.push("## Outline", "");
    for (const o of b.outline) out.push(`${o.level === 3 ? "  " : ""}- ${o.level === 2 ? "H2" : "H3"}: ${o.text}${o.notes ? ` — ${o.notes}` : ""}`);
    out.push("");
  }
  if (b.questions.length) out.push("## Questions to answer", "", ...b.questions.map((q) => `- ${q}`), "");
  if (b.entities.length) out.push("## Entities to mention", "", b.entities.join(", "), "");
  if (b.coverage.length) out.push("## Concepts to cover", "", b.coverage.join(", "), "");
  if (b.serpFeatures?.length) out.push("## SERP features", "", b.serpFeatures.map(featureName).join(", "), "");
  if (b.competitors?.length) {
    out.push("## Pages analysed", "", "| # | Page | Domain | Words | Format |", "| --- | --- | --- | ---: | --- |");
    for (const c of b.competitors) out.push(`| ${c.position ?? "—"} | [${mdCell(c.title || c.url)}](${c.url.replace(/\)/g, "%29").replace(/ /g, "%20")}) | ${mdCell(c.domain)} | ${c.words.toLocaleString("en-US")} | ${c.format ? FORMAT_LABEL[c.format] : "—"} |`);
    out.push("");
  }
  if (b.sources.length) out.push("## Sources", "", ...b.sources.map((s) => `- ${s}`), "");
  return out.join("\n").trim() + "\n";
}
