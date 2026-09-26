import { DATABASES, database, domainLabel } from "@/lib/domain";
import type { CountryShare, DomainFacts, Intent, MonthlyPoint, RankedKeyword, SerpFeature, SerpResult } from "../types";
import { bucketVolume, ctrFor, headOf, keywordIntents, keywordMetrics, leaderStrength, segmentLabel, topicById, topicFor, topicUniverse } from "./keywords";
import { clamp, hash, memo, rng, round, unit } from "./random";
import { BRAND_MODIFIERS, GIANTS, NICHE_PREFIXES, NICHE_SUFFIXES, NICHE_TLDS, TOPIC_BRAND_MODIFIERS, TOPICS, type Topic } from "./vocab";

export type DomainEntity = {
  domain: string;
  strength: number;
  homeDb: string;
  topicId: string;
  kind: "giant" | "leader" | "niche" | "external";
  intents?: string[];
};

function homeFromTld(domain: string) {
  if (/\.(in|co\.in|ac\.in|org\.in)$/.test(domain)) return "IN";
  if (/\.(uk|co\.uk|ac\.uk|org\.uk)$/.test(domain)) return "GB";
  if (/\.(com\.au|au)$/.test(domain)) return "AU";
  if (/\.ca$/.test(domain)) return "CA";
  if (/\.de$/.test(domain)) return "DE";
  if (/\.fr$/.test(domain)) return "FR";
  if (/\.es$/.test(domain)) return "ES";
  if (/\.it$/.test(domain)) return "IT";
  if (/\.(com\.br|br)$/.test(domain)) return "BR";
  if (/\.(jp|co\.jp)$/.test(domain)) return "JP";
  if (/\.nl$/.test(domain)) return "NL";
  if (/\.ae$/.test(domain)) return "AE";
  if (/\.sg$/.test(domain)) return "SG";
  if (/\.(co\.za|za)$/.test(domain)) return "ZA";
  if (/\.ie$/.test(domain)) return "IE";
  if (/\.(co\.nz|nz)$/.test(domain)) return "NZ";
  if (/\.mx$/.test(domain)) return "MX";
  if (/\.ph$/.test(domain)) return "PH";
  if (/\.se$/.test(domain)) return "SE";
  return "US";
}

const nicheDomains = memo((topicId: string): DomainEntity[] => {
  const topic = topicById(topicId);
  const r = rng(`niche:${topicId}`);
  const seen = new Set<string>();
  const out: DomainEntity[] = [];
  while (out.length < 34) {
    const stem = r.pick(topic.stems);
    const name = r.chance(0.3) ? `${r.pick(NICHE_PREFIXES)}${stem}${r.chance(0.5) ? r.pick(NICHE_SUFFIXES) : ""}` : `${stem}${r.pick(NICHE_SUFFIXES)}`;
    const domain = `${name}${r.pick(NICHE_TLDS)}`;
    if (seen.has(domain)) continue;
    seen.add(domain);
    out.push({ domain, strength: round(clamp(r.logNormal(0.36, 0.35), 0.12, 0.72), 3), homeDb: homeFromTld(domain), topicId, kind: "niche" });
  }
  return out;
}, 40);

const REGISTRY = (() => {
  const map = new Map<string, DomainEntity>();
  for (const g of GIANTS) map.set(g.domain, { domain: g.domain, strength: g.strength, homeDb: "US", topicId: "*", kind: "giant", intents: g.intents });
  for (const t of TOPICS)
    for (const l of t.leaders) {
      const [domain, home] = l.split("@");
      if (map.has(domain)) continue;
      map.set(domain, { domain, strength: leaderStrength(domain), homeDb: home || homeFromTld(domain), topicId: t.id, kind: "leader" });
    }
  return map;
})();

/** Resolve any domain to its engine entity (topic, strength, home market). */
export const domainEntity = memo((domain: string): DomainEntity => {
  const known = REGISTRY.get(domain);
  if (known) return known;
  for (const t of TOPICS) {
    const niche = nicheDomains(t.id).find((n) => n.domain === domain);
    if (niche) return niche;
  }
  const label = domainLabel(domain);
  const topic = topicFor(`${label} ${segmentLabel(label).join(" ")}`);
  let strength = 0.16 + 0.52 * unit(`str:${domain}`) ** 1.25;
  if (/\.(edu|gov|ac\.[a-z]{2}|edu\.[a-z]{2}|gov\.[a-z]{2})$/.test(domain)) strength += 0.12;
  if (label.length <= 6) strength += 0.06;
  return { domain, strength: round(clamp(strength, 0.1, 0.82), 3), homeDb: homeFromTld(domain), topicId: topic.id, kind: "external" };
}, 5000);

/** Domains competing in a topic's SERPs. */
export const topicPool = memo((topicId: string): DomainEntity[] => {
  const topic = topicById(topicId);
  const leaders = topic.leaders.map((l) => REGISTRY.get(l.split("@")[0])!).filter(Boolean);
  const giants = GIANTS.map((g) => REGISTRY.get(g.domain)!);
  return [...leaders, ...giants.filter((g) => !leaders.some((l) => l.domain === g.domain)), ...nicheDomains(topicId)];
}, 40);

/** How strongly a domain's content targets a keyword family (0..1, most families low). */
const affinity = (domain: string, head: string) => unit(`aff:${domain}:${head}`) ** 1.6;

function covers(e: DomainEntity, head: string, keyword: string) {
  const headP = e.kind === "giant" ? 0.55 : 0.28 + 0.62 * e.strength;
  if (unit(`cov:${e.domain}:${head}`) > headP) return false;
  return unit(`covk:${e.domain}:${keyword}`) < 0.45 + 0.5 * e.strength;
}

function score(e: DomainEntity, keyword: string, head: string, primary: Intent, db: string) {
  const local = e.kind === "giant" ? 1 : e.homeDb === db ? 1 : 0.62 + 0.2 * unit(`loc:${e.domain}:${db}`);
  const fit = e.kind === "giant" ? (e.intents?.includes(primary) ? 0.95 : 0.25) : 1;
  return 0.48 * e.strength * local * fit + 0.32 * affinity(e.domain, head) + 0.2 * unit(`rel:${e.domain}:${keyword}:${db}`);
}

type Ranked = { entity: DomainEntity; score: number };

/** Ranking of pool domains for one keyword (only domains that cover it), best first. */
function rankKeyword(keyword: string, db: string, topic: Topic, extra: DomainEntity[] = []): Ranked[] {
  const primary = keywordIntents(keyword)[0];
  const head = headOf(keyword, topic);
  const list: Ranked[] = [];
  const seen = new Set<string>();
  for (const e of [...topicPool(topic.id), ...extra]) {
    if (seen.has(e.domain)) continue;
    seen.add(e.domain);
    if (!covers(e, head, keyword)) continue;
    let s = score(e, keyword, head, primary, db);
    if (isBrandKeyword(keyword, e.domain)) s += 2;
    list.push({ entity: e, score: s });
  }
  return list.sort((a, b) => b.score - a.score).slice(0, 100);
}

/** Per topic+db: keyword -> ranking. Computed once and memoized. */
const topicRankings = memo((topicId: string, db: string) => {
  const topic = topicById(topicId);
  const map = new Map<string, Ranked[]>();
  for (const k of topicUniverse(topicId)) map.set(k, rankKeyword(k, db, topic));
  return map;
}, 60);

// ---------------------------------------------------------------------------------------------
// Branded keywords
// ---------------------------------------------------------------------------------------------

const brandInfo = memo((domain: string) => {
  const label = domainLabel(domain);
  return { label, phrase: segmentLabel(label).join(" ") };
}, 5000, (d) => d);

/** Brand phrase for a domain: "paruluniversity.ac.in" -> "parul university". */
export function brandPhrase(domain: string) {
  return brandInfo(domain).phrase;
}
export function isBrandKeyword(keyword: string, domain: string) {
  const { label, phrase } = brandInfo(domain);
  if (keyword.includes(phrase)) return true;
  return label.length >= 4 && keyword.includes(label[0]) && keyword.replace(/\s+/g, "").includes(label);
}
function brandKeywords(e: DomainEntity) {
  if (e.kind === "giant") return [];
  const phrase = brandPhrase(e.domain);
  const r = rng(`brand:${e.domain}`);
  const mods = [...BRAND_MODIFIERS, ...(TOPIC_BRAND_MODIFIERS[e.topicId] ?? [])];
  const count = Math.round(8 + 22 * e.strength);
  const chosen = ["", ...r.sample(mods.filter(Boolean), count)];
  const out = chosen.map((m) => (m === "vs" ? `${phrase} vs ${r.pick(topicPool(e.topicId).filter((d) => d.kind === "leader")).domain.split(".")[0]}` : `${phrase} ${m}`.trim()));
  out.push(domainLabel(e.domain), `${domainLabel(e.domain)}.${e.domain.split(".").slice(1).join(".")}`);
  return [...new Set(out)];
}

// ---------------------------------------------------------------------------------------------
// URLs & titles
// ---------------------------------------------------------------------------------------------

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
const cap = (s: string) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());

export function subdomainFor(domain: string, section: "main" | "blog" | "shop" | "help") {
  const style = hash(`sub:${domain}`) % 4;
  if (section === "blog" && style === 0) return `blog.${domain}`;
  if (section === "help" && style <= 1) return `help.${domain}`;
  if (section === "shop" && style === 2) return `shop.${domain}`;
  return `www.${domain}`;
}

export function urlFor(domain: string, keyword: string, topic: Topic, intents: Intent[], branded: boolean) {
  const head = headOf(keyword, topic);
  const primary = intents[0];
  if (domain === "wikipedia.org") return `https://en.wikipedia.org/wiki/${cap(head).replace(/ /g, "_")}`;
  if (domain === "youtube.com") return `https://www.youtube.com/watch?v=${hash(`yt:${keyword}`).toString(36).slice(0, 11)}`;
  if (domain === "reddit.com") return `https://www.reddit.com/r/${slugify(head).replace(/-/g, "")}/comments/${hash(`rd:${keyword}`).toString(36).slice(0, 6)}/${slugify(keyword).slice(0, 40)}/`;
  if (domain === "amazon.com") return `https://www.amazon.com/s?k=${encodeURIComponent(head)}`;
  if (domain === "quora.com") return `https://www.quora.com/${cap(keyword).replace(/ /g, "-")}`;
  if (branded) {
    const tail = keyword.replace(brandPhrase(domain), "").trim();
    const known: Record<string, string> = { login: "login", "": "", admission: "admissions", fees: "fees-structure", courses: "programs", placement: "placements", careers: "careers", jobs: "careers", contact: "contact-us", pricing: "pricing" };
    const first = tail.split(" ")[0] ?? "";
    const path = tail ? (known[tail] ?? known[first] ?? slugify(tail)) : "";
    return `https://${subdomainFor(domain, "main")}/${path ? `${path}/` : ""}`;
  }
  if (primary === "informational") return `https://${subdomainFor(domain, "blog")}/blog/${slugify(keyword.replace(/^(what|how|why|which|who|is|are|can|does|when|where)( is| are| does| to| the| do)* /, ""))}/`;
  if (primary === "commercial") return `https://${subdomainFor(domain, "main")}/${hash(`c:${domain}`) % 2 ? "best" : "reviews"}/${slugify(head)}/`;
  return `https://${subdomainFor(domain, "shop")}/${slugify(head)}/`;
}

export function titleFor(domain: string, keyword: string, position: number) {
  const brand = cap(brandPhrase(domain));
  const k = cap(keyword);
  const r = rng(`title:${domain}:${keyword}`);
  const patterns = [`${k} - ${brand}`, `${k}: The Complete Guide (2026) | ${brand}`, `${r.int(7, 25)} Best ${k} | ${brand}`, `${k} | Compare Prices & Reviews - ${brand}`, `What You Need to Know About ${k} | ${brand}`, `${k} Explained | ${brand}`];
  return patterns[(hash(`t:${domain}:${keyword}`) + position) % patterns.length];
}

// ---------------------------------------------------------------------------------------------
// SERP
// ---------------------------------------------------------------------------------------------

/** Organic top results for any keyword. `extraDomains` (e.g. project domains) are ranked too. */
export function serp(keywordInput: string, dbInput = "US", opts: { extraDomains?: string[]; depth?: number } = {}): SerpResult[] {
  const keyword = keywordInput.toLowerCase().trim().replace(/\s+/g, " ");
  const db = database(dbInput).code;
  const topic = topicFor(keyword);
  const extra = (opts.extraDomains ?? []).map(domainEntity);
  const cached = extra.length ? null : topicRankings(topic.id, db).get(keyword);
  const ranking = cached ?? rankKeyword(keyword, db, topic, [...extra, ...extraBrandOwners(keyword)]);
  const m = keywordMetrics(keyword, db);
  return ranking.slice(0, opts.depth ?? 100).map((r, i) => ({
    position: i + 1,
    domain: r.entity.domain,
    url: urlFor(r.entity.domain, keyword, topic, m.intents, isBrandKeyword(keyword, r.entity.domain)),
    title: titleFor(r.entity.domain, keyword, i + 1),
    description: `${cap(keyword)} — ${["compare options, prices and expert reviews", "everything you need to know, updated for 2026", "find the best choices with our step-by-step guide", "top picks, pros and cons, and FAQs"][hash(r.entity.domain + keyword) % 4]}.`,
  }));
}
function extraBrandOwners(keyword: string): DomainEntity[] {
  const out: DomainEntity[] = [];
  for (const e of REGISTRY.values()) if (isBrandKeyword(keyword, e.domain)) out.push(e);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Domain keywords & facts
// ---------------------------------------------------------------------------------------------

function positionFor(entity: DomainEntity, keyword: string, db: string, topic: Topic) {
  const rankings = topicRankings(topic.id, db).get(keyword);
  if (!rankings) return null;
  const idx = rankings.findIndex((r) => r.entity.domain === entity.domain);
  if (idx >= 0) return idx + 1;
  if (entity.kind !== "external") return null;
  const head = headOf(keyword, topic);
  if (!covers(entity, head, keyword)) return null;
  const s = score(entity, keyword, head, keywordIntents(keyword)[0], db);
  const pos = rankings.filter((r) => r.score > s).length + 1;
  return pos <= 100 ? pos : null;
}

function ownedFeatures(position: number, features: SerpFeature[], key: string): SerpFeature[] {
  const out: SerpFeature[] = [];
  if (position <= 3 && features.includes("featured_snippet") && unit(`fs:${key}`) < 0.45) out.push("featured_snippet");
  if (position <= 5 && features.includes("ai_overview") && unit(`aio:${key}`) < 0.5) out.push("ai_overview");
  if (position <= 10 && features.includes("people_also_ask") && unit(`paa:${key}`) < 0.25) out.push("people_also_ask");
  if (position <= 10 && features.includes("image_pack") && unit(`img:${key}`) < 0.3) out.push("image_pack");
  if (position <= 3 && features.includes("sitelinks")) out.push("sitelinks");
  if (position <= 10 && features.includes("video") && unit(`vid:${key}`) < 0.2) out.push("video");
  return out;
}

/** Sample of the keywords a domain ranks for in the top 100 (the organic research table). */
export const domainKeywords = memo((domain: string, dbInput: string = "US"): RankedKeyword[] => {
  const db = database(dbInput).code;
  const e = domainEntity(domain);
  const topics = e.kind === "giant" ? TOPICS.filter((_, i) => (hash(`gt:${domain}`) + i) % 3 === 0) : [topicById(e.topicId)];
  const rows: RankedKeyword[] = [];
  const seen = new Set<string>();
  const push = (keyword: string, position: number, topic: Topic, branded: boolean) => {
    if (seen.has(keyword)) return;
    seen.add(keyword);
    const metrics = keywordMetrics(keyword, db);
    if (!metrics.volume) return;
    const r = rng(`prev:${domain}:${keyword}:${db}`);
    const previousPosition = r.chance(0.07) ? null : clamp(Math.round(position + r.normal(0, 2 + position * 0.12)), 1, 100);
    const traffic = Math.round(metrics.volume * ctrFor(position, metrics.serpFeatures));
    rows.push({
      keyword,
      position,
      previousPosition,
      url: urlFor(domain, keyword, topic, metrics.intents, branded),
      metrics: branded && !metrics.intents.includes("navigational") ? { ...metrics, intents: ["navigational", ...metrics.intents].slice(0, 2) as Intent[] } : metrics,
      traffic,
      trafficPct: 0,
      trafficCost: round(traffic * metrics.cpc, 2),
      branded,
      ownedFeatures: ownedFeatures(position, metrics.serpFeatures, `${domain}:${keyword}`),
    });
  };
  for (const topic of topics)
    for (const k of topicUniverse(topic.id)) {
      const pos = positionFor(e, k, db, topic);
      if (pos) push(k, pos, topic, false);
    }
  const homeFactor = e.homeDb === db ? 1 : 0.35;
  for (const k of brandKeywords(e)) {
    const r = rng(`bpos:${domain}:${k}:${db}`);
    const pos = r.chance(0.8 * homeFactor + 0.1) ? r.weighted([1, 2, 3, 4, 6, 9], [70, 12, 7, 5, 3, 3]) : r.int(5, 40);
    push(k, pos, topicById(e.topicId === "*" ? TOPICS[0].id : e.topicId), true);
  }
  const total = rows.reduce((s, r) => s + r.traffic, 0) || 1;
  for (const r of rows) r.trafficPct = round((r.traffic / total) * 100, 2);
  return rows.sort((a, b) => b.traffic - a.traffic || a.position - b.position);
}, 1000);

/** Keywords the domain ranked for last month but not any more (for position-change reports). */
export function lostKeywords(domain: string, db = "US") {
  const e = domainEntity(domain);
  const current = new Set(domainKeywords(domain, db).map((k) => k.keyword));
  const topic = topicById(e.topicId === "*" ? TOPICS[0].id : e.topicId);
  return topicUniverse(topic.id)
    .filter((k) => !current.has(k) && unit(`lost:${domain}:${k}:${db}`) < 0.035 + 0.04 * e.strength)
    .map((keyword) => ({ keyword, previousPosition: rng(`lostpos:${domain}:${keyword}`).int(4, 95), metrics: keywordMetrics(keyword, db) }));
}

function seriesShape(key: string, months: Date[], topic: Topic, growth: number, volatility: number) {
  const r = rng(key);
  const events = new Map<string, number>([
    ["2024-11", r.normal(0, 0.06)],
    ["2025-03", r.normal(0, 0.1)],
    ["2025-06", r.normal(0, 0.07)],
    ["2025-12", r.normal(0, 0.09)],
    ["2026-03", r.normal(0, 0.12)],
    ["2026-06", r.normal(0, 0.08)],
  ]);
  let level = 1;
  return months.map((m, i) => {
    const ym = m.toISOString().slice(0, 7);
    if (events.has(ym)) level *= 1 + events.get(ym)!;
    const trend = 1 + growth * (i / (months.length - 1)) ** 1.3;
    const season = topic.season[m.getUTCMonth()] ** 0.6;
    return Math.max(0.05, level * trend * season * (1 + r.normal(0, volatility)));
  });
}

function scaleTo(shape: number[], current: number) {
  const last = shape[shape.length - 1];
  return shape.map((v) => Math.max(0, Math.round((v / last) * current)));
}

export const MONTHS_HISTORY = 24;

function historyMonths() {
  const now = new Date();
  const out: Date[] = [];
  for (let i = MONTHS_HISTORY - 1; i >= 0; i--) out.push(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)));
  return out;
}

/**
 * Backlink headline numbers and Authority Score, without computing the keyword sample (cheap; use it
 * when many domains need an AS, e.g. SERP tables). domainFacts() reports the same values.
 */
export const domainLinkStats = memo((domain: string) => {
  const s = domainEntity(domain).strength;
  const br = rng(`bl:${domain}`);
  const referringDomains = Math.round(10 ** (1.1 + 4.2 * s ** 1.15) * br.range(0.7, 1.3));
  const backlinks = Math.round(referringDomains * (5 + 70 * br.next() ** 2));
  const referringIps = Math.round(referringDomains * br.range(0.72, 0.93));
  const followRatio = round(br.range(0.52, 0.88), 3);
  const authorityScore = Math.round(clamp(6 + 90 * s ** 1.1 + br.normal(0, 2.5), 1, 100));
  return { strength: s, referringDomains, backlinks, referringIps, followRatio, authorityScore };
}, 5000, (d) => d);

/** Headline metrics + 24-month history for a domain in a regional database. */
export const domainFacts = memo((domain: string, dbInput: string = "US"): DomainFacts => {
  const db = database(dbInput).code;
  const e = domainEntity(domain);
  const topic = topicById(e.topicId === "*" ? TOPICS[hash(domain) % TOPICS.length].id : e.topicId);
  const s = e.strength;
  const r = rng(`facts:${domain}:${db}`);
  // Giants rank in every topic; computing their full keyword sample is expensive, so their headline
  // numbers come from a formula and the sample is only built when their own reports are opened.
  const giant = e.kind === "giant";
  const sample = giant ? [] : domainKeywords(domain, db);
  const giantTraffic = giant ? 2.2e8 * ((s - 0.85) / 0.14) * database(db).share * r.range(0.8, 1.2) : 0;
  const sampleTraffic = giant ? giantTraffic : sample.reduce((a, k) => a + k.traffic, 0);
  const sampleCost = giant ? giantTraffic * r.range(0.2, 0.6) : sample.reduce((a, k) => a + k.trafficCost, 0);
  const kwMult = 1.6 + 32 * s ** 2.2;
  const trafMult = giant ? 1 : 1.15 + 1.4 * s ** 1.5;
  const organicKeywords = giant ? Math.round(giantTraffic / r.range(25, 60)) : Math.round(sample.length * kwMult * r.range(0.9, 1.1));
  const organicTraffic = Math.round(sampleTraffic * trafMult);
  const organicTrafficCost = Math.round(sampleCost * trafMult);
  const paid = paidKeywordRows(domain, db);
  const paidMult = 1.2 + 6 * s ** 2;
  const paidKeywords = Math.round(paid.length * paidMult);
  const paidTraffic = Math.round(paid.reduce((a, k) => a + k.traffic, 0) * paidMult);
  const paidTrafficCost = Math.round(paid.reduce((a, k) => a + k.trafficCost, 0) * paidMult);

  const { referringDomains, backlinks, referringIps, followRatio, authorityScore } = domainLinkStats(domain);
  const br = rng(`bl:${domain}:history`);

  const months = historyMonths();
  const growth = clamp(r.normal(0.25, 0.4), -0.55, 1.6);
  const trafficShape = seriesShape(`hist:t:${domain}:${db}`, months, topic, growth, 0.035);
  const kwShape = seriesShape(`hist:k:${domain}:${db}`, months, { ...topic, season: topic.season.map((v) => v ** 0.2) }, growth * 0.8, 0.015);
  const paidShape = seriesShape(`hist:p:${domain}:${db}`, months, topic, r.normal(0, 0.4), 0.12);
  const rdShape = seriesShape(`hist:rd:${domain}`, months, { ...topic, season: topic.season.map(() => 1) }, clamp(br.normal(0.3, 0.2), -0.2, 1), 0.01);
  const blShape = seriesShape(`hist:bl:${domain}`, months, { ...topic, season: topic.season.map(() => 1) }, clamp(br.normal(0.35, 0.3), -0.3, 1.4), 0.03);
  const traffic = scaleTo(trafficShape, organicTraffic);
  const kws = scaleTo(kwShape, organicKeywords);
  const pt = scaleTo(paidShape, paidTraffic);
  const pk = scaleTo(paidShape, paidKeywords);
  const rds = scaleTo(rdShape, referringDomains);
  const bls = scaleTo(blShape, backlinks);
  const dist = giant ? { top3: 0.22, top10: 0.41, top20: 0.55, top50: 0.8, top100: 1 } : positionDistribution(sample);
  const history: MonthlyPoint[] = months.map((m, i) => {
    const jitter = rng(`dist:${domain}:${db}:${i}`);
    const top3 = Math.round(kws[i] * dist.top3 * jitter.range(0.92, 1.08));
    const top10 = Math.max(top3, Math.round(kws[i] * dist.top10 * jitter.range(0.95, 1.05)));
    const top20 = Math.max(top10, Math.round(kws[i] * dist.top20));
    return {
      month: m.toISOString().slice(0, 7),
      organicTraffic: traffic[i],
      organicKeywords: kws[i],
      paidTraffic: pt[i],
      paidKeywords: pk[i],
      top3,
      top10,
      top20,
      top100: kws[i],
      backlinks: bls[i],
      referringDomains: rds[i],
      authorityScore: clamp(Math.round(authorityScore - (MONTHS_HISTORY - 1 - i) * r.range(-0.12, 0.3)), 1, 100),
    };
  });
  const last = history[history.length - 1];
  const prev = history[history.length - 2];
  const pct = (a: number, b: number) => (b ? round(((a - b) / b) * 100, 1) : 0);
  return {
    domain,
    db,
    topicId: topic.id,
    topicName: topic.name,
    homeDb: e.homeDb,
    strength: s,
    authorityScore,
    organicTraffic,
    organicKeywords,
    organicTrafficCost,
    paidTraffic,
    paidKeywords,
    paidTrafficCost,
    backlinks,
    referringDomains,
    referringIps,
    followRatio,
    trafficChangePct: pct(last.organicTraffic, prev.organicTraffic),
    keywordsChangePct: pct(last.organicKeywords, prev.organicKeywords),
    history,
  };
}, 1000);

/** Share of ranked keywords by position band (0..1, cumulative bands). */
export function positionDistribution(sample: { position: number }[]) {
  const n = sample.length || 1;
  const within = (p: number) => sample.filter((k) => k.position <= p).length / n;
  return { top3: within(3), top10: within(10), top20: within(20), top50: within(50), top100: 1 };
}

/** Organic traffic by regional database (country distribution widget). */
export const countryDistribution = memo((domain: string): CountryShare[] => {
  const e = domainEntity(domain);
  const candidates = [...new Set([e.homeDb, "US", "IN", "GB", "CA", "AU", "DE", "BR", "FR", "PH", "AE"])].slice(0, 10);
  const rows = candidates.map((db) => {
    const f = domainFacts(domain, db);
    const info = database(db);
    return { db, name: info.name, flag: info.flag, traffic: f.organicTraffic, keywords: f.organicKeywords, share: 0 };
  });
  const total = rows.reduce((s, r) => s + r.traffic, 0) || 1;
  for (const r of rows) r.share = round((r.traffic / total) * 100, 1);
  return rows.sort((a, b) => b.traffic - a.traffic);
}, 200);

// ---------------------------------------------------------------------------------------------
// Competitors, pages, subdomains, paid
// ---------------------------------------------------------------------------------------------

export type Competitor = {
  domain: string;
  commonKeywords: number;
  competitionLevel: number;
  organicKeywords: number;
  organicTraffic: number;
  trafficCost: number;
  paidKeywords: number;
  authorityScore: number;
};

export const domainCompetitors = memo((domain: string, dbInput: string = "US", limit: number = 20): Competitor[] => {
  const db = database(dbInput).code;
  const e = domainEntity(domain);
  const topicId = e.topicId === "*" ? TOPICS[hash(domain) % TOPICS.length].id : e.topicId;
  const rankings = topicRankings(topicId, db);
  const mine = new Set(domainKeywords(domain, db).filter((k) => !k.branded).map((k) => k.keyword));
  const totals = new Map<string, number>();
  const common = new Map<string, number>();
  for (const [keyword, list] of rankings)
    for (const r of list) {
      totals.set(r.entity.domain, (totals.get(r.entity.domain) ?? 0) + 1);
      if (mine.has(keyword)) common.set(r.entity.domain, (common.get(r.entity.domain) ?? 0) + 1);
    }
  const ranked: { other: DomainEntity; common: number; level: number }[] = [];
  for (const other of topicPool(topicId)) {
    const c = common.get(other.domain) ?? 0;
    if (other.domain === domain || !c) continue;
    const level = c / (mine.size + (totals.get(other.domain) ?? 0) - c || 1);
    ranked.push({ other, common: c, level: round(Math.min(1, level * (other.kind === "giant" ? 0.5 : 1) * 1.15), 3) });
  }
  return ranked
    .sort((a, b) => b.level - a.level)
    .slice(0, limit)
    .map(({ other, common: c, level }) => {
      const f = domainFacts(other.domain, db);
      return {
        domain: other.domain,
        commonKeywords: Math.round(c * (1.6 + 32 * Math.min(e.strength, other.strength) ** 2.2)),
        competitionLevel: level,
        organicKeywords: f.organicKeywords,
        organicTraffic: f.organicTraffic,
        trafficCost: f.organicTrafficCost,
        paidKeywords: f.paidKeywords,
        authorityScore: f.authorityScore,
      };
    });
}, 200);

export type TopPage = { url: string; traffic: number; trafficPct: number; keywords: number; topKeyword: string; backlinks: number };
export function domainPages(domain: string, db = "US"): TopPage[] {
  const map = new Map<string, TopPage>();
  for (const k of domainKeywords(domain, db)) {
    const p = map.get(k.url) ?? { url: k.url, traffic: 0, trafficPct: 0, keywords: 0, topKeyword: k.keyword, backlinks: 0 };
    p.traffic += k.traffic;
    p.trafficPct += k.trafficPct;
    p.keywords += 1;
    map.set(k.url, p);
  }
  const rows = [...map.values()];
  for (const p of rows) {
    p.trafficPct = round(p.trafficPct, 2);
    p.backlinks = Math.round(p.traffic * unit(`pbl:${p.url}`) * 0.4 + (p.url.endsWith(`${domain}/`) ? domainFacts(domain, db).backlinks * 0.3 : 0));
  }
  return rows.sort((a, b) => b.traffic - a.traffic);
}

export function domainSubdomains(domain: string, db = "US") {
  const map = new Map<string, { subdomain: string; traffic: number; keywords: number }>();
  for (const k of domainKeywords(domain, db)) {
    const host = new URL(k.url).hostname;
    const s = map.get(host) ?? { subdomain: host, traffic: 0, keywords: 0 };
    s.traffic += k.traffic;
    s.keywords += 1;
    map.set(host, s);
  }
  const total = [...map.values()].reduce((a, s) => a + s.traffic, 0) || 1;
  return [...map.values()].map((s) => ({ ...s, trafficPct: round((s.traffic / total) * 100, 1) })).sort((a, b) => b.traffic - a.traffic);
}

export type PaidKeyword = {
  keyword: string;
  position: number;
  metrics: ReturnType<typeof keywordMetrics>;
  traffic: number;
  trafficCost: number;
  url: string;
  adTitle: string;
  adDescription: string;
};

/** Keywords a domain bids on (Advertising Research). */
export const paidKeywordRows = memo((domain: string, dbInput: string = "US"): PaidKeyword[] => {
  const db = database(dbInput).code;
  const e = domainEntity(domain);
  if (["wikipedia.org", "reddit.com", "quora.com", "medium.com", "youtube.com", "facebook.com", "instagram.com", "nytimes.com", "linkedin.com", "pinterest.com"].includes(domain)) return [];
  const topic = topicById(e.topicId === "*" ? "fashion" : e.topicId);
  const bid = (topic.cpc > 3 ? 0.16 : 0.07) * (e.kind === "leader" ? 1.6 : e.kind === "niche" ? 0.5 : 1) * (0.4 + unit(`bidder:${domain}`));
  const brand = cap(brandPhrase(domain));
  const rows: PaidKeyword[] = [];
  for (const k of topicUniverse(topic.id)) {
    const m = keywordMetrics(k, db);
    if (!m.intents.some((i) => i === "commercial" || i === "transactional") || !m.cpc) continue;
    if (unit(`bid:${domain}:${k}:${db}`) > bid) continue;
    const r = rng(`ad:${domain}:${k}`);
    const position = r.weighted([1, 2, 3, 4], [30, 30, 25, 15]);
    const traffic = Math.round(m.volume * [0.065, 0.04, 0.03, 0.02][position - 1]);
    rows.push({
      keyword: k,
      position,
      metrics: m,
      traffic,
      trafficCost: round(traffic * m.cpc, 2),
      url: `https://www.${domain}/${slugify(headOf(k, topic))}/?utm_source=google&utm_medium=cpc`,
      adTitle: `${cap(k)} | ${brand}® Official Site`,
      adDescription: r.pick([
        `Shop ${k} at ${brand}. Free shipping on orders over $50. Compare top options today.`,
        `Looking for ${k}? ${brand} offers trusted choices, transparent pricing & fast support.`,
        `Get ${k} from ${brand}. Rated 4.8/5 by customers. Start today and save up to 30%.`,
      ]),
    });
  }
  return rows.sort((a, b) => b.traffic - a.traffic);
}, 200);

// ---------------------------------------------------------------------------------------------
// Rank tracking (daily positions)
// ---------------------------------------------------------------------------------------------

/**
 * Deterministic daily position for a domain/keyword (Position Tracking demo mode).
 * Anchored on the monthly SERP position with a smooth daily random walk; null = not in top 100.
 */
/** Monthly anchor position for a domain/keyword (memoized: backfills call this thousands of times). */
const basePosition = memo(
  (domain: string, keyword: string, db: string): number | null => {
    const e = domainEntity(domain);
    if (isBrandKeyword(keyword, domain)) return 1 + (hash(`bp:${domain}:${keyword}`) % 3);
    const topic = topicFor(keyword);
    return positionFor(e, keyword, db, topic) ?? serp(keyword, db, { extraDomains: [domain] }).find((s) => s.domain === domain)?.position ?? null;
  },
  20000,
);

/**
 * Deterministic daily position for a domain/keyword (Position Tracking demo mode).
 * Anchored on the monthly SERP position with a smooth daily random walk; null = not in top 100.
 */
export function positionOn(domain: string, keyword: string, db: string, device: "desktop" | "mobile", isoDate: string) {
  const base = basePosition(domain, keyword, db);
  const day = Math.floor(Date.parse(isoDate) / 86400000);
  // Sum of smooth sinusoidal components gives a continuous, day-stable walk.
  const r = rng(`walk:${domain}:${keyword}:${db}`);
  const comps = [0, 1, 2].map(() => ({ a: r.range(0.5, 3.5), p: r.range(6, 45), o: r.range(0, 6.28) }));
  const drift = comps.reduce((s, c) => s + c.a * Math.sin((day / c.p) * 6.28 + c.o), 0);
  const deviceShift = device === "mobile" ? (hash(`dev:${domain}:${keyword}`) % 5) - 2 : 0;
  if (base == null) {
    const appear = Math.sin(day / 17 + (hash(keyword) % 7)) > 0.93;
    return appear ? 60 + (hash(`${keyword}${day}`) % 40) : null;
  }
  const pos = Math.round(base + drift * (0.3 + base / 30) + deviceShift);
  return pos > 100 ? null : clamp(pos, 1, 100);
}

export { bucketVolume };
