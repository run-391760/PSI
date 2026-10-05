import { inlinePlain, splitSentences, wordList } from "@/lib/content/text";

/**
 * Parses a Markdown draft (tolerating inline HTML) into the structure the checks read: headings,
 * sections split at H2, introduction and conclusion, paragraphs, sentences, lists, tables, links,
 * images, question/answer pairs and leftover placeholders. Pure and client-safe.
 */

export type Heading = { level: number; text: string; line: number };
export type Paragraph = { text: string; raw: string; words: number; line: number; section: number };
export type ListBlock = { ordered: boolean; items: string[]; line: number; section: number };
export type TableBlock = { headers: string[]; rows: number; cols: number; line: number; section: number };
export type LinkRef = { text: string; url: string; line: number; internal: boolean; section: number };
export type ImageRef = { alt: string; src: string; title: string; caption: string; line: number; section: number };
export type Section = { index: number; heading: Heading | null; text: string; words: number; paragraphs: number; lists: number; tables: number; images: number; subheadings: Heading[] };

export type ParsedDoc = {
  lines: string[];
  plain: string;
  words: number;
  sentences: string[];
  headings: Heading[];
  h1s: Heading[];
  sections: Section[];
  intro: { text: string; words: number; paragraphs: Paragraph[] };
  conclusion: Section | null;
  paragraphs: Paragraph[];
  lists: ListBlock[];
  tables: TableBlock[];
  links: LinkRef[];
  images: ImageRef[];
  faqs: { q: string; a: string; line: number }[];
  placeholders: { text: string; line: number }[];
  embeds: { kind: "video" | "iframe"; src: string; line: number }[];
  codeBlocks: number;
};

const PLACEHOLDER = /\[(?:write|add|todo|tbd|insert|placeholder)[^\]]*\]|\bTODO\b|\bTBD\b|\blorem ipsum\b|\bXXX\b|\{\{[^}]*\}\}/gi;
const CONCLUSION = /^(conclusion|summary|in summary|final thoughts|key takeaways|takeaways|wrapping up|bottom line|the bottom line|to sum up|next steps|closing thoughts|faqs?|frequently asked questions)\b/i;
const FAQ_HEADING = /^(faqs?|frequently asked questions|common questions|questions and answers)\b/i;

export const isConclusionHeading = (t: string) => CONCLUSION.test(t.trim()) && !FAQ_HEADING.test(t.trim());
export const isFaqHeading = (t: string) => FAQ_HEADING.test(t.trim());

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/** Internal = relative path, same host or a subdomain of the site's domain. */
export function isInternal(url: string, siteDomain: string | null) {
  if (/^(\/|\.\/|\.\.\/|#)/.test(url) || !/^[a-z]+:/i.test(url)) return !/^(mailto|tel):/i.test(url);
  const h = hostOf(url);
  return !!(h && siteDomain && (h === siteDomain || h.endsWith(`.${siteDomain}`)));
}

export function parseDraft(md: string, siteDomain: string | null = null): ParsedDoc {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const headings: Heading[] = [];
  const paragraphs: Paragraph[] = [];
  const lists: ListBlock[] = [];
  const tables: TableBlock[] = [];
  const links: LinkRef[] = [];
  const images: ImageRef[] = [];
  const embeds: ParsedDoc["embeds"] = [];
  const placeholders: ParsedDoc["placeholders"] = [];
  const sectionStarts: number[] = [0];
  let codeBlocks = 0;
  let inFence = false;
  let para: { raw: string[]; line: number } | null = null;
  let list: ListBlock | null = null;
  let table: { headers: string[]; rows: number; line: number } | null = null;
  let section = 0;

  const flushPara = () => {
    if (para) {
      const raw = para.raw.join(" ").trim();
      const text = inlinePlain(raw);
      if (text) paragraphs.push({ text, raw, words: wordList(text).length, line: para.line, section });
    }
    para = null;
  };
  const flushList = () => {
    if (list) lists.push(list);
    list = null;
  };
  const flushTable = () => {
    if (table) tables.push({ headers: table.headers, rows: table.rows, cols: table.headers.length, line: table.line, section });
    table = null;
  };
  const flushAll = () => (flushPara(), flushList(), flushTable());

  lines.forEach((line, i) => {
    if (/^\s*```/.test(line)) {
      flushAll();
      if (!inFence) codeBlocks++;
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    for (const m of line.matchAll(PLACEHOLDER)) placeholders.push({ text: m[0], line: i });
    // Inline references (links, images, embeds) anywhere on the line.
    for (const m of line.matchAll(/!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"([^"]*)")?\s*\)/g)) images.push({ alt: m[1].trim(), src: m[2], title: m[3] ?? "", caption: "", line: i, section });
    for (const m of line.matchAll(/<img\b[^>]*>/gi)) {
      const src = /src=["']([^"']+)["']/i.exec(m[0])?.[1] ?? "";
      const alt = /alt=["']([^"']*)["']/i.exec(m[0]);
      images.push({ alt: alt ? alt[1].trim() : "", src, title: "", caption: "", line: i, section });
    }
    for (const m of line.matchAll(/(?<!!)\[([^\]]+)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) links.push({ text: inlinePlain(m[1]), url: m[2], line: i, internal: isInternal(m[2], siteDomain), section });
    for (const m of line.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi)) links.push({ text: inlinePlain(m[2]), url: m[1], line: i, internal: isInternal(m[1], siteDomain), section });
    for (const m of line.matchAll(/<(iframe|video)\b[^>]*src=["']([^"']+)["']/gi)) embeds.push({ kind: /youtube|youtu\.be|vimeo|wistia|loom/i.test(m[2]) || m[1].toLowerCase() === "video" ? "video" : "iframe", src: m[2], line: i });
    const bareVideo = /^\s*<?(https?:\/\/(?:www\.)?(?:youtube\.com\/watch\S+|youtu\.be\/\S+|vimeo\.com\/\d+))>?\s*$/i.exec(line);
    if (bareVideo) embeds.push({ kind: "video", src: bareVideo[1], line: i });

    if (!line.trim()) {
      flushAll();
      return;
    }
    const h = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    const hh = /^\s*<h([1-6])[^>]*>(.*?)<\/h\1>\s*$/i.exec(line);
    if (h || hh) {
      flushAll();
      const level = h ? h[1].length : Number(hh![1]);
      const text = inlinePlain(h ? h[2] : hh![2]);
      headings.push({ level, text, line: i });
      if (level === 2) {
        section++;
        sectionStarts.push(i);
      }
      return;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flushPara();
      flushList();
      const cells = line.trim().replace(/^\||\|$/g, "").split("|").map((c) => inlinePlain(c));
      if (cells.every((c) => /^:?-{2,}:?$/.test(c.replace(/\s/g, "")))) return; // separator row
      if (!table) table = { headers: cells, rows: 0, line: i };
      else table.rows++;
      return;
    }
    flushTable();
    const li = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (li) {
      flushPara();
      const ordered = /\d/.test(li[1]);
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [], line: i, section };
      }
      list.items.push(inlinePlain(li[2]));
      return;
    }
    if (list && /^\s{2,}\S/.test(line)) {
      list.items[list.items.length - 1] += ` ${inlinePlain(line)}`;
      return;
    }
    flushList();
    if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) return flushPara();
    const q = /^\s*>\s?(.*)$/.exec(line);
    const content = q ? q[1] : line;
    // An image line followed by an italic line is image + caption.
    const cap = /^\s*[*_]([^*_].*?)[*_]\s*$/.exec(content);
    const prev = images[images.length - 1];
    if (cap && prev && prev.line === i - 1 && !prev.caption) {
      prev.caption = cap[1].trim();
      return;
    }
    if (/^\s*!\[[^\]]*\]\([^)]*\)\s*$/.test(content) || /^\s*<img\b[^>]*>\s*$/i.test(content)) return flushPara();
    if (para) para.raw.push(content);
    else para = { raw: [content], line: i };
  });
  flushAll();

  const h1s = headings.filter((h) => h.level === 1);
  const sections: Section[] = sectionStarts.map((start, index) => {
    const heading = index === 0 ? null : (headings.find((h) => h.line === start) ?? null);
    const ps = paragraphs.filter((p) => p.section === index);
    const ls = lists.filter((l) => l.section === index);
    const text = [...ps.map((p) => p.text), ...ls.flatMap((l) => l.items)].join("\n");
    const end = sectionStarts[index + 1] ?? Infinity;
    return {
      index,
      heading,
      text,
      words: wordList(text).length,
      paragraphs: ps.length,
      lists: ls.length,
      tables: tables.filter((t) => t.section === index).length,
      images: images.filter((im) => im.section === index).length,
      subheadings: headings.filter((h) => h.level > 2 && h.line > start && h.line < end),
    };
  });
  const introParas = paragraphs.filter((p) => p.section === 0);
  const introText = introParas.map((p) => p.text).join("\n");
  const last = sections.length > 1 ? sections[sections.length - 1] : null;
  const conclusion = last?.heading && isConclusionHeading(last.heading.text) ? last : (sections.slice(1).reverse().find((s) => s.heading && isConclusionHeading(s.heading.text)) ?? null);

  // Question headings followed by an answer paragraph.
  const faqs: ParsedDoc["faqs"] = [];
  for (const h of headings) {
    if (h.level < 2 || !/\?\s*$/.test(h.text)) continue;
    const answer = paragraphs.find((p) => p.line > h.line && !headings.some((x) => x.line > h.line && x.line < p.line));
    if (answer) faqs.push({ q: h.text, a: answer.text, line: h.line });
  }
  // **Question?** + answer paragraphs (common FAQ formatting).
  for (const p of paragraphs) {
    const m = /^\*\*(.+?\?)\*\*\s*(.*)$/.exec(p.raw);
    if (!m) continue;
    const a = m[2].trim() || paragraphs.find((x) => x.line > p.line)?.text || "";
    if (a) faqs.push({ q: inlinePlain(m[1]), a: inlinePlain(a), line: p.line });
  }

  const plainBlocks = [...paragraphs.map((p) => p.text), ...lists.flatMap((l) => l.items)];
  const plain = [...headings.map((h) => h.text), ...plainBlocks].join("\n");
  const sentences = paragraphs.flatMap((p) => splitSentences(p.text).map((s) => s.text));
  return {
    lines,
    plain,
    words: wordList(plainBlocks.join("\n")).length + wordList(headings.map((h) => h.text).join(" ")).length,
    sentences,
    headings,
    h1s,
    sections,
    intro: { text: introText, words: wordList(introText).length, paragraphs: introParas },
    conclusion,
    paragraphs,
    lists,
    tables,
    links,
    images,
    faqs,
    placeholders,
    embeds,
    codeBlocks,
  };
}

/** Lower-cased content tokens without stopwords (for overlap measures). */
export function contentTokens(text: string, stop: Set<string>) {
  return wordList(text.toLowerCase()).filter((w) => w.length > 2 && !stop.has(w) && !/^\d+$/.test(w));
}

/** Simple stem so "courses"/"course", "placements"/"placement" match. */
export const stem = (w: string) => w.replace(/(ies)$/, "y").replace(/(sses)$/, "ss").replace(/([^s])s$/, "$1").replace(/(ing|ed)$/, "");

/** Share of `needle` content tokens present in `hay` (0..1). */
export function tokenCoverage(needle: string, hayTokens: Set<string>, stop: Set<string>) {
  const toks = [...new Set(contentTokens(needle, stop).map(stem))];
  if (!toks.length) return 0;
  return toks.filter((t) => hayTokens.has(t)).length / toks.length;
}

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "");
