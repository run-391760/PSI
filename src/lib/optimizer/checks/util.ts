import type { EvidenceItem, EvidenceSource, Finding, FixOption, Status } from "../types";

export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
export const round2 = (v: number) => Math.round(v * 100) / 100;

export function statusOf(score: number | null): Status {
  if (score == null) return "na";
  return score >= 0.8 ? "pass" : score >= 0.5 ? "warn" : "fail";
}

type Extra = { how?: string; items?: EvidenceItem[]; metrics?: { label: string; value: string }[]; fixes?: FixOption[]; blocker?: string; status?: Status };

/** Build a finding; status follows the score unless given. */
export function finding(feature: string, score: number | null, summary: string, sources: EvidenceSource[], extra: Extra = {}): Finding {
  const s = score == null ? null : round2(clamp01(score));
  return {
    feature,
    score: s,
    status: extra.status ?? statusOf(s),
    summary,
    how: extra.how,
    items: extra.items?.length ? extra.items : undefined,
    metrics: extra.metrics?.length ? extra.metrics : undefined,
    fixes: extra.fixes?.length ? extra.fixes : undefined,
    blocker: extra.blocker,
    sources: [...new Set(sources)],
    severity: null,
  };
}

export function na(feature: string, reason: string, how?: string): Finding {
  return finding(feature, null, reason, ["content"], { how, status: "na" });
}

/** Blend a heuristic score with Claude's (when present) 50/50. */
export const blend = (heuristic: number, ai: number | undefined | null) => (ai == null ? heuristic : (heuristic + ai) / 2);

export const pct = (v: number) => `${Math.round(v * 100)}%`;
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const quote = (s: string, max = 140) => (s.length > max ? `“${s.slice(0, max - 1).trimEnd()}…”` : `“${s}”`);
const SPECIAL: Record<string, string> = {
  bcom: "BCom", mcom: "MCom", bsc: "BSc", msc: "MSc", btech: "BTech", mtech: "MTech", phd: "PhD", bpharm: "BPharm", mpharm: "MPharm", barch: "BArch", bdes: "BDes", mdes: "MDes", bba: "BBA", mba: "MBA", bca: "BCA", mca: "MCA", llb: "LLB", llm: "LLM", mbbs: "MBBS", bds: "BDS", bams: "BAMS", bhms: "BHMS",
  neet: "NEET", jee: "JEE", cat: "CAT", mat: "MAT", xat: "XAT", cmat: "CMAT", gmat: "GMAT", gre: "GRE", ielts: "IELTS", toefl: "TOEFL", cuet: "CUET", gate: "GATE", upsc: "UPSC", ugc: "UGC", aicte: "AICTE", naac: "NAAC", nirf: "NIRF", nba: "NBA",
  ai: "AI", ml: "ML", seo: "SEO", hr: "HR", usa: "USA", uk: "UK", uae: "UAE", faq: "FAQ", faqs: "FAQs", pdf: "PDF", api: "API", crm: "CRM", erp: "ERP", gst: "GST", emi: "EMI", nri: "NRI", iit: "IIT", iim: "IIM", nit: "NIT",
};
const SMALL = new Set(["vs", "and", "or", "of", "in", "for", "the", "to", "a", "an", "on", "at", "by", "with"]);
/** Title case with acronyms (MBA, BCom, NEET…) and small words kept lower case. */
export const cap = (s: string) => s.replace(/[A-Za-z][A-Za-z0-9]*/g, (w, i: number) => SPECIAL[w.toLowerCase()] ?? (i > 0 && SMALL.has(w.toLowerCase()) ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1)));
/** Sentence case that still fixes acronyms (“mba fees” → “MBA fees”). */
export const capFirst = (s: string) => {
  const t = s.replace(/[A-Za-z][A-Za-z0-9]*/g, (w) => SPECIAL[w.toLowerCase()] ?? w);
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
};

/** All matches of a phrase list in a text (case-insensitive, word boundaries). */
export function phraseHits(text: string, phrases: string[]) {
  const out: { phrase: string; count: number }[] = [];
  const lower = text.toLowerCase();
  for (const p of phrases) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")}(?![\\p{L}\\p{N}])`, "giu");
    const n = (lower.match(re) ?? []).length;
    if (n) out.push({ phrase: p, count: n });
  }
  return out.sort((a, b) => b.count - a.count);
}

export const YEAR_NOW = () => new Date().getFullYear();
