/**
 * Text analysis primitives (client-safe, no server imports): tokenizing, syllables, Flesch reading
 * ease, passive voice and complex-word heuristics, keyword matching, tone and in-text duplication.
 * Used live by the SEO Writing Assistant and server-side by the On Page SEO Checker.
 */

export const STOPWORDS = new Set(
  (
    "a about above after again against all am an and any are aren't as at be because been before being below between both but by can can't cannot could " +
    "couldn't did didn't do does doesn't doing don't down during each few for from further had hadn't has hasn't have haven't having he he'd he'll he's her " +
    "here here's hers herself him himself his how how's i i'd i'll i'm i've if in into is isn't it it's its itself let's me more most mustn't my myself no nor " +
    "not of off on once only or other ought our ours ourselves out over own same shan't she she'd she'll she's should shouldn't so some such than that that's " +
    "the their theirs them themselves then there there's these they they'd they'll they're they've this those through to too under until up very was wasn't " +
    "we we'd we'll we're we've were weren't what what's when when's where where's which while who who's whom why why's with won't would wouldn't you you'd " +
    "you'll you're you've your yours yourself yourselves also just can will may might must shall us get got one two use using used via vs per etc"
  ).split(" "),
);

/** Words (letters, digits, inner apostrophes/hyphens). */
export function wordList(text: string): string[] {
  return text.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu) ?? [];
}
export const normalizeText = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^\p{L}\p{N}'\s-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Syllable estimate for an English word (classic vowel-group heuristic with common corrections). */
export function syllables(input: string): number {
  const w = input.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  let n = (w.replace(/^y/, "").match(/[aeiouy]+/g) ?? []).length;
  if (n > 1) {
    if (/[^aeiouy]e$/.test(w) && !/[^aeiouy]le$/.test(w)) n--;
    else if (/[^aeioutd]ed$/.test(w)) n--;
    else if (/[^aeiouysxzh]es$/.test(w)) n--;
  }
  return Math.max(1, n);
}

const ABBREV = /\b(e\.g|i\.e|etc|vs|mr|mrs|ms|dr|prof|sr|jr|inc|ltd|co|st|no|fig|approx|dept|est|u\.s|u\.k)\.$/i;

/** Split a text block into sentences with offsets relative to the block. */
export function splitSentences(block: string): { start: number; end: number; text: string }[] {
  const out: { start: number; end: number; text: string }[] = [];
  const re = /[.!?]+["')\]”’]*(?=\s+|$)/g;
  let start = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) {
    const end = m.index + m[0].length;
    const candidate = block.slice(start, end);
    if (ABBREV.test(candidate.trim()) || /\b[A-Z]\.$/.test(candidate.trim())) continue;
    // Decimal numbers / URLs: the next char after whitespace must look like a sentence start.
    const next = block.slice(end).match(/^\s+(\S)/);
    if (next && /[a-z]/.test(next[1]) && m[0] === ".") continue;
    pushSentence(out, block, start, end);
    start = end;
  }
  pushSentence(out, block, start, block.length);
  return out;
}
function pushSentence(out: { start: number; end: number; text: string }[], block: string, start: number, end: number) {
  const raw = block.slice(start, end);
  const lead = raw.length - raw.trimStart().length;
  const text = raw.trim();
  if (text && wordList(text).length) out.push({ start: start + lead, end: start + lead + text.length, text });
}

// ---------------------------------------------------------------------------------------------
// Markdown / HTML-in-markdown structure
// ---------------------------------------------------------------------------------------------

export type Block = { kind: "heading" | "paragraph" | "list" | "quote"; level?: number; start: number; end: number; raw: string };

/** Split markdown (tolerating inline HTML) into blocks with document offsets. Code fences are skipped. */
export function markdownBlocks(md: string): Block[] {
  const blocks: Block[] = [];
  const lines = md.split("\n");
  let offset = 0;
  let para: { start: number; end: number; raw: string } | null = null;
  let inFence = false;
  const flush = () => {
    if (para) blocks.push({ kind: "paragraph", ...para });
    para = null;
  };
  for (const line of lines) {
    const lineStart = offset;
    offset += line.length + 1;
    if (/^\s*```/.test(line)) {
      flush();
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (!line.trim()) {
      flush();
      continue;
    }
    const h = line.match(/^(\s*)(#{1,6})\s+(.*)$/) ?? null;
    const htmlH = line.match(/^\s*<h([1-6])[^>]*>(.*?)<\/h\1>\s*$/i);
    if (h || htmlH) {
      flush();
      const lead = h ? h[1].length + h[2].length + 1 : 0;
      blocks.push({ kind: "heading", level: h ? h[2].length : Number(htmlH![1]), start: lineStart + lead, end: lineStart + line.length, raw: h ? h[3] : htmlH![2] });
      continue;
    }
    const li = line.match(/^(\s*(?:[-*+]|\d+[.)])\s+)(.*)$/);
    if (li) {
      flush();
      blocks.push({ kind: "list", start: lineStart + li[1].length, end: lineStart + line.length, raw: li[2] });
      continue;
    }
    const q = line.match(/^(\s*>\s?)(.*)$/);
    if (q) {
      flush();
      blocks.push({ kind: "quote", start: lineStart + q[1].length, end: lineStart + line.length, raw: q[2] });
      continue;
    }
    if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) {
      flush();
      continue;
    }
    if (para) {
      para.raw += "\n" + line;
      para.end = lineStart + line.length;
    } else para = { start: lineStart, end: lineStart + line.length, raw: line };
  }
  flush();
  return blocks;
}

/** Remove inline markdown/HTML syntax, keeping readable text. */
export function inlinePlain(s: string) {
  return s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<img\b[^>]*>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------------------------
// Readability
// ---------------------------------------------------------------------------------------------

export function fleschReadingEase(words: number, sentences: number, syl: number) {
  if (!words || !sentences) return null;
  return Math.round((206.835 - 1.015 * (words / sentences) - 84.6 * (syl / words)) * 10) / 10;
}
export function fleschKincaidGrade(words: number, sentences: number, syl: number) {
  if (!words || !sentences) return null;
  return Math.round((0.39 * (words / sentences) + 11.8 * (syl / words) - 15.59) * 10) / 10;
}
export function fleschLabel(score: number | null | undefined) {
  if (score == null) return { label: "n/a", audience: "", tone: "neutral" as const };
  if (score >= 90) return { label: "Very easy", audience: "5th grade", tone: "good" as const };
  if (score >= 80) return { label: "Easy", audience: "6th grade", tone: "good" as const };
  if (score >= 70) return { label: "Fairly easy", audience: "7th grade", tone: "good" as const };
  if (score >= 60) return { label: "Plain English", audience: "8th–9th grade", tone: "good" as const };
  if (score >= 50) return { label: "Fairly difficult", audience: "10th–12th grade", tone: "warning" as const };
  if (score >= 30) return { label: "Difficult", audience: "College", tone: "serious" as const };
  return { label: "Very difficult", audience: "College graduate", tone: "critical" as const };
}

const IRREGULAR =
  "awoken been born beat become begun bent bet bid bitten bled blown broken brought built burnt bought caught chosen come cost crept cut dealt done drawn dreamt driven drunk eaten fallen fed felt fought found fled flown forbidden forgotten forgiven frozen given gone ground grown hung had heard hidden hit held hurt kept known laid led left lent let lain lit lost made meant met paid put quit read ridden rung risen run said seen sought sold sent set shaken shed shot shown shut sung sunk sat slept slid spoken spent spun split spread stood stolen stuck stung struck sworn swept swum taken taught torn told thought thrown understood woken worn woven won written";
const PARTICIPLE = new RegExp(`^(?:\\w+ed|${IRREGULAR.split(" ").join("|")})$`, "i");
const BE = /^(am|is|are|was|were|be|been|being|isn't|aren't|wasn't|weren't|get|gets|got|gotten)$/i;

/** Passive voice heuristic: a form of "to be"/"get" followed (optionally after an adverb) by a past participle. */
export function isPassive(sentence: string) {
  const w = wordList(sentence);
  for (let i = 0; i < w.length - 1; i++) {
    if (!BE.test(w[i])) continue;
    const next = /ly$/i.test(w[i + 1]) && i + 2 < w.length ? w[i + 2] : w[i + 1];
    if (PARTICIPLE.test(next) && !/^(need|feed|seed|speed|breed|bleed|indeed|exceed|proceed|succeed|red|bed|shed)$/i.test(next)) return true;
  }
  return false;
}

/** Complex (3+ syllable) words, ignoring common inflection-only syllables and capitalized names. */
export function isComplexWord(word: string) {
  if (/^[A-Z]/.test(word) || /\d/.test(word)) return false;
  const base = word.replace(/(es|ed|ing)$/i, "");
  return syllables(base) >= 3;
}

// ---------------------------------------------------------------------------------------------
// Keywords
// ---------------------------------------------------------------------------------------------

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
/** Regex matching a keyword phrase with optional plural "s"/"es" on each word, on word boundaries. */
export function keywordRegex(keyword: string) {
  const parts = normalizeText(keyword).split(" ").filter(Boolean).map((p) => `${escapeRe(p.replace(/(es|s)$/, ""))}(?:s|es)?`);
  if (!parts.length) return null;
  return new RegExp(`(?<![\\p{L}\\p{N}])${parts.join("[\\s\\-]+")}(?![\\p{L}\\p{N}])`, "giu");
}
export function countKeyword(text: string, keyword: string) {
  const re = keywordRegex(keyword);
  if (!re) return 0;
  return (text.match(re) ?? []).length;
}
export function hasKeyword(text: string | null | undefined, keyword: string) {
  return !!text && countKeyword(text, keyword) > 0;
}
/** Keyword occurrences with offsets (for highlighting). */
export function keywordRanges(text: string, keyword: string) {
  const re = keywordRegex(keyword);
  if (!re) return [];
  const out: { start: number; end: number }[] = [];
  for (const m of text.matchAll(re)) out.push({ start: m.index!, end: m.index! + m[0].length });
  return out;
}

// ---------------------------------------------------------------------------------------------
// Tone of voice
// ---------------------------------------------------------------------------------------------

const CASUAL = new Set(
  "awesome cool stuff gonna wanna kinda sorta super pretty totally basically really okay ok hey guys yeah yep nope lots tons folks huge amazing crazy literally honestly anyway btw lol wow yay cheers hi hello fun freaking guy grab check thing things bunch".split(" "),
);
const FORMAL = new Set(
  "therefore furthermore moreover consequently thus hence regarding utilize utilise facilitate commence subsequently nevertheless nonetheless whereas herein accordingly pursuant notwithstanding henceforth wherein thereby aforementioned endeavor endeavour obtain require sufficient additional approximately demonstrate indicate implement assistance prior purchase inquire ascertain comprise constitute respectively".split(
    " ",
  ),
);
const CONTRACTION = /\b\w+(?:n't|'re|'ll|'ve|'m|'d)\b|\b(?:it|that|there|what|he|she|let|who|here)'s\b/i;
const PERSONAL = /^(i|me|my|mine|you|your|yours|we|us|our|ours)$/i;

export type ToneResult = { score: number; label: "Casual" | "Slightly casual" | "Neutral" | "Slightly formal" | "Formal"; casual: { text: string; start: number; end: number; score: number }[]; formal: { text: string; start: number; end: number; score: number }[] };

/** Per-sentence formality in -1 (casual) .. +1 (formal). */
export function sentenceFormality(s: string) {
  const w = wordList(s);
  if (!w.length) return 0;
  let casual = 0,
    formal = 0,
    personal = 0;
  if (CONTRACTION.test(s.replace(/’/g, "'"))) casual += 1.2;
  if (/!/.test(s)) casual += 1;
  if (/\?\s*$/.test(s)) casual += 0.4;
  for (const x of w) {
    const l = x.toLowerCase();
    if (CASUAL.has(l)) casual += 1;
    if (FORMAL.has(l)) formal += 1.2;
    if (PERSONAL.test(l)) personal += 0.2;
  }
  casual += Math.min(1, personal);
  const avgLen = w.reduce((a, x) => a + x.length, 0) / w.length;
  const weight = Math.min(1, w.length / 12);
  formal += Math.max(0, avgLen - 4.7) * 1.1 * weight;
  casual += Math.max(0, 4.4 - avgLen) * 1.1 * weight;
  if (isPassive(s)) formal += 0.6;
  if (w.length > 24) formal += 0.5;
  const total = casual + formal;
  return total ? Math.max(-1, Math.min(1, (formal - casual) / Math.max(total, 3))) : 0;
}
export function toneLabel(score: number): ToneResult["label"] {
  return score <= -0.35 ? "Casual" : score <= -0.12 ? "Slightly casual" : score < 0.12 ? "Neutral" : score < 0.35 ? "Slightly formal" : "Formal";
}

// ---------------------------------------------------------------------------------------------
// Full-document analysis (used by the Writing Assistant)
// ---------------------------------------------------------------------------------------------

export type SentenceInfo = { start: number; end: number; text: string; words: number; passive: boolean; formality: number };
export type DocTargets = {
  keywords: string[];
  recommended: string[];
  targetWords: number;
  targetReadability: number;
  tone: "casual" | "neutral" | "formal";
  title?: string;
};
export type Check = { id: string; label: string; status: "good" | "warning" | "critical" | "info"; detail?: string };
export type DocAnalysis = {
  words: number;
  characters: number;
  sentences: number;
  paragraphs: number;
  headings: { level: number; text: string }[];
  readingTimeMin: number;
  flesch: number | null;
  grade: number | null;
  avgSentenceLength: number;
  longSentences: SentenceInfo[];
  longParagraphs: { start: number; end: number; words: number; preview: string }[];
  passive: SentenceInfo[];
  complexWords: { word: string; count: number }[];
  complexShare: number;
  keywords: { keyword: string; count: number; density: number; inTitle: boolean; inH1: boolean; inFirstParagraph: boolean; inSubheading: boolean }[];
  recommended: { keyword: string; used: boolean; count: number }[];
  links: number;
  images: number;
  imagesMissingAlt: number;
  h1Count: number;
  tone: ToneResult;
  duplicates: { text: string; count: number; ranges: { start: number; end: number }[] }[];
  repeatedPhrases: { phrase: string; count: number }[];
  originality: number;
  scores: { seo: number; readability: number; tone: number; originality: number; overall: number };
  checks: { seo: Check[]; readability: Check[]; tone: Check[]; originality: Check[] };
};

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const round1 = (v: number) => Math.round(v * 10) / 10;

export function analyzeDocument(body: string, t: DocTargets): DocAnalysis {
  const blocks = markdownBlocks(body);
  const sentences: SentenceInfo[] = [];
  const headings: { level: number; text: string }[] = [];
  let words = 0,
    syl = 0,
    readWords = 0,
    complex = 0;
  const complexCounts = new Map<string, number>();
  const paragraphs: { start: number; end: number; words: number; preview: string }[] = [];
  let firstParagraph = "";
  const plainParts: string[] = [];

  for (const b of blocks) {
    const plain = inlinePlain(b.raw);
    const w = wordList(plain);
    words += w.length;
    plainParts.push(plain);
    if (b.kind === "heading") {
      headings.push({ level: b.level ?? 2, text: plain });
      continue;
    }
    if (b.kind === "paragraph") {
      paragraphs.push({ start: b.start, end: b.end, words: w.length, preview: plain.slice(0, 90) });
      if (!firstParagraph) firstParagraph = plain;
    }
    for (const s of splitSentences(b.raw)) {
      const sp = inlinePlain(s.text);
      const sw = wordList(sp);
      if (!sw.length) continue;
      readWords += sw.length;
      for (const x of sw) {
        syl += syllables(x);
        if (isComplexWord(x)) {
          complex++;
          const k = x.toLowerCase();
          complexCounts.set(k, (complexCounts.get(k) ?? 0) + 1);
        }
      }
      sentences.push({ start: b.start + s.start, end: b.start + s.end, text: sp, words: sw.length, passive: isPassive(sp), formality: sentenceFormality(sp) });
    }
  }
  const plainAll = plainParts.join("\n");
  const flesch = fleschReadingEase(readWords, sentences.length, syl);
  const grade = fleschKincaidGrade(readWords, sentences.length, syl);
  const avgSentenceLength = sentences.length ? round1(readWords / sentences.length) : 0;
  const longSentences = sentences.filter((s) => s.words > 25);
  const passive = sentences.filter((s) => s.passive);
  const longParagraphs = paragraphs.filter((p) => p.words > 150);

  // Structure
  const h1Count = headings.filter((h) => h.level === 1).length;
  const h1Text = headings.filter((h) => h.level === 1).map((h) => h.text).join(" ");
  const subText = headings.filter((h) => h.level > 1).map((h) => h.text).join(" \n ");
  const links = (body.match(/(?<!!)\[[^\]]+\]\([^)]+\)/g) ?? []).length + (body.match(/<a\s[^>]*href=/gi) ?? []).length + (body.match(/(?<![(\[<"'])\bhttps?:\/\/[^\s)]+/g) ?? []).length;
  const mdImages = [...body.matchAll(/!\[([^\]]*)\]\([^)]*\)/g)];
  const htmlImages = [...body.matchAll(/<img\b[^>]*>/gi)];
  const images = mdImages.length + htmlImages.length;
  const imagesMissingAlt = mdImages.filter((m) => !m[1].trim()).length + htmlImages.filter((m) => !/\balt\s*=\s*["'][^"']+["']/i.test(m[0])).length;

  const kw = t.keywords.filter(Boolean).map((k) => {
    const count = countKeyword(plainAll, k);
    return {
      keyword: k,
      count,
      density: words ? round1((count / words) * 100) : 0,
      inTitle: hasKeyword(t.title ?? "", k),
      inH1: hasKeyword(h1Text, k),
      inFirstParagraph: hasKeyword(firstParagraph, k),
      inSubheading: hasKeyword(subText, k),
    };
  });
  const recommended = t.recommended.filter(Boolean).map((k) => {
    const count = countKeyword(plainAll, k);
    return { keyword: k, used: count > 0, count };
  });

  // Tone
  const scored = sentences.filter((s) => s.words >= 6);
  const toneScore = scored.length ? scored.reduce((a, s) => a + s.formality * s.words, 0) / scored.reduce((a, s) => a + s.words, 0) : 0;
  const tone: ToneResult = {
    score: round1(toneScore * 100) / 100,
    label: toneLabel(toneScore),
    casual: scored.filter((s) => s.formality < -0.3).sort((a, b) => a.formality - b.formality).slice(0, 8).map((s) => ({ text: s.text, start: s.start, end: s.end, score: s.formality })),
    formal: scored.filter((s) => s.formality > 0.3).sort((a, b) => b.formality - a.formality).slice(0, 8).map((s) => ({ text: s.text, start: s.start, end: s.end, score: s.formality })),
  };

  // Originality (within this text only)
  const byNorm = new Map<string, SentenceInfo[]>();
  for (const s of sentences) {
    if (s.words < 4) continue;
    const k = normalizeText(s.text);
    byNorm.set(k, [...(byNorm.get(k) ?? []), s]);
  }
  const duplicates = [...byNorm.values()].filter((g) => g.length > 1).map((g) => ({ text: g[0].text, count: g.length, ranges: g.map((s) => ({ start: s.start, end: s.end })) }));
  const dupWords = duplicates.reduce((a, d) => a + (d.count - 1) * wordList(d.text).length, 0);
  const tokens = wordList(plainAll.toLowerCase());
  const grams = new Map<string, number>();
  const N = 6;
  for (let i = 0; i + N <= tokens.length; i++) {
    const g = tokens.slice(i, i + N);
    if (g.filter((x) => !STOPWORDS.has(x)).length < 3) continue;
    const key = g.join(" ");
    grams.set(key, (grams.get(key) ?? 0) + 1);
  }
  const dupSentenceTexts = new Set(duplicates.map((d) => normalizeText(d.text)));
  const repeatedPhrases = [...grams.entries()]
    .filter(([p, c]) => c > 1 && ![...dupSentenceTexts].some((d) => d.includes(p)))
    .sort((a, b) => b[1] - a[1])
    .reduce<{ phrase: string; count: number }[]>((acc, [phrase, count]) => {
      if (!acc.some((x) => x.phrase.includes(phrase.split(" ").slice(1).join(" ")))) acc.push({ phrase, count });
      return acc;
    }, [])
    .slice(0, 10);
  const phraseWords = repeatedPhrases.reduce((a, p) => a + (p.count - 1) * N, 0);
  const originality = words ? clamp(Math.round((1 - (dupWords + phraseWords * 0.5) / words) * 100), 0, 100) : 100;

  // ---------------------------------------------------------------- Scores
  const checks: DocAnalysis["checks"] = { seo: [], readability: [], tone: [], originality: [] };
  const primary = kw[0];
  let seoPts = 0,
    seoMax = 0;
  const add = (list: Check[], c: Check, weight: number, earned: number) => {
    list.push(c);
    seoMax += weight;
    seoPts += weight * earned;
  };
  if (words === 0) {
    const empty = { seo: 0, readability: 0, tone: 0, originality: 0, overall: 0 };
    return {
      words, characters: body.length, sentences: 0, paragraphs: 0, headings, readingTimeMin: 0, flesch: null, grade: null, avgSentenceLength: 0,
      longSentences: [], longParagraphs: [], passive: [], complexWords: [], complexShare: 0, keywords: kw, recommended, links, images, imagesMissingAlt, h1Count,
      tone, duplicates: [], repeatedPhrases: [], originality: 100, scores: empty,
      checks: {
        seo: [{ id: "empty", label: "Start writing to see SEO recommendations", status: "info" }],
        readability: [{ id: "empty", label: "Readability is measured once you have a few sentences", status: "info" }],
        tone: [{ id: "empty", label: "Tone of voice is measured once you have a few sentences", status: "info" }],
        originality: [{ id: "empty", label: "Nothing to compare yet", status: "info" }],
      },
    };
  }

  // Word count vs target
  const target = t.targetWords || 0;
  if (target) {
    const r = words / target;
    add(checks.seo, { id: "length", label: r >= 0.9 ? `Text length is on target (${words} / ${target} words)` : `Text is shorter than recommended: ${words} of ${target} words`, status: r >= 0.9 ? "good" : r >= 0.6 ? "warning" : "critical", detail: r < 0.9 ? `Add about ${Math.max(0, target - words)} more words to match the top-10 average.` : undefined }, 2, clamp(r / 0.9, 0, 1));
  }
  // Target keywords
  if (!kw.length) checks.seo.push({ id: "no-kw", label: "Add target keywords to get keyword recommendations", status: "info" });
  for (const k of kw) {
    const good = k.count > 0 && k.density <= 3;
    add(
      checks.seo,
      {
        id: `kw:${k.keyword}`,
        label: k.count === 0 ? `Target keyword “${k.keyword}” is not used` : k.density > 3 ? `“${k.keyword}” may be overused (${k.density}% density)` : `“${k.keyword}” used ${k.count}× (${k.density}%)`,
        status: k.count === 0 ? "critical" : k.density > 3 ? "warning" : "good",
        detail: k.count === 0 ? "Use it naturally in the first paragraph, a subheading and the body." : k.density > 3 ? "Keep density under ~3% to avoid keyword stuffing; use synonyms instead." : undefined,
      },
      k === primary ? 2 : 1,
      good ? 1 : k.count > 0 ? 0.5 : 0,
    );
  }
  if (primary) {
    add(checks.seo, { id: "kw-title", label: primary.inTitle ? "Title contains the main keyword" : "Add the main keyword to the title", status: primary.inTitle ? "good" : "warning" }, 1, primary.inTitle ? 1 : 0);
    add(checks.seo, { id: "kw-h1", label: primary.inH1 ? "H1 contains the main keyword" : h1Count ? "Use the main keyword in the H1" : "Add an H1 heading (# Heading) with the main keyword", status: primary.inH1 ? "good" : "warning" }, 1, primary.inH1 ? 1 : 0);
    add(checks.seo, { id: "kw-first", label: primary.inFirstParagraph ? "Main keyword appears in the first paragraph" : "Mention the main keyword in the first paragraph", status: primary.inFirstParagraph ? "good" : "warning" }, 1, primary.inFirstParagraph ? 1 : 0);
    if (headings.some((h) => h.level > 1)) add(checks.seo, { id: "kw-sub", label: primary.inSubheading ? "Keyword used in a subheading" : "Use the keyword or a variation in at least one subheading", status: primary.inSubheading ? "good" : "info" }, 0.5, primary.inSubheading ? 1 : 0.3);
  } else {
    add(checks.seo, { id: "h1", label: h1Count ? "Document has an H1 heading" : "Add an H1 heading (# Heading)", status: h1Count ? "good" : "warning" }, 1, h1Count ? 1 : 0);
  }
  if (h1Count > 1) checks.seo.push({ id: "multi-h1", label: `${h1Count} H1 headings — use only one`, status: "warning" });
  // Recommended keywords
  if (recommended.length) {
    const used = recommended.filter((r) => r.used).length;
    const share = used / recommended.length;
    add(checks.seo, { id: "recommended", label: `${used} of ${recommended.length} recommended keywords used`, status: share >= 0.6 ? "good" : share >= 0.3 ? "warning" : "critical", detail: share < 0.6 ? "Cover more of the related terms your rivals use." : undefined }, 2, clamp(share / 0.6, 0, 1));
  }
  // Links & images
  const wantLinks = words >= 600 ? 2 : 1;
  add(checks.seo, { id: "links", label: links >= wantLinks ? `${links} link${links === 1 ? "" : "s"} in the text` : `Add ${wantLinks - links} more link${wantLinks - links === 1 ? "" : "s"} to relevant pages`, status: links >= wantLinks ? "good" : "warning", detail: links < wantLinks ? "Internal and authoritative external links help readers and search engines." : undefined }, 1, clamp(links / wantLinks, 0, 1));
  if (images) add(checks.seo, { id: "alt", label: imagesMissingAlt ? `${imagesMissingAlt} of ${images} image${images === 1 ? "" : "s"} missing alt text` : `All ${images} image${images === 1 ? " has" : "s have"} alt text`, status: imagesMissingAlt ? "warning" : "good" }, 1, imagesMissingAlt ? 1 - imagesMissingAlt / images : 1);
  else if (words > 500) checks.seo.push({ id: "no-images", label: "Consider adding an image with descriptive alt text", status: "info" });
  const seo = seoMax ? round1((seoPts / seoMax) * 10) : 0;

  // Readability
  const targetRead = t.targetReadability || 60;
  const readParts: number[] = [];
  if (flesch != null) {
    const diff = flesch - targetRead;
    const fl = fleschLabel(flesch);
    const ok = diff >= -5;
    readParts.push(ok ? 1 : clamp(1 + diff / 30, 0, 1));
    checks.readability.push({ id: "flesch", label: `Flesch reading ease ${Math.round(flesch)} — ${fl.label.toLowerCase()} (target ${targetRead})`, status: ok ? "good" : diff > -15 ? "warning" : "critical", detail: ok ? undefined : "Use shorter sentences and simpler words to reach the target." });
  }
  const longShare = sentences.length ? longSentences.length / sentences.length : 0;
  readParts.push(clamp(1 - Math.max(0, longShare - 0.04) * 3, 0, 1));
  checks.readability.push({ id: "long", label: longSentences.length ? `${longSentences.length} long sentence${longSentences.length === 1 ? "" : "s"} (over 25 words)` : "No overly long sentences", status: longShare > 0.25 ? "critical" : longSentences.length ? "warning" : "good" });
  const passiveShare = sentences.length ? passive.length / sentences.length : 0;
  readParts.push(clamp(1 - Math.max(0, passiveShare - 0.1) * 2.5, 0, 1));
  checks.readability.push({ id: "passive", label: passive.length ? `${passive.length} sentence${passive.length === 1 ? "" : "s"} in passive voice (${Math.round(passiveShare * 100)}%)` : "No passive voice detected", status: passiveShare > 0.15 ? "warning" : "good", detail: passiveShare > 0.15 ? "Aim for under 10–15% passive sentences." : undefined });
  const complexShare = readWords ? complex / readWords : 0;
  readParts.push(clamp(1 - Math.max(0, complexShare - 0.12) * 4, 0, 1));
  checks.readability.push({ id: "complex", label: `${Math.round(complexShare * 100)}% complex words (3+ syllables)`, status: complexShare > 0.2 ? "warning" : "good" });
  readParts.push(longParagraphs.length ? 0.6 : 1);
  checks.readability.push({ id: "paragraphs", label: longParagraphs.length ? `${longParagraphs.length} paragraph${longParagraphs.length === 1 ? "" : "s"} over 150 words` : "Paragraph length is fine", status: longParagraphs.length ? "warning" : "good", detail: longParagraphs.length ? "Split long paragraphs so the text is easy to scan." : undefined });
  const readability = round1((readParts.reduce((a, b) => a + b, 0) / readParts.length) * 10);

  // Tone vs target
  const targetTone = t.tone === "casual" ? -0.4 : t.tone === "formal" ? 0.4 : 0;
  const toneDist = Math.abs(toneScore - targetTone);
  const inconsistent = t.tone === "formal" ? tone.casual.length : t.tone === "casual" ? tone.formal.length : tone.casual.length + tone.formal.length;
  const toneScoreOut = round1(clamp(10 - toneDist * 8 - Math.min(2, inconsistent * 0.25), 0, 10));
  checks.tone.push({ id: "tone", label: `Your text reads as ${tone.label.toLowerCase()} (target: ${t.tone})`, status: toneDist < 0.25 ? "good" : toneDist < 0.5 ? "warning" : "critical" });
  if (t.tone !== "casual" && tone.casual.length) checks.tone.push({ id: "casual", label: `${tone.casual.length} sentence${tone.casual.length === 1 ? " sounds" : "s sound"} too casual`, status: "warning", detail: "Contractions, exclamation marks, slang and direct address make text more casual." });
  if (t.tone !== "formal" && tone.formal.length) checks.tone.push({ id: "formal", label: `${tone.formal.length} sentence${tone.formal.length === 1 ? " sounds" : "s sound"} too formal`, status: t.tone === "casual" ? "warning" : "info", detail: "Long words, passive voice and bureaucratic terms make text feel formal." });

  // Originality
  checks.originality.push({ id: "orig", label: `${originality}% of the text is unique within this document`, status: originality >= 95 ? "good" : originality >= 85 ? "warning" : "critical" });
  checks.originality.push({ id: "dups", label: duplicates.length ? `${duplicates.length} sentence${duplicates.length === 1 ? " is" : "s are"} repeated` : "No repeated sentences", status: duplicates.length ? "warning" : "good" });
  checks.originality.push({ id: "phrases", label: repeatedPhrases.length ? `${repeatedPhrases.length} repeated phrase${repeatedPhrases.length === 1 ? "" : "s"} (6+ words)` : "No repeated phrases", status: repeatedPhrases.length > 3 ? "warning" : "good" });
  const originalityScore = round1(originality / 10);

  const overall = round1(seo * 0.35 + readability * 0.3 + toneScoreOut * 0.15 + originalityScore * 0.2);
  return {
    words,
    characters: body.length,
    sentences: sentences.length,
    paragraphs: paragraphs.length,
    headings,
    readingTimeMin: Math.max(1, Math.round(words / 230)),
    flesch,
    grade,
    avgSentenceLength,
    longSentences,
    longParagraphs,
    passive,
    complexWords: [...complexCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([word, count]) => ({ word, count })),
    complexShare: Math.round(complexShare * 1000) / 10,
    keywords: kw,
    recommended,
    links,
    images,
    imagesMissingAlt,
    h1Count,
    tone,
    duplicates,
    repeatedPhrases,
    originality,
    scores: { seo, readability, tone: toneScoreOut, originality: originalityScore, overall },
    checks,
  };
}

/** Plain-text readability stats (used for crawled pages). */
export function readabilityOf(text: string) {
  const blocks = text.split(/\n+/).map((b) => b.trim()).filter(Boolean);
  let words = 0,
    syl = 0,
    sentences = 0,
    passive = 0,
    long = 0;
  for (const b of blocks) {
    for (const s of splitSentences(b)) {
      const w = wordList(s.text);
      if (w.length < 3) continue;
      sentences++;
      words += w.length;
      for (const x of w) syl += syllables(x);
      if (w.length > 25) long++;
      if (isPassive(s.text)) passive++;
    }
  }
  return {
    flesch: fleschReadingEase(words, sentences, syl),
    grade: fleschKincaidGrade(words, sentences, syl),
    sentences,
    avgSentenceLength: sentences ? round1(words / sentences) : 0,
    longSentences: long,
    passiveShare: sentences ? Math.round((passive / sentences) * 100) : 0,
  };
}
