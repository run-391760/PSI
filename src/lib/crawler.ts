import { lookup } from "node:dns/promises";
import https from "node:https";
import http from "node:http";
import { TLSSocket } from "node:tls";
import zlib from "node:zlib";
import ipaddr from "ipaddr.js";
import { load } from "cheerio";
import robotsParser from "robots-parser";
import { AppError, matchesDomain, safeUrl } from "./domain";

/**
 * SSRF-safe fetching for the crawler-based tools. Every request: public unicast IPs only (checked
 * after DNS resolution and pinned at connect time so DNS rebinding cannot bypass it), standard ports,
 * no credentials, size and time limits, and every redirect hop is re-validated.
 */

/** Product token used for robots.txt group matching. */
export const BOT_TOKEN = "SynapseSEOBot/1.0";
const AGENT = "SynapseSEOBot/1.0 (+https://synapseseo.local/bot)";
export { AGENT };
/** Honest user agents for the Site Audit crawler (desktop / smartphone rendering hints). */
export const USER_AGENTS = {
  desktop: "Mozilla/5.0 (compatible; SynapseSEOBot/1.0; +https://synapseseo.local/bot)",
  mobile: "Mozilla/5.0 (Linux; Android 10; Mobile) (compatible; SynapseSEOBot/1.0; +https://synapseseo.local/bot)",
} as const;

export function isPublicAddress(address: string) {
  try {
    return ipaddr.process(address).range() === "unicast";
  } catch {
    return false;
  }
}

type Resolved = { address: string; family: number };
/**
 * Resolves a hostname and rejects it unless every address is public. Pass a per-crawl `cache` to
 * avoid repeated lookups (the cached value was validated when it was stored).
 */
export async function resolvePublic(hostname: string, cache?: Map<string, Promise<Resolved>>): Promise<Resolved> {
  const host = hostname.replace(/^\[|\]$/g, "");
  const hit = cache?.get(host);
  if (hit) return hit;
  const task = (async () => {
    const addresses = await lookup(host, { all: true });
    if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address)))
      throw new AppError("Private, local, and reserved network addresses are blocked.");
    return { address: addresses[0].address, family: addresses[0].family };
  })();
  cache?.set(host, task);
  return task;
}
const pinnedLookup = (resolved: Resolved) =>
  ((_host: string, opts: { all?: boolean }, cb: (...args: any[]) => void) =>
    opts?.all ? cb(null, [{ address: resolved.address, family: resolved.family }]) : cb(null, resolved.address, resolved.family)) as any;

export async function fetchPublic(
  input: string,
  redirects = 0,
  beforeRedirect?: (url: string) => Promise<void>,
): Promise<{
  url: string;
  status: number;
  body: string;
  headers: http.IncomingHttpHeaders;
}> {
  if (redirects > 4) throw new AppError("Too many redirects.");
  const url = new URL(safeUrl(input));
  const resolved = await resolvePublic(url.hostname);
  // Pin the checked IP at connection time so DNS changes cannot bypass validation.
  const result = await new Promise<{
    status: number;
    headers: http.IncomingHttpHeaders;
    body: string;
  }>((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const request = client.get(
      url,
      {
        headers: {
          "User-Agent": AGENT,
          Accept: "text/html,text/plain",
          "Accept-Encoding": "identity",
        },
        lookup: pinnedLookup(resolved),
      },
      (response) => {
        let length = 0;
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => {
          length += chunk.length;
          if (length > 2_000_000) request.destroy(new AppError("Page exceeds the 2 MB crawl limit."));
          else chunks.push(chunk);
        });
        response.on("end", () =>
          resolve({
            status: response.statusCode || 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
        response.on("error", reject);
      },
    );
    const timer = setTimeout(() => request.destroy(new AppError("Crawl timed out.")), 15000);
    request.on("close", () => clearTimeout(timer));
    request.on("error", reject);
  });
  if ([301, 302, 303, 307, 308].includes(result.status) && result.headers.location) {
    const next = new URL(result.headers.location, url).toString();
    if (beforeRedirect) await beforeRedirect(next);
    return fetchPublic(next, redirects + 1, beforeRedirect);
  }
  return { ...result, url: url.toString() };
}

/* ------------------------------------------------------------------------------------------------ */
/* Low-level single-hop fetch (used by Site Audit; also safe for other tools).                        */
/* ------------------------------------------------------------------------------------------------ */

export type HopOptions = {
  method?: "GET" | "HEAD";
  userAgent?: string;
  accept?: string;
  /** Max decoded body bytes kept; the rest is dropped and `truncated` is set. 0 = headers only. */
  maxBytes?: number;
  timeoutMs?: number;
  /** Request gzip/deflate/br and decode (default true). */
  compressed?: boolean;
  dnsCache?: Map<string, Promise<Resolved>>;
  /** Keep-alive agents shared by one crawl (politer: fewer TLS handshakes). */
  agents?: { http: http.Agent; https: https.Agent };
  /** Capture TLS protocol and certificate details (https only). */
  tlsInfo?: boolean;
};
export type TlsInfo = { protocol: string | null; validTo: string | null; validFrom: string | null; subject: string | null; issuer: string | null; altNames: string | null };
export type HopResult = {
  url: string;
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  truncated: boolean;
  /** Decoded body bytes received (capped by maxBytes). */
  bytes: number;
  /** Raw bytes on the wire. */
  transferBytes: number;
  timeMs: number;
  ttfbMs: number;
  tls?: TlsInfo;
};

/** One HTTP request without following redirects. Throws AppError/network errors (see describeFetchError). */
export async function fetchHop(input: string, opts: HopOptions = {}): Promise<HopResult> {
  const url = new URL(safeUrl(input));
  const resolved = await resolvePublic(url.hostname, opts.dnsCache);
  const method = opts.method ?? "GET";
  const maxBytes = opts.maxBytes ?? 2_000_000;
  const timeoutMs = opts.timeoutMs ?? 15000;
  const started = performance.now();
  return new Promise<HopResult>((resolve, reject) => {
    const isHttps = url.protocol === "https:";
    const client = isHttps ? https : http;
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      fn();
    };
    const request = client.request(
      url,
      {
        method,
        headers: {
          "User-Agent": opts.userAgent ?? AGENT,
          Accept: opts.accept ?? "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
          "Accept-Encoding": opts.compressed === false ? "identity" : "gzip, deflate, br",
          "Accept-Language": "en;q=0.9,*;q=0.5",
        },
        // Certificate details are only available on a full handshake, so TLS probes skip session reuse.
        agent: opts.tlsInfo && isHttps ? new https.Agent({ maxCachedSessions: 0, keepAlive: false }) : opts.agents ? (isHttps ? opts.agents.https : opts.agents.http) : undefined,
        lookup: pinnedLookup(resolved),
      },
      (response) => {
        const ttfbMs = performance.now() - started;
        let tls: TlsInfo | undefined;
        if (opts.tlsInfo && response.socket instanceof TLSSocket) {
          const cert = response.socket.getPeerCertificate();
          tls = {
            protocol: response.socket.getProtocol() ?? null,
            validTo: cert?.valid_to ? new Date(cert.valid_to).toISOString() : null,
            validFrom: cert?.valid_from ? new Date(cert.valid_from).toISOString() : null,
            subject: (cert?.subject?.CN as string | undefined) ?? null,
            issuer: (cert?.issuer?.O as string | undefined) ?? (cert?.issuer?.CN as string | undefined) ?? null,
            altNames: cert?.subjectaltname ?? null,
          };
        }
        const base = { url: url.toString(), status: response.statusCode || 0, headers: response.headers, ttfbMs, tls };
        if (method === "HEAD" || maxBytes <= 0) {
          settle(() => resolve({ ...base, body: Buffer.alloc(0), truncated: maxBytes <= 0 && method !== "HEAD", bytes: 0, transferBytes: 0, timeMs: performance.now() - started }));
          if (method === "HEAD") response.resume();
          else request.destroy();
          return;
        }
        let transferBytes = 0;
        response.on("data", (c: Buffer) => (transferBytes += c.length));
        const encoding = String(response.headers["content-encoding"] || "").toLowerCase().trim();
        let stream: NodeJS.ReadableStream = response;
        if (encoding === "gzip" || encoding === "x-gzip") stream = response.pipe(zlib.createGunzip());
        else if (encoding === "deflate") stream = response.pipe(zlib.createInflate());
        else if (encoding === "br") stream = response.pipe(zlib.createBrotliDecompress());
        const chunks: Buffer[] = [];
        let bytes = 0;
        let truncated = false;
        const finish = () => settle(() => resolve({ ...base, body: Buffer.concat(chunks), truncated, bytes, transferBytes, timeMs: performance.now() - started }));
        stream.on("data", (chunk: Buffer) => {
          if (truncated) return;
          const room = maxBytes - bytes;
          if (chunk.length >= room) {
            chunks.push(chunk.subarray(0, room));
            bytes += room;
            truncated = true;
            finish();
            request.destroy();
          } else {
            chunks.push(chunk);
            bytes += chunk.length;
          }
        });
        stream.on("end", finish);
        stream.on("error", (e: Error) => (bytes > 0 ? finish() : settle(() => reject(e))));
        response.on("aborted", () => (bytes > 0 ? finish() : settle(() => reject(new AppError("Connection closed before the response finished.")))));
      },
    );
    timer = setTimeout(() => {
      request.destroy(Object.assign(new AppError(`Timed out after ${Math.round(timeoutMs / 1000)} s.`, 504), { code: "TIMEOUT" }));
    }, timeoutMs);
    request.on("error", (e) => settle(() => reject(e)));
    request.end();
  });
}

export type RedirectHop = { url: string; status: number; location: string };
/**
 * Follows redirects hop by hop (each hop re-validated by fetchHop). `beforeHop` may veto a hop
 * (e.g. robots.txt disallows it or it leaves the crawl scope); the result then stops at that URL.
 */
export async function fetchFollow(
  input: string,
  opts: HopOptions & { maxRedirects?: number; beforeHop?: (url: string, hop: number) => Promise<boolean | void> } = {},
): Promise<{ response: HopResult; chain: RedirectHop[]; loop: boolean; tooMany: boolean; stoppedAt: string | null }> {
  const max = opts.maxRedirects ?? 10;
  const chain: RedirectHop[] = [];
  let current = input;
  for (let hop = 0; ; hop++) {
    const response = await fetchHop(current, opts);
    const location = response.headers.location;
    if (response.status >= 300 && response.status < 400 && location) {
      let next: string;
      try {
        next = safeUrl(new URL(location, current).toString());
      } catch {
        return { response, chain, loop: false, tooMany: false, stoppedAt: null };
      }
      chain.push({ url: current, status: response.status, location: next });
      if (next === current || chain.some((h) => h.url === next)) return { response, chain, loop: true, tooMany: false, stoppedAt: null };
      if (chain.length >= max) return { response, chain, loop: false, tooMany: true, stoppedAt: null };
      if (opts.beforeHop && (await opts.beforeHop(next, hop + 1)) === false) return { response, chain, loop: false, tooMany: false, stoppedAt: next };
      current = next;
      continue;
    }
    return { response, chain, loop: false, tooMany: false, stoppedAt: null };
  }
}

/** Human-readable reason for a failed request. */
export function describeFetchError(error: unknown): { code: string; message: string } {
  const e = error as { code?: string; message?: string };
  const code = e?.code ?? (error instanceof AppError ? "BLOCKED" : "ERROR");
  const messages: Record<string, string> = {
    ENOTFOUND: "DNS lookup failed (host not found).",
    EAI_AGAIN: "DNS lookup timed out.",
    ECONNREFUSED: "Connection refused.",
    ECONNRESET: "Connection reset by the server.",
    ETIMEDOUT: "Connection timed out.",
    EHOSTUNREACH: "Host unreachable.",
    CERT_HAS_EXPIRED: "TLS certificate has expired.",
    ERR_TLS_CERT_ALTNAME_INVALID: "TLS certificate does not match the host name.",
    DEPTH_ZERO_SELF_SIGNED_CERT: "TLS certificate is self-signed.",
    SELF_SIGNED_CERT_IN_CHAIN: "TLS certificate chain contains a self-signed certificate.",
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: "TLS certificate chain is incomplete.",
    UNABLE_TO_GET_ISSUER_CERT_LOCALLY: "TLS certificate issuer is unknown.",
    HPE_INVALID_CONSTANT: "Malformed HTTP response.",
    ERR_SSL_WRONG_VERSION_NUMBER: "TLS handshake failed.",
  };
  return { code, message: messages[code] ?? e?.message ?? "Request failed." };
}
export const isTlsError = (code: string) => /CERT|TLS|SSL|SIGNATURE|ISSUER/i.test(code);

/** Decode a body using the declared charset (header or <meta>), falling back to UTF-8. */
export function decodeBody(body: Buffer, contentType?: string | null) {
  let charset = /charset=["']?([\w-]+)/i.exec(contentType || "")?.[1];
  if (!charset) {
    const head = body.subarray(0, 2048).toString("latin1");
    charset = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1];
  }
  try {
    return new TextDecoder((charset || "utf-8").toLowerCase(), { fatal: false }).decode(body);
  } catch {
    return new TextDecoder("utf-8").decode(body);
  }
}

/* ------------------------------------------------------------------------------------------------ */
/* Single-page helpers used by other tools (unchanged API).                                           */
/* ------------------------------------------------------------------------------------------------ */

const crawlTimes = new Map<string, number>();
async function checkRobots(input: string) {
  const url = new URL(safeUrl(input));
  const robots = await fetchPublic(new URL("/robots.txt", url).toString());
  if (robots.status !== 404 && robots.status !== 410 && robots.status !== 200) throw new AppError("robots.txt is unavailable; crawl deferred.");
  const parser = robotsParser(new URL("/robots.txt", url).toString(), robots.status === 200 ? robots.body : "");
  if (parser.isAllowed(url.toString(), AGENT) === false) throw new AppError("Crawling is disallowed by robots.txt.");
  const delay = Math.max(1000, (parser.getCrawlDelay(AGENT) || 0) * 1000);
  if (delay > 15000) throw new AppError("Site crawl-delay exceeds this worker's window; crawl deferred.");
  const wait = Math.max(0, (crawlTimes.get(url.origin) || 0) + delay - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  crawlTimes.set(url.origin, Date.now());
}
export async function crawlPage(input: string) {
  await checkRobots(input);
  return fetchPublic(input, 0, checkRobots);
}
export function parseLinks(html: string, pageUrl: string, domain: string) {
  const $ = load(html);
  const links: {
    target: string;
    anchor: string;
    rel: string[];
    follow: boolean;
    sponsored: boolean;
    ugc: boolean;
  }[] = [];
  $("a[href]").each((_, a) => {
    try {
      const target = safeUrl(new URL($(a).attr("href")!, pageUrl).toString());
      if (!matchesDomain(target, domain)) return;
      const rel = ($(a).attr("rel") || "").toLowerCase().split(/\s+/).filter(Boolean);
      links.push({
        target,
        anchor: $(a).text().trim().slice(0, 1000),
        rel,
        follow: !rel.includes("nofollow"),
        sponsored: rel.includes("sponsored"),
        ugc: rel.includes("ugc"),
      });
    } catch {
      /* Non-HTTP links are not crawl targets. */
    }
  });
  return links;
}
export function auditHtml(html: string, url: string, headers: http.IncomingHttpHeaders = {}) {
  const $ = load(html);
  const title = $("title").first().text().trim();
  const description = $("meta[name='description']").attr("content") || "";
  const robots = [$("meta[name='robots']").attr("content"), headers["x-robots-tag"]].filter(Boolean).join(",");
  const structured: string[] = [];
  let invalidJsonLd = 0;
  const visit = (v: any) => {
    if (!v || typeof v !== "object") return;
    if (v["@type"]) structured.push(...[v["@type"]].flat().map(String));
    Object.values(v).forEach((x) => {
      if (typeof x === "object") Array.isArray(x) ? x.forEach(visit) : visit(x);
    });
  };
  $("script[type='application/ld+json']").each((_, el) => {
    try {
      visit(JSON.parse($(el).text()));
    } catch {
      invalidJsonLd++;
    }
  });
  const h1s = $("h1")
    .map((_, el) => $(el).text().trim())
    .get();
  const canonical = $("link[rel='canonical']").attr("href") || null;
  $("script,style,nav,footer,header").remove();
  const words = $("body").text().trim().split(/\s+/).filter(Boolean).length;
  return {
    url,
    title,
    description,
    canonical,
    h1s,
    words,
    structured: [...new Set(structured)],
    invalidJsonLd,
    robots,
    checks: [
      { name: "Page title", passed: !!title, action: "Write a unique title that describes the page." },
      { name: "Meta description", passed: !!description, action: "Add a specific, useful page summary." },
      { name: "Main heading", passed: h1s.length === 1, action: "Use one clear main heading for readers." },
      { name: "Canonical declared", passed: !!canonical, action: "Review the preferred URL and declare a canonical where appropriate." },
      {
        name: "No noindex directive detected",
        passed: !/(^|[\s,])(noindex|none)([\s,]|$)/i.test(robots),
        action: "Remove noindex only if this page should appear in search.",
      },
      { name: "JSON-LD syntax", passed: invalidJsonLd === 0, action: "Repair invalid JSON-LD and validate applicable schemas." },
      { name: "HTML text present", passed: words > 0, action: "Serve meaningful text in the HTML; review JavaScript rendering if needed." },
    ],
  };
}
