/**
 * Gap categories (Keyword Gap and Backlink Gap). Pure functions, safe for server and client.
 * Index 0 is always "you"; the other indexes are competitors.
 */

export type KeywordGapCategory = "shared" | "missing" | "weak" | "strong" | "untapped" | "unique" | "all";

export const KEYWORD_GAP_CATEGORIES: { id: KeywordGapCategory; label: string; note: string }[] = [
  { id: "shared", label: "Shared", note: "Keywords all the domains rank for." },
  { id: "missing", label: "Missing", note: "Keywords all the competitors rank for, but you don't." },
  { id: "weak", label: "Weak", note: "Keywords you rank for, but lower than every competitor that ranks." },
  { id: "strong", label: "Strong", note: "Keywords where you outrank every competitor that ranks." },
  { id: "untapped", label: "Untapped", note: "Keywords at least one competitor ranks for, but you don't." },
  { id: "unique", label: "Unique", note: "Keywords only you rank for." },
  { id: "all", label: "All keywords", note: "Every keyword any of the domains ranks for." },
];

/** Categories a keyword belongs to, given each domain's position (null = not ranking). */
export function keywordGapCategories(positions: (number | null)[]): KeywordGapCategory[] {
  const [you, ...comps] = positions;
  const ranking = comps.filter((p): p is number => p != null);
  const out: KeywordGapCategory[] = ["all"];
  if (you != null && ranking.length === comps.length) out.push("shared");
  if (you == null && comps.length > 0 && ranking.length === comps.length) out.push("missing");
  if (you != null && ranking.length > 0 && ranking.every((p) => you > p)) out.push("weak");
  if (you != null && ranking.length > 0 && ranking.every((p) => you < p)) out.push("strong");
  if (you == null && ranking.length > 0) out.push("untapped");
  if (you != null && ranking.length === 0) out.push("unique");
  return out;
}

export type BacklinkGapCategory = "best" | "weak" | "strong" | "shared" | "unique" | "all";

export const BACKLINK_GAP_CATEGORIES: { id: BacklinkGapCategory; label: string; note: string }[] = [
  { id: "best", label: "Best", note: "Domains that link to all your competitors, but not to you." },
  { id: "weak", label: "Weak", note: "Domains that link to you less than they link to your competitors." },
  { id: "strong", label: "Strong", note: "Domains that link to you, but not to your competitors." },
  { id: "shared", label: "Shared", note: "Domains that link to all the domains you entered." },
  { id: "unique", label: "Unique", note: "Domains that link to only one of the domains you entered." },
  { id: "all", label: "All", note: "Every domain that links to any of the domains you entered." },
];

/** Categories of a referring domain, given the backlinks it sends to each target (0 = none). */
export function backlinkGapCategories(counts: number[]): BacklinkGapCategory[] {
  const [you, ...comps] = counts;
  const linked = comps.filter((c) => c > 0);
  const out: BacklinkGapCategory[] = ["all"];
  if (you === 0 && comps.length > 0 && linked.length === comps.length) out.push("best");
  if (you > 0 && linked.length > 0 && comps.some((c) => c > you)) out.push("weak");
  if (you > 0 && linked.length === 0) out.push("strong");
  if (counts.every((c) => c > 0)) out.push("shared");
  if (counts.filter((c) => c > 0).length === 1) out.push("unique");
  return out;
}
