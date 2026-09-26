import { GIANTS, memo, referringDomains, serp, topicById, toxicity } from "@/lib/seo/engine";
import { linkingDomainAs, topicIdOf } from "./metrics";
import type { LbProspect } from "./types";

const GIANT_SET = new Set(GIANTS.map((g) => g.domain));

/**
 * Candidate link sources: domains linking to competitors (but not to the project) and sites ranking
 * for the target keywords. Rated 1–5 from authority, topical relevance and competitor overlap.
 */
export const computeProspects = memo(
  (domain: string, db: string, keywords: string[], competitors: string[]): LbProspect[] => {
    const topicName = topicById(topicIdOf(domain)).name;
    const ours = new Set(referringDomains(domain).map((r) => r.domain));
    const exclude = new Set([domain, ...competitors]);
    type Acc = { domain: string; authorityScore: number; category: string; competitors: string[]; keywords: { keyword: string; position: number }[] };
    const map = new Map<string, Acc>();
    for (const c of competitors) {
      for (const rd of referringDomains(c)) {
        if (exclude.has(rd.domain) || ours.has(rd.domain) || rd.kind === "spam" || GIANT_SET.has(rd.domain)) continue;
        if (toxicity(rd).score >= 45) continue;
        const a = map.get(rd.domain) ?? { domain: rd.domain, authorityScore: rd.authorityScore, category: rd.category, competitors: [], keywords: [] };
        if (!a.competitors.includes(c)) a.competitors.push(c);
        map.set(rd.domain, a);
      }
    }
    for (const k of keywords) {
      for (const r of serp(k, db, { depth: 30 })) {
        if (exclude.has(r.domain) || ours.has(r.domain) || GIANT_SET.has(r.domain)) continue;
        const a = map.get(r.domain) ?? { domain: r.domain, authorityScore: linkingDomainAs(r.domain), category: topicName, competitors: [], keywords: [] };
        a.keywords.push({ keyword: k, position: r.position });
        map.set(r.domain, a);
      }
    }
    const out: LbProspect[] = [];
    for (const a of map.values()) {
      const relevance = a.keywords.length || a.category === topicName ? 1 : a.category === "Online communities" || a.category === "News & Media" ? 0.55 : 0.2;
      const compShare = competitors.length ? a.competitors.length / competitors.length : 0;
      const best = a.keywords.reduce((m, k) => Math.min(m, k.position), 101);
      const kwScore = a.keywords.length ? Math.min(1, 0.45 + 0.12 * a.keywords.length + (best <= 10 ? 0.2 : 0)) : 0;
      const score = 0.35 * (a.authorityScore / 100) + 0.3 * relevance + 0.35 * Math.max(compShare, kwScore);
      const rating = score >= 0.72 ? 5 : score >= 0.6 ? 4 : score >= 0.47 ? 3 : score >= 0.36 ? 2 : 1;
      const reasons: string[] = [];
      if (a.competitors.length) reasons.push(`Links to ${a.competitors.length} of ${competitors.length} competitor${competitors.length === 1 ? "" : "s"} (${a.competitors.slice(0, 3).join(", ")}${a.competitors.length > 3 ? "…" : ""})`);
      if (a.keywords.length) {
        const top = [...a.keywords].sort((x, y) => x.position - y.position)[0];
        reasons.push(`Ranks #${top.position} for “${top.keyword}”${a.keywords.length > 1 ? ` and ${a.keywords.length - 1} more keyword${a.keywords.length > 2 ? "s" : ""}` : ""}`);
      }
      reasons.push(`AS ${a.authorityScore}`);
      reasons.push(relevance === 1 ? `Relevant: ${a.keywords.length ? "ranks for your keywords" : topicName}` : relevance > 0.5 ? `Community / media site` : `Other topic: ${a.category}`);
      out.push({
        domain: a.domain,
        rating,
        score: Math.round(score * 1000) / 1000,
        authorityScore: a.authorityScore,
        category: a.category,
        relevance: relevance === 1 ? "high" : relevance > 0.5 ? "medium" : "low",
        competitors: a.competitors,
        keywords: a.keywords.sort((x, y) => x.position - y.position),
        source: a.competitors.length && a.keywords.length ? "both" : a.competitors.length ? "competitors" : "keywords",
        reason: reasons.join(" · "),
      });
    }
    return out.sort((a, b) => b.score - a.score || b.authorityScore - a.authorityScore).slice(0, 300);
  },
  50,
);
