import { database } from "@/lib/domain";
import { autocompleteSuggestions, type AutocompleteResult } from "@/lib/providers/autocomplete";
import { dfs, market } from "@/lib/providers/dataforseo";
import { cached, liveEnabled } from "@/lib/providers/source";
import { expandSeed, rng, serp, topicFor, topicUniverse } from "@/lib/seo/engine";
import { keywordRows, mapDfsKeyword } from "./metrics";
import { isQuestion, matchesSeed, normalizeKw, stem } from "./text";
import { toIdea, type AutocompleteInfo, type IdeaRow, type KwRow, type MatchType } from "./types";

export const MAX_IDEAS = 3000;

export type { AutocompleteInfo };
export type PoolRow = KwRow & { ac: boolean; question: boolean; rel: number | null };
export type IdeaPool = {
  seed: string;
  db: string;
  topicName: string;
  rows: PoolRow[];
  /** Metrics source for every row in the pool. */
  source: "demo" | "dataforseo";
  fetchedAt: string;
  autocomplete: AutocompleteInfo;
  /** Demo pools compute SERP relatedness lazily (only the Related view and Overview need it). */
  relReady: boolean;
};

const LONG_TAIL_SUFFIX = ["near me", "online", "sale", "2026", "reviews", "price", "deals", "uk", "in india", "brands", "for beginners", "reddit", "cheap", "comparison"];
const LONG_TAIL_PREFIX = ["best", "cheap", "top", "affordable", "buy", "top rated", "new", "custom", "luxury", "used", "professional", "easy"];
const LONG_TAIL_QUESTIONS = ["what is the best {k}", "how to choose {k}", "where to buy {k}", "how much does {k} cost", "is {k} worth it", "which {k} is best", "how to find {k}", "what are the best {k}"];

/** Extra deterministic long-tail combinations (seed × topic modifier × generic modifier). */
function longTail(seed: string, modifiers: string[]) {
  const r = rng(`kw-longtail:${seed}`);
  const out = new Set<string>();
  for (const m of modifiers)
    for (const s of r.sample(LONG_TAIL_SUFFIX, 5)) if (!m.includes(s) && !s.includes(m)) out.add(`${seed} ${m} ${s}`);
  for (const p of LONG_TAIL_PREFIX) for (const m of r.sample(modifiers, 7)) out.add(`${p} ${seed} ${m}`);
  for (const q of LONG_TAIL_QUESTIONS) for (const m of r.sample(modifiers, 4)) out.add(q.replace("{k}", `${seed} ${m}`));
  return [...out];
}

const pluralToggle = (w: string) => (w.length <= 3 || /\d/.test(w) ? null : stem(w) !== w ? stem(w) : /(s|sh|ch|x|z)$/.test(w) ? `${w}es` : /[^aeiou]y$/.test(w) ? `${w.slice(0, -1)}ies` : `${w}s`);

/**
 * Word-form and word-order variants of the seed, so match types differ like in Semrush:
 * "running shoe …" (phrase, not exact), "shoes for running …" (broad only), "running trail shoes" (broad only).
 */
function variants(seed: string, modifiers: string[]) {
  const words = seed.split(" ");
  const r = rng(`kw-variants:${seed}`);
  const bases = new Set<string>();
  const last = words[words.length - 1];
  const toggled = pluralToggle(last);
  if (toggled) bases.add([...words.slice(0, -1), toggled].join(" "));
  const leadingModifier = /^(best|top|cheap|free|buy|new|used|how|what|why|where|which|who|when|is|are|can|do|does|online|affordable|good|easy|luxury)$/.test(words[0]);
  if (words.length >= 2 && words.length <= 3 && !leadingModifier) {
    bases.add(`${words.slice(1).join(" ")} for ${words[0]}`);
    bases.add(`${words.slice(1).join(" ")} ${words[0]}`);
    const singles = modifiers.filter((m) => !m.includes(" ")).slice(0, 8);
    for (const m of r.sample(singles, 4)) bases.add(`${words[0]} ${m} ${words.slice(1).join(" ")}`);
  }
  const out = new Set<string>(bases);
  for (const b of bases) {
    for (const m of r.sample([...LONG_TAIL_SUFFIX, ...modifiers], 10)) out.add(`${b} ${m}`);
    for (const p of r.sample(LONG_TAIL_PREFIX, 4)) out.add(`${p} ${b}`);
  }
  return [...out];
}

/** Engine candidates that end in a dangling connector ("credit card and") or repeat a word ("best best") read as broken; drop them. */
const DANGLING = /\s(and|with|without|vs|or|of|for|to|the|a|in)$|\b(\w+) \2\b/;

function autocompleteInfo(ac: AutocompleteResult): AutocompleteInfo {
  if (ac.status === "ok") return { status: "ok", count: ac.data.suggestions.length, fetchedAt: ac.fetchedAt };
  if (ac.status === "failed") return { status: "failed", count: 0, error: ac.error };
  return { status: "disabled", count: 0 };
}

/** Share (0..100) of the seed's top-10 domains that also rank in the keyword's top 10 (demo SERPs). */
function relatedness(seedDomains: Set<string>, keyword: string, db: string) {
  const top = serp(keyword, db, { depth: 10 });
  let shared = 0;
  for (const r of top) if (seedDomains.has(r.domain)) shared++;
  return Math.round((shared / Math.max(1, seedDomains.size)) * 100);
}

const POOLS = new Map<string, { expires: number; pool: Promise<IdeaPool> }>();
const POOL_TTL = 10 * 60 * 1000;

async function buildDemoPool(ownerId: string, seed: string, db: string, ac: AutocompleteResult): Promise<IdeaPool> {
  const { topic, candidates } = expandSeed(seed);
  const acSet = new Set(ac.status === "ok" ? ac.data.suggestions.map((s) => s.keyword) : []);
  const generated = [...candidates.map((c) => c.keyword), ...longTail(seed, topic.modifiers), ...variants(seed, topic.modifiers)].filter((k) => !DANGLING.test(k));
  const all = new Set<string>([...generated, ...acSet]);
  // Related candidates: the seed topic's keyword universe (decided by SERP overlap below).
  for (const k of topicUniverse(topicFor(seed).id)) all.add(k);
  const keywords = [...all].filter((k) => k.length <= 120);
  const { data, fetchedAt } = await keywordRows(ownerId, keywords, db);
  const rows: PoolRow[] = data.map((r) => ({ ...r, ac: acSet.has(r.keyword), question: isQuestion(r.keyword), rel: r.keyword === seed ? 100 : null }));
  return { seed, db, topicName: topic.name, rows, source: "demo", fetchedAt, autocomplete: autocompleteInfo(ac), relReady: false };
}

function ensureRelatedness(pool: IdeaPool) {
  if (pool.relReady) return;
  const seedDomains = new Set(serp(pool.seed, pool.db, { depth: 10 }).map((r) => r.domain));
  const seedTopic = topicFor(pool.seed).id;
  // Keywords of another topic cannot share the seed's results in any meaningful way; skip their SERPs.
  for (const r of pool.rows) if (r.keyword !== pool.seed) r.rel = topicFor(r.keyword).id === seedTopic ? relatedness(seedDomains, r.keyword, pool.db) : 0;
  pool.relReady = true;
}

/** Live pool: DataForSEO Labs suggestions + ideas, plus autocomplete suggestions measured with keyword_overview. */
async function buildLivePool(ownerId: string, seed: string, db: string, ac: AutocompleteResult): Promise<IdeaPool> {
  const m = market(db);
  const { data: fetched, fetchedAt } = await cached(`kw-ideas:${db}:${seed}`, "dataforseo", 24 * 7, async () => {
    const [sug] = await dfs(ownerId, "dataforseo_labs/google/keyword_suggestions/live", { keyword: seed, ...m, limit: 1000, include_seed_keyword: true }, 120000);
    const [ideas] = await dfs(ownerId, "dataforseo_labs/google/keyword_ideas/live", { keywords: [seed], ...m, limit: 700 }, 100000).catch(() => [undefined]);
    const related = ((ideas?.items ?? []) as unknown[]).map(mapDfsKeyword).map((r) => r.keyword);
    const rows = [...((sug?.items ?? []) as unknown[]), ...((ideas?.items ?? []) as unknown[])].map(mapDfsKeyword).filter((r) => r.keyword);
    return { rows, related };
  });
  const byKw = new Map(fetched.rows.map((r) => [r.keyword, r]));
  const acSet = new Set(ac.status === "ok" ? ac.data.suggestions.map((s) => s.keyword) : []);
  const missing = [...acSet].filter((k) => !byKw.has(k)).slice(0, 700);
  if (missing.length) for (const r of (await keywordRows(ownerId, missing, db)).data) byKw.set(r.keyword, r);
  const relatedSet = new Set(fetched.related);
  const rows: PoolRow[] = [...byKw.values()].map((r) => ({ ...r, ac: acSet.has(r.keyword), question: isQuestion(r.keyword), rel: relatedSet.has(r.keyword) ? 50 : null }));
  return { seed, db, topicName: "", rows, source: "dataforseo", fetchedAt, autocomplete: autocompleteInfo(ac), relReady: true };
}

/**
 * All keyword candidates for a seed with metrics, flags (autocomplete, question) and SERP relatedness.
 * Memoized in-process for 10 minutes so Overview, Magic Tool and Topic Research share the work.
 */
export async function ideaPool(ownerId: string, seedInput: string, dbInput: string, opts: { autocomplete?: boolean } = {}): Promise<IdeaPool> {
  const seed = normalizeKw(seedInput);
  const db = database(dbInput).code;
  const useAc = opts.autocomplete !== false;
  const live = liveEnabled();
  const key = `${live ? "live" : "demo"}:${db}:${seed}:${useAc ? "ac" : "-"}`;
  const hit = POOLS.get(key);
  if (hit && Date.now() < hit.expires) return hit.pool;
  const pool = (async () => {
    const ac: AutocompleteResult = useAc ? await autocompleteSuggestions(seed, db) : { status: "disabled" };
    return live ? buildLivePool(ownerId, seed, db, ac) : buildDemoPool(ownerId, seed, db, ac);
  })();
  const entry = { expires: Date.now() + POOL_TTL, pool };
  POOLS.set(key, entry);
  // A pool built while autocomplete failed is kept for one minute only, then autocomplete is retried.
  pool.then((p) => p.autocomplete.status === "failed" && (entry.expires = Date.now() + 60_000)).catch(() => POOLS.delete(key));
  if (POOLS.size > 30) POOLS.delete(POOLS.keys().next().value as string);
  return pool;
}

/** Applies a Semrush match type (+ questions filter) to the pool. Related keeps keywords sharing ≥40% of the seed's top 10. */
export function selectIdeas(pool: IdeaPool, match: MatchType, questionsOnly: boolean, limit = MAX_IDEAS) {
  if (match === "related") ensureRelatedness(pool);
  let rows = pool.rows.filter((r) => (match === "related" ? r.keyword !== pool.seed && (r.rel ?? 0) >= 40 : matchesSeed(r.keyword, pool.seed, match)));
  if (questionsOnly) rows = rows.filter((r) => r.question);
  rows.sort((a, b) =>
    match === "related"
      ? (b.rel ?? 0) - (a.rel ?? 0) || (b.volume ?? -1) - (a.volume ?? -1)
      : (b.volume ?? -1) - (a.volume ?? -1) || a.keyword.localeCompare(b.keyword),
  );
  const total = rows.length;
  const totalVolume = rows.reduce((s, r) => s + (r.volume ?? 0), 0);
  const kds = rows.filter((r) => r.kd != null);
  const avgKd = kds.length ? Math.round(kds.reduce((s, r) => s + (r.kd ?? 0), 0) / kds.length) : null;
  const ideas: IdeaRow[] = rows.slice(0, limit).map((r) => toIdea(r, r.ac, match === "related" ? (r.rel ?? undefined) : undefined));
  return { rows: ideas, total, totalVolume, avgKd, truncated: total > limit };
}
