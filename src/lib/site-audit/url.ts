import { getDomain } from "tldts";

/**
 * Canonical form used to dedupe crawl targets: absolute http(s), no fragment, no credentials,
 * standard ports only, lower-case host, no empty "?". Returns null for anything we can't crawl.
 */
export function normalizeUrl(input: string, base?: string): string | null {
  try {
    const u = new URL(input, base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (u.username || u.password) return null;
    if (u.port && !["80", "443"].includes(u.port)) return null;
    u.hash = "";
    let s = u.toString();
    if (s.endsWith("?")) s = s.slice(0, -1);
    return s;
  } catch {
    return null;
  }
}

export const registrable = (host: string) => getDomain(host, { allowPrivateDomains: true })?.toLowerCase() ?? host.toLowerCase();
export const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
};
export const stripWww = (host: string) => host.replace(/^www\./, "");

const RESOURCE_EXT =
  /\.(jpe?g|png|gif|webp|avif|svg|ico|bmp|tiff?|heic|pdf|zip|rar|7z|gz|tgz|tar|bz2|mp3|mp4|m4a|m4v|mov|avi|wmv|webm|ogg|ogv|wav|flac|css|js|mjs|map|json|xml|rss|atom|txt|csv|tsv|docx?|xlsx?|pptx?|odt|ods|epub|exe|dmg|pkg|msi|apk|iso|woff2?|ttf|otf|eot|swf)$/i;
export function isResourceUrl(url: string) {
  try {
    return RESOURCE_EXT.test(new URL(url).pathname);
  } catch {
    return false;
  }
}
export function resourceKind(url: string): "image" | "script" | "css" | "file" {
  const p = (() => {
    try {
      return new URL(url).pathname.toLowerCase();
    } catch {
      return url.toLowerCase();
    }
  })();
  if (/\.(jpe?g|png|gif|webp|avif|svg|ico|bmp|tiff?|heic)$/.test(p)) return "image";
  if (/\.(js|mjs)$/.test(p)) return "script";
  if (/\.css$/.test(p)) return "css";
  return "file";
}

/**
 * URL path masks: "/blog/" (prefix), "/blog/*.html" (wildcard), "*utm_*" (anywhere), "/exact$" (end anchor).
 * Matched against path + query.
 */
export function maskMatches(mask: string, url: string) {
  let target: string;
  try {
    const u = new URL(url);
    target = u.pathname + u.search;
  } catch {
    return false;
  }
  const m = mask.trim();
  if (!m) return false;
  const anchored = m.endsWith("$");
  const body = anchored ? m.slice(0, -1) : m;
  const pattern = body
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  const re = new RegExp(`^${body.startsWith("/") || body.startsWith("*") ? "" : ".*"}${pattern}${anchored ? "$" : ""}`, "i");
  return re.test(target);
}
export function passesMasks(url: string, allow: string[], disallow: string[]) {
  if (disallow.some((m) => maskMatches(m, url))) return false;
  if (allow.length && !allow.some((m) => maskMatches(m, url))) return false;
  return true;
}

export function queryParamCount(url: string) {
  try {
    return [...new URL(url).searchParams.keys()].length;
  } catch {
    return 0;
  }
}
