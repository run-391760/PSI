import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { z } from "zod";
import { AppError } from "../src/lib/domain";
import { CLAUDE_MODEL, complete, completeOrThrow, GEMINI_DEFAULT_MODEL, jsonSchemaOf, llmConfigured, llmLabel, llmProviders, OPENAI_DEFAULT_MODEL, structured } from "../src/lib/providers/llm";

// No network: every provider call goes through this fetch stub, routed by host.
type Reply = { status: number; body: unknown };
type Seen = { host: "anthropic" | "openai" | "gemini"; url: string; body: any };
let routes: Partial<Record<Seen["host"], () => Reply>> = {};
let seen: Seen[] = [];
const hostOf = (url: string): Seen["host"] => (url.includes("api.openai.com") ? "openai" : url.includes("generativelanguage.googleapis.com") ? "gemini" : "anthropic");
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const host = hostOf(url);
  seen.push({ host, url, body: init?.body ? JSON.parse(String(init.body)) : null });
  const r = routes[host]?.() ?? { status: 500, body: { error: { message: "no route" } } };
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json", "request-id": "req_test" } });
}) as typeof fetch;

const KEYS = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "OPENAI_MODEL", "GEMINI_MODEL"] as const;
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
});

test("complete returns null without a key and never calls the network", async () => {
  assert.equal(await complete("sys", "hi"), null);
  assert.equal(seen.length, 0);
  await assert.rejects(completeOrThrow("sys", "hi"), (e: unknown) => e instanceof AppError && /Anthropic, OpenAI or Gemini/.test(e.message));
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
