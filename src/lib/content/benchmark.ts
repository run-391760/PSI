/**
 * Top-10 rival benchmarks for a keyword (On Page SEO Checker, SEO Content Template, Writing Assistant
 * targets). Rivals come from the demo SERP; their content statistics are generated deterministically
 * with rng() so reloads agree, and everything here is labelled "Demo data" in the UI.
 */
import { brandPhrase, clamp, domainEntity, domainFacts, domainKeywords, expandSeed, keywordMetrics, referringDomains, rng, serp, topicFor, unit } from "@/lib/seo/engine";
import type { Intent, KeywordMetrics, SerpFeature } from "@/lib/seo/types";
import { STOPWORDS, hasKeyword, normalizeText, wordList } from "./text";

export type Rival = {
  position: number;
  domain: string;
  url: string;
  title: string;
  description: string;
  words: number;
  mentions: number;
  readability: number;
  refDomains: number;
  images: number;
  h2: number;
  hasVideo: boolean;
  schema: string[];
  titleHasKw: boolean;
  h1HasKw: boolean;
  metaHasKw: boolean;
};
export type SemanticTerm = { term: string; rivals: number };
export type BacklinkSource = { domain: string; rivals: number; authorityScore: number; category: string };
export type RelatedKeyword = { keyword: string; volume: number; kd: number; intents: Intent[] };
export type Benchmark = {
  keyword: string;
  db: string;
  metrics: Pick<KeywordMetrics, "volume" | "kd" | "cpc" | "intents" | "serpFeatures">;
  rivals: Rival[];
  avg: {
    words: number;
    wordsRange: [number, number];
    mentions: number;
    readability: number;
    refDomains: number;
    images: number;
    h2: number;
    titleKw: number;
    h1Kw: number;
    metaKw: number;
    video: number;
  };
  semantic: SemanticTerm[];
  related: RelatedKeyword[];
  questions: RelatedKeyword[];
  backlinkSources: BacklinkSource[];
};

const GENERIC = new Set(["best", "top", "near", "me", "vs", "2024", "2025", "2026", "reddit", "youtube", "cheap", "free", "buy", "new", "used", "set", "and", "with", "without", "list", "ideas", "uk", "usa", "india", "online", "near by", "open", "now", "under", "50", "100", "australia", "canada", "dubai", "london", "bangalore", "mumbai", "york", "pdf", "images", "logo", "meaning", "definition", "quotes", "book", "kit", "diy",
  "calculator", "rental", "company", "small", "organic", "natural", "local", "wholesale", "subscription", "custom", "portable", "simple", "easy",
  "statistics", "trends", "chart", "facts", "history", "seniors", "students", "home", "jobs", "salary", "app", "services", "template", "checklist",
  "work", "start", "find", "choose", "worth", "look", "safe", "long", "take", "much", "good", "important", "offers", "get", "use", "used", "does",
  "delivery", "tutorial", "course", "software", "types", "examples", "alternatives", "login", "hire", "near", "requirements", "affordable", "premium", "luxury", "professional", "deals", "coupon", "women", "men", "kids",
  "complete", "explained", "know", "need", "compare", "prices", "everything", "updated", "options", "picks", "choices", "faqs", "pros", "cons", "step", "expert", "near me", "under 50", "discount code", "last date", "application form"]);
const INTENT_WORDS: Record<Intent, number> = { informational: 1700, commercial: 1450, transactional: 780, navigational: 620 };
const SCHEMA_BY_INTENT: Record<Intent, string[]> = {
  informational: ["Article", "BreadcrumbList", "FAQPage", "HowTo", "Organization"],
  commercial: ["Article", "Review", "ItemList", "FAQPage", "BreadcrumbList"],
  transactional: ["Product", "Offer", "AggregateRating", "BreadcrumbList", "Organization"],
  navigational: ["Organization", "WebSite", "BreadcrumbList", "LocalBusiness"],
};
const HARD_TOPICS = new Set(["finance", "legal", "health", "software"]);

function rivalStats(r: { position: number; domain: string; url: string; title: string; description: string }, keyword: string, db: string, m: KeywordMetrics): Rival {
  const g = rng(`content:rival:${db}:${keyword}:${r.url}`);
  const intent = m.intents[0] ?? "informational";
  let median = INTENT_WORDS[intent];
  if (r.domain === "wikipedia.org") median *= 2.4;
  else if (r.domain === "youtube.com") median = 220;
  else if (r.domain === "reddit.com") median *= 0.8;
  else if (r.domain === "amazon.com") median = 520;
  else if (r.domain === "quora.com") median = 760;
  const words = Math.round(clamp(g.logNormal(median, 0.33), 140, 7000) / 10) * 10;
  const baseRead = HARD_TOPICS.has(m.topicId) ? 47 : m.topicId === "education" ? 52 : 60;
  const readability = Math.round(clamp(g.normal(baseRead + (r.domain === "reddit.com" ? 10 : 0), 7), 22, 82));
  const density = clamp(g.logNormal(0.72, 0.35), 0.25, 2.4);
  const mentions = Math.max(1, Math.round((words * density) / 100));
  const facts = domainFacts(r.domain, db);
  const refDomains = Math.round(clamp(facts.referringDomains * g.logNormal(0.0035, 0.9) * (r.position <= 3 ? 1.6 : 1), 0, facts.referringDomains * 0.25));
  const images = r.domain === "youtube.com" ? 0 : Math.round(clamp(g.logNormal(intent === "transactional" ? 14 : intent === "commercial" ? 9 : 6, 0.5), 0, 60));
  const hasVideo = r.domain === "youtube.com" || g.chance(m.serpFeatures.includes("video") ? 0.5 : 0.16);
  const schema = g.sample(SCHEMA_BY_INTENT[intent], g.int(1, 3));
  return {
    ...r,
    words,
    mentions,
    readability,
    refDomains,
    images,
    h2: Math.max(0, Math.round(words / g.range(180, 320))),
    hasVideo,
    schema,
    titleHasKw: hasKeyword(r.title, keyword),
    h1HasKw: g.chance(0.78),
    metaHasKw: hasKeyword(r.description, keyword),
  };
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const share = (xs: boolean[]) => (xs.length ? Math.round((xs.filter(Boolean).length / xs.length) * 100) : 0);

/** Related keywords that share tokens with the seed (by volume). */
export function relatedKeywords(keyword: string, db: string, limit = 20): { related: RelatedKeyword[]; questions: RelatedKeyword[] } {
  const k = normalizeText(keyword);
  const { candidates } = expandSeed(k);
  const rows = candidates
    .filter((c) => c.keyword !== k && c.kind !== "related" && !/\b(reddit|youtube|pdf|logo|images)\b/.test(c.keyword))
    .map((c) => {
      const m = keywordMetrics(c.keyword, db);
      return { keyword: c.keyword, volume: m.volume, kd: m.kd, intents: m.intents, question: c.kind === "question" };
    })
    .filter((r) => r.volume > 0)
    .sort((a, b) => b.volume - a.volume);
  return {
    related: rows.filter((r) => !r.question).slice(0, limit).map(({ question: _q, ...r }) => r),
    questions: rows.filter((r) => r.question).slice(0, 10).map(({ question: _q, ...r }) => r),
  };
}

/** Semantically related words/phrases for one or more keywords, with how many of the top 10 use them. */
export function semanticTerms(keywords: string[], db: string, rivals: Rival[] = [], limit = 24): SemanticTerm[] {
  const seedTokens = new Set(keywords.flatMap((k) => wordList(normalizeText(k))));
  const weights = new Map<string, number>();
  const bump = (term: string, w: number) => {
    const t = term.trim();
    if (!t || t.length < 3 || GENERIC.has(t) || STOPWORDS.has(t) || /^\d+$/.test(t)) return;
    weights.set(t, (weights.get(t) ?? 0) + w);
  };
  for (const kw of keywords) {
    const topic = topicFor(kw);
    const topicPhrases = new Set(topic.modifiers.map((m) => normalizeText(m)));
    const topicTokens = new Set(topic.modifiers.flatMap((m) => wordList(normalizeText(m))));
    const { related, questions } = relatedKeywords(kw, db, 60);
    for (const r of [...related, ...questions]) {
      const rest = wordList(r.keyword).filter((t) => !seedTokens.has(t) && !STOPWORDS.has(t) && !GENERIC.has(t));
      const w = Math.log10(r.volume + 10);
      const phrase = rest.join(" ");
      const mod = [...topicPhrases].find((m) => m.includes(" ") && r.keyword.endsWith(` ${m}`));
      if (mod) {
        // Multi-word topic modifier ("cut off", "size chart"): keep it whole, minus leading stopwords.
        const clean = wordList(mod).filter((t, i, a) => !(STOPWORDS.has(t) && a.slice(0, i + 1).every((x) => STOPWORDS.has(x)))).join(" ");
        if (clean && !GENERIC.has(clean)) bump(clean, w * 2);
        continue;
      }
      if (rest.length >= 2 && topicPhrases.has(phrase)) bump(phrase, w * 2);
      for (const t of rest) bump(t, topicTokens.has(t) ? w * 1.6 : w * 0.45);
    }
    topic.heads.forEach((head, i) => {
      const ht = wordList(head);
      if (head === kw || ht.every((t) => seedTokens.has(t) || seedTokens.has(`${t}s`) || seedTokens.has(t.replace(/s$/, "")))) return;
      if (ht.some((t) => seedTokens.has(t))) bump(head, 5);
      else if (i < 6) bump(head, 1.4);
    });
  }
  // Rival titles add a little signal, minus the rivals' own brand names.
  const brands = new Set(rivals.flatMap((r) => [...wordList(brandPhrase(r.domain)), r.domain.split(".")[0]]));
  for (const r of rivals) {
    for (const t of wordList(normalizeText(r.title))) if (!seedTokens.has(t) && t.length > 3 && !brands.has(t) && ![...brands].some((b) => b.length > 4 && (b.includes(t) || t.includes(b)))) bump(t, 0.8);
  }
  const ranked = [...weights.entries()].sort((a, b) => b[1] - a[1]);
  const out: SemanticTerm[] = [];
  const max = ranked[0]?.[1] ?? 1;
  for (const [term, w] of ranked) {
    if (out.some((o) => o.term.includes(term) || term.includes(o.term))) continue;
    const noise = unit(`content:sem:${db}:${keywords.join("|")}:${term}`);
    out.push({ term, rivals: Math.round(clamp(2 + 8 * (w / max) ** 0.6 + (noise - 0.5) * 2.5, 2, 10)) });
    if (out.length >= limit) break;
  }
  return out.sort((a, b) => b.rivals - a.rivals || a.term.localeCompare(b.term));
}

/** Domains that link to several rivals but not to the target domain (link-gap prospects). */
export function backlinkSources(rivalDomains: string[], ownDomain: string | null, limit = 20): BacklinkSource[] {
  const own = new Set(ownDomain ? referringDomains(ownDomain).map((r) => r.domain) : []);
  const counts = new Map<string, BacklinkSource>();
  for (const d of [...new Set(rivalDomains)]) {
    for (const rd of referringDomains(d)) {
      if (rd.kind === "spam" || own.has(rd.domain) || rivalDomains.includes(rd.domain) || rd.domain === ownDomain) continue;
      const cur = counts.get(rd.domain) ?? { domain: rd.domain, rivals: 0, authorityScore: rd.authorityScore, category: rd.category };
      cur.rivals++;
      counts.set(rd.domain, cur);
    }
  }
  return [...counts.values()]
    .filter((c) => c.rivals >= 2)
    .sort((a, b) => b.rivals - a.rivals || b.authorityScore - a.authorityScore)
    .slice(0, limit);
}

/** Full top-10 benchmark for a keyword. `ownDomain` is excluded from the rivals. */
export function benchmark(keywordInput: string, db: string, ownDomain: string | null = null): Benchmark {
  const keyword = normalizeText(keywordInput);
  const m = keywordMetrics(keyword, db);
  const rivals = serp(keyword, db, { depth: 14 })
    .filter((r) => r.domain !== ownDomain)
    .slice(0, 10)
    .map((r, i) => rivalStats({ ...r, position: r.position ?? i + 1 }, keyword, db, m));
  const words = rivals.map((r) => r.words).sort((a, b) => a - b);
  const { related, questions } = relatedKeywords(keyword, db, 15);
  return {
    keyword,
    db,
    metrics: { volume: m.volume, kd: m.kd, cpc: m.cpc, intents: m.intents, serpFeatures: m.serpFeatures },
    rivals,
    avg: {
      words: Math.round(avg(words) / 10) * 10,
      wordsRange: [words[Math.floor(words.length * 0.2)] ?? 0, words[Math.min(words.length - 1, Math.floor(words.length * 0.8))] ?? 0],
      mentions: Math.round(avg(rivals.map((r) => r.mentions))),
      readability: Math.round(avg(rivals.map((r) => r.readability))),
      refDomains: Math.round(avg(rivals.map((r) => r.refDomains))),
      images: Math.round(avg(rivals.map((r) => r.images))),
      h2: Math.round(avg(rivals.map((r) => r.h2))),
      titleKw: share(rivals.map((r) => r.titleHasKw)),
      h1Kw: share(rivals.map((r) => r.h1HasKw)),
      metaKw: share(rivals.map((r) => r.metaHasKw)),
      video: share(rivals.map((r) => r.hasVideo)),
    },
    semantic: semanticTerms([keyword], db, rivals, 20),
    related,
    questions,
    backlinkSources: backlinkSources(rivals.map((r) => r.domain), ownDomain, 15),
  };
}

/** Estimated referring domains of one of the project's pages (demo; used for the page-vs-rivals comparison). */
export function ownPageRefDomains(url: string, domain: string, db: string) {
  const f = domainFacts(domain, db);
  const g = rng(`content:ownrd:${url}`);
  const home = /^https?:\/\/(www\.)?[^/]+\/?$/.test(url);
  return Math.round(clamp(f.referringDomains * (home ? 0.35 : g.logNormal(0.002, 0.9)), 0, f.referringDomains));
}

/** Demo position of the project's domain for a keyword (null = not in top 100). */
export function ownPosition(keyword: string, db: string, domain: string) {
  domainEntity(domain);
  // Prefer the organic-research sample so this agrees with Organic Research / Domain Overview.
  const ranked = domainKeywords(domain, db).find((k) => k.keyword === keyword);
  if (ranked) return { position: ranked.position, url: ranked.url };
  const res = serp(keyword, db, { extraDomains: [domain], depth: 100 }).find((r) => r.domain === domain);
  return res ? { position: res.position, url: res.url } : null;
}

export type { SerpFeature };
