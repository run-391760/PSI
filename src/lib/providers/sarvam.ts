import { AppError } from "@/lib/domain";

/**
 * Sarvam AI (api.sarvam.ai) client, server-only: chat completions (OpenAI-compatible), Mayura /
 * Sarvam-Translate text translation and text language identification for Indian languages.
 * Key: SARVAM_API_KEY (sent as `api-subscription-key` and as a Bearer token; the docs accept both).
 * Optional SARVAM_MODEL (chat, default sarvam-105b). Never logs the key or request bodies.
 *
 * Per docs.sarvam.ai (checked 2026-10): POST /v1/chat/completions (models sarvam-105b, 128K context,
 * and sarvam-105b-conversations; response_format json_object / json_schema; reasoning_effort
 * low|high|max, default medium), POST /translate (mayura:v1 ≤1000 chars, 11 languages + `auto` source;
 * sarvam-translate:v1 ≤2000 chars, 22 languages, explicit source, formal mode only), POST /text-lid
 * (≤1000 chars → language_code + script_code, both nullable).
 */

export const SARVAM_BASE = "https://api.sarvam.ai";
export const SARVAM_DEFAULT_MODEL = "sarvam-105b";
export const sarvamModel = () => process.env.SARVAM_MODEL?.trim() || SARVAM_DEFAULT_MODEL;
export const sarvamConfigured = () => Boolean(process.env.SARVAM_API_KEY?.trim());

/** Typed failure; `status` follows the HTTP answer (502 for network/timeouts), `code` is Sarvam's error code when given. */
export class SarvamError extends AppError {
  constructor(
    message: string,
    status: number,
    readonly code: string | null = null,
  ) {
    super(message, status);
    this.name = "SarvamError";
  }
}

// ------------------------------------------------------------------------------------------ languages

/** Mayura (default model): these 11 plus `auto` source detection. */
const MAYURA = ["en-IN", "hi-IN", "bn-IN", "gu-IN", "kn-IN", "ml-IN", "mr-IN", "od-IN", "pa-IN", "ta-IN", "te-IN"] as const;
/** Sarvam-Translate adds these (explicit source only). */
const EXTENDED = ["as-IN", "brx-IN", "doi-IN", "kok-IN", "ks-IN", "mai-IN", "mni-IN", "ne-IN", "sa-IN", "sat-IN", "sd-IN", "ur-IN"] as const;
export type SarvamLang = (typeof MAYURA)[number] | (typeof EXTENDED)[number];
export const SARVAM_LANGUAGES: readonly SarvamLang[] = [...MAYURA, ...EXTENDED];
const MAYURA_SET = new Set<string>(MAYURA);

/** English names (and common native spellings) → Sarvam codes, for free-text settings like "Translate into Hindi". */
const NAMES: Record<string, SarvamLang> = {
  english: "en-IN", hindi: "hi-IN", hindustani: "hi-IN", bengali: "bn-IN", bangla: "bn-IN", gujarati: "gu-IN", kannada: "kn-IN", malayalam: "ml-IN",
  marathi: "mr-IN", odia: "od-IN", oriya: "od-IN", punjabi: "pa-IN", panjabi: "pa-IN", tamil: "ta-IN", telugu: "te-IN", assamese: "as-IN", bodo: "brx-IN",
  dogri: "doi-IN", konkani: "kok-IN", kashmiri: "ks-IN", maithili: "mai-IN", manipuri: "mni-IN", meitei: "mni-IN", nepali: "ne-IN", sanskrit: "sa-IN",
  santali: "sat-IN", sindhi: "sd-IN", urdu: "ur-IN", "हिन्दी": "hi-IN", "हिंदी": "hi-IN", "ગુજરાતી": "gu-IN", "मराठी": "mr-IN", "தமிழ்": "ta-IN",
};
/** ISO 639-1/2 → Sarvam (Odia is `od` at Sarvam, `or` in ISO). */
const ISO: Record<string, SarvamLang> = { or: "od-IN", ori: "od-IN" };

/**
 * Sarvam code for a language given as a code ("hi", "hi-IN", "or"), a name ("Hindi") or the inbox's
 * phrase `the language with code "hi"`; null when Sarvam does not support it.
 */
export function toSarvamCode(lang: string | null | undefined): SarvamLang | null {
  if (!lang) return null;
  const s = lang.trim().toLowerCase();
  const quoted = /code\s+"([a-z]{2,3}(?:-[a-z]{2})?)"/.exec(s)?.[1];
  const v = quoted ?? s;
  if (NAMES[v]) return NAMES[v];
  const base = v.split(/[-_]/)[0];
  if (ISO[base]) return ISO[base];
  const hit = SARVAM_LANGUAGES.find((c) => c.split("-")[0].toLowerCase() === base);
  return hit ?? null;
}
/** ISO-style short code for storage ("od-IN" → "or", "hi-IN" → "hi"). */
export const fromSarvamCode = (code: string) => (code.startsWith("od-") ? "or" : code.split("-")[0].toLowerCase());
/** True for any Indian language Sarvam handles (English excluded). */
export function isIndicLanguage(code: string | null | undefined): boolean {
  const c = toSarvamCode(code);
  return c != null && c !== "en-IN";
}

// ------------------------------------------------------------------------------------------ transport

const headers = () => {
  const key = process.env.SARVAM_API_KEY?.trim() ?? "";
  return { "content-type": "application/json", "api-subscription-key": key, authorization: `Bearer ${key}` };
};

async function post(path: string, body: unknown, timeoutMs: number): Promise<Record<string, any>> {
  if (!sarvamConfigured()) throw new SarvamError("SARVAM_API_KEY is not set on the server.", 400, "not_configured");
  let res: Response;
  try {
    res = await fetch(`${SARVAM_BASE}${path}`, { method: "POST", headers: headers(), body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    throw new SarvamError(e instanceof Error && e.name === "TimeoutError" ? "Sarvam did not respond in time. Try again." : "Could not reach the Sarvam API.", 502, "network");
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, any>;
  if (res.ok) return data;
  const err = (data?.error ?? {}) as { message?: unknown; code?: unknown };
  const msg = String(err.message ?? data?.message ?? res.statusText ?? "").slice(0, 300);
  const code = typeof err.code === "string" ? err.code : null;
  if (res.status === 401 || res.status === 403) throw new SarvamError(`SARVAM_API_KEY was rejected (${res.status}). Check the key on the server.`, 401, code);
  if (res.status === 429) throw new SarvamError("Sarvam rate limit or quota reached. Try again in a minute.", 429, code);
  if (res.status === 400 || res.status === 422) throw new SarvamError(`Sarvam rejected the request: ${msg}`, 400, code);
  throw new SarvamError(`Sarvam API error (${res.status}): ${msg}`, 502, code);
}

// ------------------------------------------------------------------------------------------ chat

export type SarvamChatOpts = {
  maxTokens?: number;
  timeoutMs?: number;
  /** low/high map to reasoning_effort; medium is Sarvam's default and is not sent. */
  effort?: "low" | "medium" | "high";
  temperature?: number;
  /** JSON output: a JSON schema (json_schema mode) or `true` for plain json_object mode. */
  json?: { name: string; schema: Record<string, unknown>; strict?: boolean } | true;
};

/** Older Sarvam models put their reasoning inline; drop it if present. */
const stripThinking = (t: string) => t.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^[\s\S]*?<\/think>/i, "").trim();

/** One chat completion (system + user turn). Throws SarvamError; an empty answer is returned as "". */
export async function sarvamChat(system: string, prompt: string, opts: SarvamChatOpts = {}): Promise<{ text: string; model: string; finish: string }> {
  const model = sarvamModel();
  const json = opts.json;
  const data = await post(
    "/v1/chat/completions",
    {
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      max_tokens: opts.maxTokens ?? 2048,
      temperature: opts.temperature ?? 0.2,
      ...(opts.effort && opts.effort !== "medium" ? { reasoning_effort: opts.effort } : {}),
      ...(json === true
        ? { response_format: { type: "json_object" } }
        : json
          ? { response_format: { type: "json_schema", json_schema: { name: json.name, schema: json.schema, strict: json.strict ?? false } } }
          : {}),
    },
    opts.timeoutMs ?? 60_000,
  );
  const choice = ((data.choices ?? []) as any[])[0];
  const finish = String(choice?.finish_reason ?? "");
  if (finish === "content_filter") throw new SarvamError("Sarvam declined this request.", 422, "content_filter");
  const text = stripThinking(String(choice?.message?.content ?? ""));
  if (finish === "length" && (json || !text)) throw new SarvamError("Sarvam's answer was cut off. Try a smaller section.", 502, "length");
  return { text, model: String(data.model ?? model), finish };
}

// ------------------------------------------------------------------------------------------ language id

/** Language of a text (first 1000 chars) or null when Sarvam cannot tell. Throws SarvamError. */
export async function sarvamDetectLanguage(text: string, timeoutMs = 20_000): Promise<{ language: SarvamLang | null; script: string | null }> {
  const input = text.trim().slice(0, 1000);
  if (!input) return { language: null, script: null };
  const data = await post("/text-lid", { input }, timeoutMs);
  const code = typeof data.language_code === "string" ? data.language_code : null;
  const language = code && (SARVAM_LANGUAGES as readonly string[]).includes(code) ? (code as SarvamLang) : null;
  return { language, script: typeof data.script_code === "string" ? data.script_code : null };
}

// ------------------------------------------------------------------------------------------ translate

export type TranslateOpts = {
  source?: "auto" | SarvamLang;
  target: SarvamLang;
  /** Mayura only; Sarvam-Translate supports formal only. */
  mode?: "formal" | "modern-colloquial" | "classic-colloquial" | "code-mixed";
  timeoutMs?: number;
  /** Stop after this many characters of input (cost control). */
  maxChars?: number;
};
export const TRANSLATE_LIMITS = { "mayura:v1": 1000, "sarvam-translate:v1": 2000 } as const;

/**
 * Split text into pieces of at most `limit` characters, preferring paragraph, then sentence (incl.
 * the danda "।"), then word boundaries. Pieces keep their trailing whitespace so they re-join exactly.
 */
export function chunkText(text: string, limit: number): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    let cut =
      [/\n\s*\n/g, /[.!?।॥]\s+/g, /\s+/g].map((re) => {
        let last = -1;
        for (const m of window.matchAll(re)) if (m.index! > limit * 0.3) last = m.index! + m[0].length;
        return last;
      }).find((i) => i > 0) ?? limit;
    // Never split a surrogate pair (emoji) on a hard cut.
    if (cut === limit && /[\uD800-\uDBFF]/.test(rest[cut - 1])) cut--;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) out.push(rest);
  return out;
}

/**
 * Translate text, chunked under the model's input limit. Mayura when both languages are among its 11
 * (supports `auto` source); otherwise Sarvam-Translate, detecting an `auto` source first. Returns the
 * source language Sarvam reported for the first chunk. Throws SarvamError.
 */
export async function sarvamTranslate(text: string, opts: TranslateOpts): Promise<{ text: string; source: SarvamLang | null; model: string }> {
  const input = opts.maxChars ? text.slice(0, opts.maxChars) : text;
  if (!input.trim()) return { text: input, source: null, model: "" };
  let source = opts.source ?? "auto";
  const mayura = (source === "auto" || MAYURA_SET.has(source)) && MAYURA_SET.has(opts.target);
  if (!mayura && source === "auto") {
    const lid = await sarvamDetectLanguage(input, opts.timeoutMs);
    if (!lid.language) throw new SarvamError("Sarvam could not identify the source language.", 400, "unknown_language");
    source = lid.language;
  }
  if (source === opts.target) return { text: input, source, model: "" };
  const model = mayura ? "mayura:v1" : "sarvam-translate:v1";
  const pieces = chunkText(input, TRANSLATE_LIMITS[model]);
  let detected: SarvamLang | null = source === "auto" ? null : source;
  const parts: string[] = [];
  for (const piece of pieces) {
    const lead = /^\s*/.exec(piece)![0];
    const trail = /\s*$/.exec(piece)![0];
    const core = piece.trim();
    if (!core) {
      parts.push(piece);
      continue;
    }
    const data = await post(
      "/translate",
      {
        input: core,
        source_language_code: source,
        target_language_code: opts.target,
        model,
        ...(mayura && opts.mode ? { mode: opts.mode } : {}),
      },
      opts.timeoutMs ?? 30_000,
    );
    const got = typeof data.source_language_code === "string" && (SARVAM_LANGUAGES as readonly string[]).includes(data.source_language_code) ? (data.source_language_code as SarvamLang) : null;
    detected ??= got;
    parts.push(lead + String(data.translated_text ?? "").trim() + trail);
  }
  return { text: parts.join(""), source: detected, model };
}

/** Placeholders ({{name}}), markdown links, bare URLs and line breaks are kept verbatim; only the text between them is translated. */
const PROTECTED = /(\{\{[^}]*\}\}|\[[^\]]*\]\([^)]*\)|https?:\/\/\S+|\n+)/;

/**
 * Translate a reply while keeping its placeholders, links and line breaks. Segments are translated
 * sequentially (short texts; avoids bursting the rate limit). Throws SarvamError.
 */
export async function sarvamTranslatePreserving(text: string, opts: TranslateOpts): Promise<{ text: string; source: SarvamLang | null }> {
  const segs = text.split(PROTECTED);
  let source: SarvamLang | null = null;
  const out: string[] = [];
  for (const [i, seg] of segs.entries()) {
    // split() with one capture group alternates text (even) and protected (odd) pieces.
    if (i % 2 === 1 || !/\p{L}/u.test(seg)) {
      out.push(seg);
      continue;
    }
    const r = await sarvamTranslate(seg, opts);
    source ??= r.source;
    out.push(r.text);
  }
  return { text: out.join(""), source };
}
