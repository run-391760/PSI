/**
 * Rule-based search intent from the keyword text alone (client-safe, no server imports).
 *
 * This is a classification of the words people typed, not a measurement: it never guesses when no rule
 * matches (returns []), and the UI labels it "text-based" so it is not mistaken for a SERP/volume model.
 */
import type { Intent } from "@/lib/seo/types";

const RE = {
  question: /^(what|how|why|when|where|which|who|is|are|can|does|do|should|will)\b/,
  transactional:
    /\b(buy|price|prices|pricing|cost|cheap|deal|deals|discount|coupon|coupons|promo code|order|for sale|sale|shop|near me|booking|book|rent|rental|hire|delivery|apply|download|subscribe|quote|quotes|fees|under \d+|emi|lease|trial|near by|nearby|open now|for rent)\b/,
  commercial:
    /\b(best|top|review|reviews|vs|versus|compare|comparison|alternative|alternatives|affordable|premium|luxury|brands|top rated|ranking|rankings|pros and cons|worth it)\b/,
  informational:
    /\b(how|what|why|guide|tips|ideas|meaning|definition|examples|symptoms|causes|benefits|types|history|facts|tutorial|recipe|recipes|statistics|trends|list|chart|syllabus|eligibility|requirements|process|questions|template|calculator)\b/,
  navigational: /\b(login|log in|sign in|signin|website|official site|official website|portal|contact|customer care|customer service|phone number|address|app download)\b/,
};

export function textIntents(keyword: string): Intent[] {
  const k = keyword.toLowerCase().trim();
  if (!k) return [];
  const found: Intent[] = [];
  if (RE.navigational.test(k)) found.push("navigational");
  if (RE.question.test(k) || k.includes("?")) found.push("informational");
  if (RE.transactional.test(k)) found.push("transactional");
  if (RE.commercial.test(k)) found.push("commercial");
  if (RE.informational.test(k) && !found.includes("informational")) found.push("informational");
  return [...new Set(found)].slice(0, 2);
}

export const TEXT_INTENT_NOTE = "Text-based intent: classified from the words in the keyword (e.g. “buy”, “best”, “how”), not from Google results or search volume.";
