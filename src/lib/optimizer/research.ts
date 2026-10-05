import { XMLParser } from "fast-xml-parser";
import robotsParser from "robots-parser";
import { liveSerpTop } from "@/lib/content/real";
import { extractPage } from "@/lib/content/extract";
import { crawlPage, decodeBody, describeFetchError, fetchFollow, fetchHop, fetchPublic } from "@/lib/crawler";
import { AppError, database, rootDomain, safeUrl } from "@/lib/domain";
import { autocompleteSuggestions } from "@/lib/providers/autocomplete";
import { pageSpeed, pagespeedEnabled } from "@/lib/providers/pagespeed";
import { liveEnabled } from "@/lib/providers/source";
import { siteDomainOf } from "./context";
import { competitorFormat } from "./intent";
import { parseDraft } from "./parse";
import type { CompetitorPage, Draft, LinkCheck, LiveCheck, Research } from "./types";

/**
 * Real research for a draft (server-only): the live Google SERP from DataForSEO when configured,
 * competitor pages crawled with the polite crawler (robots.txt respected), Google Autocomplete,
 * outbound-link checks, the published URL's live status and PageSpeed, and sitemap loading for
 * internal-link suggestions. Nothing here is synthetic.
 */

const TEXT_CAP = 20_000;

function normalizeUrl(raw: string) {
  const s = raw.trim();
  if (!s) return null;
  try {
    return safeUrl(new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`).toString());
  } catch {
    return null;
  }
}

export async function crawlCompetitor(url: string, position: number | null): Promise<CompetitorPage> {
  const domain = (() => {
    try {
      return rootDomain(url);
    } catch {
      return url;
    }
  })();
  const empty: CompetitorPage = { url, domain, position, title: "", metaDescription: "", h1: "", headings: [], words: 0, format: null, hasFaq: false, tables: 0, lists: 0, images: 0, hasVideo: false, schemaTypes: [], questions: [], text: "", error: null };
  try {
    const res = await crawlPage(url);
    if (res.status >= 400) return { ...empty, error: `HTTP ${res.status}` };
    const type = String(res.headers["content-type"] ?? "text/html");
    if (!/html/i.test(type)) return { ...empty, error: "Not an HTML page" };
    const { facts, text, markdown } = extractPage(res.body, res.url, res.status, res.headers, domain);
    const headings = markdown
      .split("\n")
      .map((l) => /^(#{1,6})\s+(.*)$/.exec(l))
      .filter((m): m is RegExpExecArray => !!m)
      .map((m) => ({ level: m[1].length, text: m[2].trim() }))
      .slice(0, 80);
    const questions = headings.filter((h) => /\?\s*$/.test(h.text)).map((h) => h.text);
    const page: CompetitorPage = {
      ...empty,
      url: res.url,
      title: facts.title,
      metaDescription: facts.metaDescription,
      h1: facts.h1s[0] ?? "",
      headings,
      words: facts.words,
      hasFaq: facts.schemaTypes.includes("FAQPage") || headings.some((h) => /^(faqs?|frequently asked)/i.test(h.text)) || questions.length >= 3,
      tables: facts.tables,
      lists: facts.lists,
      images: facts.images,
      hasVideo: facts.hasVideo,
      schemaTypes: facts.schemaTypes,
      questions,
      text: text.slice(0, TEXT_CAP),
    };
    return { ...page, format: competitorFormat(page) };
  } catch (e) {
    return { ...empty, error: e instanceof AppError ? e.message : describeFetchError(e).message };
  }
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

export type ResearchInput = { keyword: string; db?: string; competitors?: string[]; ownDomain?: string | null };

export const researchInputOf = (draft: Draft): ResearchInput => ({ keyword: draft.keyword, db: draft.meta.db, competitors: draft.meta.competitors, ownDomain: siteDomainOf(draft) });

export async function runResearch(ownerId: string, input: ResearchInput): Promise<Research> {
  if (!input.keyword) throw new AppError("Set a primary keyword first.");
  const db = database(input.db ?? "US").code;
  const notes: string[] = [];
  const own = input.ownDomain ?? null;
  const keyword = input.keyword;
  let features: string[] = [];
  let paa: string[] = [];
  let related: string[] = [];
  const targets: { url: string; position: number | null }[] = [];
  let serpSource: Research["serpSource"] = "none";

  if (liveEnabled()) {
    try {
      const serp = await liveSerpTop(ownerId, keyword, db, 20);
      features = serp.features;
      paa = serp.questions.slice(0, 10);
      related = serp.related.slice(0, 12);
      for (const r of serp.organic.filter((o) => !own || !(o.domain === own || o.domain.endsWith(`.${own}`))).slice(0, 6)) targets.push({ url: r.url, position: r.position });
      serpSource = "serp";
    } catch (e) {
      notes.push(`Live SERP unavailable: ${e instanceof Error ? e.message : "error"}`);
    }
  } else notes.push("Live Google results need DataForSEO (not configured): using the competitor URLs you added and Google Autocomplete.");

  const manual = (input.competitors ?? []).map(normalizeUrl).filter((u): u is string => !!u);
  for (const u of manual) if (!targets.some((t) => t.url.replace(/\/$/, "") === u.replace(/\/$/, ""))) targets.push({ url: u, position: null });
  if (serpSource === "none" && manual.length) serpSource = "urls";

  const [competitors, ac] = await Promise.all([pool(targets.slice(0, 10), 3, (t) => crawlCompetitor(t.url, t.position)), autocompleteSuggestions(keyword, db)]);
  const autocomplete = ac.status === "ok" ? ac.data.suggestions.map((s) => s.keyword).slice(0, 60) : [];
  if (ac.status === "failed") notes.push(`Google Autocomplete failed: ${ac.error}`);
  if (ac.status === "disabled") notes.push("Google Autocomplete is disabled (ENABLE_AUTOCOMPLETE=false).");
  const failed = competitors.filter((c) => c.error);
  if (failed.length) notes.push(`${failed.length} competitor page(s) could not be crawled (${[...new Set(failed.map((f) => f.error))].slice(0, 2).join("; ")}).`);
  if (!targets.length) notes.push("No competitor pages: add 2–5 URLs of pages that rank for this keyword to compare against.");
  return { keyword, db, serpSource, features, paa, related, autocomplete, competitors, fetchedAt: new Date().toISOString(), notes };
}

/** Status of every outbound link (max 40), 4 at a time. */
export async function checkLinks(draft: Draft): Promise<LinkCheck> {
  const doc = parseDraft(draft.body, siteDomainOf(draft));
  const urls = [...new Set(doc.links.map((l) => l.url).filter((u) => /^https?:\/\//i.test(u)))].slice(0, 40);
  const results = await pool(urls, 4, async (url) => {
    try {
      let r = await fetchFollow(url, { method: "HEAD", maxBytes: 0, timeoutMs: 10_000, maxRedirects: 6 });
      if ([405, 403, 501].includes(r.response.status)) r = await fetchFollow(url, { method: "GET", maxBytes: 4096, timeoutMs: 12_000, maxRedirects: 6 });
      return { url, status: r.response.status, error: r.loop ? "Redirect loop" : r.tooMany ? "Too many redirects" : null };
    } catch (e) {
      return { url, status: null, error: e instanceof AppError ? e.message : describeFetchError(e).message };
    }
  });
  return { checkedAt: new Date().toISOString(), results };
}

/** Fetch the article's URL as published: status, robots meta / X-Robots-Tag, canonical, robots.txt (Googlebot), PageSpeed. */
export async function checkLive(draft: Draft): Promise<LiveCheck> {
  const url = normalizeUrl(draft.url);
  if (!url) throw new AppError("Set the article's URL first (Technical SEO tab).");
  const base: LiveCheck = { checkedAt: new Date().toISOString(), url, status: null, noindex: false, xRobots: null, canonical: null, robotsAllowed: null, title: "", error: null };
  try {
    const robotsUrl = new URL("/robots.txt", url).toString();
    const robots = await fetchHop(robotsUrl, { maxBytes: 200_000, timeoutMs: 10_000 }).catch(() => null);
    if (robots && robots.status === 200) base.robotsAllowed = robotsParser(robotsUrl, decodeBody(robots.body, String(robots.headers["content-type"] ?? ""))).isAllowed(url, "Googlebot") !== false;
    else if (robots && robots.status >= 400 && robots.status < 500) base.robotsAllowed = true;
    const r = await fetchFollow(url, { method: "GET", maxBytes: 2_000_000, timeoutMs: 15_000, maxRedirects: 6 });
    const html = decodeBody(r.response.body, String(r.response.headers["content-type"] ?? ""));
    const xr = r.response.headers["x-robots-tag"];
    base.status = r.response.status;
    base.xRobots = xr ? (Array.isArray(xr) ? xr.join(", ") : String(xr)) : null;
    if (/html/i.test(String(r.response.headers["content-type"] ?? "text/html"))) {
      const { facts } = extractPage(html, r.response.url, r.response.status, r.response.headers, rootDomain(r.response.url));
      base.noindex = facts.noindex || /\b(noindex|none)\b/i.test(base.xRobots ?? "");
      base.canonical = facts.canonical;
      base.title = facts.title;
    }
    if (pagespeedEnabled() && base.status && base.status < 400) {
      const psi = await pageSpeed(url, "mobile").catch(() => null);
      if (psi) base.pagespeed = { performance: psi.data.performance, lcp: psi.data.field?.lcp ?? psi.data.lab.lcp, cls: psi.data.field?.cls ?? psi.data.lab.cls, inp: psi.data.field?.inp ?? null };
    }
  } catch (e) {
    base.error = e instanceof AppError ? e.message : describeFetchError(e).message;
  }
  return base;
}

/** Load page URLs from a sitemap (or sitemap index): up to 500 URLs with titles from their slugs. */
export async function loadSitemap(input: string): Promise<{ url: string; title: string }[]> {
  const url = normalizeUrl(input);
  if (!url) throw new AppError("Enter a valid sitemap URL.");
  const parser = new XMLParser({ ignoreAttributes: true });
  const seen = new Set<string>();
  const out: { url: string; title: string }[] = [];
  const visit = async (u: string, depth: number) => {
    if (out.length >= 500 || depth > 1) return;
    const res = await fetchPublic(u);
    if (res.status >= 400) throw new AppError(`The sitemap returned HTTP ${res.status}.`);
    let xml: Record<string, unknown>;
    try {
      xml = parser.parse(res.body) as Record<string, unknown>;
    } catch {
      throw new AppError("That URL is not a valid XML sitemap.");
    }
    const asArray = <T,>(v: T | T[] | undefined) => (v == null ? [] : Array.isArray(v) ? v : [v]);
    const index = (xml.sitemapindex as { sitemap?: { loc?: string } | { loc?: string }[] } | undefined)?.sitemap;
    if (index) {
      for (const s of asArray(index).slice(0, 5)) if (s.loc) await visit(String(s.loc), depth + 1);
      return;
    }
    const urls = (xml.urlset as { url?: { loc?: string } | { loc?: string }[] } | undefined)?.url;
    if (!urls) throw new AppError("No <urlset> or <sitemapindex> found in that file.");
    for (const x of asArray(urls)) {
      const loc = String(x.loc ?? "").trim();
      if (!loc || seen.has(loc)) continue;
      seen.add(loc);
      const slug = decodeURIComponent(new URL(loc).pathname.split("/").filter(Boolean).pop() ?? "home").replace(/\.[a-z]{2,5}$/i, "");
      out.push({ url: loc, title: slug.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) });
      if (out.length >= 500) break;
    }
  };
  await visit(url, 0);
  if (!out.length) throw new AppError("The sitemap has no URLs.");
  return out;
}

/** Import an existing page as a draft (title, meta, canonical, robots, body with images). */
export async function importPage(input: string) {
  const url = normalizeUrl(input);
  if (!url) throw new AppError("Enter a valid http(s) URL.");
  const res = await crawlPage(url);
  if (res.status >= 400) throw new AppError(`The page returned HTTP ${res.status}.`);
  const type = String(res.headers["content-type"] ?? "text/html");
  if (!/html/i.test(type)) throw new AppError(`That URL is not an HTML page (${type.split(";")[0]}).`);
  const { facts, markdown } = extractPage(res.body, res.url, res.status, res.headers, rootDomain(res.url), { images: true });
  if (facts.words < 20) throw new AppError("No readable main text was found on that page (it may rely on JavaScript to render).");
  const jsonLd = [...res.body.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1].trim()).filter(Boolean);
  let schema = "";
  if (jsonLd.length === 1) schema = jsonLd[0];
  else if (jsonLd.length > 1) {
    try {
      schema = JSON.stringify(jsonLd.map((j) => JSON.parse(j)), null, 2);
    } catch {
      schema = jsonLd[0];
    }
  }
  const slug = new URL(res.url).pathname.split("/").filter(Boolean).pop() ?? "";
  // The H1 often sits in a <header> the extractor drops as page chrome: keep it at the top.
  const body = !/^#\s/m.test(markdown) && facts.h1s[0] ? `# ${facts.h1s[0]}\n\n${markdown}` : markdown;
  return { url: res.url, title: facts.title, metaDescription: facts.metaDescription, canonical: facts.canonical ?? "", robots: facts.robots || "index, follow", body: body.slice(0, 150_000), slug, schema: schema.slice(0, 60_000), words: facts.words };
}
