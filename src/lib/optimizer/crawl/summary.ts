import { groupFlags } from "./rules";
import type { CrawlSummary, FlagSeverity, PageResult, Skip } from "./types";

/**
 * A page that could not be read: no response, an HTTP error, or a redirect the crawl could not follow
 * (outside the domain, disallowed by robots.txt, a loop). Every crawled page is either OK or this.
 */
const failed = (p: PageResult) => p.status == null || p.status >= 400 || !!p.error;

/** End-of-crawl summary (pure): pages, flags by type and severity, average score, worst pages. */
export function summarizeCrawl(pages: PageResult[], skips: Skip[], durationMs: number, stopReason: string | null): CrawlSummary {
  const flags = pages.flatMap((p) => p.flags);
  const bySeverity: Record<FlagSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of flags) bySeverity[f.severity]++;
  const scored = pages.map((p) => p.score?.score).filter((s): s is number => s != null);
  const weight = (p: PageResult) => p.flags.reduce((s, f) => s + ({ critical: 8, high: 4, medium: 2, low: 1 })[f.severity], 0);
  const worst = [...pages]
    .filter((p) => p.flags.length || (p.status ?? 0) >= 400)
    .sort((a, b) => ((a.status ?? 0) >= 400 ? 0 : 1) - ((b.status ?? 0) >= 400 ? 0 : 1) || (a.score?.score ?? 11) - (b.score?.score ?? 11) || weight(b) - weight(a))
    .slice(0, 5)
    .map((p) => ({ index: p.index, url: p.finalUrl || p.url, score: p.score?.score ?? null, flags: p.flags.length }));
  return {
    pages: pages.length,
    ok: pages.filter((p) => !failed(p)).length,
    errors: pages.filter(failed).length,
    skipped: skips.length,
    flags: flags.length,
    byRule: groupFlags(flags).map((g) => ({ rule: g.rule, label: g.label, severity: g.severity, count: g.items.length })),
    bySeverity,
    avgScore: scored.length ? Math.round((scored.reduce((s, v) => s + v, 0) / scored.length) * 10) / 10 : null,
    worst,
    durationMs,
    stopReason,
  };
}
