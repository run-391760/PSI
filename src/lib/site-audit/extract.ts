import { createHash } from "node:crypto";
import { load } from "cheerio";
import type { HtmlFacts } from "./types";
import { normalizeUrl } from "./url";

export type ExtractedLink = { target: string; anchor: string; nofollow: boolean; rel?: string; kind: "a" | "img" | "script" | "css" };
export type Extracted = { facts: HtmlFacts; links: ExtractedLink[]; hreflangTargets: string[] };

const ws = (s: string | undefined | null) => (s ?? "").replace(/\s+/g, " ").trim();

/** 64-bit SimHash of word 3-shingles (hex). Near-duplicates differ in few bits. */
export function simhash(text: string) {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const v = new Array(64).fill(0);
  const n = Math.max(1, words.length - 2);
  for (let i = 0; i < n; i++) {
    const shingle = words.slice(i, i + 3).join(" ");
    const h = createHash("md5").update(shingle).digest();
    for (let b = 0; b < 64; b++) {
      const bit = (h[b >> 3] >> (b & 7)) & 1;
      v[b] += bit ? 1 : -1;
    }
  }
  let hex = "";
  for (let nib = 0; nib < 16; nib++) {
    let x = 0;
    for (let k = 0; k < 4; k++) if (v[nib * 4 + k] > 0) x |= 1 << k;
    hex += x.toString(16);
  }
  return hex;
}
const fnv1a = (s: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};
const mix32 = (x: number) => {
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
};
const MINHASH_K = 64;
const SEEDS = Array.from({ length: MINHASH_K }, (_, k) => mix32(k * 0x9e3779b1 + 1));
/** 64-value MinHash of unique word 3-shingles (hex). Estimates Jaccard similarity between pages. */
export function minhash(text: string) {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const shingles = new Set<number>();
  for (let i = 0; i < Math.max(1, words.length - 2); i++) shingles.add(fnv1a(words.slice(i, i + 3).join(" ")));
  const mins = new Array(MINHASH_K).fill(0xffffffff);
  for (const h of shingles) for (let k = 0; k < MINHASH_K; k++) {
    const v = mix32(h ^ SEEDS[k]);
    if (v < mins[k]) mins[k] = v;
  }
  return mins.map((m) => m.toString(16).padStart(8, "0")).join("");
}
export function jaccardEstimate(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return 0;
  let same = 0;
  for (let i = 0; i < a.length; i += 8) if (a.slice(i, i + 8) === b.slice(i, i + 8)) same++;
  return same / (a.length / 8);
}
export function hamming(a: string, b: string) {
  let d = 0;
  for (let i = 0; i < 16; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

/**
 * Parses one HTML document into the facts the audit checks need. `isInternal` decides whether a
 * URL belongs to the audited site.
 */
export function extractHtml(html: string, pageUrl: string, contentType: string | null, isInternal: (url: string) => boolean): Extracted {
  const $ = load(html);
  const baseHref = $("base[href]").attr("href");
  let base = pageUrl;
  try {
    if (baseHref) base = new URL(baseHref, pageUrl).toString();
  } catch {
    /* keep page URL */
  }
  const abs = (href: string | undefined) => (href ? normalizeUrl(href.trim(), base) : null);
  const isHttps = pageUrl.startsWith("https:");

  const titles = $("title").filter((_, el) => $(el).parents("svg").length === 0).toArray();
  const title = titles.length ? ws($(titles[0]).text()) : null;
  const descEls = $("meta[name]").filter((_, el) => ($(el).attr("name") || "").toLowerCase() === "description");
  const description = descEls.length ? ws(descEls.first().attr("content")) : null;

  const canonicalEls = $("link[rel]").filter((_, el) => ($(el).attr("rel") || "").toLowerCase().split(/\s+/).includes("canonical"));
  const canonicalsRaw = canonicalEls.map((_, el) => ($(el).attr("href") ?? "").trim()).get();
  const canonicals = canonicalsRaw.map((h) => (h ? (abs(h) ?? `invalid:${h}`) : "invalid:"));

  const robotsMeta = $("meta[name]")
    .filter((_, el) => ["robots", "googlebot"].includes(($(el).attr("name") || "").toLowerCase()))
    .map((_, el) => $(el).attr("content") || "")
    .get()
    .join(", ")
    .toLowerCase();

  const hreflang = $("link[rel][hreflang]")
    .filter((_, el) => ($(el).attr("rel") || "").toLowerCase().split(/\s+/).includes("alternate"))
    .map((_, el) => {
      const raw = ($(el).attr("href") || "").trim();
      return { lang: ($(el).attr("hreflang") || "").trim(), href: abs(raw), raw };
    })
    .get();

  const lang = ws($("html").attr("lang")) || null;
  const viewport = $("meta[name]").filter((_, el) => ($(el).attr("name") || "").toLowerCase() === "viewport").attr("content") ?? null;
  const charsetMeta =
    $("meta[charset]").attr("charset") ??
    /charset=([\w-]+)/i.exec($("meta[http-equiv]").filter((_, el) => ($(el).attr("http-equiv") || "").toLowerCase() === "content-type").attr("content") || "")?.[1] ??
    null;
  const charset = charsetMeta || /charset=["']?([\w-]+)/i.exec(contentType || "")?.[1] || null;
  const doctype = /^\s*(?:<!--[\s\S]*?-->\s*)*<!doctype\s+html/i.test(html.replace(/^﻿/, ""));
  const metaRefresh = $("meta[http-equiv]").filter((_, el) => ($(el).attr("http-equiv") || "").toLowerCase() === "refresh").attr("content") ?? null;

  // Structured data.
  const jsonLdTypes: string[] = [];
  const jsonLdErrors: string[] = [];
  const visit = (v: unknown, top: boolean) => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) return v.forEach((x) => visit(x, top));
    const o = v as Record<string, unknown>;
    if (o["@type"]) jsonLdTypes.push(...[o["@type"]].flat().map(String));
    Object.entries(o).forEach(([k, x]) => k !== "@context" && typeof x === "object" && visit(x, false));
  };
  const ldScripts = $("script").filter((_, el) => ($(el).attr("type") || "").toLowerCase().trim() === "application/ld+json");
  ldScripts.each((i, el) => {
    const text = $(el).text().trim();
    if (!text) return void jsonLdErrors.push(`Block ${i + 1}: empty script`);
    try {
      const data = JSON.parse(text);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (!item || typeof item !== "object") {
          jsonLdErrors.push(`Block ${i + 1}: not an object`);
          continue;
        }
        const graph = (item as Record<string, unknown>)["@graph"];
        if (!(item as Record<string, unknown>)["@context"]) jsonLdErrors.push(`Block ${i + 1}: missing @context`);
        if (!(item as Record<string, unknown>)["@type"] && !Array.isArray(graph)) jsonLdErrors.push(`Block ${i + 1}: missing @type`);
      }
      visit(data, true);
    } catch (e) {
      jsonLdErrors.push(`Block ${i + 1}: ${(e as Error).message.slice(0, 120)}`);
    }
  });
  const microdata = [
    ...new Set(
      $("[itemtype]")
        .map((_, el) => ($(el).attr("itemtype") || "").split("/").pop() || "")
        .get()
        .filter(Boolean),
    ),
  ];

  const meta = (prefix: string, attr: "property" | "name") => {
    const out: Record<string, string> = {};
    $(`meta[${attr}]`).each((_, el) => {
      const k = ($(el).attr(attr) || "").toLowerCase();
      if (k.startsWith(prefix) && !(k in out)) out[k.slice(prefix.length)] = ws($(el).attr("content")).slice(0, 300);
    });
    return out;
  };
  const og = meta("og:", "property");
  Object.assign(og, Object.fromEntries(Object.entries(meta("og:", "name")).filter(([k]) => !(k in og))));
  const twitter = meta("twitter:", "name");
  Object.assign(twitter, Object.fromEntries(Object.entries(meta("twitter:", "property")).filter(([k]) => !(k in twitter))));

  // Links.
  const links: ExtractedLink[] = [];
  let internalLinks = 0,
    externalLinks = 0,
    nofollowInternal = 0,
    nofollowExternal = 0,
    emptyAnchors = 0,
    httpLinks = 0;
  const uniqInt = new Set<string>();
  const uniqExt = new Set<string>();
  $("a[href], area[href]").each((_, el) => {
    const href = ($(el).attr("href") || "").trim();
    if (!href || href.startsWith("#") || /^(javascript|mailto|tel|sms|data|ftp|file):/i.test(href)) return;
    const target = abs(href);
    if (!target) return;
    const rel = ($(el).attr("rel") || "").toLowerCase().split(/\s+/);
    const nofollow = rel.includes("nofollow");
    const text = ws($(el).text()) || ws($(el).find("img[alt]").first().attr("alt")) || ws($(el).attr("aria-label")) || ws($(el).attr("title"));
    if (!text) emptyAnchors++;
    const internal = isInternal(target);
    if (internal) {
      internalLinks++;
      uniqInt.add(target);
      if (nofollow) nofollowInternal++;
      if (isHttps && target.startsWith("http:")) httpLinks++;
    } else {
      externalLinks++;
      uniqExt.add(target);
      if (nofollow) nofollowExternal++;
    }
    links.push({ target, anchor: text.slice(0, 200), nofollow, rel: rel.filter(Boolean).join(" ").slice(0, 100), kind: "a" });
  });

  // Images and resources.
  const imgs = $("img");
  let missingAlt = 0;
  const missingAltSamples: string[] = [];
  imgs.each((_, el) => {
    const src = $(el).attr("src") || $(el).attr("data-src") || "";
    if ($(el).attr("alt") === undefined) {
      missingAlt++;
      if (missingAltSamples.length < 10 && src) missingAltSamples.push(abs(src) ?? src);
    }
    const u = src && !src.startsWith("data:") ? abs(src) : null;
    if (u) links.push({ target: u, anchor: ws($(el).attr("alt")).slice(0, 120), nofollow: false, kind: "img" });
  });
  const scripts = $("script[src]");
  scripts.each((_, el) => {
    const u = abs($(el).attr("src"));
    if (u) links.push({ target: u, anchor: "", nofollow: false, kind: "script" });
  });
  const styles = $("link[rel][href]").filter((_, el) => ($(el).attr("rel") || "").toLowerCase().split(/\s+/).includes("stylesheet"));
  styles.each((_, el) => {
    const u = abs($(el).attr("href"));
    if (u) links.push({ target: u, anchor: "", nofollow: false, kind: "css" });
  });

  const mixedContent: string[] = [];
  if (isHttps) {
    $("img[src], script[src], iframe[src], video[src], audio[src], source[src], embed[src], link[rel][href], object[data]").each((_, el) => {
      const tag = (el as { tagName?: string }).tagName?.toLowerCase();
      if (tag === "link") {
        const rel = ($(el).attr("rel") || "").toLowerCase();
        if (!/stylesheet|icon|preload|manifest/.test(rel)) return;
      }
      const raw = ($(el).attr("src") || $(el).attr("href") || $(el).attr("data") || "").trim();
      if (/^http:\/\//i.test(raw) && mixedContent.length < 20) mixedContent.push(raw);
    });
  }

  const frames = $("frameset, frame").length > 0;
  const flash = $("object[type='application/x-shockwave-flash'], embed[type='application/x-shockwave-flash'], embed[src$='.swf'], object[data$='.swf']").length > 0;
  const amp = $("html[amp], html[⚡]").length > 0;
  const iframes = $("iframe").length;

  const h1 = $("h1").map((_, el) => ws($(el).text()).slice(0, 300)).get();
  const h2 = $("h2").map((_, el) => ws($(el).text()).slice(0, 200)).get().slice(0, 30);

  // Visible text (for word count / ratio), then the main-content text (for duplicate detection).
  $("script, style, noscript, template, svg, iframe, object").remove();
  const bodyText = ws($("body").text() || $.root().text());
  const main = $("main, [role=main], article").first();
  let mainText: string;
  if (main.length) mainText = ws(main.text());
  else {
    const body = $("body").clone();
    body.find("nav, header, footer, aside, form").remove();
    mainText = ws(body.text());
  }
  const wordCount = (bodyText.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;
  const textRatio = html.length ? Math.round((bodyText.length / html.length) * 1000) / 10 : 0;

  return {
    facts: {
      title,
      titleCount: titles.length,
      description,
      descriptionCount: descEls.length,
      h1,
      h2,
      canonical: canonicals[0] ?? null,
      canonicals,
      canonicalHeader: null,
      metaRobots: robotsMeta,
      noindex: /(^|[\s,])(noindex|none)([\s,]|$)/.test(robotsMeta),
      nofollow: /(^|[\s,])(nofollow|none)([\s,]|$)/.test(robotsMeta),
      hreflang,
      lang,
      viewport,
      charset,
      doctype,
      metaRefresh,
      wordCount,
      textRatio,
      contentHash: createHash("sha1").update(mainText.toLowerCase()).digest("hex"),
      simhash: simhash(mainText),
      minhash: minhash(mainText),
      internalLinks,
      externalLinks,
      uniqueInternal: uniqInt.size,
      uniqueExternal: uniqExt.size,
      nofollowInternal,
      nofollowExternal,
      emptyAnchors,
      httpLinks,
      images: imgs.length,
      imagesMissingAlt: missingAlt,
      missingAltSamples,
      scripts: scripts.length,
      stylesheets: styles.length,
      iframes,
      jsonLd: { count: ldScripts.length, types: [...new Set(jsonLdTypes)].slice(0, 30), errors: jsonLdErrors.slice(0, 10) },
      microdata: microdata.slice(0, 20),
      og,
      twitter,
      mixedContent,
      frames,
      flash,
      amp,
    },
    links,
    hreflangTargets: hreflang.map((h) => h.href).filter((x): x is string => !!x),
  };
}
