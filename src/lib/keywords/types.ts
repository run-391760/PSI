/** Client-safe types and compact encodings shared by the keyword tools (no server imports). */
import { INTENTS, SERP_FEATURES, type Intent, type SerpFeature } from "@/lib/seo/types";

export type MatchType = "broad" | "phrase" | "exact" | "related";
export const MATCH_TYPES: { id: MatchType; label: string; note: string }[] = [
  { id: "broad", label: "Broad match", note: "All words of the seed in any order, including singular/plural forms." },
  { id: "phrase", label: "Phrase match", note: "The seed phrase in the same word order, any word form, with words before or after." },
  { id: "exact", label: "Exact match", note: "The exact seed phrase in the exact form and order, with words before or after." },
  { id: "related", label: "Related", note: "Semantically related keywords: their Google top 10 shares results with the seed." },
];

/** Full keyword metrics row (server → client). Unknown values are null ("n/a"), never 0. */
export type KwRow = {
  keyword: string;
  volume: number | null;
  kd: number | null;
  cpc: number | null;
  competition: number | null;
  intents: Intent[];
  features: SerpFeature[];
  /** 12 monthly volumes, oldest first. Empty when unknown. */
  trend: number[];
  results: number | null;
};

/**
 * Compact idea row for the Keyword Magic Tool (up to ~3000 rows are sent to the browser):
 * intents as letters ("IC"), SERP features as a bitmask, trend scaled 0..100.
 */
export type IdeaRow = {
  keyword: string;
  volume: number | null;
  kd: number | null;
  cpc: number | null;
  competition: number | null;
  i: string;
  f: number;
  t: number[];
  results: number | null;
  words: number;
  /** Found in real Google Autocomplete suggestions. */
  ac: boolean;
  /** Related view: share of the seed's top-10 domains this keyword shares (0..100). */
  rel?: number;
};

const INTENT_LETTERS: Record<Intent, string> = { informational: "I", navigational: "N", commercial: "C", transactional: "T" };
export const encodeIntents = (intents: Intent[]) => intents.map((i) => INTENT_LETTERS[i]).join("");
export const decodeIntents = (s: string): Intent[] => [...s].map((c) => INTENTS.find((i) => INTENT_LETTERS[i] === c)).filter((x): x is Intent => !!x);

const FEATURE_IDS = SERP_FEATURES.map((f) => f.id);
export const encodeFeatures = (features: SerpFeature[]) => features.reduce((m, f) => m | (1 << FEATURE_IDS.indexOf(f)), 0);
export const decodeFeatures = (mask: number): SerpFeature[] => FEATURE_IDS.filter((_, i) => mask & (1 << i));
export const featureBit = (f: SerpFeature) => 1 << FEATURE_IDS.indexOf(f);

export function scaleTrend(trend: number[]) {
  const max = Math.max(...trend, 1);
  return trend.map((v) => Math.round((v / max) * 100));
}

export function toIdea(r: KwRow, ac: boolean, rel?: number): IdeaRow {
  return {
    keyword: r.keyword,
    volume: r.volume,
    kd: r.kd,
    cpc: r.cpc,
    competition: r.competition,
    i: encodeIntents(r.intents),
    f: encodeFeatures(r.features),
    t: r.trend.length ? scaleTrend(r.trend) : [],
    results: r.results,
    words: r.keyword.split(" ").length,
    ac,
    rel,
  };
}

/** Keyword list (Keyword Strategy Builder). */
export type KeywordList = {
  id: string;
  name: string;
  db: string;
  keywords: number;
  volume: number;
  avgKd: number | null;
  created_at: string;
  updated_at: string;
};

export type ListItem = KwRow & { source: string; addedFrom: string; addedAt: string; metricsAt: string };

export type AutocompleteInfo = { status: "ok" | "disabled" | "failed"; count: number; fetchedAt?: string; error?: string };

export type ActionResult<T = unknown> = { ok: true; data: T } | { ok: false; error: string };
