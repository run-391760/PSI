import { analyzeSentiment, type Sentiment } from "@/lib/monitoring/sentiment";
import { complete as llmComplete, llmConfigured } from "@/lib/providers/llm";

/**
 * Text understanding for CX: sentiment (built-in lexicon, free), intent and language (rule-based,
 * free), and optional LLM features (suggested replies, summaries, AI classification) when an
 * Anthropic, OpenAI or Gemini key is configured (shared layer in providers/llm). Callers must handle
 * `null` = AI not configured or unavailable.
 */
export type Intent = "complaint" | "query" | "feedback" | "praise" | "purchase" | "cancellation" | "spam" | "other";
export const INTENT_LABELS: Record<Intent, string> = {
  complaint: "Complaint",
  query: "Query",
  feedback: "Feedback",
  praise: "Praise",
  purchase: "Purchase intent",
  cancellation: "Cancellation / churn risk",
  spam: "Spam",
  other: "Other",
};

export function sentimentOf(text: string): { label: Sentiment; score: number } {
  const r = analyzeSentiment(text);
  return { label: r.label, score: r.score };
}

const RULES: [Intent, RegExp][] = [
  ["spam", /\b(click here|free money|crypto giveaway|dm me for|buy followers|earn \$?\d+ (per|a) day)\b/i],
  ["cancellation", /\b(cancel|unsubscribe|close (my )?account|refund|switch(ing)? to|leaving|churn)\b/i],
  ["complaint", /\b(not working|doesn'?t work|broken|worst|terrible|awful|disappointed|complain|issue|problem|delay(ed)?|never received|scam|fraud|pathetic|horrible)\b/i],
  ["purchase", /\b(price|pricing|buy|purchase|order|quote|demo|trial|how much|discount|admission|enrol?l)\b/i],
  ["query", /(\?|\b(how (do|can|to)|what is|where (is|can)|when (will|does)|can (i|you)|is there|help me)\b)/i],
  ["praise", /\b(love|awesome|great|amazing|excellent|thank(s| you)|best|fantastic|kudos)\b/i],
  ["feedback", /\b(suggest(ion)?|feedback|would be nice|feature request|improve|please add)\b/i],
];
export function intentOf(text: string): Intent {
  for (const [intent, re] of RULES) if (re.test(text)) return intent;
  return "other";
}

/** Script-based language guess (ISO 639-1); "en" for Latin text. Good enough for routing/filters. */
export function languageOf(text: string): string {
  if (/[ऀ-ॿ]/.test(text)) return "hi";
  if (/[઀-૿]/.test(text)) return "gu";
  if (/[஀-௿]/.test(text)) return "ta";
  if (/[؀-ۿ]/.test(text)) return "ar";
  if (/[一-鿿]/.test(text)) return "zh";
  if (/[Ѐ-ӿ]/.test(text)) return "ru";
  return "en";
}

export function analyzeText(text: string) {
  const s = sentimentOf(text);
  return { sentiment: s.label, sentimentScore: s.score, intent: intentOf(text), language: languageOf(text) };
}

// ---------------------------------------------------------------- optional LLM

export const aiConfigured = () => llmConfigured();

/** One-shot LLM completion. Never throws: null when no AI key is configured or every provider failed. */
export async function complete(system: string, prompt: string, maxTokens = 1200): Promise<string | null> {
  return llmComplete(system, prompt, { maxTokens });
}

/** Suggested agent reply for a conversation (null when AI is not configured). */
export async function suggestReply(opts: { brand: string; conversation: { from: "customer" | "agent"; text: string }[]; tone?: string }) {
  const transcript = opts.conversation.map((m) => `${m.from === "customer" ? "Customer" : "Agent"}: ${m.text}`).join("\n");
  return complete(
    `You are a customer support agent for ${opts.brand}. Write the next reply to the customer: ${opts.tone ?? "friendly, concise and helpful"}. Do not invent policies, prices or facts not in the conversation; if information is missing, ask for it or say you will check. Reply with the message text only.`,
    transcript,
    600,
  );
}
