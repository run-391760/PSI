import { normalizeUrl } from "./scope";
import type { Block, Flag, FlagRule, FlagSeverity, LinkStatus, Touch, TouchKind } from "./types";

/**
 * Flag rules of the live crawler (pure, client-safe). Every flag is a measured fact about one
 * element or the page: nothing is estimated. Thresholds match the Pre-Publish Optimizer (title
 * 30–60 characters, meta description 120–160, paragraphs over 150 words, thin content under 250).
 */

export const RULES: Record<FlagRule, { label: string; severity: FlagSeverity; fix: string }> = {
  "http-error": { label: "Page returns an error", severity: "critical", fix: "Fix or redirect the URL, and update the links that point to it." },
  noindex: { label: "Page is set to noindex", severity: "high", fix: "Remove noindex (meta robots or X-Robots-Tag) if the page should appear in search." },
  "canonical-other": { label: "Canonical points to another URL", severity: "medium", fix: "Point the canonical to this URL unless the page is a deliberate duplicate." },
  "title-missing": { label: "Missing title", severity: "critical", fix: "Write a unique 30–60 character title that includes the page's main keyword." },
  "title-length": { label: "Title length outside 30–60", severity: "medium", fix: "Rewrite the title to 30–60 characters (about 580 px) so it is not truncated." },
  "meta-missing": { label: "Missing meta description", severity: "high", fix: "Add a 120–160 character summary with the keyword and a reason to click." },
  "meta-length": { label: "Meta description length outside 120–160", severity: "low", fix: "Rewrite the description to 120–160 characters." },
  "lang-missing": { label: "Missing html lang", severity: "low", fix: 'Declare the language, e.g. <html lang="en">.' },
  "viewport-missing": { label: "Missing viewport meta", severity: "high", fix: 'Add <meta name="viewport" content="width=device-width, initial-scale=1"> for mobile-first indexing.' },
  "h1-missing": { label: "No H1 heading", severity: "high", fix: "Add one H1 that states the page topic." },
  "h1-multiple": { label: "Multiple H1 headings", severity: "medium", fix: "Keep one H1 and turn the others into H2s." },
  "heading-skip": { label: "Skipped heading level", severity: "low", fix: "Nest headings in order (H2 → H3) without skipping levels." },
  "heading-empty": { label: "Empty heading", severity: "medium", fix: "Give the heading text or remove the empty heading tag." },
  "thin-content": { label: "Thin content (< 250 words)", severity: "high", fix: "Expand the main content with useful, specific information, or merge the page." },
  "long-paragraph": { label: "Long paragraph (> 150 words)", severity: "low", fix: "Split the paragraph into shorter ones (2–4 sentences)." },
  "img-alt-missing": { label: "Image without alt attribute", severity: "medium", fix: "Add alt text that describes the image (or alt=\"\" if decorative)." },
  "img-alt-empty": { label: "Image with empty alt", severity: "low", fix: "Empty alt is right only for decorative images; describe informative ones." },
  "img-mixed": { label: "Insecure image on an HTTPS page", severity: "high", fix: "Load the image over HTTPS: browsers block or warn about mixed content." },
  "anchor-generic": { label: "Generic anchor text", severity: "low", fix: "Describe the destination in the link text instead of “click here” or “read more”." },
  "anchor-empty": { label: "Link without text", severity: "medium", fix: "Give the link visible text, an image alt or an aria-label." },
  "link-insecure": { label: "HTTP link on an HTTPS page", severity: "low", fix: "Link to the HTTPS version of the URL." },
  "link-broken": { label: "Broken link (4xx/5xx)", severity: "high", fix: "Update or remove the link." },
  "link-redirect": { label: "Link goes through a redirect", severity: "low", fix: "Link straight to the final URL." },
  "link-error": { label: "Link could not be verified", severity: "medium", fix: "Check the URL manually: it timed out, failed DNS or refused automated checks." },
  "slow-response": { label: "Slow server response (TTFB > 1.8 s)", severity: "medium", fix: "Improve server response time (caching, CDN, backend)." },
};

export const SEVERITY_RANK: Record<FlagSeverity, number> = { critical: 4, high: 3, medium: 2, low: 1 };

export const GENERIC_ANCHOR = /^(click here|click|here|this|this page|this post|this article|link|read more|read more »|learn more|more|more info|go|see more|check it out|website|details|continue|continue reading|view more|view)$/i;

const flag = (rule: FlagRule, label: string, blockId: string | null, severity?: FlagSeverity): Flag => ({ rule, severity: severity ?? RULES[rule].severity, label, blockId });

export type PageFactsLite = {
  url: string;
  status: number;
  title: string;
  metaDescription: string;
  lang: string | null;
  viewport: boolean;
  noindex: boolean;
  robots: string;
  canonical: string | null;
  /** H1 count in the whole document (including page headers outside the main content). */
  h1Count: number;
  /** Words of main content. */
  words: number;
  ttfbMs: number | null;
};

/** Element-level and page-level flags that need no network (links are checked separately). */
export function inspectPage(f: PageFactsLite, blocks: Block[]): Flag[] {
  const flags: Flag[] = [];
  const https = f.url.startsWith("https:");
  const head = blocks.find((b) => b.tag === "head")?.id ?? null;
  const titleId = blocks.find((b) => b.tag === "title")?.id ?? null;
  const metaId = blocks.find((b) => b.tag === "meta")?.id ?? null;

  const t = f.title.trim();
  if (!t) flags.push(flag("title-missing", "The page has no <title>.", titleId));
  else if (t.length < 30 || t.length > 60) flags.push(flag("title-length", `Title is ${t.length} characters (aim for 30–60).`, titleId));
  const m = f.metaDescription.trim();
  if (!m) flags.push(flag("meta-missing", "No meta description: Google will pick text from the page.", metaId));
  else if (m.length < 120 || m.length > 160) flags.push(flag("meta-length", `Meta description is ${m.length} characters (aim for 120–160).`, metaId));
  if (f.noindex) flags.push(flag("noindex", `Robots directive “${f.robots}” keeps this page out of search.`, head));
  if (f.canonical) {
    const c = normalizeUrl(f.canonical);
    const self = normalizeUrl(f.url);
    if (c && self && c !== self) {
      const slashOnly = c.replace(/\/$/, "") === self.replace(/\/$/, "");
      flags.push(flag("canonical-other", slashOnly ? `Canonical differs only by a trailing slash: ${f.canonical}` : `Canonical points to ${f.canonical}`, head));
    }
  }
  if (!f.lang) flags.push(flag("lang-missing", "The <html> element has no lang attribute.", head));
  if (!f.viewport) flags.push(flag("viewport-missing", "No viewport meta tag: the page is not set up for mobile.", head));
  if (f.ttfbMs != null && f.ttfbMs > 1800) flags.push(flag("slow-response", `First byte after ${(f.ttfbMs / 1000).toFixed(1)} s.`, head));

  // Headings: H1 count (whole page), empty headings, skipped levels (in the snapshot's order).
  const headings = blocks.filter((b) => b.level);
  const h1Blocks = headings.filter((b) => b.level === 1);
  if (f.h1Count === 0) flags.push(flag("h1-missing", "The page has no H1 heading.", head));
  else if (f.h1Count > 1) {
    if (h1Blocks.length > 1) h1Blocks.slice(1).forEach((b, i) => flags.push(flag("h1-multiple", `H1 #${i + 2} of ${f.h1Count}: “${b.text.slice(0, 60) || "(empty)"}”`, b.id)));
    else flags.push(flag("h1-multiple", `The page has ${f.h1Count} H1 headings.`, h1Blocks[0]?.id ?? head));
  }
  let prev: number | null = null;
  for (const h of headings) {
    if (!h.text.trim()) flags.push(flag("heading-empty", `Empty H${h.level} tag.`, h.id));
    if (prev != null && h.level! > prev + 1) flags.push(flag("heading-skip", `H${prev} → H${h.level}: skips H${prev + 1}.`, h.id));
    prev = h.level!;
  }

  // Content.
  if (f.words < 250) {
    const lastText = [...blocks].reverse().find((b) => b.tag === "p" || b.tag === "li");
    flags.push(flag("thin-content", `Only ${f.words} words of main content.`, lastText?.id ?? head));
  }
  for (const b of blocks) {
    if (b.tag === "p" && (b.words ?? 0) > 150) flags.push(flag("long-paragraph", `Paragraph of ${b.words} words.`, b.id));
    if (b.tag === "img") {
      if (b.alt === null) flags.push(flag("img-alt-missing", `No alt attribute${b.src ? ` on ${fileName(b.src)}` : ""}.`, b.id));
      else if (b.alt !== undefined && !b.alt.trim()) flags.push(flag("img-alt-empty", `Empty alt${b.src ? ` on ${fileName(b.src)}` : ""} (fine only if decorative).`, b.id));
      if (https && b.src?.startsWith("http:")) flags.push(flag("img-mixed", `Image loaded over HTTP: ${b.src}`, b.id));
    }
    if (b.tag === "a") {
      const text = b.text.trim();
      if (!text) flags.push(flag("anchor-empty", `Link to ${b.href} has no text, alt or aria-label.`, b.id));
      else if (GENERIC_ANCHOR.test(text.replace(/[.…»›→]+$/g, "").trim())) flags.push(flag("anchor-generic", `“${text}” → ${b.href}`, b.id));
      if (https && b.href?.startsWith("http:")) flags.push(flag("link-insecure", `Links to HTTP: ${b.href}`, b.id));
    }
  }
  return flags;
}

/** Status codes that usually mean "the site refused an automated check", not "the page is gone". */
const BOT_BLOCK = new Set([401, 403, 429, 999]);

/** Flags from a link's status check. */
export function linkFlags(blockId: string, s: LinkStatus): Flag[] {
  if (s.error) return [flag("link-error", `${s.url}: ${s.error}`, blockId)];
  if (s.status == null) return [];
  if (BOT_BLOCK.has(s.status)) return [flag("link-error", `HTTP ${s.status} from ${hostOf(s.url)}: it refused the automated check (likely bot protection).`, blockId, "low")];
  if (s.status >= 400) return [flag("link-broken", `HTTP ${s.status}: ${s.url}`, blockId)];
  if (s.redirects > 0) return [flag("link-redirect", s.redirects > 1 ? `Redirect chain of ${s.redirects} hops → ${s.finalUrl}` : `Redirects (${s.redirects} hop) → ${s.finalUrl}`, blockId, s.redirects > 1 ? "medium" : "low")];
  return [];
}

export function touchKind(b: Block): TouchKind {
  if (b.tag === "a") return "link";
  if (b.tag === "img") return "image";
  if (b.level || /^h[1-3]$/.test(b.tag)) return "heading";
  if (b.tag === "title" || b.tag === "meta" || b.tag === "head") return "meta";
  return "text";
}

/** What the spider reports when it inspects one element. */
export function touchFor(b: Block, flags: Flag[], link?: LinkStatus | null): Touch {
  const kind = touchKind(b);
  if (flags.length) {
    const top = [...flags].sort((x, y) => SEVERITY_RANK[y.severity] - SEVERITY_RANK[x.severity])[0];
    return { blockId: b.id, kind, action: "flagged", rule: top.rule, label: `${RULES[top.rule].label}${flags.length > 1 ? ` (+${flags.length - 1} more)` : ""}` };
  }
  if (link?.note) return { blockId: b.id, kind, action: "ok", label: link.note };
  if (link && link.status != null) return { blockId: b.id, kind, action: "fetched", label: `${link.status}${link.ms != null ? ` · ${Math.round(link.ms)} ms` : ""}${link.method === "known" ? " · crawled" : ""}` };
  const ok =
    b.tag === "title"
      ? `Title: ${b.text.length} characters`
      : b.tag === "meta"
        ? `Meta description: ${b.text.length} characters`
        : b.tag === "head"
          ? "Head tags OK"
          : kind === "heading"
            ? `H${b.level ?? b.tag.slice(1)} in order`
            : b.tag === "img"
              ? `Alt: “${b.text.slice(0, 40)}”`
              : b.tag === "a"
                ? "Descriptive anchor (status not checked)"
                : b.tag === "table"
                  ? `Table · ${b.rows?.length ?? 0} rows read`
                  : `${b.words ?? 0} words`;
  return { blockId: b.id, kind, action: "ok", label: ok };
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
function fileName(src: string) {
  try {
    return decodeURIComponent(new URL(src).pathname.split("/").filter(Boolean).pop() ?? src).slice(0, 60);
  } catch {
    return src.slice(0, 60);
  }
}

/** Groups flags by rule, most severe first (used live and in the summary). */
export function groupFlags<T extends Flag>(flags: T[]) {
  const map = new Map<FlagRule, T[]>();
  for (const f of flags) map.set(f.rule, [...(map.get(f.rule) ?? []), f]);
  return [...map.entries()]
    .map(([rule, items]) => ({ rule, label: RULES[rule].label, severity: RULES[rule].severity, items }))
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.items.length - a.items.length);
}
