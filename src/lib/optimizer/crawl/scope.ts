import { getDomain } from "tldts";

/**
 * Crawl scope and frontier rules (pure): URL normalization, same-registrable-domain scope, which
 * links are worth fetching as pages, and a breadth-first queue with depth and page limits.
 */

export const MAX_DEPTH = 3;
export const PAGE_LIMITS = [10, 25, 50] as const;
export const DEFAULT_PAGES = 25;

const TRACKING = /^(utm_[a-z]+|gclid|fbclid|msclkid|mc_cid|mc_eid|_ga|_gl|ref_src|igshid)$/i;
const NOT_HTML = /\.(pdf|jpe?g|png|gif|webp|avif|svg|ico|bmp|tiff?|zip|rar|7z|gz|tar|mp4|m4v|mov|avi|webm|mp3|wav|ogg|docx?|xlsx?|pptx?|csv|txt|xml|json|rss|atom|css|js|mjs|woff2?|ttf|otf|eot|exe|dmg|apk|ics)$/i;

/** Accepts "example.com", "www.example.com/blog" or a full URL; returns a normalized http(s) URL or null. */
export function normalizeStartUrl(input: string): string | null {
  const s = input.trim();
  if (!s || /\s/.test(s)) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    if (url.port && !["80", "443"].includes(url.port)) return null;
    if (!/\.[a-z0-9-]{2,}$/i.test(url.hostname)) return null;
    return normalizeUrl(url.toString());
  } catch {
    return null;
  }
}

/** Canonical form used for de-duplication: lower-case host, no fragment, no default port, no tracking parameters. */
export function normalizeUrl(raw: string, base?: string): string | null {
  try {
    const url = base ? new URL(raw, base) : new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) url.port = "";
    for (const key of [...url.searchParams.keys()]) if (TRACKING.test(key)) url.searchParams.delete(key);
    url.search = url.searchParams.toString() ? `?${url.searchParams.toString()}` : "";
    return url.toString();
  } catch {
    return null;
  }
}

/** Registrable domain of a URL ("blog.example.co.uk" → "example.co.uk"), or the host itself for bare hosts. */
export function registrableDomain(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return getDomain(host, { allowPrivateDomains: true }) ?? host;
  } catch {
    return null;
  }
}

/** Same registrable domain as the crawl (subdomains included). */
export function inScope(url: string, domain: string) {
  return registrableDomain(url) === domain;
}

/** A link that may lead to an HTML page (not a file download or asset). */
export function looksLikePage(url: string) {
  try {
    return !NOT_HTML.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

export type QueueItem = { url: string; depth: number; from: number | null };

/**
 * Breadth-first frontier. `offer` accepts a URL once (normalized), only in scope, only page-like,
 * and only up to `maxDepth`; `take` returns the shallowest pending URL.
 */
export class CrawlQueue {
  private seen = new Set<string>();
  private pending: QueueItem[] = [];
  constructor(
    readonly domain: string,
    readonly maxDepth = MAX_DEPTH,
  ) {}

  offer(raw: string, depth: number, from: number | null): QueueItem | null {
    const url = normalizeUrl(raw);
    if (!url || depth > this.maxDepth || !inScope(url, this.domain) || !looksLikePage(url) || this.seen.has(url)) return null;
    this.seen.add(url);
    const item = { url, depth, from };
    // Stable insertion by depth keeps breadth-first order even when depths arrive out of order.
    let i = this.pending.length;
    while (i > 0 && this.pending[i - 1].depth > depth) i--;
    this.pending.splice(i, 0, item);
    return item;
  }
  /** Marks a URL as seen without queueing it (e.g. the final URL of a redirect). Returns false if already seen. */
  mark(raw: string) {
    const url = normalizeUrl(raw);
    if (!url || this.seen.has(url)) return false;
    this.seen.add(url);
    return true;
  }
  has(raw: string) {
    const url = normalizeUrl(raw);
    return !!url && this.seen.has(url);
  }
  take(): QueueItem | null {
    return this.pending.shift() ?? null;
  }
  get size() {
    return this.pending.length;
  }
}

/** Total time budget of one crawl (polite crawling is slow on purpose): 10 pages 2.5 min, 25 pages ~4.75 min, 50 pages 7 min. */
export const timeCapFor = (maxPages: number) => Math.min(420_000, 60_000 + maxPages * 9_000);

export function clampPages(n: unknown) {
  const v = Number(n);
  return (PAGE_LIMITS as readonly number[]).includes(v) ? v : DEFAULT_PAGES;
}
