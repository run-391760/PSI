import { recommendedFromAutocomplete, semanticFromTexts } from "@/lib/content/bench-map";
import { normalizeText, STOPWORDS, wordList } from "@/lib/content/text";
import { intentProfile } from "./intent";
import { contentTokens, parseDraft, stem, type ParsedDoc } from "./parse";
import type { AiReview, DraftInput, IntentProfile, LinkCheck, LiveCheck, Research } from "./types";

/**
 * Everything the checks share for one audit: the parsed draft, intent profile and the coverage
 * targets (questions, subtopics, entities, related terms) assembled from whichever real sources exist.
 */

export type Target = { text: string; source: "paa" | "autocomplete" | "competitors" | "brief" | "ai"; support: number };

export type OtherDraft = { id: string; title: string; keyword: string; slug: string; url: string };

export type Ctx = {
  draft: DraftInput;
  doc: ParsedDoc;
  kw: string;
  kwTokens: string[];
  research: Research | null;
  ai: AiReview | null;
  links: LinkCheck | null;
  live: LiveCheck | null;
  intent: IntentProfile;
  siteDomain: string | null;
  now: Date;
  others: OtherDraft[];
  /** Stemmed content tokens of the whole draft (title, meta and body). */
  tokens: Set<string>;
  questions: Target[];
  subtopics: Target[];
  entities: Target[];
  terms: Target[];
  competitors: NonNullable<Research>["competitors"];
};

export const STOP = STOPWORDS;
/** Autocomplete modifiers that are platforms or formats, not subtopics. */
const NOISE = new Set(["reddit", "quora", "youtube", "pdf", "ppt", "wikipedia", "hindi", "gujarati", "marathi", "tamil", "telugu", "app", "apk", "login", "near", "meaning", "notes", "quiz", "mcq", "drawing", "images", "photos", "wallpaper", "logo", "song", "movie", "brainly", "byjus", "slideshare"]);
/** Evaluative words searchers add that are not concepts to cover. */
const GENERIC = new Set(["better", "best", "good", "easy", "easier", "tough", "difficult", "hard", "which", "worth", "list", "top", "latest", "new", "free", "online", "full", "form", "com"]);
const QUESTION = /^(how|what|why|when|where|who|which|is|are|can|does|do|should|will|was|were)\b/i;

export function siteDomainOf(draft: Pick<DraftInput, "url" | "meta">) {
  for (const u of [draft.url, draft.meta.canonical, draft.meta.organization?.url]) {
    if (!u) continue;
    try {
      return new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, "").toLowerCase();
    } catch {
      /* not a URL */
    }
  }
  return null;
}

const clean = (s: string) => s.replace(/^\s*(\d+[.)]|step \d+:?|#\d+)\s*/i, "").replace(/\s+/g, " ").trim();
const keyOf = (s: string) => [...new Set(contentTokens(s, STOP).map(stem))].sort().join(" ");

function jaccard(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n / (a.size + b.size - n);
}

/** Merge near-identical targets (token Jaccard ≥ 0.6), summing support. */
function dedupe(list: Target[]): Target[] {
  const out: (Target & { set: Set<string> })[] = [];
  for (const t of list) {
    const set = new Set(keyOf(t.text).split(" ").filter(Boolean));
    if (!set.size) continue;
    const hit = out.find((o) => jaccard(o.set, set) >= 0.6);
    if (hit) hit.support += t.support;
    else out.push({ ...t, set });
  }
  return out.map(({ set: _set, ...t }) => t);
}

/** Capitalized multi-word names and acronyms used by several competitor pages. */
export function entitiesFromTexts(texts: string[], keyword: string, minDocs: number): string[] {
  const kw = new Set(wordList(normalizeText(keyword)));
  const df = new Map<string, number>();
  const display = new Map<string, string>();
  for (const text of texts) {
    const seen = new Set<string>();
    const lower = text.toLowerCase();
    const re = /\b([A-Z][a-zA-Z&'.-]+(?:\s+(?:of|and|for|the|de|in)?\s*[A-Z][a-zA-Z&'.-]+){0,3}|[A-Z]{2,6}s?)\b/g;
    for (const m of text.matchAll(re)) {
      const raw = m[1].trim().replace(/[.'-]+$/, "");
      const key = raw.toLowerCase();
      if (raw.length < 2 || STOP.has(key) || kw.has(key)) continue;
      const single = !raw.includes(" ");
      // Single capitalized words that also appear in lower case are ordinary words at sentence start.
      if (single && !/^[A-Z]{2,6}s?$/.test(raw)) {
        const lc = (lower.match(new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g")) ?? []).length;
        const uc = (text.match(new RegExp(`\\b${raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g")) ?? []).length;
        if (lc > uc * 0.5 || raw.length < 4) continue;
      }
      if (/^(The|This|That|These|Those|It|In|On|For|With|And|But|Or|If|When|What|How|Why|Our|Your|We|You|Step|Table|Figure|Image|Source|Read|Click|Learn|Home|Menu|Share|Copyright|Related|Next|Previous|Also)\b/.test(raw)) continue;
      seen.add(key);
      if (!display.has(key)) display.set(key, raw);
    }
    for (const s of seen) df.set(s, (df.get(s) ?? 0) + 1);
  }
  return [...df.entries()]
    .filter(([, c]) => c >= minDocs)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 30)
    .map(([k]) => display.get(k)!);
}

export function buildContext(draft: DraftInput, extra: { research?: Research | null; ai?: AiReview | null; links?: LinkCheck | null; live?: LiveCheck | null; others?: OtherDraft[]; now?: Date } = {}): Ctx {
  const siteDomain = siteDomainOf(draft);
  const doc = parseDraft(draft.body, siteDomain);
  const research = extra.research ?? null;
  const ai = extra.ai ?? null;
  const kw = normalizeText(draft.keyword);
  const kwTokens = wordList(kw).filter((w) => !STOP.has(w));
  const tokens = new Set(contentTokens(`${draft.title}\n${draft.metaDescription}\n${doc.plain}`, STOP).map(stem));
  const competitors = (research?.competitors ?? []).filter((c) => !c.error && c.words >= 100);
  const brief = draft.meta.brief ?? null;

  // Questions: People Also Ask, question-form autocomplete, competitor question headings, the brief.
  const qs: Target[] = [];
  for (const q of research?.paa ?? []) qs.push({ text: q, source: "paa", support: 3 });
  for (const s of research?.autocomplete ?? []) if (QUESTION.test(s)) qs.push({ text: `${s.charAt(0).toUpperCase()}${s.slice(1)}${/\?$/.test(s) ? "" : "?"}`, source: "autocomplete", support: 1 });
  const compQ = new Map<string, { text: string; n: number }>();
  for (const c of competitors) for (const q of new Set(c.questions.map(clean))) {
    const k = keyOf(q);
    const hit = compQ.get(k);
    if (hit) hit.n++;
    else compQ.set(k, { text: q, n: 1 });
  }
  for (const { text, n } of compQ.values()) if (n >= (competitors.length >= 3 ? 2 : 1)) qs.push({ text, source: "competitors", support: n });
  for (const q of brief?.questions ?? []) qs.push({ text: q, source: "brief", support: 2 });
  const questions = dedupe(qs).slice(0, 25);

  // Subtopics: competitor H2/H3 headings shared by several pages, the brief outline, autocomplete modifiers, Claude.
  const st: Target[] = [];
  if (competitors.length) {
    const groups: { text: string; set: Set<string>; docs: Set<string> }[] = [];
    for (const c of competitors) {
      for (const h of c.headings) {
        if (h.level < 2 || h.level > 3 || /\?\s*$/.test(h.text)) continue;
        const text = clean(h.text);
        if (/^(conclusion|summary|faqs?|frequently asked|table of contents|contents|introduction|related|references|sources|about the author|share|comments?)\b/i.test(text) || wordList(text).length > 12) continue;
        const set = new Set(contentTokens(text, STOP).map(stem).filter((t) => !kwTokens.map(stem).includes(t)));
        if (!set.size) continue;
        const g = groups.find((x) => jaccard(x.set, set) >= 0.5);
        if (g) g.docs.add(c.url);
        else groups.push({ text, set, docs: new Set([c.url]) });
      }
    }
    // Shared by 2+ pages; with fewer than 3 pages a single page's heading counts only when it is about the keyword.
    const kwStems = new Set(kwTokens.map(stem));
    const relevant = (g: { text: string }) => contentTokens(g.text, STOP).map(stem).some((t) => kwStems.has(t));
    for (const g of groups.filter((x) => x.docs.size >= 2 || (competitors.length < 3 && relevant(x))).sort((a, b) => b.docs.size - a.docs.size).slice(0, 20)) st.push({ text: g.text, source: "competitors", support: g.docs.size });
  }
  for (const o of brief?.outline ?? []) if (o.level === 2) st.push({ text: o.text, source: "brief", support: 2 });
  for (const m of ai?.completeness.missing ?? []) st.push({ text: m, source: "ai", support: 2 });
  if (research?.autocomplete?.length) {
    // The words searchers add to the keyword ("fees", "eligibility", "which is better") are the subtopic.
    const kwSet = new Set(kwTokens);
    for (const s of research.autocomplete) {
      if (QUESTION.test(s)) continue;
      const words = wordList(normalizeText(s));
      const rest = words.filter((w) => !kwSet.has(w) && !STOP.has(w));
      if (!rest.length || rest.length > 3 || rest.some((w) => NOISE.has(w))) continue;
      const modifier = words.filter((w) => !kwSet.has(w)).join(" ").replace(/^(for|in|of|and|the|a|an|vs)\s+/, "").trim();
      if (modifier) st.push({ text: modifier, source: "autocomplete", support: 1 });
    }
  }
  const subtopics = dedupe(st).slice(0, 24);

  // Entities: proper names and acronyms several ranking pages use, plus Claude's and the brief's lists.
  const en: Target[] = [];
  if (competitors.length >= 2) for (const e of entitiesFromTexts(competitors.map((c) => c.text), kw, competitors.length >= 4 ? 2 : 2)) en.push({ text: e, source: "competitors", support: 2 });
  for (const e of ai?.entities ?? []) en.push({ text: e, source: "ai", support: 2 });
  for (const e of brief?.entities ?? []) en.push({ text: e, source: "brief", support: 2 });
  const entities = dedupe(en).slice(0, 25);

  // Related terms: shared vocabulary of the ranking pages, else the words searchers add in autocomplete.
  const tm: Target[] = [];
  if (competitors.length >= 3) for (const t of semanticFromTexts([kw, ...draft.keywords], competitors.map((c) => ({ domain: c.domain, text: c.text })), 20)) tm.push({ text: t.term, source: "competitors", support: t.rivals });
  else if (research?.autocomplete?.length) for (const t of recommendedFromAutocomplete(kw, research.autocomplete, 25)) if (!NOISE.has(t) && !GENERIC.has(t) && t.length > 3) tm.push({ text: t, source: "autocomplete", support: 1 });
  for (const c of brief?.coverage ?? []) if (wordList(c).length <= 3) tm.push({ text: c, source: "brief", support: 1 });
  const terms = dedupe(tm).slice(0, 24);

  return {
    draft,
    doc,
    kw,
    kwTokens,
    research,
    ai,
    links: extra.links ?? null,
    live: extra.live ?? null,
    intent: intentProfile(kw, draft.title, doc, research, ai),
    siteDomain,
    now: extra.now ?? new Date(),
    others: extra.others ?? [],
    tokens,
    questions,
    subtopics,
    entities,
    terms,
    competitors,
  };
}

/** Coverage of a target in the draft (0..1), ignoring the keyword's own words when others remain. */
export function covered(ctx: Ctx, text: string) {
  const kw = new Set(ctx.kwTokens.map(stem));
  let toks = [...new Set(contentTokens(text, STOP).map(stem))];
  const rest = toks.filter((t) => !kw.has(t));
  if (rest.length) toks = rest;
  if (!toks.length) return 0;
  return toks.filter((t) => ctx.tokens.has(t)).length / toks.length;
}

/** Whether a question is answered: a heading or a paragraph covers most of its content words. */
export function answered(ctx: Ctx, q: string) {
  const kw = new Set(ctx.kwTokens.map(stem));
  const toks = [...new Set(contentTokens(q.replace(QUESTION, ""), STOP).map(stem))].filter((t) => !kw.has(t) || contentTokens(q, STOP).length <= 2);
  if (!toks.length) return true;
  const units = [...ctx.doc.headings.map((h) => h.text), ...ctx.doc.paragraphs.map((p) => p.text)];
  return units.some((u) => {
    const set = new Set(contentTokens(u, STOP).map(stem));
    return toks.filter((t) => set.has(t)).length / toks.length >= 0.75;
  });
}
