import { AppError } from "@/lib/domain";
import { askClaude, anthropicEnabled, CLAUDE_MODEL } from "./anthropic";
import { dfs, market } from "./dataforseo";
import { liveEnabled } from "./source";

/**
 * Live AI answer engines for AI Visibility. Each engine asks a prompt the way a user would (with web
 * search/grounding) and returns the answer text plus the URLs it cited. Request/response shapes follow
 * each provider's documentation (checked 2026-09): OpenAI Responses API `web_search` tool, Gemini
 * Interactions API `google_search` tool, Perplexity Agent API, Google AI Overviews via DataForSEO SERP.
 * Answers from APIs can differ from what the consumer apps show; the UI says so.
 */
export type LiveEngineId = "chatgpt" | "gemini" | "perplexity" | "google-aio" | "claude";

export type EngineAnswer = {
  engine: LiveEngineId;
  model: string;
  text: string;
  /** Sources the answer cites inline. */
  citations: { url: string; title: string }[];
  /** Other pages the engine's searches returned. */
  searchResults: { url: string; title: string }[];
  /** False when the engine produced no AI answer (e.g. no AI Overview for the query). */
  present: boolean;
};

type EngineDef = {
  id: LiveEngineId;
  name: string;
  /** Environment variables required to enable the engine. */
  env: string[];
  enabled: () => boolean;
  model: () => string;
};

export const LIVE_ENGINES: EngineDef[] = [
  { id: "chatgpt", name: "ChatGPT", env: ["OPENAI_API_KEY"], enabled: () => !!process.env.OPENAI_API_KEY, model: () => process.env.OPENAI_MODEL || "gpt-6-astra" },
  { id: "gemini", name: "Gemini", env: ["GEMINI_API_KEY"], enabled: () => !!process.env.GEMINI_API_KEY, model: () => process.env.GEMINI_MODEL || "gemini-3.8-flash" },
  {
    id: "perplexity",
    name: "Perplexity",
    env: ["PERPLEXITY_API_KEY"],
    enabled: () => !!process.env.PERPLEXITY_API_KEY,
    model: () => process.env.PERPLEXITY_MODEL || `preset:${process.env.PERPLEXITY_PRESET || "low"}`,
  },
  { id: "google-aio", name: "Google AI Overviews", env: ["DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD"], enabled: liveEnabled, model: () => "Google SERP (DataForSEO)" },
  { id: "claude", name: "Claude", env: ["ANTHROPIC_API_KEY"], enabled: anthropicEnabled, model: () => CLAUDE_MODEL },
];
export const liveEngine = (id: string) => LIVE_ENGINES.find((e) => e.id === id);
export const enabledLiveEngines = () => LIVE_ENGINES.filter((e) => e.enabled());

/** Errors that will fail every prompt for this engine (bad key, quota): the job skips the engine. */
export class EngineFatalError extends AppError {}

async function postJson(url: string, headers: Record<string, string>, body: unknown, provider: string) {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), cache: "no-store", signal: AbortSignal.timeout(180_000) });
  } catch (e) {
    throw new AppError(e instanceof Error && e.name === "TimeoutError" ? `${provider} did not respond within 3 minutes.` : `Could not reach the ${provider} API.`, 502);
  }
  const raw = (await res.json().catch(() => ({}))) as unknown;
  // Some Google endpoints wrap errors in an array: [{ "error": { ... } }].
  const data = (Array.isArray(raw) ? (raw[0] ?? {}) : raw) as Record<string, any>;
  if (!res.ok) {
    const msg = data?.error?.message ?? data?.detail ?? data?.message ?? `HTTP ${res.status}`;
    const keyProblem =
      res.status === 401 ||
      res.status === 403 ||
      /api[_ ]?key/i.test(String(msg)) ||
      (data?.error?.details ?? []).some?.((d: { reason?: string }) => d?.reason === "API_KEY_INVALID");
    if (keyProblem) throw new EngineFatalError(`${provider} rejected the API key (${res.status}): ${msg}`, 401);
    if (res.status === 429) throw new EngineFatalError(`${provider} rate limit or quota reached: ${msg}`, 429);
    throw new AppError(`${provider} API error (${res.status}): ${msg}`, 502);
  }
  return data;
}

const dedupe = (items: { url: string; title: string }[]) => {
  const seen = new Set<string>();
  return items.filter((i) => i.url && !seen.has(i.url) && (seen.add(i.url), true));
};

// ------------------------------------------------------------------------------------------ OpenAI

/** Parse an OpenAI Responses API result (message output_text + url_citation annotations, web_search_call sources). */
export function parseOpenAi(data: Record<string, any>, model: string): EngineAnswer {
  const texts: string[] = [];
  const citations: EngineAnswer["citations"] = [];
  const searchResults: EngineAnswer["searchResults"] = [];
  for (const item of (data.output ?? []) as any[]) {
    if (item?.type === "message")
      for (const c of item.content ?? []) {
        if (c?.type !== "output_text") continue;
        texts.push(c.text ?? "");
        for (const a of c.annotations ?? []) if (a?.type === "url_citation" && a.url) citations.push({ url: a.url, title: a.title ?? "" });
      }
    if (item?.type === "web_search_call") for (const src of item.action?.sources ?? []) if (src?.url) searchResults.push({ url: src.url, title: src.title ?? "" });
  }
  const text = (texts.join("").trim() || String(data.output_text ?? "")).trim();
  return { engine: "chatgpt", model: data.model ?? model, text, citations: dedupe(citations), searchResults: dedupe(searchResults), present: !!text };
}

async function askChatGpt(prompt: string, country?: string): Promise<EngineAnswer> {
  const model = liveEngine("chatgpt")!.model();
  const data = await postJson(
    "https://api.openai.com/v1/responses",
    { authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    {
      model,
      input: prompt,
      tools: [{ type: "web_search", ...(country ? { user_location: { type: "approximate", country } } : {}) }],
      include: ["web_search_call.action.sources"],
    },
    "OpenAI",
  );
  return parseOpenAi(data, model);
}

// ------------------------------------------------------------------------------------------ Gemini

/** Parse a Gemini Interactions API result (model_output steps with url_citation annotations). */
export function parseGemini(data: Record<string, any>, model: string): EngineAnswer {
  const texts: string[] = [];
  const citations: EngineAnswer["citations"] = [];
  for (const step of (data.steps ?? []) as any[]) {
    if (step?.type !== "model_output") continue;
    for (const c of step.content ?? []) {
      if (c?.type !== "text") continue;
      texts.push(c.text ?? "");
      for (const a of c.annotations ?? []) if (a?.type === "url_citation" && a.url) citations.push({ url: a.url, title: a.title ?? "" });
    }
  }
  const text = (texts.join("").trim() || String(data.output_text ?? "")).trim();
  return { engine: "gemini", model: data.model ?? model, text, citations: dedupe(citations), searchResults: [], present: !!text };
}

async function askGemini(prompt: string): Promise<EngineAnswer> {
  const model = liveEngine("gemini")!.model();
  const data = await postJson(
    "https://generativelanguage.googleapis.com/v1beta/interactions",
    { "x-goog-api-key": process.env.GEMINI_API_KEY ?? "" },
    { model, input: prompt, tools: [{ type: "google_search" }], store: false },
    "Gemini",
  );
  return parseGemini(data, model);
}

// ------------------------------------------------------------------------------------------ Perplexity

/** Parse a Perplexity Agent API result: search_results items + message text with [web:N] citations. */
export function parsePerplexity(data: Record<string, any>, model: string): EngineAnswer {
  const results = new Map<number, { url: string; title: string }>();
  const texts: string[] = [];
  for (const item of (data.output ?? []) as any[]) {
    if (item?.type === "search_results") for (const r of item.results ?? []) if (r?.url) results.set(Number(r.id), { url: r.url, title: r.title ?? "" });
    if (item?.type === "message") for (const c of item.content ?? []) if (c?.type === "output_text") texts.push(c.text ?? "");
  }
  const raw = texts.join("").trim();
  // Inline citations look like [web:1][web:2]; they index the search_results ids.
  const citedIds = [...raw.matchAll(/\[web:(\d+)\]/g)].map((m) => Number(m[1]));
  const citations = citedIds.map((id) => results.get(id)).filter((r): r is { url: string; title: string } => !!r);
  const text = raw.replace(/\[web:(\d+)\]/g, "[$1]");
  return { engine: "perplexity", model: data.model ?? model, text, citations: dedupe(citations), searchResults: dedupe([...results.values()]), present: !!text };
}

async function askPerplexity(prompt: string): Promise<EngineAnswer> {
  const explicitModel = process.env.PERPLEXITY_MODEL;
  const body = explicitModel ? { model: explicitModel, input: prompt, tools: [{ type: "web_search" }] } : { preset: process.env.PERPLEXITY_PRESET || "low", input: prompt };
  const data = await postJson("https://api.perplexity.ai/v1/agent", { authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}` }, body, "Perplexity");
  return parsePerplexity(data, liveEngine("perplexity")!.model());
}

// ------------------------------------------------------------------------------------------ Google AI Overviews

/** Collect every text and URL inside an ai_overview element (the element nests items/references). */
function walkOverview(node: unknown, texts: string[], links: { url: string; title: string }[]) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) return node.forEach((n) => walkOverview(n, texts, links));
  const o = node as Record<string, unknown>;
  if (typeof o.url === "string" && /^https?:/.test(o.url)) links.push({ url: o.url, title: typeof o.title === "string" ? o.title : "" });
  if (typeof o.text === "string" && o.type !== "ai_overview_reference") texts.push(o.text);
  for (const [k, v] of Object.entries(o)) if (k !== "text" && typeof v === "object") walkOverview(v, texts, links);
}

/** Parse the ai_overview element of a DataForSEO SERP result (absent = no AI Overview shown). */
export function parseAiOverview(result: Record<string, any> | undefined): EngineAnswer {
  const overview = ((result?.items ?? []) as any[]).find((i) => i?.type === "ai_overview");
  if (!overview) return { engine: "google-aio", model: "Google SERP (DataForSEO)", text: "", citations: [], searchResults: [], present: false };
  const texts: string[] = [];
  const links: { url: string; title: string }[] = [];
  walkOverview(overview, texts, links);
  const text = (typeof overview.markdown === "string" ? overview.markdown : texts.join("\n")).trim();
  return { engine: "google-aio", model: "Google SERP (DataForSEO)", text, citations: dedupe(links), searchResults: [], present: !!text };
}

async function askGoogleAio(ownerId: string, prompt: string, db: string): Promise<EngineAnswer> {
  const [result] = await dfs(ownerId, "serp/google/organic/live/advanced", { keyword: prompt, ...market(db), device: "desktop", depth: 10, load_async_ai_overview: true }, 8000);
  return parseAiOverview(result);
}

// ------------------------------------------------------------------------------------------ Dispatcher

export async function askEngine(engine: LiveEngineId, prompt: string, opts: { ownerId: string; country: string }): Promise<EngineAnswer> {
  const def = liveEngine(engine);
  if (!def?.enabled()) throw new EngineFatalError(`${def?.name ?? engine} is not connected. Set ${def?.env.join(" and ") ?? "its API key"}.`, 400);
  try {
    return await dispatch(engine, prompt, opts);
  } catch (e) {
    // Bad key (401), spend cap (402), quota (429) or missing credentials (503) fail every prompt alike.
    if (e instanceof AppError && !(e instanceof EngineFatalError) && [401, 402, 429, 503].includes(e.status)) throw new EngineFatalError(e.message, e.status);
    throw e;
  }
}

async function dispatch(engine: LiveEngineId, prompt: string, opts: { ownerId: string; country: string }): Promise<EngineAnswer> {
  switch (engine) {
    case "chatgpt":
      return askChatGpt(prompt, opts.country);
    case "gemini":
      return askGemini(prompt);
    case "perplexity":
      return askPerplexity(prompt);
    case "google-aio":
      return askGoogleAio(opts.ownerId, prompt, opts.country);
    case "claude": {
      const a = await askClaude(prompt, { country: opts.country });
      return { engine: "claude", model: a.model, text: a.text, citations: a.citations.map((c) => ({ url: c.url, title: c.title })), searchResults: a.searchResults, present: !!a.text };
    }
  }
}
