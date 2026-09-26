import { XMLParser } from "fast-xml-parser";
import { AppError, database } from "@/lib/domain";
import { cached, flagEnabled, type Sourced } from "./source";

/**
 * Google News RSS search (real, free): https://news.google.com/rss/search?q=<term>&hl=en-<DB>&gl=<DB>&ceid=<DB>:en
 * Results are cached for an hour in provider_cache and de-duplicated by link. Disable with
 * ENABLE_NEWS_MENTIONS=false.
 */
export type NewsItem = {
  title: string;
  link: string;
  guid: string;
  publishedAt: string;
  publisher: string;
  publisherUrl: string | null;
  snippet: string;
};

export const newsEnabled = () => flagEnabled("ENABLE_NEWS_MENTIONS");

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text", htmlEntities: true, parseTagValue: false, trimValues: true });

const text = (v: unknown): string => {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (typeof v === "object" && "#text" in (v as Record<string, unknown>)) return String((v as Record<string, unknown>)["#text"] ?? "");
  return "";
};
const stripHtml = (s: string) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
const normalizeLink = (link: string) => link.split("?")[0];

export function newsUrl(term: string, db: string) {
  const code = database(db).code;
  return `https://news.google.com/rss/search?q=${encodeURIComponent(`"${term}"`)}&hl=en-${code}&gl=${code}&ceid=${code}:en`;
}

export function parseNewsRss(xml: string): NewsItem[] {
  const doc = parser.parse(xml) as { rss?: { channel?: { item?: unknown } } };
  const raw = doc.rss?.channel?.item;
  const items = (Array.isArray(raw) ? raw : raw ? [raw] : []) as Record<string, unknown>[];
  const seen = new Set<string>();
  const out: NewsItem[] = [];
  for (const it of items) {
    const link = text(it.link);
    const guid = text(it.guid) || link;
    if (!link || seen.has(normalizeLink(link)) || seen.has(guid)) continue;
    seen.add(normalizeLink(link));
    seen.add(guid);
    const source = it.source as Record<string, unknown> | string | undefined;
    const publisher = text(source);
    const publisherUrl = typeof source === "object" && source ? String(source["@_url"] ?? "") || null : null;
    let title = stripHtml(text(it.title));
    if (publisher && title.endsWith(` - ${publisher}`)) title = title.slice(0, -(publisher.length + 3)).trim();
    let snippet = stripHtml(text(it.description));
    if (snippet.startsWith(title)) snippet = snippet.slice(title.length).trim();
    if (publisher && snippet.endsWith(publisher)) snippet = snippet.slice(0, -publisher.length).trim();
    const date = new Date(text(it.pubDate));
    out.push({ title, link, guid, publishedAt: Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString(), publisher, publisherUrl, snippet });
  }
  return out;
}

/** Search Google News for an exact phrase in a regional edition. Cached for 1 hour. */
export async function searchNews(term: string, db: string): Promise<Sourced<NewsItem[]>> {
  if (!newsEnabled()) throw new AppError("Google News mentions are disabled (ENABLE_NEWS_MENTIONS=false).", 503);
  const q = term.trim();
  if (!q || q.length > 100) throw new AppError("Enter a brand term of up to 100 characters.");
  const code = database(db).code;
  return cached(`google-news:${code}:${q.toLowerCase()}`, "google-news", 1, async () => {
    const get = () =>
      fetch(newsUrl(q, code), {
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
        headers: { "User-Agent": "Mozilla/5.0 (compatible; SynapseSEO/1.0; +https://synapseseo.local/bot)", Accept: "application/rss+xml, application/xml;q=0.9, */*;q=0.5" },
      });
    // One retry: Google News occasionally stalls.
    const res = await get()
      .catch(() => get())
      .catch((e: unknown) => {
        throw new AppError(e instanceof Error && e.name === "TimeoutError" ? "Google News did not respond in time." : "Could not reach Google News.", 502);
      });
    if (!res.ok) throw new AppError(`Google News returned HTTP ${res.status}.`, 502);
    const xml = await res.text();
    if (xml.length > 3_000_000) throw new AppError("Google News response was unexpectedly large.", 502);
    return parseNewsRss(xml);
  });
}
