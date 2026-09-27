import { database, domainLabel } from "@/lib/domain";
import type { Project } from "@/lib/projects";
import { brandPhrase, clamp, domainEntity, domainPages, hash, rng, round, topicById, topicFor, unit } from "@/lib/seo/engine";
import type { Topic } from "@/lib/seo/engine/vocab";
import type { Sentiment } from "@/lib/monitoring/sentiment";
import { brandName } from "@/lib/monitoring/names";
import { ENGINES, type AnswerResult, type EngineId } from "./meta";

/**
 * AI Visibility demo engine: deterministic answers per prompt × engine × day (no AI engine APIs are
 * connected for ChatGPT, Gemini, Perplexity or AI Overviews). Answers change in 3-day windows with a
 * slow per-engine drift so trends look like real tracking. Always labelled "Demo data".
 */

const DAY = 86400000;

export type Competitor = { name: string; domain: string | null; strength: number };
export type AiContext = { domain: string; db: string; brand: string; brandTerms: string[]; strength: number; competitors: Competitor[]; topic: Topic; pages: string[]; category: string; place: string };

const CATEGORY_WORDS: Record<string, string> = {
  university: "university",
  college: "college",
  school: "school",
  academy: "academy",
  institute: "institute",
  clinic: "clinic",
  hospital: "hospital",
  dental: "dentist",
  hotel: "hotel",
  restaurant: "restaurant",
  cafe: "cafe",
  bakery: "bakery",
  salon: "salon",
  spa: "spa",
  gym: "gym",
  fitness: "gym",
  realty: "real estate agency",
  estate: "real estate agency",
  motors: "car dealer",
  pharmacy: "pharmacy",
  law: "law firm",
  legal: "law firm",
  travel: "travel agency",
  tours: "tour operator",
  agency: "agency",
  studio: "studio",
  bank: "bank",
  insurance: "insurance company",
};

export type AiContextOptions = {
  /** Competitor brand names, aligned with project.competitors (extra names have no domain). */
  competitorNames?: string[];
  /** Business category, e.g. the local profile's primary category. */
  category?: string | null;
  /** Nearby businesses (local profile) used when the project tracks few competitors. */
  localRivals?: { name: string; strength: number }[];
  /** Real mode (DEMO_DATA unset): no competitor fill or pages from the demo engine. */
  realOnly?: boolean;
};

export function aiContext(project: Pick<Project, "domain" | "country" | "brand_terms" | "competitors" | "location">, opts: AiContextOptions = {}): AiContext {
  const e = domainEntity(project.domain);
  const topic = e.topicId === "*" ? topicFor(project.domain) : topicById(e.topicId);
  const phrase = brandPhrase(project.domain);
  const brand = project.brand_terms[0]?.trim() || brandName(project.domain);
  const names = opts.competitorNames ?? [];
  const competitors: Competitor[] = project.competitors.slice(0, 5).map((d, i) => ({ name: names[i]?.trim() || brandName(d), domain: d, strength: domainEntity(d).strength }));
  for (const name of names.slice(project.competitors.length, 5)) if (name.trim()) competitors.push({ name: name.trim(), domain: null, strength: 0.4 });
  // Too few rivals: fill with nearby businesses (local profile) or the category's leading sites.
  for (const r of opts.localRivals ?? []) {
    if (competitors.length >= 4) break;
    if (!competitors.some((c) => c.name === r.name)) competitors.push({ name: r.name, domain: null, strength: r.strength });
  }
  for (const l of opts.realOnly ? [] : topic.leaders) {
    if (competitors.length >= 4) break;
    const d = l.split("@")[0];
    if (d === project.domain || competitors.some((c) => c.domain === d)) continue;
    competitors.push({ name: brandName(d), domain: d, strength: domainEntity(d).strength });
  }
  const words = phrase.split(" ");
  const category = (opts.category?.trim() || CATEGORY_WORDS[words[words.length - 1]] || words.map((w) => CATEGORY_WORDS[w]).find(Boolean) || (opts.realOnly ? "business" : topic.heads[0])).toLowerCase();
  const label = domainLabel(project.domain);
  let pages: string[] = [];
  if (!opts.realOnly) try {
    pages = domainPages(project.domain, project.country)
      .map((p) => p.url)
      .filter((u) => !new URL(u).pathname.includes(label))
      .slice(0, 5);
  } catch {
    /* engine data unavailable */
  }
  pages = [...new Set([`https://www.${project.domain}/`, ...pages])];
  const brandTerms = [...new Set([brand, ...project.brand_terms, phrase, label, project.domain].map((t) => t.toLowerCase()).filter((t) => t.length >= 4))];
  const place = project.location.split(",")[0].trim() || database(project.country).name;
  return { domain: project.domain, db: project.country, brand, brandTerms, strength: e.strength, competitors, topic, pages, category, place };
}

export const isBranded = (ctx: AiContext, prompt: string) => ctx.brandTerms.some((t) => prompt.toLowerCase().includes(t));

export function dayList(n = 30, now = Date.now()) {
  const today = Math.floor(now / DAY) * DAY;
  return Array.from({ length: n }, (_, i) => new Date(today - (n - 1 - i) * DAY).toISOString().slice(0, 10));
}

const SOURCE_POOL = ["wikipedia.org", "reddit.com", "youtube.com", "forbes.com", "quora.com", "linkedin.com", "medium.com"];

export function demoAnswer(ctx: AiContext, prompt: string, engineId: EngineId, day: string, dayIndex: number): AnswerResult {
  const e = ENGINES.find((x) => x.id === engineId)!;
  const dn = Math.floor(Date.parse(`${day}T00:00:00Z`) / DAY);
  const w3 = Math.floor(dn / 3);
  const wk = Math.floor(dn / 7);
  const key = `${ctx.domain}|${prompt}|${engineId}`;
  const present = e.presence >= 1 || unit(`aiv:present:${prompt}:${ctx.db}:${wk}`) < e.presence;
  if (!present) return { engine: engineId, day, present: false, mentioned: false, position: null, cited: false, citedUrl: null, competitors: [], brands: [], sentiment: null, sources: [] };
  const branded = isBranded(ctx, prompt);
  const affinity = 0.55 + 0.9 * unit(`aiv:aff:${key}`);
  const slope = (unit(`aiv:slope:${ctx.domain}:${engineId}`) - 0.4) * 0.003;
  const pOwn = branded ? 0.9 : clamp(0.06 + 0.72 * ctx.strength ** 1.3 * e.mention * affinity + slope * (dayIndex - 15), 0.02, 0.93);
  const mentioned = unit(`aiv:m:${key}:${w3}`) < pOwn;
  const comps = ctx.competitors.filter((c) => {
    const aff = 0.55 + 0.9 * unit(`aiv:caff:${c.name}|${prompt}|${engineId}`);
    return unit(`aiv:c:${key}:${c.name}:${w3}`) < clamp((0.08 + 0.7 * c.strength ** 1.2 * e.mention * aff) * (branded ? 0.45 : 1), 0.02, 0.9);
  });
  const r = rng(`aiv:order:${key}:${w3}`);
  const listed = [...(mentioned ? [{ name: ctx.brand, s: ctx.strength + (branded ? 1 : 0) }] : []), ...comps.map((c) => ({ name: c.name, s: c.strength }))]
    .map((x) => ({ ...x, s: x.s + r.range(-0.25, 0.25) }))
    .sort((a, b) => b.s - a.s);
  const brands = listed.map((x) => x.name);
  const position = mentioned ? brands.indexOf(ctx.brand) + 1 : null;
  const pCite = mentioned ? clamp((0.22 + 0.5 * ctx.strength) * e.cite, 0.02, 0.95) : 0.04 * e.cite;
  const cited = unit(`aiv:cite:${key}:${w3}`) < pCite;
  const citedUrl = cited ? ctx.pages[hash(`${prompt}:${engineId}`) % ctx.pages.length] : null;
  const sentiment: Sentiment | null = mentioned ? r.weighted(["positive", "neutral", "negative"] as const, [0.45 + 0.25 * ctx.strength, 0.42, Math.max(0.03, 0.13 - 0.08 * ctx.strength)]) : null;
  const rs = rng(`aiv:src:${key}:${wk}`);
  const n = engineId === "perplexity" ? rs.int(4, 7) : engineId === "google-aio" ? rs.int(3, 6) : rs.int(2, 5);
  const sources = new Set<string>();
  if (cited) sources.add(ctx.domain);
  for (const c of comps) if (c.domain && rs.chance(0.45 * e.cite + 0.1)) sources.add(c.domain);
  const pool = [...ctx.topic.leaders.map((l) => l.split("@")[0]).filter((d) => d !== ctx.domain), ...SOURCE_POOL];
  for (const d of rs.sample(pool, n + 2)) if (sources.size < n + (cited ? 1 : 0)) sources.add(d);
  return { engine: engineId, day, present: true, mentioned, position, cited, citedUrl, competitors: comps.map((c) => c.name), brands, sentiment, sources: [...sources] };
}

export type PromptResult = AnswerResult & { prompt: string };

/** All demo answers for the given prompts over the last `days` days (oldest first). */
export function demoResults(ctx: AiContext, prompts: string[], days = 30, now = Date.now()): PromptResult[] {
  const list = dayList(days, now);
  const out: PromptResult[] = [];
  list.forEach((day, i) => {
    for (const p of prompts) for (const e of ENGINES) out.push({ ...demoAnswer(ctx, p, e.id, day, i), prompt: p });
  });
  return out;
}

export type Agg = {
  answers: number;
  mentioned: number;
  cited: number;
  positionSum: number;
  positionN: number;
  invPosition: number;
  sentiment: Record<Sentiment, number>;
  brandMentions: Record<string, number>;
};

export function aggregate(results: AnswerResult[], ctx: AiContext): Agg {
  const a: Agg = { answers: 0, mentioned: 0, cited: 0, positionSum: 0, positionN: 0, invPosition: 0, sentiment: { positive: 0, neutral: 0, negative: 0 }, brandMentions: Object.fromEntries([ctx.brand, ...ctx.competitors.map((c) => c.name)].map((n) => [n, 0])) };
  for (const r of results) {
    if (!r.present) continue;
    a.answers++;
    if (r.mentioned) {
      a.mentioned++;
      if (r.position) {
        a.positionSum += r.position;
        a.positionN++;
        a.invPosition += 1 / r.position;
      }
      if (r.sentiment) a.sentiment[r.sentiment]++;
      a.brandMentions[ctx.brand]++;
    }
    if (r.cited) a.cited++;
    for (const c of r.competitors) a.brandMentions[c] = (a.brandMentions[c] ?? 0) + 1;
  }
  return a;
}

export const rate = (n: number, d: number) => (d ? round((n / d) * 100, 1) : 0);
/** 0–100: 50% mention rate, 30% citation rate, 20% prominence (1/position) across answers. */
export const visibilityScore = (a: Agg) => (a.answers ? Math.round(100 * (0.5 * (a.mentioned / a.answers) + 0.3 * (a.cited / a.answers) + 0.2 * (a.invPosition / a.answers))) : 0);
export const shareOfVoice = (a: Agg, brand: string) => {
  const total = Object.values(a.brandMentions).reduce((s, v) => s + v, 0);
  return total ? round((a.brandMentions[brand] / total) * 100, 1) : 0;
};

// ---------------------------------------------------------------------------------------------- prompts

export function suggestPrompts(ctx: AiContext, project: Pick<Project, "country">) {
  const country = database(project.country).name;
  const cat = ctx.category;
  const rival = ctx.competitors[0]?.name;
  const brand = ctx.brand;
  const list = [
    `best ${cat} in ${ctx.place}`,
    `top rated ${cat} in ${country}`,
    `${brand} reviews`,
    `is ${brand} a good ${cat}`,
    rival ? `${brand} vs ${rival}` : `${brand} alternatives`,
    rival ? `alternatives to ${rival}` : `top ${cat} brands`,
    `how to choose a ${cat}`,
    `what should I look for in a ${cat}`,
    `most trusted ${cat} near ${ctx.place}`,
    `how much does ${brand} cost`,
    ...(ctx.category !== "business" ? [`${ctx.category} recommendations`] : []),
  ];
  return [...new Set(list.map((p) => p.replace(/\s+/g, " ").trim().toLowerCase()))].slice(0, 10);
}

// ---------------------------------------------------------------------------------------------- sample answer

const STRENGTHS = ["a strong reputation", "good value for money", "consistently positive reviews", "a wide range of options", "responsive support", "industry recognition", "ease of getting started", "quality and reliability"];
const CRITERIA = ["price", "recent reviews", "location", "features", "support", "reputation", "track record"];
const WEAK = ["pricing transparency", "response times", "consistency", "customer support"];

/** Illustrative answer text for a demo result (not a real engine response). */
export function sampleAnswer(ctx: AiContext, prompt: string, r: AnswerResult) {
  if (!r.present) return "No AI answer was shown for this query on this day.";
  const g = rng(`aiv:answer:${ctx.domain}|${prompt}|${r.engine}|${r.day}`);
  const cite = (i: number) => (r.sources.length ? ` [${(i % r.sources.length) + 1}]` : "");
  if (!r.brands.length)
    return `There isn't a single standout answer for “${prompt}”. Most sources suggest comparing options on ${g.sample(CRITERIA.filter((c) => c !== "recent reviews"), 3).join(", ")}, and reading recent reviews before deciding${cite(0)}.`;
  const list = r.brands.length === 1 ? r.brands[0] : `${r.brands.slice(0, -1).join(", ")} and ${r.brands[r.brands.length - 1]}`;
  const parts = [`For “${prompt}”, frequently recommended options include ${list}.`];
  r.brands.slice(0, 3).forEach((b, i) => {
    if (b === ctx.brand) {
      if (r.sentiment === "negative") parts.push(`${b} is an option, though some reviewers mention concerns about ${g.pick(WEAK)}${cite(i)}.`);
      else if (r.sentiment === "positive") parts.push(`${b} is often praised for ${g.pick(STRENGTHS)}${cite(i)}.`);
      else parts.push(`${b} is also worth considering${cite(i)}.`);
    } else parts.push(`${b} stands out for ${g.pick(STRENGTHS)}${cite(i)}.`);
  });
  parts.push(`The best choice depends on your priorities, such as ${g.sample(CRITERIA, 2).join(" and ")}.`);
  return parts.join(" ");
}
