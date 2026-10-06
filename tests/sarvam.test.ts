import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { AppError } from "../src/lib/domain";
import { chunkText, fromSarvamCode, isIndicLanguage, sarvamConfigured, sarvamDetectLanguage, SarvamError, sarvamTranslate, sarvamTranslatePreserving, toSarvamCode } from "../src/lib/providers/sarvam";
import { applyIndic, endIndicRun, enrichIndic, indicBudget, indicCacheKey, indicPlan, looksHinglish, runBudget, startIndicRun, type IndicResult, type IndicStore } from "../src/lib/cx/listening/indic";

// No network: Sarvam endpoints are answered by `route`, keyed by path.
type Call = { path: string; body: any; headers: Record<string, string> };
let calls: Call[] = [];
let route: (path: string, body: any) => { status: number; body: unknown } = () => ({ status: 500, body: { error: { message: "no route" } } });
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  assert.ok(url.startsWith("https://api.sarvam.ai/"), `unexpected host ${url}`);
  const path = new URL(url).pathname;
  const body = init?.body ? JSON.parse(String(init.body)) : null;
  calls.push({ path, body, headers: Object.fromEntries(new Headers(init?.headers).entries()) });
  const r = route(path, body);
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
}) as typeof fetch;

const saved = process.env.SARVAM_API_KEY;
const warn = console.warn;
beforeEach(() => {
  process.env.SARVAM_API_KEY = "sk-test";
  calls = [];
  console.warn = () => {};
});
afterEach(() => {
  if (saved === undefined) delete process.env.SARVAM_API_KEY;
  else process.env.SARVAM_API_KEY = saved;
  console.warn = warn;
});

/** A fake translator: "[en] <input>" and the source it was told (or hi-IN for auto). */
const translator = (detected = "hi-IN") => (path: string, body: any) =>
  path === "/translate"
    ? { status: 200, body: { request_id: "r", translated_text: `[${body.target_language_code}] ${body.input}`, source_language_code: body.source_language_code === "auto" ? detected : body.source_language_code } }
    : { status: 200, body: { request_id: "r", language_code: detected, script_code: "Latn" } };

// ------------------------------------------------------------------------------------------ languages

test("language codes: names, ISO codes, BCP-47 and the inbox phrase map to Sarvam codes", () => {
  assert.equal(toSarvamCode("Hindi"), "hi-IN");
  assert.equal(toSarvamCode("hi"), "hi-IN");
  assert.equal(toSarvamCode("gu-IN"), "gu-IN");
  assert.equal(toSarvamCode("or"), "od-IN");
  assert.equal(toSarvamCode("Odia"), "od-IN");
  assert.equal(toSarvamCode('the language with code "ta"'), "ta-IN");
  assert.equal(toSarvamCode("English"), "en-IN");
  assert.equal(toSarvamCode("en-US"), "en-IN");
  assert.equal(toSarvamCode("French"), null);
  assert.equal(toSarvamCode(""), null);
  assert.equal(fromSarvamCode("od-IN"), "or");
  assert.equal(fromSarvamCode("mr-IN"), "mr");
  assert.ok(isIndicLanguage("hi") && isIndicLanguage("ur-IN") && isIndicLanguage("Gujarati"));
  assert.ok(!isIndicLanguage("en") && !isIndicLanguage("fr") && !isIndicLanguage(null));
});

test("sarvamConfigured follows SARVAM_API_KEY, blanks do not count", () => {
  assert.equal(sarvamConfigured(), true);
  process.env.SARVAM_API_KEY = "  ";
  assert.equal(sarvamConfigured(), false);
});

test("chunkText keeps pieces under the limit, splits on sentence ends (incl. danda) and re-joins exactly", () => {
  const text = "पहला वाक्य है। ".repeat(120) + "\n\n" + "Second paragraph. ".repeat(80);
  const pieces = chunkText(text, 1000);
  assert.ok(pieces.length > 2);
  assert.ok(pieces.every((p) => p.length <= 1000));
  assert.equal(pieces.join(""), text);
  assert.ok(pieces.slice(0, -1).every((p) => /[।.]\s*$/.test(p) || /\n\s*$/.test(p)), "cuts at sentence/paragraph ends");
  assert.deepEqual(chunkText("short", 1000), ["short"]);
  const words = chunkText("a".repeat(2500), 1000);
  assert.deepEqual(words.map((p) => p.length), [1000, 1000, 500], "hard cut when there is no boundary");
});

// ------------------------------------------------------------------------------------------ API

test("translate: Mayura with auto source, chunked under 1000 chars, header auth, detected source returned", async () => {
  route = translator("hi-IN");
  const text = "यह एक परीक्षण है। ".repeat(100);
  const r = await sarvamTranslate(text, { source: "auto", target: "en-IN" });
  assert.equal(r.model, "mayura:v1");
  assert.equal(r.source, "hi-IN");
  assert.ok(calls.length >= 2);
  assert.ok(calls.every((c) => c.path === "/translate" && c.body.input.length <= 1000 && c.body.model === "mayura:v1" && c.body.source_language_code === "auto"));
  assert.equal(calls[0].headers["api-subscription-key"], "sk-test");
  assert.equal(calls[0].headers.authorization, "Bearer sk-test");
  assert.ok(r.text.startsWith("[en-IN] "));
});

test("translate: Sarvam-Translate for languages beyond Mayura, identifying an auto source first", async () => {
  route = translator("hi-IN");
  const r = await sarvamTranslate("Hello, how are you today?", { source: "auto", target: "ur-IN", mode: "modern-colloquial" });
  assert.deepEqual(calls.map((c) => c.path), ["/text-lid", "/translate"]);
  assert.equal(calls[1].body.model, "sarvam-translate:v1");
  assert.equal(calls[1].body.source_language_code, "hi-IN");
  assert.equal(calls[1].body.mode, undefined, "Sarvam-Translate is formal only");
  assert.equal(r.source, "hi-IN");
  calls = [];
  const same = await sarvamTranslate("नमस्ते दुनिया", { source: "hi-IN", target: "hi-IN" });
  assert.equal(same.text, "नमस्ते दुनिया");
  assert.equal(calls.length, 0, "same language costs nothing");
});

test("language identification: Sarvam code or null", async () => {
  route = () => ({ status: 200, body: { request_id: "r", language_code: "gu-IN", script_code: "Gujr" } });
  assert.deepEqual(await sarvamDetectLanguage("કેમ છો"), { language: "gu-IN", script: "Gujr" });
  assert.ok(calls[0].body.input.length <= 1000);
  route = () => ({ status: 200, body: { request_id: "r", language_code: null, script_code: null } });
  assert.deepEqual(await sarvamDetectLanguage("???"), { language: null, script: null });
  assert.deepEqual(await sarvamDetectLanguage("   "), { language: null, script: null });
  assert.equal(calls.length, 2, "blank input is not sent");
});

test("errors are typed: 403 → 401 key error, 429 → quota, 422 → bad request; no key → not configured", async () => {
  route = () => ({ status: 403, body: { error: { message: "invalid", code: "invalid_api_key_error" } } });
  await assert.rejects(sarvamDetectLanguage("hello"), (e: unknown) => e instanceof SarvamError && e instanceof AppError && e.status === 401 && e.code === "invalid_api_key_error" && !/sk-test/.test(e.message));
  route = () => ({ status: 429, body: { error: { message: "quota", code: "insufficient_quota_error" } } });
  await assert.rejects(sarvamDetectLanguage("hello"), (e: unknown) => e instanceof SarvamError && e.status === 429);
  route = () => ({ status: 422, body: { error: { message: "input too long", code: "unprocessable_entity_error" } } });
  await assert.rejects(sarvamDetectLanguage("hello"), (e: unknown) => e instanceof SarvamError && e.status === 400 && /input too long/.test(e.message));
  delete process.env.SARVAM_API_KEY;
  calls = [];
  await assert.rejects(sarvamDetectLanguage("hello"), (e: unknown) => e instanceof SarvamError && e.code === "not_configured");
  assert.equal(calls.length, 0);
});

test("preserving translation keeps placeholders, markdown links, URLs and line breaks", async () => {
  route = translator("en-IN");
  const r = await sarvamTranslatePreserving("Hi {{name}}, thanks!\nSee [our policy](https://x.in/p) or https://x.in/help now.", { source: "auto", target: "hi-IN" });
  assert.equal(r.text, "[hi-IN] Hi {{name}}[hi-IN] , thanks!\n[hi-IN] See [our policy](https://x.in/p) [hi-IN] or https://x.in/help [hi-IN] now.");
  assert.equal(r.source, "en-IN");
  assert.ok(calls.every((c) => !/\{\{|https?:|\n/.test(c.body.input)), "protected pieces are never sent");
});

// ------------------------------------------------------------------------------------------ listening

const mention = (over: Partial<{ externalId: string; title: string; body: string; language: string | null; engagement: Record<string, number> }> = {}) => ({
  externalId: "m1",
  title: "",
  body: "",
  language: null as string | null,
  sentiment: "neutral",
  sentimentScore: 0,
  intent: "other",
  engagement: {} as Record<string, number>,
  ...over,
});

function memStore(existing: string[] = [], cache: Record<string, IndicResult> = {}): IndicStore & { puts: string[] } {
  const puts: string[] = [];
  return {
    puts,
    existing: async (ids) => new Set(ids.filter((i) => existing.includes(i))),
    get: async (keys) => new Map(keys.filter((k) => cache[k]).map((k) => [k, cache[k]])),
    put: async (k, v) => void (puts.push(k), (cache[k] = v)),
  };
}

test("indicPlan: Indic script → auto, source tag → explicit only when the script fits (Latin → identify), Hinglish → identify, else none", () => {
  assert.deepEqual(indicPlan("यह सेवा बहुत खराब है", null), { source: "auto" });
  assert.deepEqual(indicPlan("ਸੇਵਾ ਬਹੁਤ ਵਧੀਆ ਹੈ ਜੀ", null), { source: "auto" });
  assert.deepEqual(indicPlan("یہ سروس بہت خراب ہے", "ur"), { source: "ur-IN" }, "Arabic script fits Urdu");
  assert.equal(indicPlan("یہ سروس بہت خراب ہے", "hi"), null, "Arabic script does not fit Hindi");
  assert.deepEqual(indicPlan("Official trailer of our new English series", "hi"), { source: "identify" }, "channel-level tag over Latin text is checked first");
  assert.deepEqual(indicPlan("Some Latin text from an Urdu feed", "ur"), { source: "identify" });
  assert.equal(indicPlan("Это очень плохой сервис", "hi"), null, "Cyrillic does not fit an Indic tag");
  assert.equal(indicPlan("🙂🙂🙂🙂🙂🙂🙂🙂", "hi"), null, "no letters");
  assert.deepEqual(indicPlan("bhai ye service bahut bekar hai yaar", "en"), { source: "identify" });
  assert.equal(indicPlan("The service was great, thanks!", "en"), null);
  assert.equal(indicPlan("ठीक है", null), null, "too short");
  assert.ok(!looksHinglish("bhai"), "one word is not a language");
  assert.ok(looksHinglish("kya baat hai, bahut accha"));
});

test("applyIndic: stores the language, re-scores sentiment and intent on the translation; ratings still win", () => {
  const row = mention({ body: "सेवा बहुत खराब है, पैसे वापस करो" });
  const res: IndicResult = { language: "hi", translation: "The service is terrible, refund my money", model: "mayura:v1" };
  const out = applyIndic(row, res);
  assert.deepEqual([out.language, out.sentiment, out.intent, out.translation], ["hi", "negative", "cancellation", res.translation]);
  assert.ok(out.sentimentScore < 0);
  const rated = applyIndic({ ...row, sentiment: "positive", engagement: { rating: 5 } }, res);
  assert.equal(rated.sentiment, "positive");
  const noTr = applyIndic(row, { language: "en", translation: null, model: "sarvam-lid" });
  assert.deepEqual([noTr.language, noTr.sentiment, noTr.translation], ["en", "neutral", undefined]);
});

test("enrichIndic: only new Indic rows, cache hits are free, results cached by text hash", async () => {
  route = translator("hi-IN");
  const hindi = mention({ externalId: "new", body: "यह उत्पाद बहुत अच्छा है, धन्यवाद" });
  const old = mention({ externalId: "old", body: "यह उत्पाद पहले से संग्रहीत है" });
  const english = mention({ externalId: "en", body: "This product is amazing, thank you" });
  const cachedRow = mention({ externalId: "cached", body: "पहले से अनुवादित पाठ यहाँ है" });
  const cachedKey = indicCacheKey(cachedRow.body);
  const store = memStore(["old"], { [cachedKey]: { language: "mr", translation: "Already translated, great", model: "mayura:v1" } });
  const budget = indicBudget(10);
  const out = await enrichIndic([hindi, old, english, cachedRow], budget, store);
  assert.equal(calls.length, 1, "one Sarvam call: the new Hindi row");
  assert.equal(budget.left, 9);
  assert.deepEqual(out.map((r) => r.language), ["hi", null, null, "mr"]);
  assert.match(out[0].translation ?? "", /^\[en-IN\] /);
  assert.equal(out[1], old, "already stored rows are untouched");
  assert.equal(out[2], english);
  assert.equal(out[3].sentiment, "positive");
  assert.deepEqual(store.puts, [indicCacheKey(hindi.body)]);
});

test("enrichIndic: respects the per-run cap and stops for the run on quota errors without throwing", async () => {
  route = translator("ta-IN");
  const rows = Array.from({ length: 6 }, (_, i) => mention({ externalId: `t${i}`, body: `இது ஒரு சோதனை செய்தி எண் ${i}` }));
  const budget = indicBudget(4);
  const out = await enrichIndic(rows, budget, memStore());
  assert.equal(calls.length, 4);
  assert.equal(out.filter((r) => "translation" in r).length, 4);
  assert.equal(budget.left, 0);

  calls = [];
  route = () => ({ status: 429, body: { error: { message: "quota", code: "rate_limit_exceeded_error" } } });
  const b2 = indicBudget(50);
  const out2 = await enrichIndic(rows, b2, memStore());
  assert.equal(b2.stopped, true);
  assert.ok(calls.length <= 4, "at most one in-flight call per worker before stopping");
  assert.deepEqual(out2, rows, "heuristic values kept");

  calls = [];
  const out3 = await enrichIndic(rows, b2, memStore());
  assert.equal(calls.length, 0, "a stopped budget makes no more calls");
  assert.deepEqual(out3, rows);
});

test("enrichIndic: a Latin text tagged Hindi by its source is identified, not translated as Hindi", async () => {
  route = translator("en-IN");
  const row = mention({ externalId: "yt", body: "Watch the full launch event of our new phone", language: "hi" });
  const out = await enrichIndic([row], indicBudget(), memStore());
  assert.deepEqual(calls.map((c) => c.path), ["/text-lid"]);
  assert.equal(out[0].language, "en");
  assert.equal("translation" in out[0], false, "the English lexicon scores stay");
  assert.equal(out[0].sentiment, row.sentiment);
});

test("runBudget: storeMentions calls without a budget share the project's open run, spent or not", () => {
  const run = startIndicRun("p1");
  assert.equal(runBudget("p1"), run);
  run.left = 0;
  run.deadline = 0;
  assert.equal(runBudget("p1"), run, "a spent run does not hand out a fresh budget");
  const other = runBudget("p2");
  assert.notEqual(other, run);
  assert.equal(other.left, 50, "no open run: a small one-off budget");
  endIndicRun("p1", other);
  assert.equal(runBudget("p1"), run, "only the run's own budget closes it");
  endIndicRun("p1", run);
  assert.notEqual(runBudget("p1"), run);
});

test("enrichIndic: Hinglish is identified first; English verdicts and store failures are harmless", async () => {
  route = translator("en-IN");
  const row = mention({ externalId: "h", body: "bhai ye app bahut bekar hai yaar", language: "en" });
  const out = await enrichIndic([row], indicBudget(), memStore());
  assert.deepEqual(calls.map((c) => c.path), ["/text-lid"]);
  assert.equal(out[0].language, "en");
  assert.equal("translation" in out[0], false);

  calls = [];
  route = translator("hi-IN");
  const out2 = await enrichIndic([row], indicBudget(), memStore());
  assert.deepEqual(calls.map((c) => c.path), ["/text-lid", "/translate"]);
  assert.equal(calls[1].body.source_language_code, "hi-IN");
  assert.equal(out2[0].language, "hi");

  const broken: IndicStore = { existing: async () => { throw new Error("db down"); }, get: async () => new Map(), put: async () => {} };
  assert.deepEqual(await enrichIndic([row], indicBudget(), broken), [row]);
  delete process.env.SARVAM_API_KEY;
  calls = [];
  assert.deepEqual(await enrichIndic([row], indicBudget(), memStore()), [row]);
  assert.equal(calls.length, 0, "no key, no calls");
});
