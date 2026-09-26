import { gunzipSync } from "node:zlib";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { decodeBody, describeFetchError, fetchFollow, type HopOptions } from "@/lib/crawler";
import type { SiteFacts } from "./types";
import { normalizeUrl, registrable, hostOf } from "./url";

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  isArray: (name) => name === "url" || name === "sitemap",
  processEntities: true,
  htmlEntities: false,
  parseTagValue: false,
  trimValues: true,
});

type SitemapFile = SiteFacts["sitemaps"][number];

/**
 * Fetches and parses sitemaps (urlset + sitemap index, gzip supported). Follows at most `maxFiles`
 * files within the audited registrable domain. Returns per-file diagnostics and the URL set.
 */
export async function loadSitemaps(opts: {
  candidates: { url: string; fromRobots: boolean }[];
  domain: string;
  hop: HopOptions;
  wait: (url: string) => Promise<void>;
  maxFiles?: number;
  maxUrls?: number;
  cancelled?: () => boolean;
}) {
  const maxFiles = opts.maxFiles ?? 25;
  const maxUrls = opts.maxUrls ?? 50_000;
  const files: SitemapFile[] = [];
  const urls = new Map<string, { lastmod: string | null; sitemap: string }>();
  const foreign: string[] = [];
  const queue = [...opts.candidates];
  const visited = new Set<string>();

  while (queue.length && files.length < maxFiles && !opts.cancelled?.()) {
    const item = queue.shift()!;
    if (visited.has(item.url)) continue;
    visited.add(item.url);
    const file: SitemapFile = { url: item.url, status: null, kind: "missing", urls: 0, bytes: 0, errors: [], fromRobots: item.fromRobots };
    files.push(file);
    if (registrable(hostOf(item.url)) !== opts.domain) {
      file.errors.push("Hosted on another domain (cross-submitted); not fetched by this audit.");
      continue;
    }
    try {
      await opts.wait(item.url);
      const { response } = await fetchFollow(item.url, {
        ...opts.hop,
        accept: "application/xml,text/xml;q=0.9,*/*;q=0.5",
        maxBytes: 20_000_000,
        maxRedirects: 5,
        timeoutMs: 30000,
        beforeHop: async (next) => {
          if (registrable(hostOf(next)) !== opts.domain) return false;
          await opts.wait(next);
        },
      });
      file.status = response.status;
      file.bytes = response.bytes;
      if (response.status !== 200) {
        file.kind = "missing";
        if (response.status >= 300 && response.status < 400) file.errors.push(`Redirects to ${response.headers.location ?? "another URL"}.`);
        continue;
      }
      let buf = response.body;
      if (buf[0] === 0x1f && buf[1] === 0x8b) {
        try {
          buf = gunzipSync(buf, { maxOutputLength: 60_000_000 });
        } catch {
          file.kind = "invalid";
          file.errors.push("Gzip-compressed sitemap could not be decompressed.");
          continue;
        }
      }
      file.bytes = buf.length;
      if (buf.length > 50 * 1024 * 1024) file.errors.push("File exceeds 50 MB uncompressed.");
      if (response.truncated) file.errors.push("File was larger than 20 MB; only the first 20 MB were read.");
      const text = decodeBody(buf, String(response.headers["content-type"] || "")).replace(/^﻿/, "");
      const valid = XMLValidator.validate(text);
      if (valid !== true) {
        file.kind = "invalid";
        file.errors.push(`XML error at line ${valid.err.line}: ${valid.err.msg}`);
        if (/^\s*<!doctype html|^\s*<html/i.test(text)) file.errors.splice(-1, 1, "The URL returns an HTML page, not XML.");
        continue;
      }
      const doc = parser.parse(text) as Record<string, any>;
      if (doc.urlset) {
        file.kind = "urlset";
        const entries: any[] = doc.urlset.url ?? [];
        file.urls = entries.length;
        if (entries.length > 50_000) file.errors.push(`Lists ${entries.length.toLocaleString()} URLs (maximum is 50,000).`);
        let missingLoc = 0;
        for (const e of entries) {
          const loc = typeof e?.loc === "string" ? e.loc.trim() : null;
          if (!loc) {
            missingLoc++;
            continue;
          }
          const u = normalizeUrl(loc);
          if (!u) {
            file.errors.push(`Invalid URL: ${loc.slice(0, 120)}`);
            continue;
          }
          if (registrable(hostOf(u)) !== opts.domain) {
            if (foreign.length < 50) foreign.push(u);
            continue;
          }
          if (urls.size < maxUrls && !urls.has(u)) urls.set(u, { lastmod: typeof e?.lastmod === "string" ? e.lastmod : null, sitemap: item.url });
        }
        if (missingLoc) file.errors.push(`${missingLoc} <url> entries have no <loc>.`);
      } else if (doc.sitemapindex) {
        file.kind = "index";
        const entries: any[] = doc.sitemapindex.sitemap ?? [];
        file.urls = entries.length;
        for (const e of entries) {
          const loc = typeof e?.loc === "string" ? normalizeUrl(e.loc.trim()) : null;
          if (loc && !visited.has(loc)) queue.push({ url: loc, fromRobots: false });
        }
      } else {
        file.kind = "invalid";
        file.errors.push("Root element must be <urlset> or <sitemapindex>.");
      }
      file.errors = file.errors.slice(0, 12);
    } catch (e) {
      file.kind = "missing";
      file.errors.push(describeFetchError(e).message);
    }
  }
  return { files, urls, foreign };
}
