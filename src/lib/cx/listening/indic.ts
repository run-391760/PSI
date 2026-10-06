import { createHash } from "node:crypto";
import { intentOf, languageOf, sentimentOf } from "@/lib/cx/ai";
import { fromSarvamCode, isIndicLanguage, sarvamConfigured, sarvamDetectLanguage, SarvamError, sarvamTranslate, toSarvamCode, type SarvamLang } from "@/lib/providers/sarvam";

/**
 * Indian-language enrichment for new listening mentions (Sarvam AI, only when SARVAM_API_KEY is set).
 * Mentions in an Indic script, tagged with an Indic language by their source, or written in romanized
 * Hindi are translated to English (Mayura detects the language, Sarvam LID confirms Hinglish), the
 * detected language is stored, and sentiment and intent are re-scored on the English translation,
 * where the lexicon and rules work. Star ratings still win for reviews. Capped per ingest run, cached
 * by text hash in provider_cache (the translation stays readable there via mentionTranslation), and
 * never throws: any Sarvam failure leaves the heuristic values in place.
 */

export const INDIC_MAX_PER_RUN = 200;
/** Shorter texts carry too little signal to pay for. */
export const INDIC_MIN_CHARS = 12;
/** Characters translated per mention (two Mayura requests at most). */
export const INDIC_MAX_CHARS = 2000;
const CONCURRENCY = 4;
const RUN_MS = 120_000;
const CACHE_HOURS = 24 * 180;

export type IndicBudget = { left: number; deadline: number; stopped: boolean };
/** One budget per ingest run; share it across every storeMentions call of the run. */
export const indicBudget = (max = INDIC_MAX_PER_RUN, ms = RUN_MS): IndicBudget => ({ left: max, deadline: Date.now() + ms, stopped: false });

/**
 * The open ingest run per project, so storeMentions calls that are not handed a budget (tracked social
 * profiles fetched inside ingestBrand) draw from the run's shared one instead of getting their own.
 */
const RUNS = new Map<string, IndicBudget>();
export function startIndicRun(projectId: string): IndicBudget {
  const b = indicBudget();
  RUNS.set(projectId, b);
  return b;
}
export function endIndicRun(projectId: string, b: IndicBudget) {
  if (RUNS.get(projectId) === b) RUNS.delete(projectId);
}
/** The project's open run budget (even when spent or past its deadline), else a small one for a one-off fetch. */
export const runBudget = (projectId: string): IndicBudget => RUNS.get(projectId) ?? indicBudget(50);

/** Cached Sarvam result for one text: ISO language (null = unknown) and the English translation (null = already English / untranslatable). */
export type IndicResult = { language: string | null; translation: string | null; model: string };

type MentionLike = { externalId: string; title: string; body: string; language: string | null; sentiment: string; sentimentScore: number; intent: string; engagement: Record<string, number> };

// ------------------------------------------------------------------------------------------ detection

/** Frequent romanized-Hindi function words that are rare in English. */
const HINGLISH = /\b(hai|hain|nahi|nahin|nhi|kya|kyu|kyun|bahut|bohot|accha|achha|acha|yaar|bhai|mujhe|humko|aap|tum|kaise|kaisa|kuch|bilkul|bekar|bakwas|ekdum|matlab|lekin|wala|wali|raha|rahe|rahi|gaya|gayi|karo|karna|diya|liya|mera|meri|tera|teri|hota|hoti|chahiye|sahi|paisa|paise)\b/gi;
/** At least three hits over two distinct words: "bhai" alone is not a language. */
export function looksHinglish(text: string): boolean {
  const hits = (text.match(HINGLISH) ?? []).map((w) => w.toLowerCase());
  return hits.length >= 3 && new Set(hits).size >= 2;
}

/** Share of the text's letters that are Latin. */
const latinShare = (text: string) => {
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  return letters ? (text.match(/\p{Script=Latin}/gu)?.length ?? 0) / letters : 0;
};
/** Sarvam languages written in the Perso-Arabic script (languageOf reports that script as "ar"). */
const ARABIC_SCRIPT = new Set<string>(["ur-IN", "ks-IN", "sd-IN"]);

/**
 * How to translate a mention, or null when it is not worth a Sarvam call: an Indic script → Mayura
 * auto-detect; an Indic language reported by the source → that language when the text's script fits it,
 * identify first when the text is Latin (feeds tag whole channels, e.g. YouTube "hi" over English
 * descriptions); romanized Hindi → identify first.
 */
export function indicPlan(text: string, given: string | null): { source: "auto" | "identify" | SarvamLang } | null {
  if (text.trim().length < INDIC_MIN_CHARS || !/\p{L}/u.test(text)) return null;
  const guess = languageOf(text);
  if (isIndicLanguage(guess)) return { source: "auto" };
  if (given && isIndicLanguage(given)) {
    const code = toSarvamCode(given)!;
    if (latinShare(text) >= 0.5) return { source: "identify" };
    // Arabic script fits Urdu/Kashmiri/Sindhi; other scripts languageOf does not know (Ol Chiki, Meetei Mayek) are trusted.
    if (guess === "ar") return ARABIC_SCRIPT.has(code) ? { source: code } : null;
    return guess === "en" ? { source: code } : null;
  }
  if (looksHinglish(text)) return { source: "identify" };
  return null;
}

const textOf = (r: Pick<MentionLike, "title" | "body">) => `${r.title} ${r.body}`.trim().slice(0, INDIC_MAX_CHARS);
export const indicCacheKey = (text: string) => `sarvam:mention:v1:${createHash("sha256").update(text.slice(0, INDIC_MAX_CHARS)).digest("hex")}`;

/** One Sarvam round for a text. Throws SarvamError. */
export async function translateMention(text: string, plan: NonNullable<ReturnType<typeof indicPlan>>): Promise<IndicResult> {
  let source: "auto" | SarvamLang;
  if (plan.source === "identify") {
    const lid = await sarvamDetectLanguage(text);
    if (!lid.language || lid.language === "en-IN") return { language: lid.language ? "en" : null, translation: null, model: "sarvam-lid" };
    source = lid.language;
  } else source = plan.source;
  const r = await sarvamTranslate(text, { source, target: "en-IN" });
  const lang = r.source ?? (source === "auto" ? null : source);
  // English input (auto-detected) or an echo is no translation.
  const translation = lang === "en-IN" || r.text.trim() === text.trim() ? null : r.text.trim() || null;
  return { language: lang ? fromSarvamCode(lang) : null, translation, model: r.model };
}

/** Apply a result: stored language, and sentiment/intent from the English translation (a star rating still decides sentiment). */
export function applyIndic<R extends MentionLike>(row: R, res: IndicResult): R & { translation?: string } {
  const out = { ...row, language: res.language ?? row.language } as R & { translation?: string };
  if (!res.translation) return out;
  const s = sentimentOf(res.translation);
  const rating = row.engagement.rating;
  return { ...out, translation: res.translation, sentiment: rating == null ? s.label : row.sentiment, sentimentScore: s.score, intent: intentOf(res.translation) };
}

// ------------------------------------------------------------------------------------------ run

export type IndicStore = {
  /** External ids (as stored, ≤500 chars) that already exist for this project and source. */
  existing: (externalIds: string[]) => Promise<Set<string>>;
  get: (keys: string[]) => Promise<Map<string, IndicResult>>;
  put: (key: string, value: IndicResult) => Promise<void>;
};

/** provider_cache + cx_mentions backed store (lazy DB import keeps this module test-friendly). */
export function dbIndicStore(projectId: string, source: string): IndicStore {
  const q = async () => (await import("@/lib/db")).query;
  return {
    existing: async (ids) =>
      new Set((await (await q())<{ external_id: string }>("SELECT external_id FROM cx_mentions WHERE project_id=$1 AND source=$2 AND external_id = ANY($3::text[])", [projectId, source, ids])).map((r) => r.external_id)),
    get: async (keys) =>
      new Map((await (await q())<{ key: string; payload: IndicResult }>("SELECT key, payload FROM provider_cache WHERE key = ANY($1::text[]) AND expires_at>now()", [keys])).map((r) => [r.key, r.payload])),
    put: async (key, value) =>
      void (await (await q())(
        `INSERT INTO provider_cache(key,source,payload,fetched_at,expires_at) VALUES($1,'sarvam',$2::jsonb,now(),now()+($3 * interval '1 hour'))
         ON CONFLICT(key) DO UPDATE SET payload=excluded.payload, fetched_at=now(), expires_at=excluded.expires_at`,
        [key, JSON.stringify(value), CACHE_HOURS],
      )),
  };
}

/**
 * Enrich the new rows of a batch (rows already stored keep their values). Cache hits are free; each
 * Sarvam round uses one unit of the run budget. 401/403/429 stop Sarvam for the rest of the run.
 */
export async function enrichIndic<R extends MentionLike>(rows: R[], budget: IndicBudget, store: IndicStore): Promise<(R & { translation?: string })[]> {
  if (!sarvamConfigured() || !rows.length) return rows;
  try {
    const planned = rows.map((r) => ({ r, text: textOf(r), plan: indicPlan(textOf(r), r.language) }));
    const todo = planned.filter((p) => p.plan);
    if (!todo.length) return rows;
    const known = await store.existing(todo.map((p) => p.r.externalId.slice(0, 500)));
    const fresh = todo.filter((p) => !known.has(p.r.externalId.slice(0, 500)));
    if (!fresh.length) return rows;
    const cache = await store.get(fresh.map((p) => indicCacheKey(p.text)));
    const results = new Map<string, IndicResult>();
    const queue: typeof fresh = [];
    for (const p of fresh) {
      const hit = cache.get(indicCacheKey(p.text));
      if (hit) results.set(p.r.externalId, hit);
      else queue.push(p);
    }
    let failures = 0;
    const worker = async () => {
      for (let p = queue.shift(); p; p = queue.shift()) {
        if (budget.stopped || budget.left <= 0 || Date.now() > budget.deadline) return;
        budget.left--;
        try {
          const res = await translateMention(p.text, p.plan!);
          results.set(p.r.externalId, res);
          await store.put(indicCacheKey(p.text), res).catch(() => {});
        } catch (e) {
          failures++;
          if (e instanceof SarvamError && (e.status === 401 || e.status === 429)) {
            if (!budget.stopped) console.warn(`[listening] Sarvam enrichment paused for this run: ${e.message}`);
            budget.stopped = true;
          }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
    if (failures && !budget.stopped) console.warn(`[listening] Sarvam enrichment skipped ${failures} mention(s) after errors`);
    return rows.map((r) => {
      const res = results.get(r.externalId);
      return res ? applyIndic(r, res) : r;
    });
  } catch (e) {
    console.warn(`[listening] Sarvam enrichment skipped: ${e instanceof Error ? e.message : String(e)}`);
    return rows;
  }
}

/** The stored English translation of a mention (null when none was made or it expired). */
export async function mentionTranslation(title: string, body: string): Promise<IndicResult | null> {
  const key = indicCacheKey(textOf({ title, body }));
  return (await dbIndicStore("", "").get([key]).catch(() => new Map<string, IndicResult>())).get(key) ?? null;
}
