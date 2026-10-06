/**
 * Listening sources and topic keyword rules. Pure and client-safe.
 *
 * Topic keyword syntax (one rule per line; rules are OR'ed):
 *   acme                        single term or phrase
 *   acme AND (refund OR delay)  every AND part must match; a part matches when any OR alternative does
 * Excluded words drop a mention when any of them appears.
 */
export const LISTEN_SOURCES = ["news", "hackernews", "mastodon", "appstore", "reddit", "youtube", "bluesky", "google-reviews"] as const;
export type ListenSource = (typeof LISTEN_SOURCES)[number];

export const SOURCE_LABELS: Record<ListenSource, string> = {
  news: "Google News",
  hackernews: "Hacker News",
  mastodon: "Mastodon",
  appstore: "App Store",
  reddit: "Reddit",
  youtube: "YouTube",
  bluesky: "Bluesky",
  "google-reviews": "Google reviews",
};
export const sourceLabel = (s: string) => (SOURCE_LABELS as Record<string, string>)[s] ?? s;
export const isListenSource = (s: string): s is ListenSource => (LISTEN_SOURCES as readonly string[]).includes(s);

export const TOPIC_KINDS = ["brand", "competitor", "campaign", "industry"] as const;
export type TopicKind = (typeof TOPIC_KINDS)[number];

export const SENTIMENTS = ["positive", "neutral", "negative"] as const;
export const STATUSES = ["new", "read", "actioned", "ignored"] as const;

export const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  hi: "Hindi",
  gu: "Gujarati",
  ta: "Tamil",
  ar: "Arabic",
  zh: "Chinese",
  ru: "Russian",
  de: "German",
  fr: "French",
  es: "Spanish",
  pt: "Portuguese",
  it: "Italian",
  ja: "Japanese",
  nl: "Dutch",
  sv: "Swedish",
};
export const languageName = (code: string | null | undefined) => (code ? (LANGUAGE_NAMES[code] ?? code.toUpperCase()) : "Unknown");

/** A keyword rule as AND-parts, each a list of OR alternatives (lower-cased, unquoted). */
export type Rule = string[][];

const clean = (s: string) => s.replace(/[()"“”]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();

export function parseRule(line: string): Rule {
  return line
    .split(/\s+AND\s+/)
    .map((part) => part.split(/\s+OR\s+/).map(clean).filter(Boolean))
    .filter((p) => p.length > 0);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const reCache = new Map<string, RegExp>();
/** Whole-word, case-insensitive containment (works for phrases, hashtags and non-Latin scripts). */
export function hasTerm(text: string, term: string) {
  let re = reCache.get(term);
  if (!re) {
    re = new RegExp(`(^|[^\\p{L}\\p{N}_])${escape(term)}($|[^\\p{L}\\p{N}_])`, "iu");
    if (reCache.size > 2000) reCache.clear();
    reCache.set(term, re);
  }
  return re.test(text);
}

export function ruleMatches(text: string, rule: Rule) {
  return rule.length > 0 && rule.every((alts) => alts.some((a) => hasTerm(text, a)));
}

export function isExcluded(text: string, excluded: string[]) {
  return excluded.some((w) => {
    const t = clean(w);
    return !!t && hasTerm(text, t);
  });
}

/** Does text match any of the topic's keyword rules and none of its excluded words? */
export function matchesTopic(text: string, keywords: string[], excluded: string[]) {
  if (isExcluded(text, excluded)) return false;
  return keywords.some((k) => ruleMatches(text, parseRule(k)));
}

const quote = (t: string) => (/\s/.test(t) ? `"${t}"` : t);

/** Boolean query for engines that support OR, quotes and -exclusions (Google News, Reddit, YouTube). */
export function booleanQuery(keyword: string, excluded: string[] = [], opts: { exclusions?: boolean } = { exclusions: true }) {
  const rule = parseRule(keyword);
  const q = rule.map((alts) => (alts.length > 1 ? `(${alts.map(quote).join(" OR ")})` : quote(alts[0]))).join(" ");
  const ex = opts.exclusions ? excluded.map(clean).filter(Boolean).map((w) => ` -${quote(w)}`).join("") : "";
  return (q + ex).trim();
}

/** Plain AND queries (every OR alternative expanded), for engines without OR support (HN, Bluesky). */
export function simpleQueries(keyword: string, max = 4): string[] {
  let combos: string[][] = [[]];
  for (const alts of parseRule(keyword)) {
    combos = combos.flatMap((c) => alts.map((a) => [...c, a]));
    if (combos.length > max) combos = combos.slice(0, max);
  }
  return combos.filter((c) => c.length).map((c) => c.map(quote).join(" "));
}

/** Hashtags to follow for a keyword (each OR alternative of the first part, letters and digits only). */
export function hashtagsFor(keyword: string): string[] {
  const first = parseRule(keyword)[0] ?? [];
  return [...new Set(first.map((a) => a.replace(/^#/, "").replace(/[^\p{L}\p{N}_]/gu, "")).filter((t) => t.length >= 2))];
}

/** Sources whose results must contain the keyword text (others match on full text server-side). */
export const STRICT_MATCH: Record<ListenSource, boolean> = {
  news: false,
  youtube: false,
  appstore: false,
  hackernews: true,
  mastodon: true,
  reddit: true,
  bluesky: true,
  // Reviews of the brand's own business rarely name it; only excluded words apply.
  "google-reviews": false,
};

/** App Store ids: "123456789" or "gb/123456789" (country storefront). */
export function parseAppId(v: string): { country: string; id: string } | null {
  const m = v.trim().match(/^(?:([a-z]{2})[/:])?(?:id)?(\d{5,12})$/i);
  return m ? { country: (m[1] ?? "us").toLowerCase(), id: m[2] } : null;
}

/** Intent labels (mirror of @/lib/cx/ai INTENT_LABELS, kept here so client bundles avoid the AI SDK). */
export const INTENTS: Record<string, string> = {
  complaint: "Complaint",
  query: "Query",
  feedback: "Feedback",
  praise: "Praise",
  purchase: "Purchase intent",
  cancellation: "Churn risk",
  spam: "Spam",
  other: "Other",
};
