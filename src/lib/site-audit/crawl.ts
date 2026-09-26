import http from "node:http";
import https from "node:https";
import robotsParser from "robots-parser";
import { BOT_TOKEN, USER_AGENTS, decodeBody, describeFetchError, fetchFollow, fetchHop, isTlsError, type HopOptions, type HopResult } from "@/lib/crawler";
import { AppError } from "@/lib/domain";
import { extractHtml } from "./extract";
import { loadSitemaps } from "./sitemap";
import type { AuditConfig, LiveProgress, PageData, PageHeaders, RedirectStep, SiteFacts } from "./types";
import { hostOf, isResourceUrl, normalizeUrl, passesMasks, registrable, resourceKind, stripWww } from "./url";

type Robot = ReturnType<typeof robotsParser>;

export type CrawlPage = {
  id: number;
  url: string;
  finalUrl: string | null;
  status: number | null;
  depth: number | null;
  contentType: string | null;
  responseMs: number | null;
  sizeBytes: number | null;
  inSitemap: boolean;
  data: PageData;
};
export type CrawlLink = { sourceId: number; target: string; anchor: string; internal: boolean; nofollow: boolean; rel?: string; kind: "a" | "img" | "script" | "css" };
export type ResourceCheck = { url: string; kind: "image" | "script" | "css" | "file"; status: number | null; error: string | null; blocked: boolean; checked: boolean; pages: number[] };
export type ExternalCheck = { url: string; status: number | null; error: string | null; code: string | null; finalUrl: string | null };
export type ExtraCheck = { url: string; status: number | null; location: string | null; error: string | null };
export type RobotsState = {
  url: string;
  status: number | null;
  found: boolean;
  bytes: number;
  sitemaps: string[];
  crawlDelay: number | null;
  error: string | null;
  excerpt: string;
  parser: Robot | null;
  disallowAll: boolean;
};
export type CrawlOutput = {
  pages: CrawlPage[];
  links: CrawlLink[];
  resources: Map<string, ResourceCheck>;
  external: Map<string, ExternalCheck>;
  extras: Map<string, ExtraCheck>;
  site: SiteFacts;
  sitemapUrls: Map<string, { lastmod: string | null; sitemap: string }>;
  sitemapForeign: string[];
  isAllowed: (url: string) => boolean;
  inScope: (url: string) => boolean;
  stopped: boolean;
  durationMs: number;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Bot-protection interstitials (Cloudflare, proof-of-work walls, CAPTCHAs). */
const CHALLENGE_PATH = /\/(_ray\/pow|cdn-cgi\/challenge-platform|__challenge|captcha|challenge|px-captcha|_incapsula_resource|\.well-known\/sgcaptcha)/i;
const CHALLENGE_TITLE = /^(just a moment|attention required|access denied|verifying you are human|are you a robot|please wait|security check|ddos-guard|checking your browser)/i;
const THROTTLE_STOP = 6;
/** Returns a predicate that turns true once `ms` have elapsed (per-phase time budgets). */
const phaseDeadline = (ms: number) => {
  const until = Date.now() + ms;
  return () => Date.now() > until;
};
const MAX_BLOCKED_ROWS = 100;
const MAX_LINKS_PER_PAGE = 500;
const TIME_BUDGET_MS = 40 * 60 * 1000;

function headersOf(res: HopResult): PageHeaders {
  const h = res.headers;
  const s = (v: unknown) => (v == null ? null : (Array.isArray(v) ? v.join(", ") : String(v)).slice(0, 500));
  const link = s(h.link);
  const canon = link ? /<([^>]+)>\s*;[^,]*rel\s*=\s*"?canonical"?/i.exec(link)?.[1] ?? null : null;
  return {
    hsts: s(h["strict-transport-security"]),
    csp: s(h["content-security-policy"]),
    xcto: s(h["x-content-type-options"]),
    xfo: s(h["x-frame-options"]),
    referrer: s(h["referrer-policy"]),
    encoding: s(h["content-encoding"]),
    xRobots: s(h["x-robots-tag"]),
    server: s(h.server),
    cacheControl: s(h["cache-control"]),
    lastModified: s(h["last-modified"]),
    linkCanonical: canon ? normalizeUrl(canon, res.url) : null,
  };
}

/**
 * Crawls one site politely: robots.txt always respected (per origin, including Crawl-delay), one
 * request per host every `delayMs`, 2–4 requests in flight, redirects followed hop by hop inside
 * the audited scope. Returns everything the analysis needs; nothing is written to the database here.
 */
export async function crawlSite(input: {
  domain: string;
  config: AuditConfig;
  onProgress: (live: LiveProgress) => Promise<void>;
  isCancelled: () => Promise<boolean>;
}): Promise<CrawlOutput> {
  const started = Date.now();
  const { domain, config: cfg } = input;
  const ua = USER_AGENTS[cfg.device];
  const agents = { http: new http.Agent({ keepAlive: true, maxSockets: 4 }), https: new https.Agent({ keepAlive: true, maxSockets: 4 }) };
  const dnsCache = new Map<string, Promise<{ address: string; family: number }>>();
  const hop: HopOptions = { userAgent: ua, agents, dnsCache, timeoutMs: 20000 };
  const startUrl = normalizeUrl(cfg.startUrl) ?? `https://${domain}/`;
  const startHost = hostOf(startUrl);
  const limit = Math.max(1, Math.min(500, cfg.limit));

  const inScope = (url: string) => {
    const h = hostOf(url);
    if (!h) return false;
    return cfg.subdomains ? registrable(h) === domain : stripWww(h) === stripWww(startHost);
  };

  const live: LiveProgress = { phase: "Reading robots.txt", crawled: 0, discovered: 1, queued: 0, limit, broken: 0, redirects: 0, recent: [], startedAt: new Date(started).toISOString() };
  let lastReport = 0;
  const report = async (force = false) => {
    if (!force && Date.now() - lastReport < 1000) return;
    lastReport = Date.now();
    await input.onProgress(live);
  };
  let stop = false;
  let cancelCheckedAt = 0;
  const checkCancel = async () => {
    if (stop) return true;
    if (Date.now() - cancelCheckedAt < 1500) return false;
    cancelCheckedAt = Date.now();
    if ((await input.isCancelled()) || Date.now() - started > TIME_BUDGET_MS) stop = true;
    return stop;
  };

  // Adaptive politeness: back off on 429/503 and stop when the site keeps challenging or timing out.
  const throttle = { streak: 0, events: 0, reason: null as string | null };
  const noteThrottle = (host: string, why: string, retryAfterMs = 0) => {
    throttle.streak++;
    throttle.events++;
    const cur = Math.max(baseDelay, hostDelay.get(host) ?? 0);
    hostDelay.set(host, Math.min(30000, Math.max(cur * 2, retryAfterMs)));
    if (throttle.streak >= THROTTLE_STOP && !throttle.reason)
      throttle.reason = `${host} started ${why} after ${pages.filter((p) => p.status != null).length} pages, so SynapseSEOBot stopped crawling to avoid overloading it. Allow SynapseSEOBot in your firewall/bot protection or raise the crawl delay, then re-run the audit.`;
  };
  const noteOk = (host: string) => {
    throttle.streak = 0;
    // Relax a backed-off host gradually once it answers normally again.
    const cur = hostDelay.get(host);
    if (cur && cur > baseDelay && throttle.events) hostDelay.set(host, Math.max(baseDelay, Math.round(cur * 0.8)));
  };

  /* ---------------------------------------------- politeness ---------------------------------------------- */
  const baseDelay = Math.max(250, Math.min(10000, cfg.delayMs));
  const hostDelay = new Map<string, number>();
  const hostNext = new Map<string, number>();
  const extNext = new Map<string, number>();
  const slot = async (map: Map<string, number>, host: string, delay: number) => {
    const now = Date.now();
    const at = Math.max(now, map.get(host) ?? 0);
    map.set(host, at + delay);
    if (at > now) await sleep(at - now);
  };
  const wait = async (url: string) => {
    const host = hostOf(url);
    await slot(hostNext, host, Math.max(baseDelay, hostDelay.get(host) ?? 0));
    await report();
  };
  const waitExternal = async (url: string) => {
    await slot(extNext, hostOf(url), 1000);
    await report();
  };

  /* ---------------------------------------------- robots.txt ---------------------------------------------- */
  const robotsCache = new Map<string, Promise<RobotsState>>();
  const robotsLoaded = new Map<string, RobotsState>();
  const loadRobots = async (origin: string): Promise<RobotsState> => {
    const url = `${origin}/robots.txt`;
    const state: RobotsState = { url, status: null, found: false, bytes: 0, sitemaps: [], crawlDelay: null, error: null, excerpt: "", parser: null, disallowAll: false };
    try {
      await wait(url);
      const { response } = await fetchFollow(url, {
        ...hop,
        accept: "text/plain,*/*;q=0.5",
        maxBytes: 500_000,
        maxRedirects: 5,
        beforeHop: async (next) => void (await wait(next)),
      });
      state.status = response.status;
      if (response.status >= 200 && response.status < 300) {
        const text = decodeBody(response.body, String(response.headers["content-type"] || ""));
        const looksHtml = /^\s*(<!doctype html|<html)/i.test(text);
        state.found = !looksHtml;
        state.bytes = response.bytes;
        state.excerpt = looksHtml ? "" : text.slice(0, 5000);
        state.parser = robotsParser(url, looksHtml ? "" : text);
        state.sitemaps = looksHtml ? [] : state.parser.getSitemaps();
        state.crawlDelay = looksHtml ? null : (state.parser.getCrawlDelay(BOT_TOKEN) ?? null);
        if (looksHtml) state.error = "robots.txt returns an HTML page (treated as missing).";
      } else if (response.status >= 400 && response.status < 500) {
        state.parser = robotsParser(url, "");
      } else {
        state.disallowAll = true;
        state.error = `robots.txt returned HTTP ${response.status}.`;
      }
    } catch (e) {
      state.disallowAll = true;
      state.error = describeFetchError(e).message;
    }
    if (state.crawlDelay) hostDelay.set(new URL(origin).hostname, Math.min(30000, state.crawlDelay * 1000));
    robotsLoaded.set(origin, state);
    return state;
  };
  const robotsFor = (url: string) => {
    const origin = new URL(url).origin;
    let p = robotsCache.get(origin);
    if (!p) robotsCache.set(origin, (p = loadRobots(origin)));
    return p;
  };
  const allowed = async (url: string) => {
    const r = await robotsFor(url);
    if (r.disallowAll) return false;
    return r.parser?.isAllowed(url, BOT_TOKEN) !== false;
  };
  const isAllowedSync = (url: string) => {
    try {
      const r = robotsLoaded.get(new URL(url).origin);
      if (!r) return true;
      if (r.disallowAll) return false;
      return r.parser?.isAllowed(url, BOT_TOKEN) !== false;
    } catch {
      return true;
    }
  };

  const startRobots = await robotsFor(startUrl);
  if (startRobots.disallowAll) throw new AppError(`robots.txt could not be fetched (${startRobots.error}) — crawling is deferred, as search engines do.`);
  if (!(await allowed(startUrl))) throw new AppError(`robots.txt disallows SynapseSEOBot from crawling ${startUrl}. Allow it with “User-agent: SynapseSEOBot / Allow: /”.`);

  /* ---------------------------------------------- sitemaps ---------------------------------------------- */
  live.phase = "Reading sitemaps";
  await report(true);

  const startOrigin = new URL(startUrl).origin;
  const smCandidates = startRobots.sitemaps.length
    ? startRobots.sitemaps.map((u) => ({ url: normalizeUrl(u) ?? u, fromRobots: true }))
    : [
        { url: `${startOrigin}/sitemap.xml`, fromRobots: false },
        { url: `${startOrigin}/sitemap_index.xml`, fromRobots: false },
      ];
  const sm = await loadSitemaps({ candidates: smCandidates, domain, hop, wait, cancelled: () => stop });
  // Without a robots reference only the first found default location counts; drop the 404 probe of the alternate name.
  let smFiles = sm.files;
  if (!startRobots.sitemaps.length) {
    const found = smFiles.filter((f) => f.status === 200);
    smFiles = found.length ? found : smFiles.slice(0, 1);
  }
  const sitemapUrls = sm.urls;

  /* ---------------------------------------------- frontier ---------------------------------------------- */
  type QItem = { url: string; depth: number | null; source: PageData["source"]; foundOn: string | null };
  const linkQueue: QItem[] = [];
  const smQueue: QItem[] = [];
  const seen = new Set<string>();
  const pages: CrawlPage[] = [];
  const byUrl = new Map<string, CrawlPage>();
  const links: CrawlLink[] = [];
  const resources = new Map<string, ResourceCheck>();
  let blockedRows = 0;
  let blockedMore = 0;
  let reserved = 0;
  let inFlight = 0;

  const enqueueLink = (item: QItem) => {
    if (seen.has(item.url)) return;
    seen.add(item.url);
    linkQueue.push(item);
    live.discovered = seen.size;
  };
  enqueueLink({ url: startUrl, depth: 0, source: "start", foundOn: null });
  if (cfg.source !== "website")
    for (const u of sitemapUrls.keys())
      if (inScope(u) && !isResourceUrl(u) && passesMasks(u, cfg.allow, cfg.disallow)) {
        if (cfg.source === "sitemap") {
          if (!seen.has(u)) {
            seen.add(u);
            smQueue.push({ url: u, depth: null, source: "sitemap", foundOn: null });
          }
        } else smQueue.push({ url: u, depth: null, source: "sitemap", foundOn: null });
      }
  const nextItem = (): QItem | undefined => {
    if (linkQueue.length) return linkQueue.shift();
    while (smQueue.length) {
      const it = smQueue.shift()!;
      if (cfg.source === "both") {
        if (seen.has(it.url)) continue;
        seen.add(it.url);
      }
      return it;
    }
    return undefined;
  };

  const addPage = (p: Omit<CrawlPage, "id" | "inSitemap">) => {
    const page: CrawlPage = { ...p, id: pages.length + 1, inSitemap: sitemapUrls.has(p.url) };
    pages.push(page);
    byUrl.set(page.url, page);
    if (page.status != null) {
      live.crawled = pages.filter((x) => x.status != null).length;
      if (page.status === 0 || page.status >= 400) live.broken++;
      if (page.status >= 300 && page.status < 400) live.redirects++;
      live.recent = [{ url: page.url, status: page.status, ms: page.responseMs }, ...live.recent].slice(0, 8);
    }
    return page;
  };
  const emptyData = (over: Partial<PageData>): PageData => ({
    error: null,
    source: "link",
    foundOn: null,
    redirectChain: [],
    redirectLoop: false,
    blocked: null,
    ttfbMs: null,
    transferBytes: null,
    truncated: false,
    headers: null,
    html: null,
    ...over,
  });
  const addBlocked = (item: QItem) => {
    if (byUrl.has(item.url)) return;
    if (blockedRows >= MAX_BLOCKED_ROWS) {
      blockedMore++;
      return;
    }
    blockedRows++;
    addPage({ url: item.url, finalUrl: null, status: null, depth: item.depth, contentType: null, responseMs: null, sizeBytes: null, data: emptyData({ source: item.source, foundOn: item.foundOn, blocked: "robots" }) });
  };
  const addResource = (url: string, pageId: number, kind?: ResourceCheck["kind"]) => {
    const r = resources.get(url);
    if (r) {
      if (r.pages.length < 50 && !r.pages.includes(pageId)) r.pages.push(pageId);
      return;
    }
    resources.set(url, { url, kind: kind ?? resourceKind(url), status: null, error: null, blocked: false, checked: false, pages: [pageId] });
  };

  const recordResponse = (item: QItem, url: string, res: HopResult, source: PageData["source"], foundOn: string | null) => {
    const rawCt = String(res.headers["content-type"] || "");
    const ct = rawCt.split(";")[0].trim().toLowerCase() || null;
    const headers = headersOf(res);
    const page = addPage({
      url,
      finalUrl: url,
      status: res.status,
      depth: item.depth,
      contentType: ct,
      responseMs: Math.round(res.timeMs),
      sizeBytes: res.bytes,
      data: emptyData({ source, foundOn, ttfbMs: Math.round(res.ttfbMs), transferBytes: res.transferBytes, truncated: res.truncated, headers }),
    });
    const isHtml = ct === "text/html" || ct === "application/xhtml+xml" || (!ct && /^\s*</.test(res.body.subarray(0, 200).toString("latin1")));
    if (res.status < 200 || res.status >= 300 || !isHtml) return page;
    const text = decodeBody(res.body, rawCt);
    const ex = extractHtml(text, url, rawCt, inScope);
    const html = ex.facts;
    html.canonicalHeader = headers.linkCanonical;
    if (headers.linkCanonical && !html.canonicals.includes(headers.linkCanonical)) html.canonicals.push(headers.linkCanonical);
    if (!html.canonical && headers.linkCanonical) html.canonical = headers.linkCanonical;
    const xr = (headers.xRobots || "").toLowerCase();
    if (/(^|[\s,:])(noindex|none)([\s,]|$)/.test(xr)) html.noindex = true;
    if (/(^|[\s,:])(nofollow|none)([\s,]|$)/.test(xr)) html.nofollow = true;
    page.data.html = html;

    const seenHere = new Set<string>();
    let aCount = 0;
    for (const l of ex.links) {
      const key = `${l.kind}:${l.target}`;
      if (seenHere.has(key)) continue;
      seenHere.add(key);
      const internal = inScope(l.target);
      if (l.kind === "a") {
        if (aCount++ < MAX_LINKS_PER_PAGE) links.push({ sourceId: page.id, target: l.target, anchor: l.anchor, internal, nofollow: l.nofollow, rel: l.rel ?? "", kind: "a" });
        if (!internal) continue;
        if (isResourceUrl(l.target)) {
          addResource(l.target, page.id);
          continue;
        }
        if (cfg.source === "sitemap" || html.nofollow) continue;
        if (!passesMasks(l.target, cfg.allow, cfg.disallow)) continue;
        enqueueLink({ url: l.target, depth: item.depth == null ? null : item.depth + 1, source: "link", foundOn: url });
      } else if (internal) {
        addResource(l.target, page.id, l.kind === "img" ? "image" : l.kind === "script" ? "script" : "css");
      }
    }
    return page;
  };

  const redirectRow = (item: QItem, url: string, chain: RedirectStep[], finalUrl: string | null, loop: boolean, error: string | null, ms: number, depth: number | null, source: PageData["source"], foundOn: string | null) =>
    addPage({ url, finalUrl, status: chain[0]?.status ?? null, depth, contentType: null, responseMs: ms, sizeBytes: 0, data: emptyData({ source, foundOn, redirectChain: chain, redirectLoop: loop, error }) });

  const processItem = async (item: QItem) => {
    const chain: RedirectStep[] = [];
    const hopMs: number[] = [];
    let current = item.url;
    const finishRedirect = (finalUrl: string | null, loop: boolean, error: string | null) => {
      // One row for the requested URL plus one per intermediate in-scope hop (they are real URLs too).
      chain.forEach((step, i) => {
        if (i > 0 && byUrl.has(step.url)) return;
        redirectRow(item, step.url, chain.slice(i), finalUrl, loop, error, hopMs[i] ?? 0, item.depth, i === 0 ? item.source : "redirect", i === 0 ? item.foundOn : item.url);
      });
    };
    for (;;) {
      await wait(current);
      let res: HopResult;
      try {
        res = await fetchHop(current, { ...hop, maxBytes: 5_000_000 });
      } catch (e) {
        const err = describeFetchError(e);
        if (/timed out|ETIMEDOUT|ECONNRESET/i.test(`${err.code} ${err.message}`)) noteThrottle(hostOf(current), "timing out");
        if (!chain.length) addPage({ url: item.url, finalUrl: null, status: 0, depth: item.depth, contentType: null, responseMs: null, sizeBytes: null, data: emptyData({ source: item.source, foundOn: item.foundOn, error: err.message }) });
        else {
          finishRedirect(current, false, null);
          if (!byUrl.has(current)) addPage({ url: current, finalUrl: null, status: 0, depth: item.depth, contentType: null, responseMs: null, sizeBytes: null, data: emptyData({ source: "redirect", foundOn: item.url, error: err.message }) });
        }
        return;
      }
      const location = res.headers.location;
      if (res.status >= 300 && res.status < 400 && location) {
        const next = normalizeUrl(String(location), current);
        chain.push({ url: current, status: res.status });
        hopMs.push(Math.round(res.timeMs));
        if (!next) return finishRedirect(null, false, "Redirect points to an invalid URL.");
        if (CHALLENGE_PATH.test(new URL(next).pathname) && !CHALLENGE_PATH.test(new URL(current).pathname)) {
          finishRedirect(next, false, "Redirected to a bot-protection challenge.");
          const row = byUrl.get(item.url);
          if (row) row.data.challenge = true;
          noteThrottle(hostOf(current), "serving bot-protection challenges");
          return;
        }
        if (next === current || chain.some((h) => h.url === next)) return finishRedirect(next, true, "Redirect loop.");
        if (chain.length >= 10) return finishRedirect(next, true, "More than 10 redirects.");
        if (!inScope(next) || seen.has(next) || reserved >= limit) return finishRedirect(next, false, null);
        if (!(await allowed(next))) {
          finishRedirect(next, false, null);
          seen.add(next);
          addBlocked({ url: next, depth: item.depth, source: "redirect", foundOn: item.url });
          return;
        }
        seen.add(next);
        reserved++;
        current = next;
        continue;
      }
      const host = hostOf(current);
      const limited = res.status === 429 || res.status === 503;
      if (limited) {
        const ra = Number(res.headers["retry-after"]);
        noteThrottle(host, res.status === 429 ? "rate-limiting SynapseSEOBot (HTTP 429)" : "returning HTTP 503", Number.isFinite(ra) ? ra * 1000 : 0);
      }
      let page: CrawlPage;
      if (chain.length) {
        finishRedirect(current, false, null);
        page = recordResponse(item, current, res, "redirect", item.url);
      } else page = recordResponse(item, item.url, res, item.source, item.foundOn);
      const challenged = String(res.headers["cf-mitigated"] || "").toLowerCase() === "challenge" || (!!page.data.html && CHALLENGE_TITLE.test(page.data.html.title ?? ""));
      if (challenged) {
        page.data.challenge = true;
        noteThrottle(host, "serving bot-protection challenges");
      } else if (!limited) noteOk(host);
      return;
    }
  };

  live.phase = "Crawling";
  const concurrency = baseDelay >= 2000 ? 2 : baseDelay >= 1000 ? 3 : 4;
  const worker = async () => {
    while (!stop && !throttle.reason) {
      if (reserved >= limit) break;
      const item = nextItem();
      if (!item) {
        if (inFlight === 0) break;
        await sleep(150);
        continue;
      }
      if (item.source !== "start" && !(await allowed(item.url))) {
        addBlocked(item);
        continue;
      }
      reserved++;
      inFlight++;
      try {
        await processItem(item);
      } catch (e) {
        console.error("[site-audit] crawl item failed", item.url, e);
        if (!byUrl.has(item.url)) addPage({ url: item.url, finalUrl: null, status: 0, depth: item.depth, contentType: null, responseMs: null, sizeBytes: null, data: emptyData({ source: item.source, foundOn: item.foundOn, error: describeFetchError(e).message }) });
      } finally {
        inFlight--;
      }
      live.queued = linkQueue.length + (cfg.source === "website" ? 0 : smQueue.length);
      await report();
      await checkCancel();
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  const frontierExhausted = !stop && !throttle.reason && linkQueue.length === 0 && (cfg.source === "website" || smQueue.every((s) => seen.has(s.url)));

  /* ---------------------------------------------- site-level probes ---------------------------------------------- */
  const resolveFinal = (url: string) => {
    let cur = url;
    for (let i = 0; i < 12; i++) {
      const p = byUrl.get(cur);
      if (!p || !p.data.redirectChain.length || !p.finalUrl || p.finalUrl === cur) return cur;
      cur = p.finalUrl;
    }
    return cur;
  };
  const home = byUrl.get(startUrl);
  const homeFinal = resolveFinal(startUrl);
  const homeFinalPage = byUrl.get(homeFinal);
  const finalHost = hostOf(homeFinal) || startHost;
  const finalOrigin = (() => {
    try {
      return new URL(homeFinal).origin;
    } catch {
      return startOrigin;
    }
  })();
  live.phase = "Checking HTTPS, robots.txt and llms.txt";
  await report(true);

  const site: SiteFacts = {
    host: finalHost,
    origin: finalOrigin,
    homepage: { url: startUrl, finalUrl: homeFinal, status: homeFinalPage?.status ?? home?.status ?? null, chain: home?.data.redirectChain ?? [] },
    robots: { url: startRobots.url, status: startRobots.status, found: startRobots.found, bytes: startRobots.bytes, sitemaps: startRobots.sitemaps, crawlDelay: startRobots.crawlDelay, error: startRobots.error, excerpt: startRobots.excerpt },
    sitemaps: smFiles,
    sitemapUrlCount: sitemapUrls.size,
    llms: { url: `${finalOrigin}/llms.txt`, status: null, found: false, bytes: 0, firstLine: null, problems: [] },
    https: { supported: false, error: null, httpRedirects: null, httpStatus: null, httpLocation: null },
    tls: null,
    www: { altHost: "", status: null, location: null, ok: null, note: "" },
    scopeNote: cfg.subdomains ? `All hosts of ${domain}` : `${stripWww(startHost)} (and www.)`,
    frontierExhausted,
    probed: false,
    throttled: throttle.reason,
    blockedMore,
    externalChecked: 0,
    resourcesChecked: 0,
    effectiveDelayMs: Math.max(baseDelay, (startRobots.crawlDelay ?? 0) * 1000),
    backoffEvents: throttle.events,
    userAgent: ua,
  };

  if (!stop) {
    // HTTPS support + certificate.
    try {
      await wait(`https://${finalHost}/`);
      const r = await fetchHop(`https://${finalHost}/`, { ...hop, maxBytes: 0, tlsInfo: true, agents: undefined });
      site.https.supported = true;
      site.tls = { protocol: r.tls?.protocol ?? null, validTo: r.tls?.validTo ?? null, issuer: r.tls?.issuer ?? null, subject: r.tls?.subject ?? null, error: null };
    } catch (e) {
      const err = describeFetchError(e);
      site.https.error = err.message;
      if (isTlsError(err.code)) site.tls = { protocol: null, validTo: null, issuer: null, subject: null, error: err.message };
    }
    // HTTP -> HTTPS redirect.
    try {
      await wait(`http://${finalHost}/`);
      const r = await fetchHop(`http://${finalHost}/`, { ...hop, maxBytes: 0 });
      site.https.httpStatus = r.status;
      site.https.httpLocation = r.headers.location ? String(r.headers.location) : null;
      site.https.httpRedirects = r.status >= 300 && r.status < 400 && !!site.https.httpLocation && /^https:/i.test(new URL(site.https.httpLocation, `http://${finalHost}/`).toString());
    } catch {
      site.https.httpRedirects = null;
    }
    // www / non-www consistency (only meaningful for the apex or its www host).
    const bare = stripWww(finalHost);
    if (bare === domain) {
      const alt = finalHost.startsWith("www.") ? bare : `www.${bare}`;
      site.www.altHost = alt;
      const proto = new URL(finalOrigin).protocol;
      try {
        await wait(`${proto}//${alt}/`);
        const r = await fetchHop(`${proto}//${alt}/`, { ...hop, maxBytes: 0 });
        site.www.status = r.status;
        site.www.location = r.headers.location ? new URL(String(r.headers.location), `${proto}//${alt}/`).toString() : null;
        if (r.status >= 300 && r.status < 400 && site.www.location) {
          site.www.ok = hostOf(site.www.location) === finalHost;
          site.www.note = site.www.ok ? `${alt} redirects to ${finalHost}.` : `${alt} redirects to ${hostOf(site.www.location)}, not ${finalHost}.`;
        } else if (r.status >= 200 && r.status < 300) {
          site.www.ok = false;
          site.www.note = `${alt} returns ${r.status} without redirecting to ${finalHost}.`;
        } else {
          site.www.ok = true;
          site.www.note = `${alt} returns ${r.status}.`;
        }
      } catch (e) {
        site.www.ok = null;
        site.www.note = `${alt} is not reachable (${describeFetchError(e).message.replace(/\.$/, "")}).`;
      }
    } else site.www.note = `Start host ${finalHost} is a subdomain; www consistency not applicable.`;
    site.probed = true;
    // llms.txt
    try {
      const url = `${finalOrigin}/llms.txt`;
      await wait(url);
      const { response } = await fetchFollow(url, {
        ...hop,
        accept: "text/markdown,text/plain;q=0.9,*/*;q=0.5",
        maxBytes: 300_000,
        maxRedirects: 3,
        beforeHop: async (next) => {
          if (!inScope(next)) return false;
          await wait(next);
        },
      });
      site.llms.status = response.status;
      if (response.status === 200) {
        const text = decodeBody(response.body, String(response.headers["content-type"] || ""));
        if (/^\s*(<!doctype html|<html)/i.test(text)) site.llms.problems.push("Returns an HTML page (soft 404).");
        else {
          site.llms.found = true;
          site.llms.bytes = response.bytes;
          const first = text.split(/\r?\n/).find((l) => l.trim()) ?? "";
          site.llms.firstLine = first.slice(0, 200);
          if (!/^#\s+\S/.test(first)) site.llms.problems.push("Doesn't start with an H1 (“# Site name”).");
          if (!/\[[^\]]+\]\([^)]+\)/.test(text)) site.llms.problems.push("Contains no markdown links.");
          if (!text.trim()) site.llms.problems.push("File is empty.");
        }
      }
    } catch (e) {
      site.llms.problems.push(describeFetchError(e).message);
    }
  }

  /* ---------------------------------------------- canonical / hreflang targets ---------------------------------------------- */
  const extras = new Map<string, ExtraCheck>();
  if (!stop && !throttle.reason) {
    live.phase = "Checking canonical and hreflang targets";
    await report(true);
    const want: string[] = [];
    for (const p of pages) {
      const h = p.data.html;
      if (!h) continue;
      for (const t of [...h.canonicals.filter((x) => !x.startsWith("invalid:")), ...h.hreflang.map((x) => x.href).filter((x): x is string => !!x)])
        if (inScope(t) && !byUrl.has(t) && !want.includes(t)) want.push(t);
    }
    const expired = phaseDeadline(90_000);
    for (const url of want.slice(0, 40)) {
      if ((await checkCancel()) || expired()) break;
      if (!(await allowed(url))) continue;
      try {
        await wait(url);
        const r = await fetchHop(url, { ...hop, maxBytes: 0 });
        extras.set(url, { url, status: r.status, location: r.headers.location ? normalizeUrl(String(r.headers.location), url) : null, error: null });
      } catch (e) {
        extras.set(url, { url, status: 0, location: null, error: describeFetchError(e).message });
      }
    }
  }

  /* ---------------------------------------------- internal resources ---------------------------------------------- */
  // Link/resource checks: a host that times out twice is skipped for the rest of the phase, and each
  // phase has a time budget, so one unresponsive CDN can't stretch the audit by many minutes.
  const deadHosts = new Map<string, number>();
  const isTimeout = (e: unknown) => /timed out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EHOSTUNREACH/i.test(`${describeFetchError(e).code} ${describeFetchError(e).message}`);
  const headOrGet = async (url: string, waiter: (u: string) => Promise<void>, timeoutMs = 8000) => {
    const host = hostOf(url);
    if ((deadHosts.get(host) ?? 0) >= 2) throw Object.assign(new AppError("Skipped: host did not respond to earlier checks."), { code: "SKIPPED" });
    const follow = (method: "HEAD" | "GET") => fetchFollow(url, { ...hop, method, maxBytes: 0, timeoutMs, maxRedirects: 5, beforeHop: async (n) => void (await waiter(n)) });
    await waiter(url);
    let r: Awaited<ReturnType<typeof follow>> | null = null;
    try {
      r = await follow("HEAD");
    } catch (e) {
      const code = describeFetchError(e).code;
      if (isTimeout(e)) deadHosts.set(host, (deadHosts.get(host) ?? 0) + 1);
      // An unresponsive, unknown or TLS-broken host won't do better on GET.
      if (code === "ENOTFOUND" || code === "BLOCKED" || isTlsError(code) || isTimeout(e)) throw e;
    }
    // Many servers mishandle HEAD (404/405/403… or a dropped connection); confirm with a headers-only GET.
    if (!r || r.response.status >= 400) {
      await waiter(url);
      try {
        r = await follow("GET");
      } catch (e) {
        if (isTimeout(e)) deadHosts.set(host, (deadHosts.get(host) ?? 0) + 1);
        throw e;
      }
    }
    return r;
  };
  for (const r of resources.values()) r.blocked = !isAllowedSync(r.url);
  if (!stop && !throttle.reason) {
    live.phase = "Checking images, scripts and stylesheets";
    await report(true);
    const byPopularity = [...resources.values()].filter((r) => !r.blocked).sort((a, b) => b.pages.length - a.pages.length);
    const pick = (kinds: ResourceCheck["kind"][], n: number) => byPopularity.filter((r) => kinds.includes(r.kind)).slice(0, n);
    const sample = [...pick(["image"], 20), ...pick(["script", "css"], 20), ...pick(["file"], 10)];
    let i = 0;
    const expired = phaseDeadline(120_000);
    const run = async () => {
      while (!(await checkCancel()) && !expired() && i < sample.length) {
        const r = sample[i++];
        try {
          const res = await headOrGet(r.url, wait);
          r.status = res.response.status;
        } catch (e) {
          const err = describeFetchError(e);
          if (err.code === "SKIPPED") continue;
          r.status = 0;
          r.error = err.message;
        }
        r.checked = true;
        site.resourcesChecked++;
      }
    };
    await Promise.all([run(), run()]);
  }

  /* ---------------------------------------------- confirm slow pages ---------------------------------------------- */
  // Timings taken while the server is busy can be inflated; re-measure slow pages one at a time and keep the best.
  if (!stop && !throttle.reason && !throttle.events) {
    const slowPages = pages
      .filter((p) => p.data.html && p.status != null && p.status >= 200 && p.status < 300 && (p.responseMs ?? 0) > 1000)
      .sort((a, b) => (b.responseMs ?? 0) - (a.responseMs ?? 0))
      .slice(0, 12);
    if (slowPages.length) {
      live.phase = `Re-checking ${slowPages.length} slow page${slowPages.length === 1 ? "" : "s"}`;
      await report(true);
    }
    const expired = phaseDeadline(90_000);
    for (const p of slowPages) {
      if ((await checkCancel()) || expired()) break;
      try {
        await wait(p.url);
        const r = await fetchHop(p.url, { ...hop, maxBytes: 5_000_000 });
        if (r.status === p.status) {
          p.responseMs = Math.min(p.responseMs ?? Infinity, Math.round(r.timeMs));
          p.data.ttfbMs = Math.min(p.data.ttfbMs ?? Infinity, Math.round(r.ttfbMs));
        }
      } catch {
        /* keep the first measurement */
      }
    }
  }

  /* ---------------------------------------------- external links ---------------------------------------------- */
  const external = new Map<string, ExternalCheck>();
  if (!stop && cfg.checkExternal) {
    live.phase = "Checking external links";
    await report(true);
    const counts = new Map<string, number>();
    for (const l of links) if (l.kind === "a" && !l.internal) counts.set(l.target, (counts.get(l.target) ?? 0) + 1);
    const perHost = new Map<string, number>();
    const sample: string[] = [];
    for (const [url] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
      const h = hostOf(url);
      if ((perHost.get(h) ?? 0) >= 3) continue;
      perHost.set(h, (perHost.get(h) ?? 0) + 1);
      sample.push(url);
      if (sample.length >= 100) break;
    }
    let i = 0;
    const expired = phaseDeadline(150_000);
    const run = async () => {
      while (!(await checkCancel()) && !expired() && i < sample.length) {
        const url = sample[i++];
        try {
          const r = await headOrGet(url, waitExternal, 8000);
          external.set(url, { url, status: r.response.status, error: null, code: null, finalUrl: r.chain.length ? r.response.url : null });
        } catch (e) {
          const err = describeFetchError(e);
          if (err.code === "SKIPPED") continue;
          external.set(url, { url, status: null, error: err.message, code: err.code, finalUrl: null });
        }
        site.externalChecked++;
        if (site.externalChecked % 10 === 0) {
          live.phase = `Checking external links (${site.externalChecked}/${sample.length})`;
          await report();
        }
      }
    };
    await Promise.all([run(), run(), run(), run()]);
  }

  agents.http.destroy();
  agents.https.destroy();
  return {
    pages,
    links,
    resources,
    external,
    extras,
    site,
    sitemapUrls,
    sitemapForeign: sm.foreign,
    isAllowed: isAllowedSync,
    inScope,
    stopped: stop,
    durationMs: Date.now() - started,
  };
}
