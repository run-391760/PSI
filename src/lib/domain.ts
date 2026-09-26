import { getDomain, parse } from "tldts";

export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

/**
 * Regional databases (Semrush calls these "db"). The DataForSEO/Google Ads location code is
 * 2000 + the ISO 3166-1 numeric country code. `share` is the demo engine's relative market size.
 */
export const DATABASES = [
  { code: "US", name: "United States", flag: "🇺🇸", iso: 840, language: "en", share: 1 },
  { code: "GB", name: "United Kingdom", flag: "🇬🇧", iso: 826, language: "en", share: 0.24 },
  { code: "IN", name: "India", flag: "🇮🇳", iso: 356, language: "en", share: 0.62 },
  { code: "CA", name: "Canada", flag: "🇨🇦", iso: 124, language: "en", share: 0.13 },
  { code: "AU", name: "Australia", flag: "🇦🇺", iso: 36, language: "en", share: 0.11 },
  { code: "DE", name: "Germany", flag: "🇩🇪", iso: 276, language: "de", share: 0.2 },
  { code: "FR", name: "France", flag: "🇫🇷", iso: 250, language: "fr", share: 0.16 },
  { code: "ES", name: "Spain", flag: "🇪🇸", iso: 724, language: "es", share: 0.12 },
  { code: "IT", name: "Italy", flag: "🇮🇹", iso: 380, language: "it", share: 0.11 },
  { code: "BR", name: "Brazil", flag: "🇧🇷", iso: 76, language: "pt", share: 0.22 },
  { code: "MX", name: "Mexico", flag: "🇲🇽", iso: 484, language: "es", share: 0.12 },
  { code: "JP", name: "Japan", flag: "🇯🇵", iso: 392, language: "ja", share: 0.18 },
  { code: "NL", name: "Netherlands", flag: "🇳🇱", iso: 528, language: "nl", share: 0.06 },
  { code: "AE", name: "United Arab Emirates", flag: "🇦🇪", iso: 784, language: "en", share: 0.04 },
  { code: "SG", name: "Singapore", flag: "🇸🇬", iso: 702, language: "en", share: 0.03 },
  { code: "ZA", name: "South Africa", flag: "🇿🇦", iso: 710, language: "en", share: 0.05 },
  { code: "IE", name: "Ireland", flag: "🇮🇪", iso: 372, language: "en", share: 0.03 },
  { code: "NZ", name: "New Zealand", flag: "🇳🇿", iso: 554, language: "en", share: 0.025 },
  { code: "PH", name: "Philippines", flag: "🇵🇭", iso: 608, language: "en", share: 0.08 },
  { code: "SE", name: "Sweden", flag: "🇸🇪", iso: 752, language: "sv", share: 0.04 },
] as const;
export type DbCode = (typeof DATABASES)[number]["code"];
export const DB_CODES = DATABASES.map((d) => d.code) as unknown as [DbCode, ...DbCode[]];
export function database(code: string | undefined | null) {
  const upper = (code || "US").toUpperCase();
  return DATABASES.find((d) => d.code === upper) ?? DATABASES[0];
}
export const locationCode = (code: string) => 2000 + database(code).iso;

/** Normalizes user input to a registrable root domain, e.g. "https://www.Blog.example.co.uk/x" -> "example.co.uk". */
export function rootDomain(input: string) {
  let url: URL;
  try {
    url = new URL(input.trim().includes("://") ? input.trim() : `https://${input.trim()}`);
  } catch {
    throw new AppError("Enter a valid domain.");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port)
    throw new AppError("Enter a public domain without credentials or a port.");
  // Hosts that are themselves (private) public suffixes, e.g. github.io or blogspot.com, have no
  // registrable domain; fall back to the hostname so they can still be analyzed.
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const root = getDomain(host, { allowPrivateDomains: true }) ?? (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null);
  if (!root) throw new AppError("Enter a public domain without credentials or a port.");
  return root;
}
/** Like rootDomain but returns null instead of throwing. */
export function tryRootDomain(input: string | null | undefined) {
  if (!input) return null;
  try {
    return rootDomain(input);
  } catch {
    return null;
  }
}
export function hostname(input: string) {
  try {
    return new URL(input.includes("://") ? input : `https://${input}`).hostname.toLowerCase();
  } catch {
    return input.toLowerCase();
  }
}
/** Domain label without the public suffix: "shop.example.co.uk" -> "example". */
export function domainLabel(domain: string) {
  return parse(domain).domainWithoutSuffix || domain.split(".")[0];
}
export function matchesDomain(url: string, domain: string) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === domain || host.endsWith(`.${domain}`);
  } catch {
    return false;
  }
}
export function safeUrl(input: string) {
  const url = new URL(input);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !["80", "443"].includes(url.port))
  )
    throw new AppError("Only public HTTP(S) URLs on standard ports are supported.");
  url.hash = "";
  return url.toString();
}

/** What a free-text search box contains: a URL, a domain, or a keyword. */
export function classifyQuery(input: string): { kind: "domain" | "url" | "keyword"; value: string } {
  const value = input.trim();
  if (/^https?:\/\//i.test(value)) return { kind: "url", value };
  if (!/\s/.test(value) && /\.[a-z]{2,}(\/|$)/i.test(value)) {
    const root = tryRootDomain(value);
    if (root) return value.includes("/") ? { kind: "url", value: `https://${value}` } : { kind: "domain", value: root };
  }
  return { kind: "keyword", value: normalizeKeyword(value) };
}

export function normalizeKeyword(term: string) {
  return term.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}
export function normalizeKeywords(terms: string[], max = 5000) {
  const normalized = [...new Set(terms.map(normalizeKeyword).filter(Boolean))];
  if (normalized.length > max || normalized.some((t) => t.length > 255))
    throw new AppError(`Add at most ${max.toLocaleString()} keywords, each up to 255 characters.`);
  if (normalized.some((t) => /\b(allinanchor|allintext|allintitle|allinurl|filetype|inanchor|intext|intitle|inurl|site):/i.test(t)))
    throw new AppError("Search operators are not supported in tracked keywords.");
  return normalized;
}

/** Position change: positive = improved. Null when either side is unknown. */
export function delta(previous: number | null | undefined, current: number | null | undefined) {
  return previous == null || current == null ? null : previous - current;
}
