import { CHECK_MAP, THEMES, cwvStatus } from "./checks";
import type { CrawlStats, CwvSummary, Severity, ThemeKey } from "./types";

export type ScorePage = { id: number; status: number | null; noindex: boolean };
export type ScoreIssue = { check: string; pageId: number | null };

const SITE_PENALTY: Record<Severity, number> = { error: 8, warning: 3, notice: 1 };

/**
 * Site Health and thematic scores (Semrush-style). Health = share of crawled pages free of errors
 * (80 % weight) and of warnings (20 % weight), minus a penalty of 3 points per site-wide error and
 * 1 per site-wide warning (max 12). Theme scores use the same idea restricted to the theme's checks.
 */
export function scoreCrawl(pages: ScorePage[], issues: ScoreIssue[], cwv: CwvSummary | null, durationMs: number) {
  const fetched = pages.filter((p) => p.status != null);
  const n = fetched.length || 1;
  const perPage = new Map<number, { error: number; warning: number; notice: number; themes: Map<ThemeKey, Severity> }>();
  const byCheck: Record<string, number> = {};
  const pagesByCheckSets: Record<string, Set<number>> = {};
  const siteChecks = new Map<string, Severity>();
  let errors = 0,
    warnings = 0,
    notices = 0;
  const rank: Record<Severity, number> = { error: 3, warning: 2, notice: 1 };
  for (const i of issues) {
    const def = CHECK_MAP[i.check];
    if (!def) continue;
    byCheck[i.check] = (byCheck[i.check] ?? 0) + 1;
    if (def.severity === "error") errors++;
    else if (def.severity === "warning") warnings++;
    else notices++;
    if (i.pageId == null) {
      siteChecks.set(i.check, def.severity);
      continue;
    }
    (pagesByCheckSets[i.check] ??= new Set()).add(i.pageId);
    let pp = perPage.get(i.pageId);
    if (!pp) perPage.set(i.pageId, (pp = { error: 0, warning: 0, notice: 0, themes: new Map() }));
    pp[def.severity]++;
    const theme = THEMES.find((t) => t.category === def.category)?.key;
    if (theme) {
      const cur = pp.themes.get(theme);
      if (!cur || rank[def.severity] > rank[cur]) pp.themes.set(theme, def.severity);
    }
  }
  const pagesByCheck = Object.fromEntries(Object.entries(pagesByCheckSets).map(([k, v]) => [k, v.size]));

  const withoutErrors = fetched.filter((p) => !(perPage.get(p.id)?.error ?? 0)).length;
  const withoutWarnings = fetched.filter((p) => !(perPage.get(p.id)?.warning ?? 0)).length;
  let siteErr = 0,
    siteWarn = 0;
  for (const sev of siteChecks.values()) sev === "error" ? siteErr++ : sev === "warning" ? siteWarn++ : null;
  const health = fetched.length ? clamp(Math.round(100 * (0.8 * (withoutErrors / n) + 0.2 * (withoutWarnings / n))) - Math.min(12, siteErr * 3 + siteWarn)) : 0;

  const themes = {} as Record<ThemeKey, number | null>;
  for (const t of THEMES) {
    if (t.key === "cwv") {
      themes.cwv = cwvScore(cwv);
      continue;
    }
    let penalty = 0;
    for (const p of fetched) {
      const sev = perPage.get(p.id)?.themes.get(t.key);
      penalty += sev === "error" ? 1 : sev === "warning" ? 0.5 : sev === "notice" ? 0.1 : 0;
    }
    let site = 0;
    for (const [check, sev] of siteChecks) if (CHECK_MAP[check]?.category === t.category) site += SITE_PENALTY[sev];
    themes[t.key] = fetched.length ? clamp(Math.round(100 * (1 - penalty / n)) - Math.min(30, site)) : null;
  }

  const breakdown = { healthy: 0, broken: 0, issues: 0, redirected: 0, blocked: 0 };
  for (const p of pages) {
    const flags = perPage.get(p.id);
    if (p.status == null) breakdown.blocked++;
    else if (p.status === 0 || p.status >= 400) breakdown.broken++;
    else if (p.status >= 300) breakdown.redirected++;
    else if (p.noindex) breakdown.blocked++;
    else if (flags && (flags.error || flags.warning)) breakdown.issues++;
    else breakdown.healthy++;
  }

  const stats: CrawlStats = {
    byCheck,
    pagesByCheck,
    breakdown,
    themes,
    pages: pages.length,
    htmlPages: 0,
    fetched: fetched.length,
    pagesWithErrors: fetched.length - withoutErrors,
    pagesWithWarnings: fetched.length - withoutWarnings,
    durationMs,
  };
  const perPageCounts = new Map([...perPage.entries()].map(([id, v]) => [id, { errors: v.error, warnings: v.warning, notices: v.notice }]));
  return { health, errors, warnings, notices, stats, perPageCounts };
}

const clamp = (v: number) => Math.max(0, Math.min(100, v));

/** Share of good Core Web Vitals across measured pages (LCP, CLS and INP-or-TBT), 0–100. */
export function cwvScore(cwv: CwvSummary | null) {
  const ok = cwv?.pages.filter((p) => p.ok) ?? [];
  if (!ok.length) return null;
  let total = 0;
  for (const p of ok) {
    const lcp = cwvStatus("lcp", p.field?.lcp.value ?? p.lab.lcp.value);
    const cls = cwvStatus("cls", p.field?.cls.value ?? p.lab.cls.value);
    const resp = p.field?.inp.value != null ? cwvStatus("inp", p.field.inp.value) : cwvStatus("tbt", p.lab.tbt.value);
    const s = [lcp, cls, resp].filter(Boolean);
    total += s.length ? (s.filter((x) => x === "good").length + 0.5 * s.filter((x) => x === "ni").length) / s.length : 0;
  }
  return Math.round((100 * total) / ok.length);
}
