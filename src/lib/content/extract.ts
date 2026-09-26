import { load, type Cheerio, type CheerioAPI } from "cheerio";
import type { AnyNode, Element } from "domhandler";
import { auditHtml } from "@/lib/crawler";
import { matchesDomain } from "@/lib/domain";
import { readabilityOf, wordList } from "./text";

/** Measured facts about a fetched page (everything here comes from the live HTML). */
export type PageFacts = {
  finalUrl: string;
  status: number;
  https: boolean;
  bytes: number;
  title: string;
  metaDescription: string;
  h1s: string[];
  h2s: string[];
  h3Count: number;
  canonical: string | null;
  robots: string;
  noindex: boolean;
  lang: string | null;
  viewport: boolean;
  og: { title: boolean; description: boolean; image: boolean };
  hreflang: number;
  schemaTypes: string[];
  invalidJsonLd: number;
  words: number;
  paragraphs: number;
  longParagraphs: number;
  flesch: number | null;
  grade: number | null;
  avgSentenceLength: number;
  longSentences: number;
  passiveShare: number;
  images: number;
  imagesMissingAlt: number;
  imagesEmptyAlt: number;
  imagesNoDimensions: number;
  internalLinks: number;
  externalLinks: number;
  nofollowLinks: number;
  jumpLinks: number;
  lists: number;
  tables: number;
  hasVideo: boolean;
  questionHeadings: number;
  snippet: string;
};

const BLOCKS = "h1,h2,h3,h4,h5,h6,p,li,blockquote,dt,dd,figcaption,td,th,pre";
const NOISE = "script,style,noscript,template,svg,canvas,form,button,select,nav,header,footer,aside,[role=navigation],[role=banner],[role=contentinfo],[aria-hidden=true],.cookie,.cookies,#cookie-banner,.breadcrumb,.breadcrumbs,sup.reference,.reference,.references,.reflist,.navbox,.mw-editsection,#toc,.toc,.sr-only,.visually-hidden,.screen-reader-text,.catlinks,.printfooter,.noprint";

function clean(s: string) {
  return s.replace(/\s+/g, " ").trim();
}

/** Picks the main content container: <main>/<article>/common content wrappers, else <body>. */
function mainRoot($: CheerioAPI): Cheerio<Element> {
  for (const sel of ["main", "article", "[role=main]", "#content", "#main", ".entry-content", ".post-content", ".article-body", ".content"]) {
    const el = $(sel).first();
    if (el.length && wordList(el.text()).length >= 120) return el as Cheerio<Element>;
  }
  return $("body").first() as Cheerio<Element>;
}

function inlineMarkdown($: CheerioAPI, el: Cheerio<AnyNode>, base: string): string {
  let out = "";
  el.contents().each((_, node) => {
    if (node.type === "text") out += (node as unknown as { data: string }).data;
    else if (node.type === "tag") {
      const tag = (node as Element).tagName.toLowerCase();
      const $n = $(node);
      if (tag === "br") out += " ";
      else if (tag === "a") {
        const text = clean($n.text());
        const href = $n.attr("href");
        let abs = "";
        try {
          abs = href && !href.startsWith("#") && !/^javascript:/i.test(href) ? new URL(href, base).toString() : "";
        } catch {
          abs = "";
        }
        out += text ? (abs ? `[${text}](${abs})` : text) : "";
      } else if (tag === "strong" || tag === "b") {
        const t = clean($n.text());
        out += t ? `**${t}**` : "";
      } else if (tag === "em" || tag === "i") {
        const t = clean($n.text());
        out += t ? `*${t}*` : "";
      } else if (tag === "img") {
        /* images are dropped from imported text */
      } else out += inlineMarkdown($, $n, base);
    }
  });
  return out;
}

/** Analyze fetched HTML. Returns measured facts, the main text (for keyword checks) and a Markdown rendition. */
export function extractPage(html: string, url: string, status: number, headers: Record<string, string | string[] | undefined>, domain: string) {
  const audit = auditHtml(html, url, headers);
  const $ = load(html);
  const meta = (name: string) => $(`meta[name='${name}']`).attr("content") ?? $(`meta[property='${name}']`).attr("content") ?? "";

  // Whole-document signals (before removing chrome).
  const imgs = $("img").toArray();
  const images = imgs.length;
  const imagesMissingAlt = imgs.filter((i) => $(i).attr("alt") === undefined).length;
  const imagesEmptyAlt = imgs.filter((i) => $(i).attr("alt") !== undefined && !clean($(i).attr("alt") ?? "")).length;
  const imagesNoDimensions = imgs.filter((i) => !$(i).attr("width") || !$(i).attr("height")).length;
  const alts = imgs.map((i) => $(i).attr("alt") ?? "").filter(Boolean);
  let internal = 0,
    external = 0,
    nofollow = 0,
    jump = 0;
  $("a[href]").each((_, a) => {
    const href = $(a).attr("href") ?? "";
    if (href.startsWith("#")) {
      if (href.length > 1) jump++;
      return;
    }
    if (/^(mailto|tel|javascript):/i.test(href)) return;
    try {
      const target = new URL(href, url).toString();
      if (matchesDomain(target, domain)) internal++;
      else external++;
      if (/nofollow/i.test($(a).attr("rel") ?? "")) nofollow++;
    } catch {
      /* ignore malformed hrefs */
    }
  });
  const hasVideo = $("video").length > 0 || $("iframe[src*='youtube'],iframe[src*='youtu.be'],iframe[src*='vimeo'],iframe[src*='wistia'],iframe[src*='loom'],iframe[data-src*='youtube']").length > 0;
  const h2s = $("h2").map((_, e) => clean($(e).text())).get().filter(Boolean);
  const h3Count = $("h3").length;
  const questionHeadings = $("h2,h3,h4").filter((_, e) => /\?\s*$/.test(clean($(e).text()))).length;

  // Main content.
  $(NOISE).remove();
  const root = mainRoot($);
  root.find("br").replaceWith(" ");
  const blocks: { tag: string; text: string; md: string; ordered?: boolean }[] = [];
  root.find(BLOCKS).each((_, el) => {
    const $el = $(el);
    const tag = (el as Element).tagName.toLowerCase();
    if (tag !== "pre" && $el.find(BLOCKS).length) return; // nested: children are collected instead
    const text = clean($el.text());
    if (!text) return;
    const md = tag === "pre" ? text : clean(inlineMarkdown($, $el, url));
    blocks.push({ tag, text, md, ordered: tag === "li" ? $el.parent().is("ol") : undefined });
  });
  let text = blocks.map((b) => b.text).join("\n");
  const rootWords = wordList(root.text()).length;
  if (wordList(text).length < rootWords * 0.4) {
    root.find("div,section,span").each((_, el) => void $(el).append("\n"));
    text = root
      .text()
      .split("\n")
      .map(clean)
      .filter((l) => wordList(l).length > 2)
      .join("\n");
  }
  const words = wordList(text).length;
  const paras = blocks.filter((b) => b.tag === "p");
  const read = readabilityOf(text);
  const markdown = blocks
    .map((b) => {
      if (/^h[1-6]$/.test(b.tag)) return `${"#".repeat(Number(b.tag[1]))} ${b.text}`;
      if (b.tag === "li") return `${b.ordered ? "1." : "-"} ${b.md}`;
      if (b.tag === "blockquote") return `> ${b.md}`;
      if (b.tag === "pre") return "```\n" + b.text + "\n```";
      return b.md;
    })
    .reduce<string[]>((acc, line) => {
      const prevList = acc.length && /^(-|1\.) /.test(acc[acc.length - 1]);
      const isList = /^(-|1\.) /.test(line);
      if (acc.length) acc.push(prevList && isList ? "\n" : "\n\n");
      acc.push(line);
      return acc;
    }, [])
    .join("");

  const robots = audit.robots;
  const facts: PageFacts = {
    finalUrl: url,
    status,
    https: url.startsWith("https://"),
    bytes: Buffer.byteLength(html),
    title: audit.title,
    metaDescription: audit.description,
    h1s: audit.h1s.filter(Boolean),
    h2s: h2s.slice(0, 40),
    h3Count,
    canonical: audit.canonical ? safeResolve(audit.canonical, url) : null,
    robots,
    noindex: /(^|[\s,])(noindex|none)([\s,]|$)/i.test(robots),
    lang: $("html").attr("lang") ?? null,
    viewport: !!meta("viewport"),
    og: { title: !!meta("og:title"), description: !!meta("og:description"), image: !!meta("og:image") },
    hreflang: $("link[rel='alternate'][hreflang]").length,
    schemaTypes: audit.structured,
    invalidJsonLd: audit.invalidJsonLd,
    words,
    paragraphs: paras.length,
    longParagraphs: paras.filter((p) => wordList(p.text).length > 150).length,
    flesch: read.flesch,
    grade: read.grade,
    avgSentenceLength: read.avgSentenceLength,
    longSentences: read.longSentences,
    passiveShare: read.passiveShare,
    images,
    imagesMissingAlt,
    imagesEmptyAlt,
    imagesNoDimensions,
    internalLinks: internal,
    externalLinks: external,
    nofollowLinks: nofollow,
    jumpLinks: jump,
    lists: root.find("ul,ol").length,
    tables: root.find("table").length,
    hasVideo,
    questionHeadings,
    snippet: text.slice(0, 280),
  };
  return { facts, text, markdown, alts };
}

function safeResolve(href: string, base: string) {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}
