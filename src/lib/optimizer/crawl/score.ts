import { analyze, bySeverity } from "../analyze";
import { featureById } from "../features";
import type { DraftInput } from "../types";
import type { PageScore } from "./types";

/**
 * Scores a crawled page with the Pre-Publish Optimizer engine (pure): the page's Markdown, title,
 * meta, canonical, robots and JSON-LD go in as a draft. A crawled page has no declared target
 * keyword, so the engine scores it against one inferred from the URL slug, else the H1, else the
 * title — the UI names that keyword next to the score.
 */

const SLUG_NOISE = /^(index|home|default|page|main|en|en-us|en-gb|amp|\d+|[a-f0-9]{8,})$/i;

export function inferKeyword(url: string, title: string, h1: string | undefined): string {
  try {
    const seg = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() ?? "")
      .replace(/\.[a-z0-9]{2,5}$/i, "")
      .toLowerCase();
    const words = seg.split(/[-_+\s]+/).filter((w) => w && !SLUG_NOISE.test(w) && /[a-z]/.test(w));
    if (words.length >= 2) return words.slice(0, 6).join(" ");
  } catch {
    /* fall through to headings */
  }
  const tidy = (s: string) =>
    s
      .replace(/[“”"']/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  if (h1 && h1.split(/\s+/).length <= 8) return tidy(h1);
  const first = title.split(/\s+[|–—·:-]\s+/)[0] ?? title;
  return tidy(first).split(" ").slice(0, 6).join(" ");
}

export type ScoreInput = { url: string; title: string; metaDescription: string; canonical: string | null; robots: string; schema: string; markdown: string; h1: string | undefined };

export function scorePage(p: ScoreInput, now = new Date()): PageScore {
  const keyword = inferKeyword(p.url, p.title, p.h1);
  if (!p.markdown.trim()) return { score: null, status: null, keyword, top: [], counts: null };
  const slug = (() => {
    try {
      return new URL(p.url).pathname.split("/").filter(Boolean).pop() ?? "";
    } catch {
      return "";
    }
  })();
  // The H1 often sits outside the extracted main content: keep it at the top, as the importer does.
  const body = !/^#\s/m.test(p.markdown) && p.h1 ? `# ${p.h1}\n\n${p.markdown}` : p.markdown;
  const draft: DraftInput = {
    title: p.title,
    keyword,
    keywords: [],
    metaDescription: p.metaDescription,
    slug,
    url: p.url,
    body: body.slice(0, 150_000),
    meta: { canonical: p.canonical ?? undefined, robots: p.robots || "index, follow", schema: p.schema || undefined },
  };
  const report = analyze(draft, { now });
  const top = report.findings
    .filter((f) => f.severity && f.status !== "na")
    .sort(bySeverity)
    .slice(0, 5)
    .map((f) => ({ feature: f.feature, name: featureById(f.feature)?.name ?? f.feature, severity: f.severity, text: f.blocker ?? f.summary }));
  const { critical, high, medium, low, passed } = report.counts;
  return { score: report.overall, status: report.status, keyword, top, counts: { critical, high, medium, low, passed } };
}

/** All JSON-LD blocks of the page as one string (the engine validates it). */
export function jsonLdOf(html: string) {
  const blocks = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1].trim()).filter(Boolean);
  if (blocks.length <= 1) return (blocks[0] ?? "").slice(0, 60_000);
  try {
    return JSON.stringify(blocks.map((j) => JSON.parse(j)), null, 2).slice(0, 60_000);
  } catch {
    return blocks[0].slice(0, 60_000);
  }
}
