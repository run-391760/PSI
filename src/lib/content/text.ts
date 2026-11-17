/**
 * Text analysis primitives (client-safe, no server imports): tokenizing, syllables, Flesch reading
 * ease, passive voice and complex-word heuristics, keyword matching, tone and in-text duplication.
 * Shared by the optimizer and On Page SEO Checker.
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

// Markdown / HTML-in-markdown structure

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

const round1 = (v: number) => Math.round(v * 10) / 10;

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
