import { backlinks as engineBacklinks, brandPhrase, referringDomains, topicById, toxicity } from "@/lib/seo/engine";
import { hosting, isSharedHost, subnetOf, topicIdOf } from "./metrics";
import { TOXIC_MIN, POTENTIAL_MIN, type AuditLevel } from "./types";

/**
 * Backlink Audit scoring (demo engine). Starts from the engine's toxicity() markers and adds
 * project-aware markers that depend on the audit setup (brand terms, target country) and on the
 * whole profile (shared subnets). Pure and deterministic.
 */
export type ScoredDomain = {
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

export function scoreProfile(domain: string, opts: { brandTerms: string[]; country: string }): { rows: ScoredDomain[]; backlinksAnalyzed: number } {
  const rds = referringDomains(domain);
  const bls = engineBacklinks(domain);
  const topicName = topicById(topicIdOf(domain)).name;
  const brand = [brandPhrase(domain), domain.split(".")[0], ...opts.brandTerms].map((b) => b.toLowerCase().trim()).filter((b) => b.length >= 3);
  const byDomain = new Map<string, typeof bls>();
  for (const b of bls) {
    const list = byDomain.get(b.sourceDomain) ?? [];
    list.push(b);
    byDomain.set(b.sourceDomain, list);
  }
  const hosts = new Map(rds.map((r) => [r.domain, hosting(r)]));
  const ips = new Map([...hosts.entries()].map(([d, h]) => [d, h.ip]));
  const subnetCount = new Map<string, number>();
  for (const ip of ips.values()) subnetCount.set(subnetOf(ip), (subnetCount.get(subnetOf(ip)) ?? 0) + 1);

  const rows = rds.map((rd) => {
    const t = toxicity(rd);
    let score = t.score;
    const markers = [...t.markers];
    const add = (marker: string, points: number) => {
      if (markers.includes(marker)) return;
      markers.push(marker);
      score += points;
    };
    const links = byDomain.get(rd.domain) ?? [];
    const ip = ips.get(rd.domain)!;
    const unrelated = rd.kind === "spam" || (rd.kind === "blog" && rd.category !== topicName && rd.category !== "News & Media");
    if (unrelated) add("Unrelated category", 8);
    if (opts.country && unrelated && rd.authorityScore < 20 && hosts.get(rd.domain)!.country !== opts.country && hosts.get(rd.domain)!.country !== "US") add("Geo mismatch", 8);
    if (links.length && links.every((l) => (l.anchorType === "exact" || l.anchorType === "partial") && !brand.some((b) => l.anchor.toLowerCase().includes(b)))) add("Money anchor text", 12);
    if (links.some((l) => l.externalLinks > 300)) add("Too many outbound links", 8);
    if ((subnetCount.get(subnetOf(ip)) ?? 0) >= 3 && !isSharedHost(ip) && rd.kind !== "platform") add("Same IP network", 10);
    const sample = links[0];
    return {
      domain: rd.domain,
      toxicity: Math.max(0, Math.min(100, score)),
      markers,
      authority_score: rd.authorityScore,
      backlinks: rd.backlinks,
      country: hosts.get(rd.domain)!.country,
      ip,
      category: rd.category,
      follow: rd.follow,
      first_seen: rd.firstSeen,
      last_seen: rd.lastSeen,
      sample_url: sample?.sourceUrl ?? `https://${rd.domain}/`,
      sample_anchor: sample?.anchor ?? "",
    };
  });
  return { rows: rows.sort((a, b) => b.toxicity - a.toxicity), backlinksAnalyzed: bls.length };
}

export const toxicClass = (score: number) => (score >= TOXIC_MIN ? "toxic" : score >= POTENTIAL_MIN ? "potentially" : "non");

/** Overall toxic score 0–100 from the share of toxic and potentially toxic domains. */
export function overallScore(toxic: number, potentially: number, analyzed: number): { score: number; level: AuditLevel } {
  if (!analyzed) return { score: 0, level: "low" };
  const score = Math.min(100, Math.round(((toxic * 3 + potentially) / analyzed) * 100));
  return { score, level: score >= 20 ? "high" : score >= 6 ? "medium" : "low" };
}
