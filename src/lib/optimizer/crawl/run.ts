import "server-only";
import http from "node:http";
import https from "node:https";
import robotsParser from "robots-parser";
import { extractPage } from "@/lib/content/extract";
import { BOT_TOKEN, decodeBody, describeFetchError, fetchFollow, fetchHop, parseLinks, type HopOptions, type HopResult, type RedirectHop } from "@/lib/crawler";
import { AppError, safeUrl } from "@/lib/domain";
import { extractBlocks } from "./blocks";
import { GateStopped, HostGate, limiter, sleep } from "./gate";
import { inspectPage, linkFlags, touchFor } from "./rules";
import { CrawlQueue, MAX_DEPTH, normalizeUrl, registrableDomain, timeCapFor } from "./scope";
import { jsonLdOf, scorePage } from "./score";
import { summarizeCrawl } from "./summary";
import type { CrawlEvent, CrawlStatus, CrawlSummary, Flag, LinkStatus, PageResult, Skip } from "./types";

/**
 * The live crawler (server-only). Polite by construction: robots.txt is read per origin and
 * respected (pages, redirect targets and link checks), Crawl-delay is honoured, one request at a
 * time per host with a gap between requests, same registrable domain only, depth ≤ 3, a page limit
 * and a total time cap. Every fetch goes through the SSRF-safe crawler (`fetchHop`/`fetchFollow`). Each
 * page is reported as it is processed: its snapshot, one "touch" per element the spider inspects (with
 * the measured result), its flags, and its optimizer score.
 *
 * The time cap is enforced inside a page too: request timeouts never reach past it, link checks still
 * outstanding when it passes are reported "Not checked: time limit", and a watchdog moves on from a
 * page that has not wrapped up shortly after the cap (or after Stop).
 */

export const LINKS_PER_PAGE = 15;
const MAX_CRAWL_DELAY_MS = 20_000;
const PAGE_REDIRECTS = 5;
/** How long a page may take to wrap up (touches, score) after the time cap or Stop. */
const WRAP_UP_MS = 1500;
/** Link-check codes that are definitive: the page is reported from the check instead of refetched. */
const DEFINITIVE = (status: number) => status === 404 || status === 410 || status >= 500;

type Robots = {
  parser: ReturnType<typeof robotsParser> | null;
  disallowAll: boolean;
  found: boolean;
  delayMs: number | null;
  error: string | null;
  /** The host itself was unreachable (DNS, refused, timeout): links to it are reported with this error. */
  unreachable: string | null;
};
/** Network failures where retrying the same URL with GET cannot help. */
const HARD_FAIL = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "TIMEOUT", "ETIMEDOUT", "EHOSTUNREACH", "BLOCKED"]);

export type RunInput = { id: string; startUrl: string; maxPages: number; signal: AbortSignal; emit: (e: CrawlEvent) => void };
export type RunResult = { status: CrawlStatus; domain: string; pages: PageResult[]; skips: Skip[]; summary: CrawlSummary };

const hostOf = (url: string) => new URL(url).hostname;
type Followed = { response: HopResult; chain: RedirectHop[]; loop: boolean; tooMany: boolean; stoppedAt: string | null };
const snapshotOf = ({ touches: _t, flags: _f, score: _s, linksChecked: _l, ...rest }: PageResult) => rest;
const asString = (v: string | string[] | undefined) => (Array.isArray(v) ? v.join(", ") : (v ?? ""));

export async function runCrawl({ id, startUrl, maxPages, signal, emit }: RunInput): Promise<RunResult> {
  const started = Date.now();
  const timeCapMs = timeCapFor(maxPages);
  const domain = registrableDomain(startUrl);
  if (!domain) throw new AppError("Enter a valid website URL.");
  // `stop` fires on the caller's abort (Stop / disconnect) or when the time cap passes.
  const capped = new AbortController();
  const stop = AbortSignal.any([signal, capped.signal]);
  const capTimer = setTimeout(() => capped.abort(), timeCapMs);
  const stopped = new Promise<void>((resolve) => (stop.aborted ? resolve() : stop.addEventListener("abort", () => resolve(), { once: true })));
  const gate = new HostGate(undefined, stop);
  const agents = { http: new http.Agent({ keepAlive: true, maxSockets: 2 }), https: new https.Agent({ keepAlive: true, maxSockets: 2 }) };
  const dnsCache: NonNullable<HopOptions["dnsCache"]> = new Map();
  const hop: HopOptions = { agents, dnsCache };
  const pages: PageResult[] = [];
  const skips: Skip[] = [];
  const linkCache = new Map<string, Promise<LinkStatus>>();
  const queue = new CrawlQueue(domain, MAX_DEPTH);
  let stopReason: string | null = null;
  // Set once the crawl loop has ended: a page abandoned by the watchdog can no longer change the result.
  let sealed = false;
  const send = (e: CrawlEvent) => {
    if (!sealed) emit(e);
  };
  const timeUp = () => Date.now() - started > timeCapMs;
  const halted = () => stop.aborted || timeUp();
  /** A request timeout that does not reach past the time cap (at least 1 s, so a request can complete). */
  const within = (ms: number) => Math.max(1000, Math.min(ms, timeCapMs - (Date.now() - started)));
  const notChecked = (url: string): LinkStatus => ({ url, status: null, redirects: 0, finalUrl: null, error: null, ms: null, method: "skipped", note: signal.aborted ? "Not checked: crawl stopped" : "Not checked: time limit" });
  const skip = (url: string, reason: string) => {
    if (sealed) return;
    const s = { url, reason };
    skips.push(s);
    send({ type: "skip", skip: s });
  };

  /* ------------------------------------------------ robots.txt ------------------------------------------------ */
  const robotsCache = new Map<string, Promise<Robots>>();
  const loadRobots = async (origin: string): Promise<Robots> => {
    const url = `${origin}/robots.txt`;
    const own = registrableDomain(origin) === domain;
    try {
      const { response } = await gate.run(new URL(origin).hostname, () => fetchFollow(url, { ...hop, accept: "text/plain,*/*;q=0.5", maxBytes: 500_000, timeoutMs: within(own ? 10_000 : 7_000), maxRedirects: 5 }));
      if (response.status >= 200 && response.status < 300) {
        const text = decodeBody(response.body, String(response.headers["content-type"] ?? ""));
        const html = /^\s*(<!doctype html|<html)/i.test(text);
        const parser = robotsParser(url, html ? "" : text);
        const delay = html ? undefined : (parser.getCrawlDelay(BOT_TOKEN) ?? parser.getCrawlDelay("*"));
        return { parser, disallowAll: false, found: !html, delayMs: delay ? delay * 1000 : null, error: null, unreachable: null };
      }
      if (response.status >= 400 && response.status < 500) return { parser: robotsParser(url, ""), disallowAll: false, found: false, delayMs: null, error: null, unreachable: null };
      return { parser: null, disallowAll: true, found: false, delayMs: null, error: `robots.txt returned HTTP ${response.status}`, unreachable: null };
    } catch (e) {
      const err = describeFetchError(e);
      return { parser: null, disallowAll: true, found: false, delayMs: null, error: `robots.txt could not be fetched (${err.message})`, unreachable: HARD_FAIL.has(err.code) ? err.message : null };
    }
  };
  const robotsFor = (url: string) => {
    const u = new URL(url);
    let p = robotsCache.get(u.origin);
    if (!p) {
      p = loadRobots(u.origin).then((r) => {
        if (r.delayMs) gate.setGap(u.hostname, Math.min(r.delayMs, MAX_CRAWL_DELAY_MS));
        return r;
      });
      robotsCache.set(u.origin, p);
    }
    return p;
  };
  const allowed = async (url: string) => {
    const r = await robotsFor(url);
    if (r.disallowAll) return false;
    if (r.delayMs && r.delayMs > MAX_CRAWL_DELAY_MS) return false;
    return r.parser?.isAllowed(url, BOT_TOKEN) !== false;
  };


  /* ------------------------------------------------ link checks ------------------------------------------------ */
  // Moving average of one same-host request including the politeness gap (sizes the per-page link budget).
  let hostReqMs = 1200;
  const checkLink = (url: string): Promise<LinkStatus> => {
    const key = normalizeUrl(url) ?? url;
    const hit = linkCache.get(key);
    if (hit) return hit;
    const task = (async (): Promise<LinkStatus> => {
      const base: LinkStatus = { url, status: null, redirects: 0, finalUrl: null, error: null, ms: null, method: "HEAD" };
      if (halted()) return notChecked(url);
      const robots = await robotsFor(url);
      if (halted()) return notChecked(url);
      if (robots.unreachable) return { ...base, method: "GET", error: robots.unreachable };
      if (!(await allowed(url))) return { ...base, method: "skipped", note: robots.disallowAll ? "Not checked: the host's robots.txt is unavailable" : "Not checked: robots.txt disallows it" };
      const host = hostOf(url);
      // Response time of the request(s) themselves, not the time spent waiting for the host's turn.
      let spent = 0;
      const attempt = (method: "HEAD" | "GET") =>
        gate.run(host, async () => {
          const s0 = performance.now();
          try {
            return await fetchFollow(url, { ...hop, method, maxBytes: method === "HEAD" ? 0 : 4096, timeoutMs: within(8_000), maxRedirects: 6 });
          } finally {
            const ms = performance.now() - s0;
            spent += ms;
            if (registrableDomain(url) === domain) hostReqMs = hostReqMs * 0.7 + (ms + gate.gapOf(host)) * 0.3;
          }
        });
      let method: "HEAD" | "GET" = "HEAD";
      try {
        let r: Awaited<ReturnType<typeof attempt>> | null = null;
        try {
          r = await attempt("HEAD");
        } catch (e) {
          if (e instanceof GateStopped || HARD_FAIL.has(describeFetchError(e).code)) throw e;
        }
        // Many servers mishandle HEAD: confirm any failure with a small GET before flagging it.
        if (!r || r.response.status >= 400 || r.loop || r.tooMany) {
          method = "GET";
          r = await attempt("GET");
        }
        const err = r.loop ? "Redirect loop" : r.tooMany ? "Too many redirects" : null;
        return { ...base, method, status: r.response.status, redirects: r.chain.length, finalUrl: r.response.url, error: err, ms: spent };
      } catch (e) {
        // Stopped, or cut short by the time cap: not a fact about the link.
        if (e instanceof GateStopped || halted()) return notChecked(url);
        return { ...base, method, error: e instanceof AppError ? e.message : describeFetchError(e).message, ms: spent || null };
      }
    })();
    linkCache.set(key, task);
    return task;
  };

  /** Links to status-check on a page: up to LINKS_PER_PAGE, with same-site checks sized to the time left. */
  const pickLinks = (hrefs: string[], pageHost: string, index: number) => {
    const pagesLeft = Math.max(1, maxPages - index);
    const perPage = (timeCapMs - (Date.now() - started)) / pagesLeft;
    const sameHostBudget = Math.max(2, Math.min(LINKS_PER_PAGE, Math.floor(perPage / hostReqMs) - 2));
    const out: string[] = [];
    let sameHost = 0;
    for (const u of hrefs) {
      if (out.length >= LINKS_PER_PAGE) break;
      if (linkCache.has(normalizeUrl(u) ?? u)) out.push(u);
      else if (hostOf(u) === pageHost) {
        if (sameHost < sameHostBudget) {
          sameHost++;
          out.push(u);
        }
      } else out.push(u);
    }
    return out;
  };

  /* ------------------------------------------------ pages ------------------------------------------------ */
  /**
   * Fetches a page hop by hop: each hop waits for its host's turn on its own, and the scope and
   * robots.txt check of a redirect target runs between hops, outside the gate. (Checking it inside a
   * gated fetch would deadlock when the target's robots.txt, e.g. http:// → https:// on the same host,
   * has to be fetched through that same host's gate.)
   */
  const fetchPage = async (url: string): Promise<Followed> => {
    const chain: RedirectHop[] = [];
    let current = url;
    for (;;) {
      const at = current;
      const response = await gate.run(hostOf(at), () => fetchHop(at, { ...hop, maxBytes: 2_000_000, timeoutMs: within(15_000) }));
      const location = response.headers.location;
      if (response.status < 300 || response.status >= 400 || !location) return { response, chain, loop: false, tooMany: false, stoppedAt: null };
      let next: string;
      try {
        next = safeUrl(new URL(location, at).toString());
      } catch {
        return { response, chain, loop: false, tooMany: false, stoppedAt: null };
      }
      chain.push({ url: at, status: response.status, location: next });
      if (next === at || chain.some((h) => h.url === next)) return { response, chain, loop: true, tooMany: false, stoppedAt: null };
      if (chain.length >= PAGE_REDIRECTS) return { response, chain, loop: false, tooMany: true, stoppedAt: null };
      if (!(registrableDomain(next) === domain && (await allowed(next)))) return { response, chain, loop: false, tooMany: false, stoppedAt: next };
      current = next;
    }
  };

  const crawlOne = async (item: { url: string; depth: number; from: number | null }) => {
    const index = pages.length;
    send({ type: "fetching", url: item.url, depth: item.depth, done: index });
    const page: PageResult = { index, url: item.url, finalUrl: item.url, depth: item.depth, from: item.from, status: null, timing: { ttfbMs: null, totalMs: null }, redirects: 0, title: "", contentType: null, words: null, blocks: [], touches: [], flags: [], score: null, error: null, linksChecked: 0 };
    const keep = () => {
      if (sealed) return false;
      pages.push(page);
      send({ type: "page", page: snapshotOf(page) });
      return true;
    };
    const addFlag = (f: Flag) => {
      if (sealed) return;
      page.flags.push(f);
      send({ type: "flag", page: index, flag: f });
    };
    const unscored = () => send({ type: "score", page: index, score: { score: null, status: null, keyword: "", top: [], counts: null }, linksChecked: 0 });

    // A URL a link check already found gone (404/410) or failing (5xx) is reported without fetching it
    // again. Other codes (401/403/429/999 bot protection, other 4xx) are not conclusive: fetch the page.
    const known = await linkCache.get(normalizeUrl(item.url) ?? item.url);
    if (known && known.status != null && DEFINITIVE(known.status)) {
      page.status = known.status;
      page.error = `HTTP ${known.status} (from the link check)`;
      if (!keep()) return;
      addFlag({ rule: "http-error", severity: "critical", label: `HTTP ${known.status}: ${item.url}`, blockId: null });
      unscored();
      return;
    }

    const t0 = performance.now();
    let res: Followed;
    try {
      res = await fetchPage(item.url);
    } catch (e) {
      // Stopped, or cut short by the time cap: not an error of the page.
      if (e instanceof GateStopped || halted()) return skip(item.url, signal.aborted ? "Not fetched: crawl stopped" : "Not fetched: time limit");
      page.error = e instanceof AppError ? e.message : describeFetchError(e).message;
      if (!keep()) return;
      addFlag({ rule: "http-error", severity: "critical", label: `${item.url}: ${page.error}`, blockId: null });
      unscored();
      return;
    }
    const r = res.response;
    page.status = r.status;
    page.finalUrl = r.url;
    page.redirects = res.chain.length;
    page.timing = { ttfbMs: Math.round(r.ttfbMs), totalMs: Math.round(performance.now() - t0) };
    page.contentType = String(r.headers["content-type"] ?? "").split(";")[0] || null;
    // Remember the crawled status so links to this URL are not checked again.
    linkCache.set(normalizeUrl(item.url) ?? item.url, Promise.resolve({ url: item.url, status: r.status, redirects: res.chain.length, finalUrl: r.url, error: null, ms: page.timing.totalMs, method: "known" }));

    if (res.stoppedAt) page.error = registrableDomain(res.stoppedAt) === domain ? `Redirects to ${res.stoppedAt}, which robots.txt disallows` : `Redirects outside ${domain} (${res.stoppedAt})`;
    else if (res.loop) page.error = "Redirect loop";
    else if (res.tooMany) page.error = "Too many redirects";
    else if (r.status >= 300 && r.status < 400) page.error = `HTTP ${r.status} without a usable Location header`;
    if (page.error || r.status >= 300) {
      if (!keep()) return;
      if (r.status >= 400) addFlag({ rule: "http-error", severity: "critical", label: `HTTP ${r.status}: ${item.url}`, blockId: null });
      // Internal links lead here, then off the crawl: the destination is not reachable for this crawl.
      else if (res.stoppedAt) addFlag({ rule: "link-redirect", severity: registrableDomain(res.stoppedAt) === domain ? "low" : "medium", label: `${item.url}: ${page.error}`, blockId: null });
      else addFlag({ rule: "http-error", severity: res.loop || res.tooMany ? "critical" : "high", label: `${item.url}: ${page.error}`, blockId: null });
      unscored();
      return;
    }
    if (res.chain.length && normalizeUrl(r.url) !== normalizeUrl(item.url) && !queue.mark(r.url)) {
      skip(item.url, `Redirects to ${r.url}, which was already crawled`);
      return;
    }
    if (page.contentType && !/html/i.test(page.contentType)) {
      skip(item.url, `Not an HTML page (${page.contentType})`);
      return;
    }

    const html = decodeBody(r.body, String(r.headers["content-type"] ?? ""));
    const { facts, markdown } = extractPage(html, r.url, r.status, r.headers, domain, { images: true });
    page.title = facts.title;
    page.words = facts.words;
    page.blocks = extractBlocks(html, r.url, r.headers);
    if (!keep()) return;

    const flags = inspectPage(
      { url: r.url, status: r.status, title: facts.title, metaDescription: facts.metaDescription, lang: facts.lang, viewport: facts.viewport, noindex: facts.noindex, robots: facts.robots, canonical: facts.canonical, h1Count: facts.h1s.length, words: facts.words, ttfbMs: page.timing.ttfbMs },
      page.blocks,
    );

    // Status checks of up to LINKS_PER_PAGE distinct links, 4 in flight (each host stays one at a time).
    // Same-site checks are budgeted so every requested page fits in the time cap.
    const linkUrls = pickLinks([...new Set(page.blocks.filter((b) => b.tag === "a" && b.href).map((b) => b.href!))], hostOf(r.url), index);
    const limit = limiter(4);
    const checks = new Map(linkUrls.map((u) => [u, limit(() => checkLink(u))]));
    page.linksChecked = linkUrls.length;

    // The spider walks the page in document order; link touches wait for their status check, or until
    // the time cap passes (outstanding checks are then reported as not checked).
    for (const b of page.blocks) {
      if (signal.aborted || sealed) break;
      let status: LinkStatus | null = null;
      const check = b.tag === "a" && b.href ? checks.get(b.href) : undefined;
      if (check) status = await Promise.race([check, stopped.then(() => notChecked(b.href!))]);
      if (sealed) break;
      const own = [...flags.filter((f) => f.blockId === b.id), ...(status ? linkFlags(b.id, status) : [])];
      if (b.tag === "a" && !own.length && !status) continue; // unchecked, clean links are not touched
      for (const f of own) addFlag(f);
      const touch = touchFor(b, own, status);
      page.touches.push(touch);
      send({ type: "touch", page: index, touch });
    }
    for (const f of flags.filter((x) => x.blockId === null)) addFlag(f);

    // Discover internal links to queue (followable links of indexable-follow pages only).
    if (!/(^|[\s,])(nofollow|none)([\s,]|$)/i.test(facts.robots) && item.depth < MAX_DEPTH) {
      const added: { url: string; depth: number; from: number }[] = [];
      for (const l of parseLinks(html, r.url, domain)) {
        if (!l.follow) continue;
        const q = queue.offer(l.target, item.depth + 1, index);
        if (q) added.push({ url: q.url, depth: q.depth, from: index });
      }
      if (added.length) send({ type: "queue", added: added.slice(0, 60), queued: queue.size });
    }

    if (sealed) return;
    const score = scorePage({ url: r.url, title: facts.title, metaDescription: facts.metaDescription, canonical: facts.canonical, robots: facts.robots || asString(r.headers["x-robots-tag"]), schema: jsonLdOf(html), markdown, h1: facts.h1s[0] });
    page.score = score;
    send({ type: "score", page: index, score, linksChecked: page.linksChecked });
  };

  try {
    const startRobots = await robotsFor(startUrl);
    if (startRobots.disallowAll) throw new AppError(`${startRobots.error ?? "robots.txt is unavailable"}: crawling is deferred, as search engines do.`);
    if (startRobots.delayMs && startRobots.delayMs > MAX_CRAWL_DELAY_MS) throw new AppError(`The site asks for a Crawl-delay of ${Math.round(startRobots.delayMs / 1000)} s, too slow for a live crawl. Use Site Audit for this site.`);
    if (!(await allowed(startUrl))) throw new AppError(`robots.txt disallows SynapseSEOBot from crawling ${startUrl}.`);

    send({
      type: "start",
      id,
      startUrl,
      domain,
      maxPages,
      maxDepth: MAX_DEPTH,
      crawlDelayMs: gate.gapOf(hostOf(startUrl)),
      robots: startRobots.found ? "found" : "missing",
      startedAt: new Date(started).toISOString(),
      timeCapMs,
    });
    queue.offer(startUrl, 0, null);

    while (pages.length < maxPages) {
      if (signal.aborted) {
        stopReason = "Stopped before finishing";
        break;
      }
      if (halted()) {
        stopReason = `Time limit reached (${Math.round(timeCapMs / 1000)} s)`;
        break;
      }
      const item = queue.take();
      if (!item) {
        stopReason = pages.length <= 1 ? "No crawlable internal links were found on the start page" : "Every reachable URL within depth 3 was crawled";
        break;
      }
      const ok = await allowed(item.url);
      if (halted()) continue; // the loop's first checks record why it stops
      if (!ok) {
        skip(item.url, "Disallowed by robots.txt");
        continue;
      }
      // Watchdog: a page still busy shortly after the time cap or Stop (e.g. a request that cannot be
      // interrupted) is left behind; `sealed` keeps it from changing the result afterwards.
      const work = crawlOne(item);
      work.catch(() => undefined);
      await Promise.race([work, stopped.then(() => sleep(WRAP_UP_MS))]);
    }
    if (!stopReason && pages.length >= maxPages) stopReason = `Page limit reached (${maxPages})`;
  } finally {
    sealed = true;
    clearTimeout(capTimer);
    // Releases anything still waiting for a host's turn, then closes open connections.
    capped.abort();
    agents.http.destroy();
    agents.https.destroy();
  }
  const status: CrawlStatus = signal.aborted ? "cancelled" : "done";
  const summary = summarizeCrawl(pages, skips, Date.now() - started, stopReason);
  emit({ type: "summary", summary });
  return { status, domain, pages, skips, summary };
}
