import { hasKeyword, normalizeText, sentenceFormality, toneLabel, wordList } from "@/lib/content/text";
import type { DraftInput, EvidenceItem, GscPerformance, Research } from "./types";

/**
 * Extra evidence signals (pure, client-safe): the tone of voice ported from the SEO Writing Assistant,
 * and Search Console data for the draft URL (stored in the research when the domain is a linked project).
 */

// -------------------------------------------------------------------------------- tone of voice

export type ToneSummary = { score: number; label: ReturnType<typeof toneLabel>; casual: string[]; formal: string[]; measured: number };

/** Word-weighted formality of the sentences (−1 casual … +1 formal), on the Writing Assistant's scale and thresholds. */
export function toneOf(sentences: string[]): ToneSummary {
  const scored = sentences.map((text) => ({ text, words: wordList(text).length, f: sentenceFormality(text) })).filter((s) => s.words >= 6);
  const words = scored.reduce((a, s) => a + s.words, 0);
  const score = words ? scored.reduce((a, s) => a + s.f * s.words, 0) / words : 0;
  return {
    score: Math.round(score * 100) / 100,
    label: toneLabel(score),
    casual: scored.filter((s) => s.f < -0.3).sort((a, b) => a.f - b.f).map((s) => s.text),
    formal: scored.filter((s) => s.f > 0.3).sort((a, b) => b.f - a.f).map((s) => s.text),
    measured: scored.length,
  };
}

/** The tone as one evidence item: label, scale position and whether the voice is consistent. */
export function toneEvidence(t: ToneSummary): EvidenceItem | null {
  if (!t.measured) return null;
  const mixed = t.casual.length >= 2 && t.formal.length >= 2;
  const parts = [`Formality ${t.score > 0 ? "+" : ""}${t.score.toFixed(2)} on a −1 (casual) to +1 (formal) scale`, `${t.casual.length} casual and ${t.formal.length} formal sentence${t.formal.length === 1 ? "" : "s"} stand out`];
  if (mixed) parts.push("the voice switches between casual and formal: keep one tone throughout");
  const example = mixed ? t.casual[0] : null;
  return { label: `Tone of voice: ${t.label}`, detail: `${parts.join("; ")}.${example ? ` Most casual: “${example.length > 120 ? `${example.slice(0, 119).trimEnd()}…` : example}”` : ""}`, tone: mixed ? "warning" : "neutral" };
}

// -------------------------------------------------------------------------------- Search Console

const urlKey = (u: string) => {
  try {
    const x = new URL(/^https?:\/\//i.test(u.trim()) ? u.trim() : `https://${u.trim()}`);
    return `${x.hostname.replace(/^www\./, "")}${x.pathname.replace(/\/+$/, "")}`.toLowerCase();
  } catch {
    return null;
  }
};

/** Search Console data from the research, only while it belongs to the draft's current URL (or canonical). */
export function gscFor(draft: Pick<DraftInput, "url" | "meta">, research: Research | null | undefined): GscPerformance | null {
  const g = research?.gsc;
  if (!g) return null;
  const key = urlKey(g.url);
  return key && [draft.url, draft.meta.canonical].some((u) => !!u && urlKey(u) === key) ? g : null;
}

const fmtPos = (p: number) => (Math.round(p * 10) / 10).toString();

/** Evidence for keyword relevance: the queries the page already gets impressions for, and the primary keyword among them. */
export function gscQueryEvidence(g: GscPerformance, keyword: string): EvidenceItem[] {
  if (!g.queries.length) return [{ label: "Search Console: no queries for this URL yet (last 28 days)", detail: `Property ${g.site}. Data appears once the page is indexed and shown in results.`, tone: "neutral" }];
  const k = normalizeText(keyword);
  const exact = g.queries.find((q) => normalizeText(q.query) === k);
  const related = g.queries.filter((q) => hasKeyword(q.query, keyword) || normalizeText(q.query).includes(k));
  const top = g.queries.slice(0, 5).map((q) => `“${q.query}” (#${fmtPos(q.position)}, ${q.impressions.toLocaleString("en-US")} impr.)`);
  return [
    { label: `Search Console: the page ranks for ${g.queries.length} quer${g.queries.length === 1 ? "y" : "ies"} (last 28 days)`, detail: `Top by impressions: ${top.join(", ")}.`, tone: "neutral" },
    exact
      ? { label: `“${keyword}” already ranks at #${fmtPos(exact.position)}`, detail: `${exact.clicks.toLocaleString("en-US")} clicks, ${exact.impressions.toLocaleString("en-US")} impressions, CTR ${(exact.ctr * 100).toFixed(1)}%.`, tone: "good" }
      : related.length
        ? { label: `${related.length} of the page's queries contain “${keyword}”`, detail: related.slice(0, 3).map((q) => `“${q.query}” #${fmtPos(q.position)}`).join(", "), tone: "good" }
        : { label: `None of the page's queries contain “${keyword}”`, detail: "Google associates this URL with other queries: check that the keyword describes what the page is about.", tone: "warning" },
  ];
}

/** Evidence for keyword-to-URL mapping: other pages of the site that get impressions for the keyword. */
export function gscCannibalEvidence(g: GscPerformance, keyword: string): EvidenceItem[] {
  const own = urlKey(g.url);
  const others = (g.keywordPages ?? []).filter((p) => urlKey(p.url) !== own);
  if (!others.length) return [];
  return others.slice(0, 3).map((p) => ({ label: `Search Console: ${p.url} also ranks for “${keyword}” (#${fmtPos(p.position)})`, detail: `${p.impressions.toLocaleString("en-US")} impressions in the last 28 days. Two URLs competing for one keyword split clicks: consolidate or differentiate them.`, tone: "warning" as const, href: p.url }));
}
