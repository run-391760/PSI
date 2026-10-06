import { load, type Cheerio, type CheerioAPI } from "cheerio";
import type { AnyNode, Element } from "domhandler";
import { wordList } from "@/lib/content/text";
import type { Block, BlockTag } from "./types";

/**
 * Page snapshot for the live crawler (pure): the head facts the spider inspects first (title, meta
 * description, lang/robots/canonical/viewport), then the main content as an ordered list of text
 * blocks, inline links, images and tables, capped so the stage stays light.
 */

export const MAX_BLOCKS = 80;
export const MAX_LINKS = 40;
const TEXT_CAP = 280;

const NOISE = [
  "script,style,noscript,template,svg,canvas,iframe,form,button,select,dialog,nav,footer,aside,[hidden]",
  "[role=navigation],[role=contentinfo],[role=banner],[role=menu],[role=menubar],[role=dialog],[role=search],[aria-hidden=true]",
  ".cookie,.cookies,#cookie-banner,.breadcrumb,.breadcrumbs,.sr-only,.visually-hidden,.screen-reader-text,.skip-link,.share,.social-share",
  ".dropdown-menu,.sub-menu,.megamenu,.offcanvas,.modal,.sidebar,#sidebar,.toc,#toc,.navbox",
  ".mw-editsection,.noprint,.mw-jump-link,.vector-dropdown,.vector-menu,.mw-portlet,.vector-page-toolbar,.vector-header-container,.mw-indicators",
].join(",");
/** Lists of bare short links longer than this (menus, language pickers, tag clouds) are shortened. */
const LINK_LIST_KEEP = 6;
/** Elements that start their own block (and are skipped by the inline walk of a parent block). */
const TEXT_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "pre", "blockquote", "figcaption", "dt", "dd"]);
const NESTED = new Set([...TEXT_TAGS, "ul", "ol", "dl", "table", "div", "section", "article", "figure"]);
const BLOCKISH = "h1,h2,h3,h4,h5,h6,p,li,table,ul,ol,pre,blockquote";
/** Children that end a run of inline content inside a leaf container (a visual paragraph break). */
const BREAKS = new Set([...TEXT_TAGS, "div", "section", "article", "header", "main", "figure", "address", "details", "summary", "center", "fieldset", "hgroup", "dl", "hr"]);
/** Attribute holding a link's accessible name, computed before page chrome and hidden text are removed. */
const NAME_ATTR = "data-syn-name";

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

function absolute(href: string | undefined, base: string) {
  if (!href) return undefined;
  try {
    return new URL(href, base).toString();
  } catch {
    return undefined;
  }
}
/** A navigable link (not a jump link, script, mail or phone link). */
function linkHref(raw: string | undefined, base: string) {
  const href = raw?.trim();
  if (!href || href.startsWith("#") || /^(javascript|mailto|tel|sms|data):/i.test(href)) return undefined;
  const abs = absolute(href, base);
  return abs && /^https?:/i.test(abs) ? abs : undefined;
}
export function imageSrc($el: Cheerio<Element>, base: string) {
  const raw = [$el.attr("src"), $el.attr("data-src"), $el.attr("data-lazy-src"), ($el.attr("srcset") ?? "").split(",")[0]?.trim().split(/\s+/)[0]].find((s) => s && !s.startsWith("data:"));
  return absolute(raw, base);
}

/**
 * Accessible name of a link (simplified accname): aria-labelledby, aria-label, then its content
 * (text including screen-reader-only text, image alt, SVG <title>), then its title attribute. This is
 * the name search engines and assistive tech use, so anchor rules must not judge the visible text alone
 * (e.g. "Continue reading<span class=screen-reader-text> Post title</span>").
 */
export function accessibleName($: CheerioAPI, el: Element): string {
  const labelledBy = ($(el).attr("aria-labelledby") ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => clean($(`[id="${id.replace(/"/g, "")}"]`).first().text()))
    .filter(Boolean)
    .join(" ");
  if (labelledBy) return labelledBy;
  const label = clean($(el).attr("aria-label") ?? "");
  if (label) return label;
  const parts: string[] = [];
  const walkName = (node: AnyNode) => {
    for (const child of (node as Element).children ?? []) {
      if (child.type === "text") parts.push((child as unknown as { data: string }).data);
      else if (child.type === "tag") {
        const c = child as Element;
        const t = c.tagName.toLowerCase();
        const $c = $(c);
        if (t === "script" || t === "style" || t === "template" || $c.attr("aria-hidden") === "true" || $c.attr("hidden") !== undefined) continue;
        if (t === "img") parts.push(` ${$c.attr("alt") ?? ""} `);
        else if (t === "svg") parts.push(` ${clean($c.attr("aria-label") ?? "") || clean($c.children("title").first().text())} `);
        else if (t === "br") parts.push(" ");
        else walkName(c);
      }
    }
  };
  walkName(el);
  return clean(parts.join("")) || clean($(el).attr("title") ?? "");
}

/** Main content container: <main>/<article>/common wrappers with enough text, else <body>. */
function mainRoot($: CheerioAPI): Cheerio<Element> {
  for (const sel of ["main", "article", "[role=main]", "#content", "#main", ".entry-content", ".post-content", ".article-body", ".content"]) {
    const el = $(sel).first();
    if (el.length && wordList(el.text()).length >= 120) return el as Cheerio<Element>;
  }
  return $("body").first() as Cheerio<Element>;
}

export function headBlocks($: CheerioAPI, pageUrl: string, headers: Record<string, string | string[] | undefined> = {}): Block[] {
  const title = clean($("title").first().text());
  const description = clean($("meta[name='description' i]").attr("content") ?? "");
  const lang = $("html").attr("lang");
  const robots = [$("meta[name='robots' i]").attr("content"), headers["x-robots-tag"]].flat().filter(Boolean).join(", ");
  const canonical = absolute($("link[rel='canonical' i]").attr("href"), pageUrl);
  const viewport = $("meta[name='viewport' i]").attr("content");
  const head = [`lang=${lang ? `"${lang}"` : "missing"}`, `viewport ${viewport ? "set" : "missing"}`, `robots: ${robots || "index, follow (default)"}`, `canonical: ${canonical ?? "none"}`].join(" · ");
  return [
    { id: "b0", tag: "title", text: cut(title, TEXT_CAP) },
    { id: "b1", tag: "meta", text: cut(description, TEXT_CAP) },
    { id: "b2", tag: "head", text: cut(head, 400) },
  ];
}

/**
 * Ordered snapshot blocks of a page (≤ MAX_BLOCKS, ≤ MAX_LINKS links). Text blocks keep their links
 * as runs (`segs`) and each link is also its own `a` block with `parent` set, so the spider can
 * point at it inside the sentence.
 */
export function extractBlocks(html: string, pageUrl: string, headers: Record<string, string | string[] | undefined> = {}): Block[] {
  const $ = load(html);
  const blocks: Block[] = headBlocks($, pageUrl, headers);
  let links = 0;
  let n = blocks.length;
  const nextId = () => `b${n++}`;
  const full = () => blocks.length >= MAX_BLOCKS;

  // The H1 often sits in a page header outside the main container: keep it at the top.
  const outsideH1 = (() => {
    const root = mainRoot($);
    if (root.find("h1").length) return null;
    const h1 = $("h1").filter((_, e) => !!clean($(e).text())).first();
    return h1.length ? clean(h1.text()) : null;
  })();
  if (outsideH1) blocks.push({ id: nextId(), tag: "h1", level: 1, text: cut(outsideH1, TEXT_CAP) });

  // Link names first: chrome removal below also drops screen-reader text and SVG titles they rely on.
  $("a[href]").each((_, el) => void $(el).attr(NAME_ATTR, accessibleName($, el)));
  $(NOISE).remove();
  // Site headers (with navigation) are chrome; article headers (with the H1) are content.
  $("header").each((_, el) => {
    if ($(el).find("a").length > 6 && !$(el).find("h1").length) $(el).remove();
  });
  const root = mainRoot($);
  // Menus, language pickers and tag clouds would use up the block budget: keep their first items.
  root.find("ul,ol").each((_, list) => {
    const items = $(list).children("li");
    if (items.length <= LINK_LIST_KEEP + 2) return;
    const bare = items.filter((_, li) => {
      const $li = $(li);
      const a = $li.children("a");
      return a.length === 1 && clean($li.text()) === clean(a.text()) && wordList(a.text()).length <= 4;
    }).length;
    if (bare / items.length < 0.9) return;
    items.slice(LINK_LIST_KEEP).remove();
    $(list).append(`<li data-more="1">… ${items.length - LINK_LIST_KEEP} more links in this list</li>`);
  });

  const emitImage = (el: Element) => {
    if (full()) return;
    const $el = $(el);
    const alt = $el.attr("alt");
    blocks.push({ id: nextId(), tag: "img", text: cut(clean(alt ?? ""), 160), alt: alt === undefined ? null : alt, src: imageSrc($el, pageUrl) });
  };

  const emitLinkBlock = (el: Element, parent?: string) => {
    if (full() || links >= MAX_LINKS) return null;
    const $el = $(el);
    const href = linkHref($el.attr("href"), pageUrl);
    if (!href) return null;
    const name = $el.attr(NAME_ATTR) ?? accessibleName($, el);
    links++;
    const block: Block = { id: nextId(), tag: "a", text: cut(name, 160), href, ...(parent ? { parent } : {}) };
    blocks.push(block);
    return block;
  };

  /** A text block with its inline links; nested block containers are walked afterwards. */
  const emitText = (el: Element, tag: string) => {
    const runs: { t: string; link?: Element }[] = [];
    const nested: Element[] = [];
    const images: Element[] = [];
    const inline = (node: AnyNode) => {
      for (const child of (node as Element).children ?? []) {
        if (child.type === "text") runs.push({ t: (child as unknown as { data: string }).data });
        else if (child.type === "tag") {
          const c = child as Element;
          const t = c.tagName.toLowerCase();
          if (t === "br") runs.push({ t: " " });
          else if (t === "img") images.push(c);
          else if (t === "a" && linkHref($(c).attr("href"), pageUrl) && !$(c).find(BLOCKISH).length) {
            runs.push({ t: $(c).text(), link: c });
            $(c).find("img").each((_, i) => void images.push(i as Element));
          } else if (NESTED.has(t) && (TEXT_TAGS.has(t) || $(c).find(BLOCKISH).length || t === "table" || t === "ul" || t === "ol")) nested.push(c);
          else inline(c);
        }
      }
    };
    inline(el);
    // Normalize whitespace across runs and truncate to TEXT_CAP characters.
    const segs: { t: string; link?: Element }[] = [];
    let len = 0;
    let truncated = false;
    for (const r of runs) {
      let t = r.t.replace(/\s+/g, " ");
      if (!segs.length || segs[segs.length - 1].t.endsWith(" ")) t = t.replace(/^ /, "");
      // A link without text is kept (as an empty run) so its missing anchor text can be flagged.
      if (!t && r.link) {
        segs.push({ t: "", link: r.link });
        continue;
      }
      if (!t) continue;
      if (len + t.length > TEXT_CAP) {
        t = t.slice(0, Math.max(0, TEXT_CAP - len - 1)).trimEnd();
        if (t) segs.push({ t: `${t}…`, link: r.link });
        else if (segs.length) segs[segs.length - 1].t = `${segs[segs.length - 1].t.trimEnd()}…`;
        truncated = true;
        break;
      }
      len += t.length;
      const last = segs[segs.length - 1];
      if (last && !last.link && !r.link) last.t += t;
      else segs.push({ t, link: r.link });
    }
    if (segs.length) segs[segs.length - 1].t = segs[segs.length - 1].t.trimEnd();
    const text = segs.map((s) => s.t).join("");
    // Words of the whole block before truncation: its own inline text (<br> counts as a space; nested
    // blocks are measured on their own).
    const fullText = runs.map((r) => r.t).join("");
    if (text && !full()) {
      const blockTag: BlockTag = /^h[1-6]$/.test(tag) ? (tag === "h1" ? "h1" : tag === "h2" ? "h2" : "h3") : tag === "li" ? "li" : "p";
      const block: Block = { id: nextId(), tag: blockTag, text };
      if (/^h[1-6]$/.test(tag)) block.level = Number(tag[1]);
      if (blockTag === "p" || blockTag === "li") block.words = wordList(fullText).length;
      if (truncated) block.truncated = true;
      if (tag === "li") block.ordered = $(el).parent().is("ol");
      blocks.push(block);
      if (segs.some((s) => s.link)) {
        block.segs = [];
        for (const s of segs) {
          const lb = s.link ? emitLinkBlock(s.link, block.id) : null;
          block.segs.push(lb ? { t: s.t, a: lb.id } : { t: s.t });
        }
      }
    } else if (!text && segs.some((sg) => sg.link)) {
      for (const sg of segs) if (sg.link) emitLinkBlock(sg.link);
    } else if (/^h[1-6]$/.test(tag) && !text && !full()) {
      // Empty headings are a measured issue: keep them so the spider can flag them.
      blocks.push({ id: nextId(), tag: tag === "h1" ? "h1" : tag === "h2" ? "h2" : "h3", level: Number(tag[1]), text: "" });
    }
    for (const i of images) emitImage(i);
    for (const c of nested) visit(c);
  };

  const emitTable = (el: Element) => {
    if (full()) return;
    const $el = $(el);
    const rows = $el
      .find("tr")
      .slice(0, 4)
      .map((_, tr) => [
        $(tr)
          .children("th,td")
          .slice(0, 4)
          .map((__, td) => cut(clean($(td).text()), 40))
          .get(),
      ])
      .get() as string[][];
    const caption = clean($el.find("caption").first().text());
    blocks.push({ id: nextId(), tag: "table", text: cut(caption || rows[0]?.join(" · ") || "Table", 160), rows: rows.filter((r) => r.length) });
  };

  /** One element in document order: a block of its own, or a container to descend into. */
  const visit = (c: Element) => {
    if (full()) return;
    const t = c.tagName.toLowerCase();
    if (TEXT_TAGS.has(t)) emitText(c, t);
    else if (t === "table") emitTable(c);
    else if (t === "img") emitImage(c);
    else if (t === "a") {
      // Card-style links wrap headings/paragraphs: the link is one block, its inside is not walked.
      if (emitLinkBlock(c) && !$(c).find(BLOCKISH).length) $(c).find("img").each((_, i) => void emitImage(i as Element));
    } else if (!$(c).find(BLOCKISH).length && clean($(c).text())) {
      // A leaf container of inline text: one paragraph, unless nested blocks or <br><br> split it.
      const parts = paragraphsOf(c);
      if (parts) for (const part of parts) visit(part);
      else emitText(c, "p");
    } else walk(c);
  };
  /**
   * The visual paragraphs of a container whose inline content is interrupted by block children (nested
   * divs etc.) or <br><br> breaks: each run of inline content moves into its own (detached) <p>, in
   * order with the block children, so every paragraph is its own block and is measured on its own.
   * Null when the container is a single paragraph.
   */
  const paragraphsOf = (c: Element): Element[] | null => {
    const kids = [...(c.children ?? [])];
    const isBr = (n: AnyNode | undefined) => n?.type === "tag" && (n as Element).tagName.toLowerCase() === "br";
    const blank = (n: AnyNode | undefined) => n?.type === "text" && !(n as unknown as { data: string }).data.trim();
    const parts: (AnyNode[] | Element)[] = [[]];
    let split = false;
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i];
      if (k.type === "tag" && BREAKS.has((k as Element).tagName.toLowerCase())) {
        split = true;
        parts.push(k as Element, []);
        continue;
      }
      // Two or more <br> in a row (whitespace between them allowed) end a paragraph.
      let j = i + 1;
      while (blank(kids[j])) j++;
      if (isBr(k) && isBr(kids[j])) {
        while (isBr(kids[j + 1]) || blank(kids[j + 1])) j++;
        split = true;
        parts.push([]);
        i = j;
        continue;
      }
      (parts[parts.length - 1] as AnyNode[]).push(k);
    }
    if (!split) return null;
    const out: Element[] = [];
    for (const part of parts) {
      if (!Array.isArray(part)) out.push(part);
      else if (part.some((n) => n.type === "tag" || !blank(n))) out.push($("<p></p>").append($(part as Element[])).get(0) as Element);
    }
    return out;
  };
  const walk = (node: Element) => {
    for (const child of node.children ?? []) {
      if (full()) return;
      if (child.type === "tag") visit(child as Element);
    }
  };
  const rootEl = root.get(0);
  if (rootEl) walk(rootEl);
  return blocks;
}
