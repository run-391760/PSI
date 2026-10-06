import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { z } from "zod";
import { AppError } from "../src/lib/domain";
import { CLAUDE_MODEL, complete, completeOrThrow, GEMINI_DEFAULT_MODEL, jsonSchemaOf, llmConfigured, llmLabel, llmProviders, OPENAI_DEFAULT_MODEL, providersFor, structured } from "../src/lib/providers/llm";
import { SARVAM_DEFAULT_MODEL } from "../src/lib/providers/sarvam";

// No network: every provider call goes through this fetch stub, routed by host.
type Reply = { status: number; body: unknown };
type Seen = { host: "anthropic" | "openai" | "gemini" | "sarvam"; url: string; body: any; headers: Record<string, string> };
let routes: Partial<Record<Seen["host"], () => Reply>> = {};
let seen: Seen[] = [];
const hostOf = (url: string): Seen["host"] =>
  url.includes("api.openai.com") ? "openai" : url.includes("generativelanguage.googleapis.com") ? "gemini" : url.includes("api.sarvam.ai") ? "sarvam" : "anthropic";
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const host = hostOf(url);
  seen.push({ host, url, body: init?.body ? JSON.parse(String(init.body)) : null, headers: Object.fromEntries(new Headers(init?.headers).entries()) });
  const r = routes[host]?.() ?? { status: 500, body: { error: { message: "no route" } } };
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json", "request-id": "req_test" } });
}) as typeof fetch;

const KEYS = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "SARVAM_API_KEY", "OPENAI_MODEL", "GEMINI_MODEL", "SARVAM_MODEL"] as const;
const saved: Partial<Record<string, string | undefined>> = {};
const warn = console.warn;
beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  routes = {};
  seen = [];
  console.warn = () => {};
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  console.warn = warn;
});
const keys = (...names: (typeof KEYS)[number][]) => names.forEach((n) => (process.env[n] = "test-key"));

const claudeText = (text: string): Reply => ({
  status: 200,
  body: { id: "msg_1", type: "message", role: "assistant", model: CLAUDE_MODEL, content: [{ type: "text", text }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } },
});
const openAiText = (text: string): Reply => ({ status: 200, body: { model: OPENAI_DEFAULT_MODEL, status: "completed", output: [{ type: "message", content: [{ type: "output_text", text }] }] } });
const geminiText = (text: string): Reply => ({ status: 200, body: { modelVersion: GEMINI_DEFAULT_MODEL, candidates: [{ finishReason: "STOP", content: { parts: [{ text: "thinking…", thought: true }, { text }] } }] } });
const sarvamText = (text: string | null, finish = "stop"): Reply => ({ status: 200, body: { id: "c1", object: "chat.completion", model: SARVAM_DEFAULT_MODEL, choices: [{ index: 0, finish_reason: finish, message: { role: "assistant", content: text, reasoning_content: "hmm" } }] } });
const fail = (status: number, message = "boom"): Reply => ({ status, body: { type: "error", error: { type: "error", message } } });

test("providers are picked from configured keys in priority order", () => {
  assert.deepEqual(llmProviders(), []);
  assert.equal(llmConfigured(), false);
  assert.equal(llmLabel(), "Not configured");
  keys("GEMINI_API_KEY");
  assert.deepEqual(llmProviders(), ["gemini"]);
  assert.equal(llmLabel(), "Gemini (Google)");
  keys("OPENAI_API_KEY", "ANTHROPIC_API_KEY");
  assert.deepEqual(llmProviders(), ["anthropic", "openai", "gemini"]);
  assert.equal(llmConfigured(), true);
  assert.equal(llmLabel(), "Claude (Anthropic)");
  keys("SARVAM_API_KEY");
  assert.deepEqual(llmProviders(), ["anthropic", "openai", "gemini", "sarvam"], "Sarvam comes last");
});

test("Sarvam alone is a full AI provider; blank keys do not count", () => {
  process.env.ANTHROPIC_API_KEY = "   ";
  keys("SARVAM_API_KEY");
  assert.deepEqual(llmProviders(), ["sarvam"]);
  assert.equal(llmLabel(), "Sarvam AI");
});

test("providersFor returns up to n distinct configured providers in priority order", () => {
  assert.deepEqual(providersFor(3), []);
  keys("SARVAM_API_KEY", "OPENAI_API_KEY");
  assert.deepEqual(providersFor(3), ["openai", "sarvam"]);
  assert.deepEqual(providersFor(1), ["openai"]);
  assert.deepEqual(providersFor(0), []);
  keys("ANTHROPIC_API_KEY", "GEMINI_API_KEY");
  const four = providersFor(4);
  assert.deepEqual(four, ["anthropic", "openai", "gemini", "sarvam"]);
  assert.equal(new Set(four).size, 4);
});

test("complete returns null without a key and never calls the network", async () => {
  assert.equal(await complete("sys", "hi"), null);
  assert.equal(seen.length, 0);
  await assert.rejects(completeOrThrow("sys", "hi"), (e: unknown) => e instanceof AppError && /Anthropic, OpenAI, Gemini or Sarvam/.test(e.message));
});

test("Claude answers first when its key is set", async () => {
  keys("ANTHROPIC_API_KEY", "OPENAI_API_KEY");
  routes.anthropic = () => claudeText("from claude");
  const r = await completeOrThrow("sys", "hi", { maxTokens: 300 });
  assert.equal(r.text, "from claude");
  assert.equal(r.provider, "anthropic");
  assert.deepEqual(seen.map((s) => s.host), ["anthropic"]);
  assert.equal(seen[0].body.model, CLAUDE_MODEL);
  assert.equal(seen[0].body.fallbacks, "default");
  assert.ok(seen[0].body.max_tokens > 300, "thinking headroom is added to text replies");
});

test("falls back to OpenAI when Claude fails, then to Gemini", async () => {
  keys("ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY");
  routes.anthropic = () => fail(401, "invalid x-api-key");
  routes.openai = () => openAiText("from openai");
  assert.equal(await complete("sys", "hi"), "from openai");
  assert.deepEqual(seen.map((s) => s.host), ["anthropic", "openai"]);
  assert.equal(seen[1].body.model, OPENAI_DEFAULT_MODEL);
  assert.equal(seen[1].body.instructions, "sys");

  seen = [];
  process.env.GEMINI_MODEL = "gemini-test";
  routes.openai = () => fail(400, "bad");
  routes.gemini = () => geminiText("from gemini");
  const r = await completeOrThrow("sys", "hi");
  assert.deepEqual([r.provider, r.text, r.model], ["gemini", "from gemini", GEMINI_DEFAULT_MODEL]);
  assert.deepEqual(seen.map((s) => s.host), ["anthropic", "openai", "gemini"]);
  assert.match(seen[2].url, /models\/gemini-test:generateContent$/);
  assert.equal(seen[2].body.systemInstruction.parts[0].text, "sys");
});

test("an empty answer counts as a failure and moves on", async () => {
  keys("OPENAI_API_KEY", "GEMINI_API_KEY");
  routes.openai = () => openAiText("   ");
  routes.gemini = () => geminiText("ok");
  assert.equal(await complete("sys", "hi"), "ok");
});

test("when every provider fails, complete is null and completeOrThrow reports the first error", async () => {
  keys("ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY");
  routes.anthropic = () => fail(401);
  routes.openai = () => fail(429);
  routes.gemini = () => fail(403);
  assert.equal(await complete("sys", "hi"), null);
  await assert.rejects(completeOrThrow("sys", "hi"), (e: unknown) => e instanceof AppError && e.status === 401 && /ANTHROPIC_API_KEY was rejected/.test(e.message));
});

const Schema = z.object({ title: z.string(), level: z.union([z.literal(2), z.literal(3)]), tags: z.array(z.string()) });

test("structured output from Claude is parsed by the SDK", async () => {
  keys("ANTHROPIC_API_KEY");
  routes.anthropic = () => claudeText(JSON.stringify({ title: "T", level: 2, tags: ["a"] }));
  const r = await structured(Schema, "sys", "prompt", { effort: "low", maxTokens: 2000 });
  assert.deepEqual(r.data, { title: "T", level: 2, tags: ["a"] });
  assert.equal(r.provider, "anthropic");
  assert.equal(seen[0].body.output_config.effort, "low");
  assert.equal(seen[0].body.output_config.format.type, "json_schema");
});

test("structured output via OpenAI sends a strict JSON schema and validates the answer", async () => {
  keys("OPENAI_API_KEY", "GEMINI_API_KEY");
  routes.openai = () => openAiText(JSON.stringify({ title: "T", level: 3, tags: [] }));
  const r = await structured(Schema, "sys", "prompt", { name: "brief" });
  assert.deepEqual([r.provider, r.data.level], ["openai", 3]);
  const format = seen[0].body.text.format;
  assert.deepEqual([format.type, format.name, format.strict], ["json_schema", "brief", true]);
  assert.equal(format.schema.$schema, undefined);
  assert.deepEqual(format.schema.properties.level.anyOf.map((x: { enum: number[] }) => x.enum), [[2], [3]]);
});

test("structured output that fails validation falls back to the next provider", async () => {
  keys("OPENAI_API_KEY", "GEMINI_API_KEY");
  routes.openai = () => openAiText(JSON.stringify({ title: "T", level: 7, tags: [] }));
  routes.gemini = () => geminiText('```json\n{"title":"G","level":2,"tags":["x"]}\n```');
  const r = await structured(Schema, "sys", "prompt");
  assert.deepEqual([r.provider, r.data.title], ["gemini", "G"]);
  const cfg = seen[1].body.generationConfig;
  assert.equal(cfg.responseMimeType, "application/json");
  assert.deepEqual(cfg.responseJsonSchema.required, ["title", "level", "tags"]);
});

test("structured output throws an AppError when nothing is configured or every answer is invalid", async () => {
  await assert.rejects(structured(Schema, "sys", "p"), (e: unknown) => e instanceof AppError && e.status === 400);
  keys("GEMINI_API_KEY");
  routes.gemini = () => geminiText("not json");
  await assert.rejects(structured(Schema, "sys", "p"), (e: unknown) => e instanceof AppError && /unexpected format/.test(e.message));
  routes.gemini = () => ({ status: 200, body: { candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: '{"title":' }] } }] } });
  await assert.rejects(structured(Schema, "sys", "p"), (e: unknown) => e instanceof AppError && /cut off/.test(e.message));
});

test("optional fields turn OpenAI strict mode off", async () => {
  keys("OPENAI_API_KEY");
  routes.openai = () => openAiText(JSON.stringify({ a: "x" }));
  await structured(z.object({ a: z.string(), b: z.string().optional() }), "sys", "p");
  assert.equal(seen[0].body.text.format.strict, false);
  const props = jsonSchemaOf(z.object({ a: z.literal("x") })).properties as Record<string, { enum?: unknown[] }>;
  assert.deepEqual(props.a.enum, ["x"]);
});

// ------------------------------------------------------------------------------------------ Sarvam

test("Sarvam chat completions: OpenAI-compatible request, key in headers, reasoning trace dropped", async () => {
  keys("SARVAM_API_KEY");
  routes.sarvam = () => sarvamText("<think>internal</think>नमस्ते");
  const r = await completeOrThrow("sys", "hi", { maxTokens: 300 });
  assert.deepEqual([r.provider, r.text, r.model], ["sarvam", "नमस्ते", SARVAM_DEFAULT_MODEL]);
  assert.equal(seen[0].url, "https://api.sarvam.ai/v1/chat/completions");
  assert.equal(seen[0].headers["api-subscription-key"], "test-key");
  assert.equal(seen[0].body.model, SARVAM_DEFAULT_MODEL);
  assert.deepEqual(seen[0].body.messages.map((m: { role: string }) => m.role), ["system", "user"]);
  assert.equal(seen[0].body.reasoning_effort, "low");
  assert.ok(seen[0].body.max_tokens > 300, "reasoning headroom");
  assert.ok(!JSON.stringify(seen[0].body).includes("test-key"), "the key never travels in the body");
  process.env.SARVAM_MODEL = "sarvam-105b-conversations";
  await completeOrThrow("sys", "hi");
  assert.equal(seen[1].body.model, "sarvam-105b-conversations");
});

test("Sarvam is the last fallback and its errors map to AppErrors", async () => {
  keys("GEMINI_API_KEY", "SARVAM_API_KEY");
  routes.gemini = () => fail(500);
  routes.sarvam = () => sarvamText("from sarvam");
  assert.equal(await complete("sys", "hi"), "from sarvam");
  assert.deepEqual(seen.map((s) => s.host), ["gemini", "sarvam"]);
  routes.gemini = () => fail(400);
  routes.sarvam = () => ({ status: 403, body: { error: { message: "bad key", code: "invalid_api_key_error" } } });
  await assert.rejects(completeOrThrow("sys", "hi", { providers: ["sarvam"] }), (e: unknown) => e instanceof AppError && e.status === 401 && /SARVAM_API_KEY was rejected/.test(e.message));
  routes.sarvam = () => sarvamText(null, "length");
  assert.equal(await complete("sys", "hi", { providers: ["sarvam"] }), null, "an answer cut off before any text is a failure");
});

test("the providers option pins a call to one configured provider", async () => {
  keys("ANTHROPIC_API_KEY", "SARVAM_API_KEY");
  routes.sarvam = () => sarvamText("pinned");
  const r = await completeOrThrow("sys", "hi", { providers: ["sarvam"] });
  assert.equal(r.provider, "sarvam");
  assert.deepEqual(seen.map((s) => s.host), ["sarvam"]);
  await assert.rejects(completeOrThrow("sys", "hi", { providers: ["openai"] }), (e: unknown) => e instanceof AppError && e.status === 400, "an unconfigured pin is not configured");
});

test("structured output via Sarvam: json_schema mode, schema in the prompt, zod-validated", async () => {
  keys("SARVAM_API_KEY");
  routes.sarvam = () => sarvamText('Here you go: {"title":"T","level":2,"tags":["a"]}');
  const r = await structured(Schema, "sys", "prompt", { name: "brief", effort: "high" });
  assert.deepEqual([r.provider, r.data], ["sarvam", { title: "T", level: 2, tags: ["a"] }]);
  const rf = seen[0].body.response_format;
  assert.deepEqual([rf.type, rf.json_schema.name, rf.json_schema.schema.required], ["json_schema", "brief", ["title", "level", "tags"]]);
  assert.match(seen[0].body.messages[0].content, /^sys\n\nAnswer with a single JSON object only/);
  assert.equal(seen[0].body.reasoning_effort, "high");
});

test("structured output via Sarvam falls back to json_object mode and repairs one invalid answer", async () => {
  keys("SARVAM_API_KEY");
  let n = 0;
  routes.sarvam = () => {
    n++;
    if (n === 1) return { status: 400, body: { error: { message: "unsupported schema", code: "invalid_request_error" } } };
    if (n === 2) return sarvamText('{"title":"T","level":7,"tags":[]}');
    return sarvamText('{"title":"T","level":3,"tags":[]}');
  };
  const r = await structured(Schema, "sys", "prompt");
  assert.equal(r.data.level, 3);
  assert.deepEqual(seen.map((s) => s.body.response_format.type), ["json_schema", "json_object", "json_object"]);
  assert.match(seen[2].body.messages[1].content, /did not validate \(level:/);
  assert.match(seen[2].body.messages[1].content, /"level":7/);

  seen = [];
  routes.sarvam = () => sarvamText("still not json");
  await assert.rejects(structured(Schema, "sys", "p"), (e: unknown) => e instanceof AppError && /Sarvam returned an answer in an unexpected format/.test(e.message));
  assert.equal(seen.length, 2, "exactly one repair round");
  assert.match(seen[1].body.messages[1].content, /not valid JSON/);
});

test("a Sarvam answer cut off by its reasoning is retried once with low effort and a larger budget", async () => {
  keys("SARVAM_API_KEY");
  let n = 0;
  routes.sarvam = () => (++n === 1 ? sarvamText('{"title":"T","lev', "length") : sarvamText('{"title":"T","level":2,"tags":[]}'));
  const r = await structured(Schema, "sys", "prompt", { maxTokens: 8000 });
  assert.equal(r.data.level, 2);
  assert.equal(seen.length, 2);
  assert.equal(seen[0].body.reasoning_effort, undefined, "first attempt keeps the default (medium) effort");
  assert.equal(seen[1].body.reasoning_effort, "low");
  assert.ok(seen[1].body.max_tokens > seen[0].body.max_tokens && seen[1].body.max_tokens <= 32_000);

  seen = [];
  n = 0;
  routes.sarvam = () => sarvamText('{"title":"T","lev', "length");
  await assert.rejects(structured(Schema, "sys", "prompt", { maxTokens: 8000 }), /cut off/);
  assert.equal(seen.length, 2, "only one retry");
});
