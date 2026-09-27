/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Pure mappings from DataForSEO Backlinks API rows to the backlinks module's view models. No server
 * imports, so they can be unit-tested with fixture rows (tests/links-content-real.test.ts).
 * Unknown values stay null / empty; nothing here invents numbers.
 */
import type { AnchorType, BulkRow, BulkTarget, LbProspect } from "./types";

export const dfsAs = (rank?: number | null) => (rank == null ? 0 : Math.round(Math.min(1000, rank) / 10));
export const dfsDay = (s?: string | null) => (s ? String(s).slice(0, 10) : "");
const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

/** Classify an anchor text relative to the target domain (and optional brand terms). */
export function anchorType(anchor: string, domain: string, brandTerms: string[] = []): AnchorType {
  const a = anchor.toLowerCase().trim();
  if (!a) return "image";
  if (a.includes(domain) || /^https?:\/\//.test(a) || a.startsWith("www.")) return "naked";
  if (a.includes(domain.split(".")[0]) || brandTerms.some((b) => b.length >= 3 && a.includes(b.toLowerCase()))) return "branded";
  if (/^(click here|here|website|read more|learn more|this article|source|link|visit site|official site|more|this|homepage|home page)$/.test(a)) return "generic";
  return "partial";
}

/* ------------------------------------------------------------------------------------------------
 * Bulk Analysis
 * ---------------------------------------------------------------------------------------------- */

export type BulkRaw = { ranks: Map<string, any>; backlinks: Map<string, any>; referringDomains: Map<string, any>; newLostRd?: Map<string, any>; newLostBl?: Map<string, any> };

/** Map bulk_ranks / bulk_backlinks / bulk_referring_domains / bulk_new_lost_* items to rows. */
export function bulkRowsFromDfs(targets: BulkTarget[], res: BulkRaw): BulkRow[] {
  return targets.map((t) => {
    const r = res.ranks.get(t.target);
    const b = res.backlinks.get(t.target);
    const d = res.referringDomains.get(t.target);
    const nlr = res.newLostRd?.get(t.target);
    const nlb = res.newLostBl?.get(t.target);
    const rd: number | null = typeof d?.referring_domains === "number" ? d.referring_domains : null;
    const nofollow: number | null = typeof d?.referring_domains_nofollow === "number" ? d.referring_domains_nofollow : null;
    const num = (v: unknown) => (typeof v === "number" ? v : null);
    return {
      target: t.target,
      kind: t.kind,
      domain: t.domain,
      authorityScore: typeof r?.rank === "number" ? dfsAs(r.rank) : null,
      referringDomains: rd,
      backlinks: num(b?.backlinks),
      referringIps: num(d?.referring_ips),
      followPct: rd && nofollow != null ? round((1 - nofollow / rd) * 100) : null,
      nofollowPct: rd && nofollow != null ? round((nofollow / rd) * 100) : null,
      textPct: null,
      imagePct: null,
      newRd30: num(nlr?.new_referring_domains),
      lostRd30: num(nlr?.lost_referring_domains),
      newBl30: num(nlb?.new_backlinks),
      lostBl30: num(nlb?.lost_backlinks),
    };
  });
}

/* ------------------------------------------------------------------------------------------------
 * Backlink Audit (live toxicity from real signals only)
 * ---------------------------------------------------------------------------------------------- */

export type LiveAuditDomain = { domain: string; spamScore: number | null; authorityScore: number; backlinks: number; firstSeen: string; lastSeen: string; follow: boolean };
export type LiveAuditSample = { url: string; anchor: string; ip: string; country: string; externalLinks: number | null };
export type LiveScored = {
  domain: string;
  toxicity: number;
  markers: string[];
  authority_score: number;
  backlinks: number;
  country: string;
  ip: string;
  category: string;
  follow: boolean;
  first_seen: string;
  last_seen: string;
  sample_url: string;
  sample_anchor: string;
};

/** Markers the live audit can compute from real data (shown in the setup explanation). */
export const LIVE_MARKERS = [
  "High spam score",
  "Spam in domain name",
  "Suspicious TLD",
  "Low Authority Score",
  "Sitewide link",
  "Too many outbound links",
  "Money anchor text",
  "Same IP network",
] as const;

export const SPAM_WORDS = /(casino|poker|slots?|betting|bet365|viagra|cialis|pills?|pharma|loans?|payday|porn|xxx|sex|escort|replica|essay|seo-?links|backlinks?|linkdir|link-?farm|directory|submit|bookmark|article-?submit|cheap-)/;
export const SUSPICIOUS_TLDS = [".xyz", ".top", ".click", ".icu", ".work", ".loan", ".win", ".bid", ".gq", ".ml", ".cf", ".tk", ".ga", ".buzz", ".rest", ".cyou"];

const subnet = (ip: string) => (/^\d+\.\d+\.\d+\.\d+$/.test(ip) ? ip.split(".").slice(0, 3).join(".") : "");

/** Map backlinks/backlinks (mode one_per_domain) items to one sample link per referring domain. */
export function samplesByDomain(items: any[]): Map<string, LiveAuditSample> {
  const out = new Map<string, LiveAuditSample>();
  for (const b of items ?? []) {
    const d = String(b?.domain_from ?? "").replace(/^www\./, "");
    if (!d || out.has(d)) continue;
    out.set(d, {
      url: String(b.url_from ?? ""),
      anchor: String(b.anchor ?? ""),
      ip: String(b.domain_from_ip ?? ""),
      country: String(b.domain_from_country ?? ""),
      externalLinks: typeof b.page_from_external_links === "number" ? b.page_from_external_links : null,
    });
  }
  return out;
}

/**
 * Toxicity 0–100 = DataForSEO's backlinks spam score plus points for markers computed from the real
 * link data (domain name, TLD, authority, link counts, sample anchor, shared /24 subnets).
 */
export function scoreLiveAudit(domains: LiveAuditDomain[], samples: Map<string, LiveAuditSample>, opts: { domain: string; brandTerms: string[] }): LiveScored[] {
  const subnets = new Map<string, number>();
  for (const d of domains) {
    const s = subnet(samples.get(d.domain)?.ip ?? "");
    if (s) subnets.set(s, (subnets.get(s) ?? 0) + 1);
  }
  const rows = domains.map((d) => {
    const sample = samples.get(d.domain);
    const markers: string[] = [];
    let score = Math.max(0, Math.min(100, Math.round(d.spamScore ?? 0)));
    const add = (m: string, pts: number) => {
      markers.push(m);
      score += pts;
    };
    if ((d.spamScore ?? 0) >= 60) markers.push("High spam score");
    if (SPAM_WORDS.test(d.domain)) add("Spam in domain name", 15);
    if (SUSPICIOUS_TLDS.some((t) => d.domain.endsWith(t))) add("Suspicious TLD", 10);
    if (d.authorityScore < 5) add("Low Authority Score", 8);
    if (d.backlinks >= 200) add("Sitewide link", 6);
    if (sample?.externalLinks != null && sample.externalLinks > 300) add("Too many outbound links", 8);
    if (sample?.anchor) {
      const t = anchorType(sample.anchor, opts.domain, opts.brandTerms);
      if ((t === "partial" || t === "exact") && sample.anchor.trim().split(/\s+/).length >= 2) add("Money anchor text", 6);
    }
    const sn = subnet(sample?.ip ?? "");
    if (sn && (subnets.get(sn) ?? 0) >= 3) add("Same IP network", 10);
    return {
      domain: d.domain,
      toxicity: Math.max(0, Math.min(100, score)),
      markers,
      authority_score: d.authorityScore,
      backlinks: d.backlinks,
      country: sample?.country ?? "",
      ip: sample?.ip ?? "",
      category: "",
      follow: d.follow,
      first_seen: d.firstSeen,
      last_seen: d.lastSeen,
      sample_url: sample?.url || `https://${d.domain}/`,
      sample_anchor: sample?.anchor ?? "",
    };
  });
  return rows.sort((a, b) => b.toxicity - a.toxicity);
}

/* ------------------------------------------------------------------------------------------------
 * Link Building prospects (competitors' real referring domains + real SERP)
 * ---------------------------------------------------------------------------------------------- */

export type ProspectInput = {
  domain: string;
  competitors: string[];
  /** Referring domains of our own domain (excluded). */
  ours: string[];
  /** Referring domains per competitor (real rows). */
  competitorLinks: Record<string, { domain: string; authorityScore: number; spamScore?: number | null }[]>;
  /** Organic results per keyword (real SERP). */
  serps: Record<string, { domain: string; position: number }[]>;
  /** Very large platforms to skip (e.g. google.com, wikipedia.org). */
  skip?: string[];
};

const DEFAULT_SKIP = ["google.com", "youtube.com", "facebook.com", "wikipedia.org", "twitter.com", "x.com", "instagram.com", "linkedin.com", "amazon.com", "pinterest.com", "reddit.com", "apple.com", "microsoft.com"];

export function rateProspects(input: ProspectInput): LbProspect[] {
  const ours = new Set(input.ours);
  const skip = new Set([...(input.skip ?? DEFAULT_SKIP), input.domain, ...input.competitors]);
  type Acc = { domain: string; authorityScore: number | null; competitors: string[]; keywords: { keyword: string; position: number }[] };
  const map = new Map<string, Acc>();
  for (const c of input.competitors) {
    for (const rd of input.competitorLinks[c] ?? []) {
      if (!rd.domain || skip.has(rd.domain) || ours.has(rd.domain)) continue;
      if ((rd.spamScore ?? 0) >= 45) continue;
      const a = map.get(rd.domain) ?? { domain: rd.domain, authorityScore: rd.authorityScore, competitors: [], keywords: [] };
      if (!a.competitors.includes(c)) a.competitors.push(c);
      map.set(rd.domain, a);
    }
  }
  for (const [k, rows] of Object.entries(input.serps)) {
    for (const r of rows) {
      if (!r.domain || skip.has(r.domain) || ours.has(r.domain)) continue;
      const a = map.get(r.domain) ?? { domain: r.domain, authorityScore: null, competitors: [], keywords: [] };
      if (!a.keywords.some((x) => x.keyword === k)) a.keywords.push({ keyword: k, position: r.position });
      map.set(r.domain, a);
    }
  }
  const nComp = input.competitors.length;
  const out: LbProspect[] = [];
  for (const a of map.values()) {
    const compShare = nComp ? a.competitors.length / nComp : 0;
    const relevance = a.keywords.length ? 1 : a.competitors.length >= 2 ? 0.55 : 0.2;
    const best = a.keywords.reduce((m, k) => Math.min(m, k.position), 101);
    const kwScore = a.keywords.length ? Math.min(1, 0.45 + 0.12 * a.keywords.length + (best <= 10 ? 0.2 : 0)) : 0;
    const asPart = a.authorityScore == null ? 0.15 : a.authorityScore / 100;
    const score = 0.35 * asPart + 0.3 * relevance + 0.35 * Math.max(compShare, kwScore);
    const rating = score >= 0.72 ? 5 : score >= 0.6 ? 4 : score >= 0.47 ? 3 : score >= 0.36 ? 2 : 1;
    const reasons: string[] = [];
    if (a.competitors.length) reasons.push(`Links to ${a.competitors.length} of ${nComp} competitor${nComp === 1 ? "" : "s"} (${a.competitors.slice(0, 3).join(", ")}${a.competitors.length > 3 ? "…" : ""})`);
    if (a.keywords.length) {
      const top = [...a.keywords].sort((x, y) => x.position - y.position)[0];
      reasons.push(`Ranks #${top.position} for “${top.keyword}”${a.keywords.length > 1 ? ` and ${a.keywords.length - 1} more keyword${a.keywords.length > 2 ? "s" : ""}` : ""}`);
    }
    if (a.authorityScore != null) reasons.push(`AS ${a.authorityScore}`);
    out.push({
      domain: a.domain,
      rating,
      score: Math.round(score * 1000) / 1000,
      authorityScore: a.authorityScore ?? 0,
      category: "",
      relevance: relevance === 1 ? "high" : relevance > 0.5 ? "medium" : "low",
      competitors: a.competitors,
      keywords: a.keywords.sort((x, y) => x.position - y.position),
      source: a.competitors.length && a.keywords.length ? "both" : a.competitors.length ? "competitors" : "keywords",
      reason: reasons.join(" · "),
    });
  }
  return out.sort((a, b) => b.score - a.score || b.authorityScore - a.authorityScore).slice(0, 300);
}
