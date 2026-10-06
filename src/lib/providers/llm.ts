import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { AppError } from "@/lib/domain";

/**
 * One AI layer for every SEO and CX feature (server-only). Whichever key is configured is used, in
 * priority order ANTHROPIC_API_KEY → OPENAI_API_KEY → GEMINI_API_KEY; when a provider fails the next
 * configured one is tried. Claude runs through the SDK with server-side refusal fallbacks; OpenAI
 * (Responses API) and Gemini (generateContent) run over fetch, with JSON-schema output validated
 * against the same zod schema Claude uses.
 */

export type LlmProvider = "anthropic" | "openai" | "gemini";
export type LlmEffort = "low" | "medium" | "high";

export const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
export const OPENAI_DEFAULT_MODEL = "gpt-6-astra";
export const GEMINI_DEFAULT_MODEL = "gemini-3.8-flash";
const openAiModel = () => process.env.OPENAI_MODEL || OPENAI_DEFAULT_MODEL;
const geminiModel = () => process.env.GEMINI_MODEL || GEMINI_DEFAULT_MODEL;

const FALLBACK_BETA = "server-side-fallback-2026-07-01";
/** Thinking/reasoning tokens count against the output cap on all three providers; text replies get this on top. */
const THINKING_HEADROOM = 4000;

const PROVIDERS: { id: LlmProvider; env: string; label: string; name: string }[] = [
  { id: "anthropic", env: "ANTHROPIC_API_KEY", label: "Claude (Anthropic)", name: "Claude" },
  { id: "openai", env: "OPENAI_API_KEY", label: "OpenAI", name: "OpenAI" },
  { id: "gemini", env: "GEMINI_API_KEY", label: "Gemini (Google)", name: "Gemini" },
];
const info = (p: LlmProvider) => PROVIDERS.find((x) => x.id === p)!;

/** Configured providers, most preferred first. */
export const llmProviders = (): LlmProvider[] => PROVIDERS.filter((p) => !!process.env[p.env]).map((p) => p.id);
export const llmConfigured = () => llmProviders().length > 0;
export const providerLabel = (p: LlmProvider) => info(p).label;
/** Label of the provider that answers first, e.g. "Claude (Anthropic)". */
export const llmLabel = () => {
  const [p] = llmProviders();
  return p ? providerLabel(p) : "Not configured";
};
export const LLM_NOT_CONFIGURED = "Connect an AI key (Anthropic, OpenAI or Gemini) on the server to use this.";

let client: Anthropic | null = null;
/** The one shared Anthropic SDK client. */
export const anthropicClient = () => (client ??= new Anthropic({ timeout: 180_000, maxRetries: 2 }));

/** Translate provider/SDK errors (most specific first) into user-facing AppErrors. */
export function llmError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof Anthropic.AuthenticationError) return new AppError("ANTHROPIC_API_KEY was rejected (401). Check the key on the server.", 401);
  if (error instanceof Anthropic.RateLimitError) return new AppError("Claude rate limit reached. Try again in a minute.", 429);
  if (error instanceof Anthropic.APIConnectionTimeoutError) return new AppError("Claude did not respond in time. Try again.", 502);
  if (error instanceof Anthropic.APIConnectionError) return new AppError("Could not reach the Anthropic API.", 502);
  if (error instanceof Anthropic.BadRequestError) return new AppError(`Claude rejected the request: ${error.message}`, 400);
  if (error instanceof Anthropic.InternalServerError) return new AppError(`Anthropic API is unavailable (${error.status}): ${error.message}`, 502);
  if (error instanceof Anthropic.APIError) return new AppError(`Anthropic API error (${error.status ?? "?"}): ${error.message}`, 502);
  return new AppError(error instanceof Error ? error.message : "Unexpected error calling the AI provider.", 502);
}

// ------------------------------------------------------------------------------------------ calls

type Call = { system: string; prompt: string; maxTokens: number; timeoutMs: number; effort?: LlmEffort; json?: { name: string; schema: Record<string, unknown> } };
/** Raw answer: text, or for Claude structured calls the already-parsed object. */
type Raw = { text: string; model: string; parsed?: unknown };

async function postJson(url: string, headers: Record<string, string>, body: unknown, p: LlmProvider, timeoutMs: number): Promise<Record<string, any>> {
  const { name, env } = info(p);
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    throw new AppError(e instanceof Error && e.name === "TimeoutError" ? `${name} did not respond in time. Try again.` : `Could not reach the ${name} API.`, 502);
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, any>;
  if (res.ok) return data;
  const msg = String(data?.error?.message ?? res.statusText ?? "").slice(0, 300);
  if (res.status === 401 || res.status === 403) throw new AppError(`${env} was rejected (${res.status}). Check the key on the server.`, 401);
  if (res.status === 429) throw new AppError(`${name} rate limit or quota reached. Try again in a minute.`, 429);
  if (res.status === 400) throw new AppError(`${name} rejected the request: ${msg}`, 400);
  throw new AppError(`${name} API error (${res.status}): ${msg}`, 502);
}

async function callAnthropic(c: Call, schema?: z.ZodType): Promise<Raw> {
  const base = {
    model: CLAUDE_MODEL,
    max_tokens: c.maxTokens,
    // Server-side refusal fallbacks: a declined request is re-run on Anthropic's recommended model.
    betas: [FALLBACK_BETA],
    fallbacks: "default" as const,
    system: c.system,
    messages: [{ role: "user" as const, content: c.prompt }],
  };
  if (schema) {
    const res = await anthropicClient().beta.messages.parse({ ...base, output_config: { effort: c.effort ?? "medium", format: betaZodOutputFormat(schema) } }, { timeout: c.timeoutMs });
    if (res.stop_reason === "refusal") throw new AppError("Claude declined this request.", 422);
    if (res.stop_reason === "max_tokens") throw new AppError("Claude's answer was cut off. Try a smaller section.", 502);
    if (!res.parsed_output) throw new AppError("Claude returned an answer in an unexpected format. Try again.", 502);
    return { text: "", parsed: res.parsed_output, model: res.model ?? CLAUDE_MODEL };
  }
  const res = await anthropicClient().beta.messages.create({ ...base, ...(c.effort ? { output_config: { effort: c.effort } } : {}) }, { timeout: c.timeoutMs });
  if (res.stop_reason === "refusal") throw new AppError("Claude declined this request.", 422);
  const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim();
  return { text, model: res.model ?? CLAUDE_MODEL };
}

async function callOpenAi(c: Call): Promise<Raw> {
  const model = openAiModel();
  const data = await postJson(
    "https://api.openai.com/v1/responses",
    { authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    {
      model,
      instructions: c.system,
      input: c.prompt,
      max_output_tokens: c.maxTokens,
      store: false,
      ...(c.json ? { text: { format: { type: "json_schema", name: c.json.name, schema: c.json.schema, strict: strictCompatible(c.json.schema) } } } : {}),
    },
    "openai",
    c.timeoutMs,
  );
  const parts = ((data.output ?? []) as any[]).flatMap((o) => (o?.type === "message" ? ((o.content ?? []) as any[]) : []));
  if (parts.some((p) => p?.type === "refusal")) throw new AppError("OpenAI declined this request.", 422);
  const text = parts.filter((p) => p?.type === "output_text").map((p) => String(p.text ?? "")).join("").trim();
  if (data.status === "incomplete" && (c.json || !text)) throw new AppError(`OpenAI's answer was cut off (${data.incomplete_details?.reason ?? "incomplete"}). Try a smaller section.`, 502);
  return { text, model: String(data.model ?? model) };
}

async function callGemini(c: Call): Promise<Raw> {
  const model = geminiModel();
  const data = await postJson(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    { "x-goog-api-key": process.env.GEMINI_API_KEY ?? "" },
    {
      systemInstruction: { parts: [{ text: c.system }] },
      contents: [{ role: "user", parts: [{ text: c.prompt }] }],
      generationConfig: { maxOutputTokens: c.maxTokens, ...(c.json ? { responseMimeType: "application/json", responseJsonSchema: c.json.schema } : {}) },
    },
    "gemini",
    c.timeoutMs,
  );
  if (data.promptFeedback?.blockReason) throw new AppError("Gemini declined this request.", 422);
  const cand = (data.candidates ?? [])[0] as any;
  const finish = String(cand?.finishReason ?? "");
  if (["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION"].includes(finish)) throw new AppError("Gemini declined this request.", 422);
  const text = ((cand?.content?.parts ?? []) as any[]).filter((p) => !p?.thought).map((p) => String(p?.text ?? "")).join("").trim();
  if (finish === "MAX_TOKENS" && (c.json || !text)) throw new AppError("Gemini's answer was cut off. Try a smaller section.", 502);
  return { text, model: String(data.modelVersion ?? model) };
}

/** Try each configured provider in order; the first success wins, otherwise the first error is thrown. */
async function firstSuccess<T>(attempt: (p: LlmProvider) => Promise<T>): Promise<T & { provider: LlmProvider }> {
  const providers = llmProviders();
  if (!providers.length) throw new AppError(LLM_NOT_CONFIGURED, 400);
  let first: AppError | null = null;
  for (const [i, p] of providers.entries()) {
    try {
      return { ...(await attempt(p)), provider: p };
    } catch (e) {
      const err = llmError(e);
      first ??= err;
      if (i < providers.length - 1) console.warn(`[llm] ${info(p).name} failed, trying ${info(providers[i + 1]).name}: ${err.message}`);
    }
  }
  throw first!;
}

// ------------------------------------------------------------------------------------------ text

type TextOpts = { maxTokens?: number; timeoutMs?: number };

/** Plain-text completion; throws an AppError with a user-facing message when no provider answers. */
export async function completeOrThrow(system: string, prompt: string, opts: TextOpts = {}): Promise<{ text: string; provider: LlmProvider; model: string }> {
  const c: Call = { system, prompt, maxTokens: (opts.maxTokens ?? 1200) + THINKING_HEADROOM, timeoutMs: opts.timeoutMs ?? 60_000, effort: "low" };
  return firstSuccess(async (p) => {
    const r = p === "anthropic" ? await callAnthropic(c) : p === "openai" ? await callOpenAi(c) : await callGemini(c);
    if (!r.text) throw new AppError(`${info(p).name} returned an empty answer.`, 502);
    return { text: r.text, model: r.model };
  });
}

/** Plain-text completion that never throws: null when no AI key is configured or every provider failed. */
export async function complete(system: string, prompt: string, opts: TextOpts = {}): Promise<string | null> {
  if (!llmConfigured()) return null;
  try {
    return (await completeOrThrow(system, prompt, opts)).text;
  } catch (e) {
    console.warn(`[llm] completion failed: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

// ------------------------------------------------------------------------------------------ structured

/** JSON Schema for OpenAI/Gemini from a zod schema: no $schema key, `const` spelled as a one-value enum. */
export function jsonSchemaOf(schema: z.ZodType): Record<string, unknown> {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (!v || typeof v !== "object") return v;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      if (k === "$schema") continue;
      if (k === "const") out.enum = [x];
      else out[k] = walk(x);
    }
    return out;
  };
  return walk(z.toJSONSchema(schema, { target: "draft-2020-12", io: "output" })) as Record<string, unknown>;
}

/** OpenAI strict mode needs every object closed with all properties required. */
function strictCompatible(schema: unknown): boolean {
  if (Array.isArray(schema)) return schema.every(strictCompatible);
  if (!schema || typeof schema !== "object") return true;
  const s = schema as Record<string, unknown>;
  if (s.type === "object" && s.properties) {
    const keys = Object.keys(s.properties as object);
    const req = new Set((s.required as string[] | undefined) ?? []);
    if (s.additionalProperties !== false || keys.some((k) => !req.has(k))) return false;
  }
  return Object.values(s).every(strictCompatible);
}

function parseJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
}

/**
 * Schema-constrained output. Claude uses structured outputs via the SDK; OpenAI and Gemini get the
 * JSON Schema and their answer is validated with the zod schema. Throws AppError.
 */
export async function structured<T extends z.ZodType>(
  schema: T,
  system: string,
  prompt: string,
  opts: { maxTokens?: number; effort?: LlmEffort; timeoutMs?: number; name?: string } = {},
): Promise<{ data: z.infer<T>; model: string; provider: LlmProvider }> {
  const c: Call = { system, prompt, maxTokens: opts.maxTokens ?? 16000, timeoutMs: opts.timeoutMs ?? 180_000, effort: opts.effort ?? "medium" };
  let json: Call["json"];
  return firstSuccess(async (p) => {
    if (p === "anthropic") {
      const r = await callAnthropic(c, schema);
      return { data: r.parsed as z.infer<T>, model: r.model };
    }
    json ??= { name: (opts.name ?? "result").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64), schema: jsonSchemaOf(schema) };
    // `effort` only reaches Claude (OpenAI/Gemini reasoning params are model-specific and 400 on
    // non-reasoning models), so their default reasoning gets the same headroom as text replies.
    const oc: Call = { ...c, json, maxTokens: c.maxTokens + THINKING_HEADROOM };
    const r = p === "openai" ? await callOpenAi(oc) : await callGemini(oc);
    const parsed = schema.safeParse(parseJson(r.text));
    if (!parsed.success) throw new AppError(`${info(p).name} returned an answer in an unexpected format. Try again.`, 502);
    return { data: parsed.data as z.infer<T>, model: r.model };
  });
}
