/** Client-safe keyword text helpers: tokens, word forms, match types, grouping, input parsing. */
import type { MatchType } from "./types";

export const STOPWORDS = new Set([
  "a", "an", "the", "to", "of", "in", "on", "for", "and", "or", "is", "are", "with", "at", "by", "from", "as", "it", "its", "be",
  "vs", "my", "your", "me", "i", "you", "do", "does", "can", "should", "will", "what", "how", "why", "when", "where", "which",
  "who", "that", "this", "than", "into", "about", "near",
]);

const QUESTION_RE = /^(what|how|why|when|where|which|who|whom|whose|is|are|can|could|does|do|did|should|would|will|was|were|am)\b/;

export function normalizeKw(s: string) {
  return s.normalize("NFKC").toLowerCase().trim().replace(/\s+/g, " ");
}

export function kwTokens(s: string) {
  return normalizeKw(s)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** Crude English word-form folding: shoes → shoe, cities → city, boxes → box. */
export function stem(t: string) {
  if (t.length <= 3) return t;
  if (t.endsWith("ies") && t.length > 4) return `${t.slice(0, -3)}y`;
  if (/(ches|shes|sses|xes|zes)$/.test(t)) return t.slice(0, -2);
  if (t.endsWith("s") && !t.endsWith("ss") && !t.endsWith("us") && !t.endsWith("is")) return t.slice(0, -1);
  return t;
}

export const isQuestion = (k: string) => QUESTION_RE.test(normalizeKw(k)) || k.includes("?");

/** Does `keyword` match `seed` under a Semrush-style match type? ("related" is decided by SERP overlap.) */
export function matchesSeed(keyword: string, seed: string, match: MatchType) {
  const k = normalizeKw(keyword);
  const s = normalizeKw(seed);
  if (!s) return false;
  if (match === "exact") return ` ${k} `.includes(` ${s} `);
  const ks = kwTokens(k).map(stem);
  const ss = kwTokens(s).map(stem);
  if (!ss.length) return false;
  if (match === "phrase") {
    outer: for (let i = 0; i + ss.length <= ks.length; i++) {
      for (let j = 0; j < ss.length; j++) if (ks[i + j] !== ss[j]) continue outer;
      return true;
    }
    return false;
  }
  // broad (and the containment part of related): every meaningful seed word, any order
  const need = ss.filter((t) => !STOPWORDS.has(t));
  const have = new Set(ks);
  return (need.length ? need : ss).every((t) => have.has(t));
}

export type WordGroup = { id: string; label: string; count: number; volume: number };

/**
 * Keyword Magic Tool style groups: frequent words that are not part of the seed (and not stopwords).
 * `id` is the folded word form; `label` its most common spelling.
 */
export function wordGroups<T extends { keyword: string; volume: number | null }>(rows: T[], seed: string, limit = 60): WordGroup[] {
  const seedStems = new Set(kwTokens(seed).map(stem));
  const map = new Map<string, { count: number; volume: number; forms: Map<string, number> }>();
  for (const r of rows) {
    const seen = new Set<string>();
    for (const t of kwTokens(r.keyword)) {
      const st = stem(t);
      if (seen.has(st) || seedStems.has(st) || STOPWORDS.has(t) || t.length < 2 || (/^\d+$/.test(t) && t.length < 4)) continue;
      seen.add(st);
      const g = map.get(st) ?? { count: 0, volume: 0, forms: new Map() };
      g.count++;
      g.volume += r.volume ?? 0;
      g.forms.set(t, (g.forms.get(t) ?? 0) + 1);
      map.set(st, g);
    }
  }
  return [...map.entries()]
    .filter(([, g]) => g.count >= 2)
    .map(([id, g]) => ({ id, label: [...g.forms.entries()].sort((a, b) => b[1] - a[1])[0][0], count: g.count, volume: g.volume }))
    .sort((a, b) => b.count - a.count || b.volume - a.volume)
    .slice(0, limit);
}

export function rowHasWord(keyword: string, groupId: string) {
  return kwTokens(keyword).some((t) => stem(t) === groupId);
}

/** Parses a free-text keyword box (newlines, commas, tabs or semicolons). */
export function parseKeywordInput(text: string, max = 100) {
  const all = [...new Set(text.split(/[\n,;\t]+/).map(normalizeKw).filter((k) => k && k.length <= 255))];
  return { keywords: all.slice(0, max), overflow: Math.max(0, all.length - max) };
}

export function titleCase(s: string) {
  return s.replace(/(^|\s)(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase());
}
