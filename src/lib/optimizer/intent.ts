import { hasKeyword, normalizeText } from "@/lib/content/text";
import type { ParsedDoc } from "./parse";
import type { AiReview, CompetitorPage, ContentFormat, Funnel, Intent, IntentProfile, Research } from "./types";

/**
 * Search intent from independent signals: the query's wording, DataForSEO's intent classification of
 * the keyword (when keyword data was fetched), the formats of the pages that rank (live SERP or the
 * competitor URLs the user supplied) and, when configured, the AI review. The SERP outranks the
 * classifier and the wording because it shows what Google actually rewards.
 */

const RULES: { intent: Intent; re: RegExp; label: string }[] = [
  { intent: "local", re: /\b(near me|nearby|near by|in my area|closest)\b/, label: "local modifier" },
  { intent: "navigational", re: /\b(login|log in|sign in|signin|official (site|website)|portal|website|homepage|contact number|customer care|app download)\b/, label: "navigational term" },
  { intent: "transactional", re: /\b(buy|price|prices|pricing|cost|costs|fee|fees|cheap|discount|deal|deals|coupon|order|apply|application form|admission|admissions|enrol|enroll|enrollment|register|registration|book|booking|hire|quote|for sale|subscribe|download|free trial|scholarship form)\b/, label: "transactional term" },
  { intent: "commercial", re: /\b(best|top \d*|top|vs|versus|compare|comparison|review|reviews|alternative|alternatives|ranking|rankings|rated|which|worth it|pros and cons|cheapest|recommended)\b/, label: "commercial-investigation term" },
  { intent: "informational", re: /\b(how|what|why|when|where|who|guide|tutorial|tips|ideas|examples|meaning|definition|define|steps|learn|history|benefits|types of|list of|explained|syllabus|eligibility|scope|career|careers|salary)\b/, label: "informational question/term" },
];

export function keywordIntent(keyword: string): { intent: Intent; signals: string[] } {
  const k = normalizeText(keyword);
  const hits = RULES.filter((r) => r.re.test(k));
  if (!hits.length) return { intent: "informational", signals: ["no modifier: broad topic queries are usually informational"] };
  // Questions are informational even when they contain a commercial word ("how much does X cost" stays transactional though).
  const q = /^(how|what|why|when|where|who|is|are|can|does|do|should)\b/.test(k);
  const transactional = hits.find((h) => h.intent === "transactional");
  if (q && !(transactional && /\b(cost|price|fee|fees)\b/.test(k))) return { intent: "informational", signals: hits.map((h) => `${h.label}: "${(k.match(h.re) ?? [""])[0]}"`) };
  // "admission process", "fees structure explained", "eligibility criteria": research questions, not purchases.
  if (transactional && /\b(process|procedure|eligibility|criteria|requirements|documents|syllabus|steps|guide|explained|structure|dates|timeline)\b/.test(k) && !/\b(apply now|buy|order|book)\b/.test(k))
    return { intent: "informational", signals: [...hits.map((h) => `${h.label}: "${(k.match(h.re) ?? [""])[0]}"`), "process/eligibility wording: searchers are researching before acting"] };
  const order: Intent[] = ["local", "navigational", "transactional", "commercial", "informational"];
  const best = order.find((o) => hits.some((h) => h.intent === o))!;
  return { intent: best, signals: hits.map((h) => `${h.label}: "${(k.match(h.re) ?? [""])[0]}"`) };
}

const FORMAT_INTENT: Record<ContentFormat, Intent> = {
  "how-to": "informational",
  guide: "informational",
  news: "informational",
  listicle: "commercial",
  comparison: "commercial",
  review: "commercial",
  landing: "transactional",
};

const CTA_RE = /\b(apply now|apply today|enrol now|enroll now|register now|sign up|book (a|your)|buy now|order now|get started|contact us|request (a )?(call|demo|quote|brochure)|download (the )?(brochure|prospectus)|start (your|a) free|schedule (a|your)|enquire now|talk to (an|our)|call us)\b/i;
export const hasCta = (text: string) => CTA_RE.test(text);
export const ctaMatches = (text: string) => [...new Set((text.match(new RegExp(CTA_RE.source, "gi")) ?? []).map((s) => s.toLowerCase()))];

/** Detect the article's format from its title, headings, lists and tables. */
export function detectFormat(title: string, doc: ParsedDoc): { format: ContentFormat; signals: string[] } {
  const t = normalizeText(`${title} ${doc.h1s[0]?.text ?? ""}`);
  const h2 = doc.headings.filter((h) => h.level === 2).map((h) => h.text);
  const signals: string[] = [];
  const numberedH2 = h2.filter((h) => /^\d+[.)]?\s/.test(h)).length;
  const steps = doc.lists.filter((l) => l.ordered && l.items.length >= 3).length + h2.filter((h) => /^step\s*\d/i.test(h)).length;
  if (/\b(vs|versus|compared|comparison|compare)\b/.test(t) || (doc.tables.length && h2.some((h) => /\bvs\b|comparison|compare/i.test(h)))) return { format: "comparison", signals: ["comparison wording or comparison table"] };
  if (/\breview\b/.test(t) || h2.some((h) => /^(pros|cons|verdict|our verdict|rating)/i.test(h))) return { format: "review", signals: ["review wording or pros/cons/verdict sections"] };
  if (/^\d+\s/.test(t) || /\b(best|top \d+|top)\b/.test(t) || numberedH2 >= 4) {
    signals.push(numberedH2 >= 4 ? `${numberedH2} numbered sections` : "list-style title");
    return { format: "listicle", signals };
  }
  if (/^how to\b/.test(t) || steps >= 2 || (steps >= 1 && /\b(steps?|process|procedure)\b/.test(t))) return { format: "how-to", signals: [steps ? `${steps} step lists/sections` : "how-to title"] };
  const ctas = ctaMatches(doc.plain).length;
  if ((ctas >= 2 && doc.words < 900) || /\b(apply|admission|admissions open|enrol|buy|pricing|book)\b/.test(t)) return { format: "landing", signals: [`${ctas} calls to action`, "conversion-focused wording"] };
  if (/\b(announces|announced|launches|launched|news|update|today)\b/.test(t)) return { format: "news", signals: ["news wording"] };
  return { format: "guide", signals: ["explanatory article (no list, step, comparison or sales pattern)"] };
}

export function competitorFormat(c: Pick<CompetitorPage, "title" | "headings" | "tables" | "lists" | "words">): ContentFormat {
  const fake = { h1s: [], headings: c.headings.map((h) => ({ ...h, line: 0 })), lists: Array.from({ length: c.lists }, () => ({ ordered: false, items: [], line: 0, section: 0 })), tables: Array.from({ length: c.tables }, () => ({ headers: [], rows: 0, cols: 0, line: 0, section: 0 })), plain: "", words: c.words } as unknown as ParsedDoc;
  return detectFormat(c.title, fake).format;
}

/** How acceptable each format is for each intent (1 = ideal). */
const FIT: Record<Intent, Record<ContentFormat, number>> = {
  informational: { guide: 1, "how-to": 1, news: 0.8, listicle: 0.75, comparison: 0.55, review: 0.45, landing: 0.2 },
  commercial: { listicle: 1, comparison: 1, review: 0.95, guide: 0.6, "how-to": 0.45, news: 0.3, landing: 0.35 },
  transactional: { landing: 1, guide: 0.55, comparison: 0.55, listicle: 0.45, review: 0.5, "how-to": 0.5, news: 0.2 },
  navigational: { landing: 1, guide: 0.6, "how-to": 0.6, news: 0.5, listicle: 0.3, comparison: 0.3, review: 0.3 },
  local: { landing: 0.9, guide: 0.7, listicle: 0.8, comparison: 0.5, review: 0.6, "how-to": 0.4, news: 0.3 },
};
export const formatFit = (intent: Intent, format: ContentFormat) => FIT[intent][format];

export const INTENT_LABEL: Record<Intent, string> = { informational: "Informational", commercial: "Commercial investigation", transactional: "Transactional", navigational: "Navigational", local: "Local" };
export const FORMAT_LABEL: Record<ContentFormat, string> = { "how-to": "How-to / step-by-step", guide: "Guide / explainer", listicle: "List (best / top)", comparison: "Comparison", review: "Review", landing: "Landing / sales page", news: "News / update" };
export const FUNNEL_FOR: Record<Intent, Funnel> = { informational: "awareness", commercial: "consideration", transactional: "decision", navigational: "decision", local: "decision" };

/** DataForSEO's main intent for the keyword, only when the stored keyword data is for the current keyword. */
export function dataforseoIntent(keyword: string, research: Research | null): Intent | null {
  const k = research?.keywordData;
  if (!k?.intents.length || normalizeText(k.keyword) !== normalizeText(keyword)) return null;
  return k.intents[0];
}

export function intentProfile(keyword: string, title: string, doc: ParsedDoc, research: Research | null, ai: AiReview | null): IntentProfile {
  const kw = keywordIntent(keyword);
  const { format, signals } = detectFormat(title, doc);
  const comps = (research?.competitors ?? []).filter((c) => !c.error && c.words > 100);
  const serpFormats: Partial<Record<ContentFormat, number>> = {};
  let serp: Intent | null = null;
  if (comps.length >= 2) {
    const votes: Partial<Record<Intent, number>> = {};
    for (const c of comps) {
      const fmt = c.format ?? competitorFormat(c);
      serpFormats[fmt] = (serpFormats[fmt] ?? 0) + 1;
      const byTitle = keywordIntent(c.title).intent;
      const fromFormat = FORMAT_INTENT[fmt];
      // Format is the stronger signal; titles break ties.
      votes[fromFormat] = (votes[fromFormat] ?? 0) + 2;
      votes[byTitle] = (votes[byTitle] ?? 0) + 1;
    }
    serp = (Object.entries(votes) as [Intent, number][]).sort((a, b) => b[1] - a[1])[0][0];
  }
  const dataforseo = dataforseoIntent(keyword, research);
  const dominant = ai?.intent.dominant ?? serp ?? dataforseo ?? kw.intent;
  return { keyword: kw.intent, keywordSignals: kw.signals, serp, serpFormats, dataforseo, ai: ai?.intent.dominant ?? null, dominant, format, formatSignals: signals, contentIntent: FORMAT_INTENT[format] };
}

/** Intent-specific content signals (0..1) and what is missing. */
export function intentSignals(intent: Intent, keyword: string, doc: ParsedDoc, title: string) {
  const missing: string[] = [];
  const found: string[] = [];
  const firstWords = doc.intro.text.split(/\s+/).slice(0, 120).join(" ");
  const add = (ok: boolean, yes: string, no: string) => (ok ? found.push(yes) : missing.push(no), ok ? 1 : 0);
  let got = 0,
    of = 0;
  const h2 = doc.headings.filter((h) => h.level === 2);
  if (intent === "informational") {
    of = 4;
    got += add(hasKeyword(firstWords, keyword) || hasKeyword(firstWords, keyword.split(" ").slice(-2).join(" ")), "topic addressed in the first 120 words", "answer the query in the introduction");
    got += add(h2.length >= 3, `${h2.length} explanatory sections`, "at least 3 sections that explain the topic");
    got += add(/\b(for example|for instance|e\.g\.|such as|case study|example)\b/i.test(doc.plain), "examples", "concrete examples");
    got += add(doc.faqs.length > 0 || doc.lists.length > 0, "lists or Q&A that answer sub-questions", "lists or Q&A answering sub-questions");
  } else if (intent === "commercial") {
    of = 4;
    const options = Math.max(h2.filter((h) => /^\d+[.)]?\s/.test(h.text)).length, Math.max(0, ...doc.lists.map((l) => l.items.length)));
    got += add(options >= 3, `${options} options compared`, "compare at least 3 options");
    got += add(doc.tables.length > 0, "comparison table", "a comparison table");
    got += add(/\b(pros?|cons?|advantages|disadvantages|drawbacks|benefits)\b/i.test(doc.plain), "pros and cons", "pros and cons or trade-offs");
    got += add(/\b(criteria|how we (chose|picked|ranked|tested)|methodology|compared on|factors)\b/i.test(doc.plain), "selection criteria", "how the options were evaluated (criteria)");
  } else if (intent === "transactional") {
    of = 4;
    got += add(hasCta(doc.plain), "a clear call to action", "a clear call to action (apply, buy, book, contact)");
    got += add(/\b(fee|fees|price|pricing|cost|₹|rs\.?|inr|\$|usd|eligibility|requirements?)\b/i.test(doc.plain), "price, fees or eligibility details", "price, fees or eligibility details");
    got += add(/\b(steps?|process|how to apply|procedure|deadline|last date|documents required)\b/i.test(doc.plain), "the process / next steps", "the process and deadlines");
    got += add(/\b(contact|call|email|phone|whatsapp|visit)\b/i.test(doc.plain), "contact options", "contact options");
  } else if (intent === "navigational") {
    of = 2;
    got += add(doc.links.length > 0, "direct links", "direct links to the destination");
    got += add(hasKeyword(title, keyword), "destination named in the title", "the destination named in the title");
  } else {
    of = 3;
    got += add(/\b(address|located|location|directions|map|campus|near)\b/i.test(doc.plain), "location details", "address/location details");
    got += add(/\b(hours|open|timings|contact|phone|call)\b/i.test(doc.plain), "opening hours or contact", "hours and contact details");
    got += add(hasCta(doc.plain), "a call to action", "a call to action (visit, call, book)");
  }
  return { score: of ? got / of : 0, found, missing };
}
