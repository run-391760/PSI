import assert from "node:assert/strict";
import { test } from "node:test";

for (const k of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "SARVAM_API_KEY"]) delete process.env[k];
const s = await import("../src/lib/cx/sentiment-ai");

test("alignResults: maps by index, clamps scores, ignores unknown and duplicate indexes", () => {
  const r = s.alignResults(3, [
    { i: 2, sentiment: "negative", score: -1.7, abusive: true },
    { i: 0, sentiment: "positive", score: 0.456, abusive: false },
    { i: 0, sentiment: "negative", score: -0.5, abusive: false },
    { i: 9, sentiment: "neutral", score: 0, abusive: false },
  ]);
  assert.deepEqual(r, [{ sentiment: "positive", score: 0.46, abusive: false }, null, { sentiment: "negative", score: -1, abusive: true }]);
});

test("aiSentiments: without a Gemini or Sarvam key every text keeps the lexicon (null), with no network call", async () => {
  assert.equal(s.aiSentimentEnabled(), false);
  assert.deepEqual(await s.aiSentiments(["great", "awful"]), [null, null]);
  process.env.OPENAI_API_KEY = "x"; // other providers don't count: sentiment uses Gemini, then Sarvam
  assert.equal(s.aiSentimentEnabled(), false);
  delete process.env.OPENAI_API_KEY;
});

test("aiSentiments: a daily limit of 0 turns AI sentiment off", () => {
  process.env.GEMINI_API_KEY = "x";
  process.env.AI_SENTIMENT_DAILY_LIMIT = "0";
  assert.equal(s.aiSentimentEnabled(), false);
  delete process.env.AI_SENTIMENT_DAILY_LIMIT;
  assert.equal(s.aiSentimentEnabled(), true);
  delete process.env.GEMINI_API_KEY;
});
