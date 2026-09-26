import { DATABASES, database } from "@/lib/domain";
import type { Intent, KeywordMetrics, SerpFeature } from "../types";
import { clamp, hash, memo, rng, round, unit } from "./random";
import { GIANTS, PREFIX_MODIFIERS, QUESTION_TEMPLATES, SEGMENT_WORDS, SUFFIX_MODIFIERS, TOPICS, type Topic } from "./vocab";

/** Google Ads style monthly volume buckets. */
const BUCKETS = [
  0, 10, 20, 30, 40, 50, 70, 90, 110, 140, 170, 210, 260, 320, 390, 480, 590, 720, 880, 1000, 1300, 1600, 1900, 2400, 2900, 3600,
  4400, 5400, 6600, 8100, 9900, 12100, 14800, 18100, 22200, 27100, 33100, 40500, 49500, 60500, 74000, 90500, 110000, 135000,
  165000, 201000, 246000, 301000, 368000, 450000, 550000, 673000, 823000, 1000000, 1220000, 1500000, 1830000, 2240000, 2740000,
  3350000, 4090000, 5000000, 6120000, 7480000, 9140000, 11100000, 13600000, 16600000, 20400000, 24900000, 30400000, 37200000,
];
export function bucketVolume(v: number) {
  if (v < 5) return 0;
  let lo = 1,
    hi = BUCKETS.length - 1;
  if (v >= BUCKETS[hi]) return BUCKETS[hi];
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (BUCKETS[mid] <= v) lo = mid;
    else hi = mid;
  }
  return v - BUCKETS[lo] < BUCKETS[hi] - v ? BUCKETS[lo] : BUCKETS[hi];
}

export const topicById = (id: string) => TOPICS.find((t) => t.id === id) ?? TOPICS[0];

export function tokens(text: string) {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

const SEGMENTS_BY_LENGTH = [...SEGMENT_WORDS].sort((a, b) => b.length - a.length);

/** Split a concatenated label using known words: "paruluniversity" -> ["parul","university"]. */
export function segmentLabel(label: string): string[] {
  const clean = label.toLowerCase().replace(/[^a-z0-9-]/g, "");
  if (clean.includes("-")) return clean.split("-").filter(Boolean);
  if (clean.length < 6) return [clean];
  for (const w of SEGMENTS_BY_LENGTH) {
    if (w.length < 3 || clean === w) continue;
    if (clean.endsWith(w) && clean.length - w.length >= 3) return [...segmentLabel(clean.slice(0, -w.length)), w];
    if (clean.startsWith(w) && clean.length - w.length >= 3) return [w, ...segmentLabel(clean.slice(w.length))];
  }
  return [clean];
}

/** Head-term tokens per topic, precomputed once. */
let HEAD_TOKENS: Map<string, string[][]> | null = null;
function headTokens(topic: Topic) {
  HEAD_TOKENS ??= new Map(TOPICS.map((t) => [t.id, t.heads.map((h) => tokens(h).filter((x) => !STOPWORDS.has(x)))]));
  return HEAD_TOKENS.get(topic.id)!;
}

/** Best-matching topic for a keyword or domain; deterministic fallback by hash. */
export const topicFor = memo((text: string): Topic => {
  const base = tokens(text);
  const toks = new Set(base.length === 1 ? [...base, ...segmentLabel(base[0])] : base);
  let best: Topic | null = null;
  let bestScore = 0;
  for (const topic of TOPICS) {
    let score = 0;
    for (const s of topic.signals) if (toks.has(s)) score += 3;
    for (const t of toks) if (t.length > 2 && topic.signals.some((s) => s.length > 3 && t.includes(s))) score += 1;
    for (const ht of headTokens(topic)) {
      if (!ht.length) continue;
      const overlap = ht.filter((t) => toks.has(t) || toks.has(t.replace(/s$/, "")) || toks.has(`${t}s`)).length;
      if (overlap === ht.length) score += 4 + ht.length;
      else score += overlap * 1.5;
    }
    for (const leader of topic.leaders) if (toks.has(leader.split(".")[0])) score += 6;
    if (score > bestScore) {
      bestScore = score;
      best = topic;
    }
  }
  return best ?? TOPICS[hash(text) % TOPICS.length];
}, 20000, (t) => t);

/** Strength (0..1) of a category leader domain. Shared with domains.ts so both agree. */
export const leaderStrength = (domain: string) => round(0.72 + 0.26 * unit(`lead:${domain}`), 3);

/** Brand labels of well-known sites ("amazon", "nike") → keyword containing them is navigational. */
const KNOWN_BRANDS = new Map<string, number>();
for (const t of TOPICS) for (const l of t.leaders) KNOWN_BRANDS.set(l.split("@")[0].split(".")[0], leaderStrength(l.split("@")[0]));
for (const g of GIANTS) KNOWN_BRANDS.set(g.domain.split(".")[0], g.strength);

const STOPWORDS = new Set(["a", "an", "the", "to", "of", "in", "on", "for", "and", "or", "is", "are", "how", "what", "why", "when", "where", "which", "who", "do", "does", "can", "with", "at", "by", "vs", "best", "top", "near", "me"]);

const RE = {
  question: /^(what|how|why|when|where|which|who|is|are|can|does|do|should|will)\b/,
  transactional:
    /\b(buy|price|prices|pricing|cost|cheap|deal|deals|discount|coupon|code|order|for sale|sale|shop|near me|booking|book|rent|rental|hire|delivery|apply|download|subscribe|quote|quotes|fees|under \d+|emi|lease|trial|near by|open now|for rent)\b/,
  commercial:
    /\b(best|top|review|reviews|vs|versus|compare|comparison|alternative|alternatives|affordable|premium|luxury|brands|top rated|ranking|rankings|pros and cons|worth it)\b/,
  informational:
    /\b(how|what|why|guide|tips|ideas|meaning|definition|examples|symptoms|causes|benefits|types|history|facts|tutorial|recipe|recipes|statistics|trends|list|chart|syllabus|eligibility|requirements|process|questions|template|calculator)\b/,
  navigational: /\b(login|log in|sign in|website|official|portal|contact|customer care|customer service|number|address|app download|erp|near me\b.*\b(branch|store))\b/,
  local: /\b(near me|near by|in [a-z]+|open now)\b/,
  year: /\b20(2[4-9]|3\d)\b/,
};

const LOCAL_DB: [RegExp, string][] = [
  [/\b(india|bangalore|mumbai|delhi|goa|hindi|lakhs|gst|chennai|pune|hyderabad|kolkata|nirf|bhk|ifsc|rupees|rs)\b/, "IN"],
  [/\b(uk|london|manchester|nhs|pounds)\b/, "GB"],
  [/\b(usa|us|new york|california|texas|austin|chicago|florida)\b/, "US"],
  [/\b(dubai|abu dhabi|uae)\b/, "AE"],
  [/\b(australia|sydney|melbourne)\b/, "AU"],
  [/\b(canada|toronto|vancouver)\b/, "CA"],
];

/** Intent does not depend on the regional database, so it is memoized per keyword. */
export const keywordIntents = memo((keyword: string): Intent[] => intentsFor(keyword, topicFor(keyword)), 20000, (k) => k);

export function intentsFor(keyword: string, topic: Topic): Intent[] {
  const k = keyword.toLowerCase();
  const found: Intent[] = [];
  const toks = tokens(k);
  const hasBrand = toks.some((t) => KNOWN_BRANDS.has(t));
  if (RE.navigational.test(k) || (hasBrand && toks.length <= 3)) found.push("navigational");
  if (RE.question.test(k)) found.push("informational");
  if (RE.transactional.test(k)) found.push("transactional");
  if (RE.commercial.test(k)) found.push("commercial");
  if (RE.informational.test(k) && !found.includes("informational")) found.push("informational");
  if (!found.length) {
    const productTopic = ["fashion", "beauty", "home", "automotive", "pets", "software", "fitness"].includes(topic.id);
    const u = unit(`intent:${k}`);
    if (productTopic) found.push(u < 0.55 ? "commercial" : u < 0.8 ? "transactional" : "informational");
    else found.push(u < 0.7 ? "informational" : "commercial");
  }
  return [...new Set(found)].slice(0, 2);
}

function baseVolume(k: string, topic: Topic) {
  const words = k.split(" ").length;
  const r = rng(`vol:${k}`);
  const medians = [0, 33000, 4400, 720, 170, 70, 40, 30];
  let median = medians[Math.min(words, 7)];
  if (topic.heads.includes(k)) median *= 3.5;
  else if (topic.heads.some((h) => k.includes(h))) median *= 2.2;
  if (/near me/.test(k)) median *= 1.8;
  if (RE.question.test(k)) median *= 0.4;
  if (RE.year.test(k)) median *= 0.55;
  // Brand demand: only when the keyword starts with a well-known brand ("nike careers", not "sandals reddit").
  const first = tokens(k)[0];
  const strength = first ? KNOWN_BRANDS.get(first) : undefined;
  if (strength && !/\bvs\b/.test(k)) {
    const bare = 10 ** (5.18 + 7.3 * (strength - 0.72));
    median = words === 1 ? (k.includes(".") ? bare * 0.12 : bare) : bare * (words === 2 ? 0.006 : 0.0018);
  }
  median *= topic.popularity;
  return r.logNormal(median, 0.95);
}

function dbFactor(k: string, db: string, localDb: string | null) {
  const info = database(db);
  let f = info.share * (0.65 + 0.7 * unit(`db:${db}:${k}`));
  if (localDb) f = localDb === info.code ? Math.max(f, 0.5) * 1.6 : f * 0.08;
  return f;
}

function featuresFor(k: string, intents: Intent[], topic: Topic, competition: number, words: number): SerpFeature[] {
  const primary = intents[0];
  const p = (id: SerpFeature, prob: number) => (unit(`serp:${id}:${k}`) < prob ? [id] : []);
  const isQ = RE.question.test(k);
  const howTo = /\bhow to\b/.test(k);
  const shopTopic = ["fashion", "beauty", "home", "automotive", "pets", "fitness"].includes(topic.id);
  const I = primary === "informational",
    C = primary === "commercial",
    T = primary === "transactional",
    N = primary === "navigational";
  return [
    ...p("ai_overview", I ? (isQ ? 0.7 : 0.5) : C ? 0.35 : T ? 0.08 : 0.04),
    ...p("featured_snippet", isQ ? 0.55 : I ? 0.3 : C ? 0.12 : 0.03),
    ...p("people_also_ask", I ? 0.85 : C ? 0.75 : T ? 0.45 : 0.25),
    ...p("local_pack", RE.local.test(k) ? 0.9 : ["food", "health", "legal", "home", "real-estate"].includes(topic.id) && T ? 0.35 : 0.02),
    ...p("image_pack", shopTopic || topic.id === "food" ? 0.55 : 0.15),
    ...p("video", howTo ? 0.8 : I ? 0.3 : 0.1),
    ...p("top_stories", topic.id === "news" ? 0.85 : RE.year.test(k) ? 0.3 : 0.04),
    ...p("shopping", shopTopic && (T || C) ? 0.75 : T ? 0.25 : 0.03),
    ...p("reviews", C ? 0.5 : 0.08),
    ...p("sitelinks", N ? 0.9 : words === 1 ? 0.25 : 0.05),
    ...p("knowledge_panel", N ? 0.6 : words === 1 ? 0.45 : 0.05),
    ...p("ads_top", competition > 0.45 ? 0.85 : competition > 0.2 ? 0.4 : 0.05),
    ...p("discussions", C ? 0.45 : I ? 0.3 : 0.08),
    ...p("related_searches", 0.92),
  ];
}

/** 12 trailing months ending last month (oldest first) → Date of each month start. */
export function trailingMonths(count = 12, from = new Date()) {
  const out: Date[] = [];
  for (let i = count; i >= 1; i--) out.push(new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() - i, 1)));
  return out;
}
let monthCache: { key: string; months: Date[] } | null = null;
function lastTwelveMonths() {
  const now = new Date();
  const key = `${now.getUTCFullYear()}-${now.getUTCMonth()}`;
  if (monthCache?.key !== key) monthCache = { key, months: trailingMonths(12, now) };
  return monthCache.months;
}

function trendFor(k: string, volume: number, topic: Topic) {
  const r = rng(`trend:${k}`);
  const months = lastTwelveMonths();
  const slope = clamp(r.normal(0.05, 0.25), -0.5, 0.8);
  let season = topic.season;
  if (/christmas|gift|black friday/.test(k)) season = [0.4, 0.3, 0.3, 0.3, 0.3, 0.3, 0.35, 0.4, 0.5, 0.8, 2.6, 4.5];
  if (/summer|beach|swim/.test(k)) season = [0.5, 0.55, 0.75, 1, 1.4, 1.8, 1.9, 1.5, 0.9, 0.6, 0.5, 0.5];
  if (/admission|entrance|result/.test(k)) season = [0.8, 0.9, 1.1, 1.3, 1.6, 1.7, 1.4, 1.0, 0.7, 0.6, 0.5, 0.6];
  const raw = months.map((m, i) => season[m.getUTCMonth()] * (1 - slope / 2 + (slope * i) / 11) * (1 + r.normal(0, 0.08)));
  const mean = raw.reduce((s, v) => s + v, 0) / raw.length;
  return raw.map((v) => {
    const x = (v / mean) * volume;
    return x >= 100 ? Math.round(x / 10) * 10 : Math.max(0, Math.round(x));
  });
}

/** Deterministic keyword metrics for any keyword and regional database. */
export const keywordMetrics = memo(
  (keywordInput: string, dbInput: string = "US"): KeywordMetrics => {
    const k = keywordInput.toLowerCase().trim().replace(/\s+/g, " ");
    const db = database(dbInput).code;
    const topic = topicFor(k);
    const words = k.split(" ").length;
    const base = baseVolume(k, topic);
    const localDb = LOCAL_DB.find(([re]) => re.test(k))?.[1] ?? null;
    const volume = Math.max(k.length ? 10 : 0, bucketVolume(base * dbFactor(k, db, localDb)));
    const globalVolume = DATABASES.reduce((sum, d) => sum + bucketVolume(base * dbFactor(k, d.code, localDb)), 0);
    const intents = keywordIntents(k);
    const r = rng(`kw:${k}`);
    const lv = Math.log10(base + 1);
    const primary = intents[0];
    const kd = Math.round(
      clamp(
        6 + lv * 10.5 +
          (primary === "transactional" ? 6 : primary === "commercial" ? 9 : primary === "navigational" ? -14 : -2) +
          (words === 1 ? 12 : words >= 4 ? -9 : 0) +
          (topic.cpc > 6 ? 7 : 0) +
          r.normal(0, 8),
        0,
        100,
      ),
    );
    const intentCpc = primary === "transactional" ? 1.4 : primary === "commercial" ? 1.15 : primary === "navigational" ? 0.45 : 0.3;
    const cpcRaw = unit(`cpc0:${k}`) < (primary === "informational" ? 0.22 : 0.05) ? 0 : topic.cpc * intentCpc * r.logNormal(1, 0.55);
    const cpc = round(cpcRaw * (db === "IN" || db === "PH" ? 0.25 : db === "BR" || db === "MX" ? 0.4 : 1), 2);
    const competition = round(clamp(cpc / (topic.cpc * 2.2) + r.normal(0, 0.12), 0, 1), 2);
    return {
      keyword: k,
      db,
      volume,
      globalVolume: Math.max(volume, globalVolume),
      cpc,
      competition,
      kd,
      intents,
      serpFeatures: featuresFor(k, intents, topic, competition, words),
      trend: trendFor(k, volume, topic),
      results: Math.round(base * r.range(900, 9000) + r.range(1e5, 4e7)),
      words,
      topicId: topic.id,
    };
  },
  20000,
);

/** Keyword universe for a topic: head terms expanded with curated + generic modifiers. */
export const topicUniverse = memo((topicId: string): string[] => {
  const topic = topicById(topicId);
  const safeSuffix = ["near me", "online", "for beginners", "2026", "reviews", "price", "cost", "free", "ideas", "tips", "guide", "list", "types", "benefits", "vs", "alternatives", "examples", "comparison", "reddit", "in india", "uk", "deals", "checklist", "trends"];
  const out = new Set<string>();
  for (const head of topic.heads) {
    const r = rng(`uni:${topic.id}:${head}`);
    out.add(head);
    for (const m of r.sample(topic.modifiers, 13)) out.add(`${head} ${m}`);
    for (const m of r.sample(safeSuffix, 9)) out.add(`${head} ${m}`);
    for (const p of r.sample(PREFIX_MODIFIERS.slice(0, 14), 5)) out.add(`${p} ${head}`);
    for (const q of r.sample(QUESTION_TEMPLATES, 5)) out.add(q.replace("{k}", head));
    for (const m of r.sample(topic.modifiers, 3)) out.add(`best ${head} ${m}`);
  }
  return [...new Set([...out].map(cleanCandidate).filter((k): k is string => !!k))];
}, 40);

/** The head term a keyword belongs to (for URL grouping and SERP affinity). */
export function headOf(keyword: string, topic: Topic) {
  let best = "";
  for (const h of topic.heads) if (keyword.includes(h) && h.length > best.length) best = h;
  if (best) return best;
  const t = tokens(keyword).filter((x) => !["best", "top", "how", "what", "is", "the", "to", "for", "of", "a", "in"].includes(x));
  return t.slice(0, 2).join(" ") || keyword;
}

/** Collapse doubled words ("best best x") and reject dangling connectors ("x and"). */
export function cleanCandidate(k: string): string | null {
  const words = k.split(" ").filter((w, i, a) => w && w !== a[i - 1]);
  if (!words.length || ["and", "or", "with", "without", "for", "of", "the", "to", "in", "vs"].includes(words[words.length - 1])) return null;
  return words.join(" ");
}

/** Keyword Magic Tool candidates for an arbitrary seed (before metrics). */
export function expandSeed(seedInput: string) {
  const seed = seedInput.toLowerCase().trim().replace(/\s+/g, " ");
  const topic = topicFor(seed);
  const out = new Map<string, "seed" | "modifier" | "question" | "related">();
  out.set(seed, "seed");
  for (const m of [...SUFFIX_MODIFIERS, ...topic.modifiers]) out.set(`${seed} ${m}`, "modifier");
  for (const p of PREFIX_MODIFIERS) out.set(`${p} ${seed}`, "modifier");
  const r = rng(`expand:${seed}`);
  for (const a of r.sample(PREFIX_MODIFIERS, 8)) for (const b of r.sample([...SUFFIX_MODIFIERS, ...topic.modifiers], 4)) out.set(`${a} ${seed} ${b}`, "modifier");
  for (const q of QUESTION_TEMPLATES) out.set(q.replace("{k}", seed), "question");
  const seedTokens = new Set(tokens(seed));
  for (const k of topicUniverse(topic.id)) {
    if (out.has(k)) continue;
    const overlap = tokens(k).filter((t) => seedTokens.has(t)).length;
    if (overlap > 0) out.set(k, "modifier");
    else if (unit(`rel:${seed}:${k}`) < 0.08) out.set(k, "related");
  }
  const candidates = new Map<string, "seed" | "modifier" | "question" | "related">();
  for (const [keyword, kind] of out) {
    const clean = cleanCandidate(keyword);
    if (clean && !candidates.has(clean)) candidates.set(clean, kind);
  }
  return { topic, candidates: [...candidates.entries()].map(([keyword, kind]) => ({ keyword, kind })) };
}

/** Organic click-through rate by position; AI Overviews and ads reduce organic CTR. */
export function ctrFor(position: number, features: SerpFeature[] = []) {
  const curve = [0.28, 0.155, 0.11, 0.08, 0.065, 0.05, 0.04, 0.032, 0.027, 0.023];
  let ctr = position <= 10 ? curve[position - 1] : position <= 20 ? 0.012 - (position - 11) * 0.0008 : Math.max(0.0002, 0.003 - (position - 21) * 0.00004);
  if (features.includes("ai_overview")) ctr *= 0.72;
  if (features.includes("ads_top")) ctr *= 0.88;
  if (features.includes("featured_snippet") && position > 1) ctr *= 0.85;
  return ctr;
}

/** Keyword difficulty label (Semrush-style bands). */
export function kdLabel(kd: number) {
  if (kd < 15) return "Very easy";
  if (kd < 30) return "Easy";
  if (kd < 50) return "Possible";
  if (kd < 70) return "Difficult";
  if (kd < 85) return "Hard";
  return "Very hard";
}
