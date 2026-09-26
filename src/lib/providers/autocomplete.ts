import { database } from "@/lib/domain";
import { cached, flagEnabled } from "./source";

/**
 * Google Autocomplete (real, free). Queries the public suggest endpoint for "<seed>", "<seed> a".."<seed> z"
 * and a few question prefixes, with limited concurrency, an 8s timeout per request and an overall
 * deadline. Results are cached for a week per seed + database. Failures degrade gracefully: the caller
 * gets `status: "failed"` and keeps working with the other sources.
 */

const ENDPOINT = "https://suggestqueries.google.com/complete/search";
const LETTERS = "abcdefghijklmnopqrstuvwxyz".split("");
const QUESTION_PREFIXES = ["how", "what", "why", "where", "which", "can", "is", "are"];
const REQUEST_TIMEOUT_MS = 8000;
const OVERALL_DEADLINE_MS = 12000;
const CONCURRENCY = 8;
const TTL_HOURS = 24 * 7;

export type AutocompleteSuggestion = {
  /** Normalized suggestion text. */
  keyword: string;
  /** The query that produced it ("running shoes a"). */
  query: string;
  /** Rank inside that query's suggestion list (0 = first). */
  rank: number;
};

export type AutocompleteData = {
  seed: string;
  db: string;
  suggestions: AutocompleteSuggestion[];
  queries: number;
  failed: number;
};

export type AutocompleteResult =
  | { status: "ok"; data: AutocompleteData; fetchedAt: string }
  | { status: "disabled" }
  | { status: "failed"; error: string };

const normalize = (s: string) => s.normalize("NFKC").toLowerCase().trim().replace(/\s+/g, " ");

async function fetchSuggestions(q: string, gl: string): Promise<string[]> {
  const url = `${ENDPOINT}?client=firefox&hl=en&gl=${encodeURIComponent(gl.toLowerCase())}&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: "no-store",
    headers: { Accept: "application/json,text/javascript,*/*;q=0.1", "User-Agent": "Mozilla/5.0 (compatible; SynapseSEO/1.0; +keyword research)" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  const charset = /charset=([^;\s]+)/i.exec(res.headers.get("content-type") ?? "")?.[1] ?? "utf-8";
  let text: string;
  try {
    text = new TextDecoder(charset).decode(buf);
  } catch {
    text = new TextDecoder().decode(buf);
  }
  const json: unknown = JSON.parse(text);
  if (!Array.isArray(json) || !Array.isArray(json[1])) return [];
  return (json[1] as unknown[]).filter((s): s is string => typeof s === "string");
}

/** Runs `fn` over `items` with at most `limit` in flight; stops starting new work after `deadline`. */
async function pool<T, R>(items: T[], limit: number, deadline: number, fn: (item: T) => Promise<R>) {
  const results: ({ ok: true; value: R } | { ok: false; error: unknown } | null)[] = items.map(() => null);
  let next = 0;
  let consecutiveFailures = 0;
  const worker = async () => {
    while (next < items.length) {
      if (Date.now() > deadline || consecutiveFailures >= 8) return;
      const i = next++;
      try {
        results[i] = { ok: true, value: await fn(items[i]) };
        consecutiveFailures = 0;
      } catch (error) {
        results[i] = { ok: false, error };
        consecutiveFailures++;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function collect(seed: string, db: string): Promise<AutocompleteData> {
  const queries = [seed, ...LETTERS.map((l) => `${seed} ${l}`), ...QUESTION_PREFIXES.map((p) => `${p} ${seed}`)];
  const results = await pool(queries, CONCURRENCY, Date.now() + OVERALL_DEADLINE_MS, (q) => fetchSuggestions(q, db));
  const seen = new Map<string, AutocompleteSuggestion>();
  let failed = 0;
  results.forEach((r, i) => {
    if (!r || !r.ok) {
      failed++;
      return;
    }
    const query = normalize(queries[i]);
    r.value.forEach((s, rank) => {
      const keyword = normalize(s);
      if (!keyword || keyword.length > 100 || seen.has(keyword)) return;
      // Google often echoes the probe query itself ("how running shoes", "running shoes a"); only the
      // bare seed is a genuine suggestion when echoed.
      if (i > 0 && keyword === query) return;
      seen.set(keyword, { keyword, query: queries[i], rank });
    });
  });
  // Nothing came back at all: treat as a failure so the empty result is not cached for a week.
  if (failed === queries.length || (seen.size === 0 && failed > 0)) {
    const first = results.find((r) => r && !r.ok) as { ok: false; error: unknown } | undefined;
    throw new Error(first?.error instanceof Error ? first.error.message : "no response from Google Autocomplete");
  }
  return { seed, db, suggestions: [...seen.values()], queries: queries.length, failed };
}

const inflight = new Map<string, Promise<AutocompleteResult>>();

/** Real Google Autocomplete suggestions for a seed keyword in a regional database (cached 7 days). */
export async function autocompleteSuggestions(seedInput: string, dbInput: string): Promise<AutocompleteResult> {
  if (!flagEnabled("ENABLE_AUTOCOMPLETE")) return { status: "disabled" };
  const seed = normalize(seedInput);
  const db = database(dbInput).code;
  if (!seed || seed.length > 80) return { status: "failed", error: "Seed is empty or too long for autocomplete." };
  const key = `autocomplete:v2:${db}:${seed}`;
  const running = inflight.get(key);
  if (running) return running;
  const task = cached(key, "google-autocomplete", TTL_HOURS, () => collect(seed, db))
    .then((r): AutocompleteResult => ({ status: "ok", data: r.data, fetchedAt: r.fetchedAt }))
    .catch((e): AutocompleteResult => ({ status: "failed", error: e instanceof Error ? e.message : String(e) }))
    .finally(() => inflight.delete(key));
  inflight.set(key, task);
  return task;
}
