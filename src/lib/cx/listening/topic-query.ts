/**
 * Topic query building and matching for the Konnect-style topic editor. Pure and client-safe.
 *
 * A topic is:
 *   CONTAINS          any of these terms (a term may also be a legacy rule such as `acme AND (refund OR delay)`)
 *   AND CONTAINS      and, when the list is not empty, at least one of these terms
 *   DOES NOT CONTAIN  and none of these terms
 * plus exclusions (authors, sites), regional filters (countries, languages), minimum followers,
 * verified-only, media preference (sources) and a fetch frequency.
 */
import { hasTerm, parseRule, ruleMatches } from "./sources";

export type TopicSpec = {
  contains: string[];
  andContains: string[];
  excluded: string[];
  excludeAuthors: string[];
  excludeSites: string[];
  countries: string[];
  languages: string[];
  minFollowers: number;
  verifiedOnly: boolean;
};

export const EMPTY_SPEC: TopicSpec = { contains: [], andContains: [], excluded: [], excludeAuthors: [], excludeSites: [], countries: [], languages: [], minFollowers: 0, verifiedOnly: false };

export const FETCH_FREQUENCIES = [
  { id: "hourly", label: "Every hour", hours: 1 },
  { id: "3h", label: "Every 3 hours", hours: 3 },
  { id: "6h", label: "Every 6 hours", hours: 6 },
  { id: "12h", label: "Every 12 hours", hours: 12 },
  { id: "daily", label: "Once a day", hours: 24 },
] as const;
export type FetchFrequency = (typeof FETCH_FREQUENCIES)[number]["id"];
export const isFetchFrequency = (v: string): v is FetchFrequency => FETCH_FREQUENCIES.some((f) => f.id === v);

/** Is a topic due for fetching? Manual runs always fetch; never-fetched topics are due. A 5-minute grace absorbs scheduler drift. */
export function isDue(frequency: string, lastFetchedAt: string | Date | null | undefined, now: Date, manual = false) {
  if (manual || !lastFetchedAt) return true;
  const f = FETCH_FREQUENCIES.find((x) => x.id === frequency) ?? FETCH_FREQUENCIES[0];
  return now.getTime() - new Date(lastFetchedAt).getTime() >= f.hours * 3600_000 - 5 * 60_000;
}

const unquote = (s: string) => s.replace(/[“”"]/g, "").replace(/\s+/g, " ").trim();
/** Dedupe (case-insensitive), trim and drop empty terms, keeping the first spelling. */
export function cleanTerms(list: readonly string[], max = 300, len = 200): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const t = String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, len);
    const k = unquote(t).toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/** Split pasted text into terms (comma, semicolon or newline separated; a rule with AND/OR stays one term). */
export function splitTerms(text: string): string[] {
  return cleanTerms(text.split(/[,;\n]+/));
}

const q = (t: string) => `"${unquote(t)}"`;
const isRule = (t: string) => /\s(AND|OR)\s/.test(t);

/** One CONTAINS term as boolean text: a plain term is quoted; a legacy rule keeps its AND/OR structure. */
export function termQuery(term: string): string {
  if (!isRule(term)) return q(term);
  const rule = parseRule(term);
  const parts = rule.map((alts) => (alts.length > 1 ? `(${alts.map(q).join(" OR ")})` : q(alts[0])));
  return parts.length > 1 ? `(${parts.join(" AND ")})` : parts[0] ?? "";
}

const orGroup = (terms: string[]) => (terms.length > 1 ? `(${terms.join(" OR ")})` : terms[0]);

/** The human-readable "Search Query" column: `("A" OR "B") AND ("x" OR "y") AND NOT ("z")`. */
export function displayQuery(spec: Pick<TopicSpec, "contains" | "andContains" | "excluded">): string {
  const c = cleanTerms(spec.contains).map(termQuery).filter(Boolean);
  if (!c.length) return "";
  const parts = [spec.andContains.length ? orGroup(c) : c.join(" OR ")];
  const a = cleanTerms(spec.andContains).map(q);
  if (a.length) parts.push(orGroup(a));
  const n = cleanTerms(spec.excluded).map(q);
  let out = parts.length > 1 ? parts.join(" AND ") : parts[0];
  if (n.length) out += ` AND NOT ${orGroup(n)}`;
  return out;
}

const engineTerm = (t: string) => {
  const u = unquote(t);
  return /\s/.test(u) ? `"${u}"` : u;
};
const engineRule = (term: string) => {
  if (!isRule(term)) return engineTerm(term);
  const parts = parseRule(term).map((alts) => (alts.length > 1 ? `(${alts.map(engineTerm).join(" OR ")})` : engineTerm(alts[0])));
  return parts.length > 1 ? `(${parts.join(" ")})` : parts[0];
};

/**
 * Boolean queries for engines that support OR, quotes, -exclusions and site: (Google News, Reddit, YouTube).
 * CONTAINS terms are chunked so every query stays under `maxLen`; each chunk carries the AND CONTAINS group
 * and the exclusions. At most `maxQueries` queries are returned (the rest of the terms are reported as `dropped`).
 */
export function engineQueries(spec: Pick<TopicSpec, "contains" | "andContains" | "excluded" | "excludeSites">, opts: { maxLen?: number; maxQueries?: number; sites?: boolean } = {}) {
  const maxLen = opts.maxLen ?? 480, maxQueries = opts.maxQueries ?? 5;
  const and = cleanTerms(spec.andContains).map(engineTerm);
  const andPart = and.length ? ` ${and.length > 1 ? `(${and.join(" OR ")})` : and[0]}` : "";
  let tail = cleanTerms(spec.excluded).map((w) => ` -${engineTerm(w)}`).join("");
  if (opts.sites) tail += cleanTerms(spec.excludeSites).map((s) => normalizeSite(s)).filter(Boolean).map((s) => ` -site:${s}`).join("");
  // Keep room for the CONTAINS group; long exclusion lists are trimmed rather than producing an invalid query.
  const budget = Math.max(80, maxLen - andPart.length);
  if (tail.length > budget / 2) {
    const cut = tail.lastIndexOf(" -", Math.floor(budget / 2));
    tail = cut > 0 ? tail.slice(0, cut) : "";
  }
  const room = budget - tail.length;
  const terms = cleanTerms(spec.contains).map(engineRule).filter(Boolean);
  const queries: string[] = [];
  let chunk: string[] = [];
  const flush = () => {
    if (!chunk.length) return;
    const g = chunk.length > 1 ? `(${chunk.join(" OR ")})` : chunk[0];
    queries.push(`${g}${andPart}${tail}`.trim());
    chunk = [];
  };
  let used = 0;
  let dropped = 0;
  for (const t of terms) {
    if (queries.length >= maxQueries) {
      dropped++;
      continue;
    }
    const add = (chunk.length ? 4 : 2) + t.length;
    if (chunk.length && used + add > room) {
      flush();
      used = 0;
      if (queries.length >= maxQueries) {
        dropped++;
        continue;
      }
    }
    chunk.push(t);
    used += add;
  }
  if (queries.length < maxQueries) flush();
  else if (chunk.length) dropped += chunk.length;
  return { queries, dropped };
}

/** Plain queries for engines without OR (Hacker News, Bluesky): one per CONTAINS term; AND CONTAINS is applied when matching. */
export function plainQueries(spec: Pick<TopicSpec, "contains">, max = 6): string[] {
  const out: string[] = [];
  for (const term of cleanTerms(spec.contains)) {
    const rule = parseRule(term);
    if (!rule.length) continue;
    out.push(rule.map((alts) => engineTerm(alts[0])).join(" "));
    if (out.length >= max) break;
  }
  return out;
}

/** Hashtags to follow (Mastodon): every single-word CONTAINS term, letters/digits only. */
export function hashtagsOf(spec: Pick<TopicSpec, "contains">, max = 6): string[] {
  const tags = cleanTerms(spec.contains)
    .flatMap((t) => (parseRule(t)[0] ?? []))
    .map((a) => a.replace(/^#/, "").replace(/[^\p{L}\p{N}_]/gu, ""))
    .filter((t) => t.length >= 2);
  return [...new Set(tags.map((t) => t.toLowerCase()))].slice(0, max);
}

const termRule = (t: string) => (isRule(t) ? parseRule(t) : [[unquote(t).toLowerCase()]]);

/** Does the text satisfy CONTAINS, AND CONTAINS and DOES NOT CONTAIN? */
export function matchesSpec(text: string, spec: Pick<TopicSpec, "contains" | "andContains" | "excluded">, opts: { requireContains?: boolean } = {}) {
  if (spec.excluded.some((w) => { const t = unquote(w).toLowerCase(); return !!t && hasTerm(text, t); })) return false;
  if (spec.andContains.length && !spec.andContains.some((w) => { const t = unquote(w).toLowerCase(); return !!t && hasTerm(text, t); })) return false;
  if (opts.requireContains === false) return true;
  return spec.contains.some((t) => ruleMatches(text, termRule(t)));
}

/** Host of a URL or a bare domain, lower-case, without www. ("" when it isn't one). */
export function normalizeSite(v: string): string {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return "";
  let host = s;
  try {
    host = new URL(/^[a-z]+:\/\//.test(s) ? s : `https://${s}`).hostname;
  } catch {
    return "";
  }
  host = host.replace(/^www\./, "");
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) ? host : "";
}

const normHandle = (v: string) => String(v ?? "").trim().toLowerCase().replace(/^@/, "");

export type MentionFacts = { author: string; authorHandle: string | null; authorFollowers: number | null; authorVerified?: boolean | null; url: string | null; country: string | null; language: string | null; site?: string | null };

/**
 * Why a fetched mention is dropped by the topic's exclusions / regional / more-settings filters, or null to keep it.
 * Unknown facts are never used to drop: sources that don't report followers, verification or country are not filtered on them.
 */
export function rejectReason(m: MentionFacts, spec: Pick<TopicSpec, "excludeAuthors" | "excludeSites" | "countries" | "languages" | "minFollowers" | "verifiedOnly">): string | null {
  if (spec.excludeAuthors.length) {
    const names = new Set(spec.excludeAuthors.map(normHandle).filter(Boolean));
    const handle = normHandle(m.authorHandle ?? "");
    const handleBase = handle.split("@")[0];
    if (names.has(normHandle(m.author)) || (handle && (names.has(handle) || names.has(handleBase)))) return "excluded author";
  }
  if (spec.excludeSites.length) {
    const sites = spec.excludeSites.map(normalizeSite).filter(Boolean);
    const hosts = [m.site ? normalizeSite(m.site) : "", m.url ? normalizeSite(m.url) : ""].filter(Boolean);
    if (hosts.some((h) => sites.some((s) => h === s || h.endsWith(`.${s}`)))) return "excluded site";
  }
  if (spec.languages.length && m.language && !spec.languages.map((l) => l.toLowerCase()).includes(m.language.toLowerCase())) return "language";
  if (spec.countries.length && m.country && !spec.countries.map((c) => c.toUpperCase()).includes(m.country.toUpperCase())) return "country";
  if (spec.minFollowers > 0 && m.authorFollowers != null && m.authorFollowers < spec.minFollowers) return "followers";
  if (spec.verifiedOnly && m.authorVerified === false) return "not verified";
  return null;
}

/** Countries a Google News fetch should cover (editions), falling back to the brand's country. */
export function newsEditions(spec: Pick<TopicSpec, "countries">, fallback: string, max = 3): string[] {
  const list = spec.countries.map((c) => c.toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c));
  return (list.length ? [...new Set(list)] : [fallback.toUpperCase() || "US"]).slice(0, max);
}

/** Common countries for the REGIONAL picker (ISO 3166-1 alpha-2). */
export const COUNTRIES: Record<string, string> = {
  IN: "India", US: "United States", GB: "United Kingdom", CA: "Canada", AU: "Australia", AE: "United Arab Emirates", SG: "Singapore", DE: "Germany", FR: "France", ES: "Spain",
  IT: "Italy", NL: "Netherlands", SE: "Sweden", BR: "Brazil", MX: "Mexico", JP: "Japan", KR: "South Korea", ZA: "South Africa", NG: "Nigeria", KE: "Kenya", SA: "Saudi Arabia",
  ID: "Indonesia", MY: "Malaysia", PH: "Philippines", NZ: "New Zealand", IE: "Ireland", BD: "Bangladesh", NP: "Nepal", LK: "Sri Lanka", PK: "Pakistan",
};
