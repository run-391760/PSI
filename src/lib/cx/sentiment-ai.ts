import { z } from "zod";
import { llmProviders, structured, type LlmProvider } from "@/lib/providers/llm";
import type { Sentiment } from "@/lib/monitoring/sentiment";

/**
 * AI sentiment for CX (inbox tickets and new listening mentions). Gemini scores the text, Sarvam is the
 * fallback; when neither key is set, a call fails or the daily cap is reached, callers keep the built-in
 * lexicon score (analyzeText). Understands Indian languages, Hinglish, emojis, sarcasm and abuse, which the
 * lexicon misses. Never throws. Cap: AI_SENTIMENT_DAILY_LIMIT texts per UTC day (default 3000; 0 turns it off).
 */
export type AiSentiment = { sentiment: Sentiment; score: number; abusive: boolean };

/** Providers used for sentiment, in order (only configured ones are tried). */
export const SENTIMENT_PROVIDERS: LlmProvider[] = ["gemini", "sarvam"];
const BATCH = 25;
const MAX_CHARS = 1000;

const SCHEMA = z.object({
  results: z.array(z.object({
    i: z.number().int(),
    sentiment: z.enum(["positive", "neutral", "negative"]),
    score: z.number(),
    abusive: z.boolean(),
  })),
});

const SYSTEM = `You label the sentiment of short texts about a university and its services: social media comments, direct messages, reviews, forum posts and news snippets.
Texts may be in English, Hindi, Gujarati, other Indian languages or Hinglish (Indian languages in Latin script), and may use emojis, slang or sarcasm.
For each text return:
- sentiment: "positive", "negative" or "neutral", for the writer's overall tone and opinion. Questions, requests for information and factual news without an opinion are neutral. Complaints, anger, insults, abuse and sarcastic praise are negative. Enthusiasm, thanks and happy emojis are positive.
- score: a number from -1 (very negative) to 1 (very positive); 0 for neutral.
- abusive: true only for harassment, hate speech, slurs, threats, sexual content aimed at someone or insults targeting a person or group. Ordinary criticism or complaints are not abusive.
Return one result per text, using the text's number as i.`;

let day = "";
let used = 0;
const dailyLimit = () => {
  const n = Number(process.env.AI_SENTIMENT_DAILY_LIMIT ?? 3000);
  return Number.isFinite(n) && n >= 0 ? n : 3000;
};
/** Reserve up to `want` texts of today's budget; returns how many may be scored. */
function take(want: number) {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== day) { day = today; used = 0; }
  const n = Math.max(0, Math.min(want, dailyLimit() - used));
  used += n;
  return n;
}

export const aiSentimentEnabled = () => dailyLimit() > 0 && llmProviders().some((p) => SENTIMENT_PROVIDERS.includes(p));

/** Map the model's results back to the inputs (pure): unknown or missing items are null, scores clamped to -1..1. */
export function alignResults(count: number, results: z.infer<typeof SCHEMA>["results"]): (AiSentiment | null)[] {
  const out: (AiSentiment | null)[] = Array.from({ length: count }, () => null);
  for (const r of results) {
    if (r.i < 0 || r.i >= count || out[r.i]) continue;
    const score = Math.round(Math.max(-1, Math.min(1, Number.isFinite(r.score) ? r.score : 0)) * 100) / 100;
    out[r.i] = { sentiment: r.sentiment, score, abusive: r.abusive };
  }
  return out;
}

/** Score texts with Gemini (Sarvam fallback); one entry per text, null where the lexicon should be used. */
export async function aiSentiments(texts: string[], opts: { timeoutMs?: number } = {}): Promise<(AiSentiment | null)[]> {
  const out: (AiSentiment | null)[] = texts.map(() => null);
  if (!texts.length || !aiSentimentEnabled()) return out;
  const allowed = take(texts.length);
  for (let start = 0; start < allowed; start += BATCH) {
    const chunk = texts.slice(start, Math.min(start + BATCH, allowed));
    const prompt = chunk.map((t, i) => `[${i}] ${t.replace(/\s+/g, " ").trim().slice(0, MAX_CHARS) || "(empty)"}`).join("\n");
    try {
      const { data } = await structured(SCHEMA, SYSTEM, `Label these ${chunk.length} texts:\n${prompt}`, {
        providers: SENTIMENT_PROVIDERS, effort: "low", maxTokens: 120 * chunk.length + 400, timeoutMs: opts.timeoutMs ?? 30_000, name: "sentiment",
      });
      alignResults(chunk.length, data.results).forEach((r, i) => { out[start + i] = r; });
    } catch (e) {
      console.warn(`[sentiment] AI scoring failed, using the built-in lexicon: ${e instanceof Error ? e.message : String(e)}`);
      break; // the provider is failing: don't spend more of this run on it
    }
  }
  return out;
}
