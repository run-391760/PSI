import type { ParsedDoc } from "../parse";

/** Factual and risky claim detection shared by Content Quality and E-E-A-T. */

export type Claim = { text: string; paragraph: number; kinds: string[]; supported: boolean; risk: "high" | "medium" | "low"; riskReason: string | null };

const STAT = /\b\d[\d,.]*\s?(%|percent|per cent|lakh|lakhs|crore|crores|million|billion|thousand|k\b|x\b)|\b(\d{1,3}(,\d{3})+|\d{4,})\b|\b(ranked|rank(s|ed)?|top)\s+(#?\d+|first|second|third)\b|#\s?1\b/i;
const RESEARCH = /\b(studies|study|research|survey|report|data|statistics|according to|experts? (say|says|agree)|scientists?|evidence)\b/i;
const SUPERLATIVE = /\b(the )?(best|largest|biggest|highest|lowest|fastest|first|only|leading|most (popular|trusted|advanced|recognized|reputed)|number one|no\.? ?1|#1|top-ranked|world[- ]class)\b/i;
const YEAR = /\b(19|20)\d{2}\b/;

const HIGH_RISK: { re: RegExp; reason: string }[] = [
  { re: /\b(100\s?%|hundred percent)\s+(placement|placements|job|jobs|guarantee|guaranteed|success|results?|pass|selection|admission)/i, reason: "absolute outcome promise" },
  { re: /\b(guarantee|guarantees|guaranteed|assured|assure)\b/i, reason: "guarantee" },
  { re: /\b(risk[- ]free|no risk|zero risk|never fails?|can't lose|cannot lose)\b/i, reason: "risk-free promise" },
  { re: /\b(cure|cures|cured|heal|heals|treats?|prevents?)\s+(cancer|diabetes|covid|disease|illness|depression|anxiety)\b/i, reason: "medical claim" },
  { re: /\b(returns? of|earn|earning|income of|salary of)\s+(up to\s+)?(₹|rs\.?|inr|\$)?\s?\d/i, reason: "earnings/financial promise" },
  { re: /\b(best|no\.?\s?1|number one|#1|top)\s+(university|college|institute|school|hospital|company|brand)\s+(in|of)\s+(the\s+)?(world|india|country|asia|state|gujarat)\b/i, reason: "unqualified ranking claim" },
  { re: /\b(approved|accredited|recognised|recognized|certified|ranked)\s+by\s+[A-Z]/, reason: "accreditation/ranking claim (must be verifiable)" },
];
const MEDIUM_RISK: { re: RegExp; reason: string }[] = [
  { re: /\b(always|never|everyone|no one|nobody|all students|every student)\b/i, reason: "absolute wording" },
  { re: SUPERLATIVE, reason: "superlative" },
  { re: /\b(proven|scientifically proven|clinically)\b/i, reason: "proof claim" },
];

const CITED = /\[[^\]]+\]\([^)]+\)|<a\s|\[\d+\]|\(source:|\bsource:|according to [A-Z]|\bper (the )?[A-Z][a-z]+ (report|study|survey|data)/;

export function detectClaims(doc: ParsedDoc): Claim[] {
  const out: Claim[] = [];
  doc.paragraphs.forEach((p, pi) => {
    const sentences = p.raw.split(/(?<=[.!?])\s+(?=[A-Z0-9“"(])/);
    const paragraphCited = CITED.test(p.raw);
    for (const raw of sentences) {
      const kinds: string[] = [];
      if (STAT.test(raw)) kinds.push("statistic");
      if (RESEARCH.test(raw)) kinds.push("research");
      if (SUPERLATIVE.test(raw)) kinds.push("superlative");
      if (YEAR.test(raw) && /\b(in|since|by|as of)\s+(19|20)\d{2}\b/i.test(raw)) kinds.push("dated fact");
      const high = HIGH_RISK.find((r) => r.re.test(raw));
      const med = MEDIUM_RISK.find((r) => r.re.test(raw));
      if (!kinds.length && !high && !med) continue;
      const text = raw.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_`]/g, "").trim();
      // High-risk claims need a source in the sentence itself; other claims may lean on the paragraph's source.
      const supported = CITED.test(raw) || (paragraphCited && !high);
      out.push({ text, paragraph: pi, kinds: kinds.length ? kinds : ["claim"], supported, risk: high ? "high" : med ? "medium" : "low", riskReason: high?.reason ?? med?.reason ?? null });
    }
  });
  return out;
}

const CREDIBLE_TLD = /\.(gov|gov\.[a-z]{2}|nic\.in|edu|edu\.[a-z]{2}|ac\.[a-z]{2}|int|mil)$/i;
const CREDIBLE_HOSTS = /(^|\.)(who\.int|un\.org|worldbank\.org|oecd\.org|nature\.com|science\.org|sciencedirect\.com|springer\.com|ieee\.org|acm\.org|nih\.gov|ncbi\.nlm\.nih\.gov|pubmed|wikipedia\.org|britannica\.com|reuters\.com|apnews\.com|bbc\.(co\.uk|com)|nytimes\.com|theguardian\.com|thehindu\.com|indianexpress\.com|hindustantimes\.com|livemint\.com|economictimes\.indiatimes\.com|timesofindia\.indiatimes\.com|statista\.com|pewresearch\.org|ugc\.gov\.in|aicte-india\.org|naac\.gov\.in|nirfindia\.org|education\.gov\.in|mohfw\.gov\.in|rbi\.org\.in|sebi\.gov\.in|forbes\.com|harvard\.edu|mit\.edu|stanford\.edu|ox\.ac\.uk|cam\.ac\.uk)$/i;
const WEAK_HOSTS = /(^|\.)(bit\.ly|tinyurl\.com|t\.co|goo\.gl|ow\.ly|is\.gd|buff\.ly|rebrand\.ly|blogspot\.com|medium\.com|quora\.com|reddit\.com|pinterest\.com|scribd\.com)$/i;

export function sourceQuality(url: string): "credible" | "weak" | "neutral" {
  let host = "";
  try {
    host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "neutral";
  }
  if (CREDIBLE_TLD.test(host) || CREDIBLE_HOSTS.test(host)) return "credible";
  if (WEAK_HOSTS.test(host)) return "weak";
  return "neutral";
}
