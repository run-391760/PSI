import { DATABASES, database } from "@/lib/domain";
import { brandPhrase, clamp, ctrFor, domainEntity, domainLinkStats, keywordMetrics, rng, serp, slugify, topicFor, topicPool } from "@/lib/seo/engine";
import { clusterKeywords, groupBySharedWords } from "./cluster";
import { ideaPool, selectIdeas, type AutocompleteInfo } from "./ideas";
import { demoRow, keywordRows, metricsSource, trendMonths, type MetricsSource } from "./metrics";
import { liveSerpItems } from "./serp";
import { normalizeKw, titleCase, wordGroups, type WordGroup } from "./text";
import type { IdeaRow, KwRow } from "./types";

export type SerpRow = {
  position: number;
  url: string;
  title: string;
  domain: string;
  /** Domain Authority Score (0..100). */
  domainAs: number | null;
  /** Referring domains / backlinks pointing to the ranking URL. */
  refDomains: number | null;
  backlinks: number | null;
  /** Estimated monthly organic visits of the URL (all its keywords). */
  traffic: number | null;
  /** Keywords the URL ranks for in the top 100. */
  urlKeywords: number | null;
  isProject: boolean;
};

export type IdeaBlock = { total: number; /** null when no row has a measured volume. */ volume: number | null; top: IdeaRow[] };
export type SampleAd = { domain: string; title: string; displayUrl: string; description: string; position: number };

export type KeywordOverview = {
  keyword: string;
  db: string;
  topicName: string;
  metrics: KwRow;
  globalVolume: number | null;
  countries: { db: string; name: string; flag: string; volume: number }[];
  months: string[];
  variations: IdeaBlock;
  questions: IdeaBlock;
  related: IdeaBlock;
  serp: SerpRow[];
  /** Median referring domains of the top 10 URLs ("how many links you need"). */
  rdNeeded: number | null;
  ads: SampleAd[];
  strategy: { pillar: string; pillarKeywords: number; pillarVolume: number; subpages: { name: string; keywords: number; volume: number }[]; importKeywords: string[] } | null;
  /** No metrics provider: Autocomplete variations grouped by shared words (real text analysis). */
  wordGroups: (WordGroup & { examples: string[] })[];
  source: MetricsSource;
  fetchedAt: string;
  autocomplete: AutocompleteInfo;
};

function block(rows: ReturnType<typeof selectIdeas>): IdeaBlock {
  return { total: rows.total, volume: rows.rows.some((r) => r.volume != null) ? rows.totalVolume : null, top: rows.rows.slice(0, 5) };
}

/** Page-level SERP metrics from the demo engine (domain AS is the same number Domain Overview shows). */
function demoSerp(keyword: string, db: string, projectDomains: string[], m: KwRow): SerpRow[] {
  const extra = projectDomains.length ? { extraDomains: projectDomains } : {};
  return serp(keyword, db, { ...extra, depth: 20 }).map((r) => {
    const f = domainLinkStats(r.domain);
    const g = rng(`kw-serp-page:${keyword}:${db}:${r.url}`);
    const share = clamp(g.logNormal(0.018, 0.9) * (1.35 - Math.min(r.position, 20) * 0.045), 0.0004, 0.3);
    const refDomains = Math.max(r.position <= 10 ? 1 : 0, Math.round(f.referringDomains * share));
    const backlinks = Math.round(refDomains * g.logNormal(3.2, 0.7));
    const urlKeywords = Math.max(1, Math.round(g.logNormal(12 + 260 * f.strength ** 2, 0.75)));
    const traffic = Math.round((m.volume ?? 0) * ctrFor(r.position, m.features) * (1 + Math.log10(1 + urlKeywords) * g.range(0.4, 1.3)));
    return { position: r.position, url: r.url, title: r.title, domain: r.domain, domainAs: f.authorityScore, refDomains, backlinks, traffic, urlKeywords, isProject: projectDomains.includes(r.domain) };
  });
}

async function liveSerp(ownerId: string, keyword: string, db: string, projectDomains: string[]): Promise<SerpRow[]> {
  const data = await liveSerpItems(ownerId, keyword, db);
  return data.map((r) => ({ ...r, domainAs: null, refDomains: null, backlinks: null, traffic: null, urlKeywords: null, isProject: projectDomains.some((d) => r.domain === d || r.domain.endsWith(`.${d}`)) }));
}

function sampleAds(keyword: string, db: string, m: KwRow): SampleAd[] {
  if ((m.competition ?? 0) < 0.35 && !m.features.includes("ads_top")) return [];
  const topic = topicFor(keyword);
  const r = rng(`kw-ads:${keyword}:${db}`);
  const advertisers = r.sample(topicPool(topic.id).filter((e) => e.kind !== "giant"), 3);
  const k = titleCase(keyword);
  return advertisers.map((e, i) => {
    const brand = titleCase(brandPhrase(e.domain));
    const title = r.pick([`${k} | ${brand}® Official Site`, `Shop ${k} - Free Shipping & Returns | ${brand}`, `${k} from ${brand} - Compare Top Options`, `Best ${k} of 2026 | ${brand}`]);
    const description = r.pick([
      `Looking for ${keyword}? ${brand} offers trusted choices, transparent pricing and fast support. Get started today.`,
      `Get ${keyword} from ${brand}. Rated 4.8/5 by customers. Save up to 30% this week only.`,
      `Compare ${keyword} side by side. Expert picks, honest reviews and exclusive deals at ${brand}.`,
    ]);
    return { domain: e.domain, title, displayUrl: `www.${e.domain}/${slugify(keyword).slice(0, 30)}`, description, position: i + 1 };
  });
}

const MEMO = new Map<string, { expires: number; value: Promise<KeywordOverview> }>();

/** Everything the Keyword Overview report shows for one keyword (memoized in-process for 10 minutes). */
export async function getKeywordOverview(ownerId: string, keywordInput: string, dbInput: string, projectDomains: string[] = []): Promise<KeywordOverview> {
  const keyword = normalizeKw(keywordInput);
  const db = database(dbInput).code;
  const key = `${metricsSource()}|${ownerId}|${db}|${keyword}|${[...projectDomains].sort().join(",")}`;
  const hit = MEMO.get(key);
  if (hit && Date.now() < hit.expires) return hit.value;
  const entry = { expires: Date.now() + 10 * 60_000, value: buildOverview(ownerId, keyword, db, projectDomains) };
  MEMO.set(key, entry);
  if (MEMO.size > 50) MEMO.delete(MEMO.keys().next().value as string);
  entry.value.then((o) => o.autocomplete.status === "failed" && (entry.expires = Date.now() + 60_000)).catch(() => MEMO.delete(key));
  return entry.value;
}

async function buildOverview(ownerId: string, keyword: string, db: string, projectDomains: string[]): Promise<KeywordOverview> {
  const [{ data: [metrics], fetchedAt, source }, pool] = await Promise.all([keywordRows(ownerId, [keyword], db), ideaPool(ownerId, keyword, db)]);
  const live = source === "dataforseo";
  const demo = source === "demo";
  const serpRows = live ? await liveSerp(ownerId, keyword, db, projectDomains).catch(() => []) : demo ? demoSerp(keyword, db, projectDomains, metrics) : [];
  const top10 = serpRows.filter((r) => r.position <= 10 && r.refDomains != null).map((r) => r.refDomains as number).sort((a, b) => a - b);
  const variations = selectIdeas(pool, "broad", false, source === "none" ? MAX_TEXT_VARIATIONS : 100);
  const questions = selectIdeas(pool, "broad", true, 5);
  const related = selectIdeas(pool, "related", false, 5);

  // Keyword strategy hint: cluster the top variations by SERP overlap (demo SERPs, local development only).
  let strategy: KeywordOverview["strategy"] = null;
  if (demo && variations.rows.length >= 5) {
    // Same-topic variations only: other topics' SERPs never overlap and would cost a full topic ranking each.
    const topicId = topicFor(keyword).id;
    const sameTopic = variations.rows.filter((r) => topicFor(r.keyword).id === topicId).slice(0, 60);
    const clusters = clusterKeywords(sameTopic.map((r) => ({ keyword: r.keyword, volume: r.volume, kd: r.kd })), db, "medium");
    const pillar = clusters.find((c) => c.keywords.some((k) => k.keyword === keyword)) ?? clusters[0];
    if (pillar) strategy = {
      pillar: pillar.pillar,
      pillarKeywords: pillar.keywords.length,
      pillarVolume: pillar.volume,
      subpages: clusters.filter((c) => c !== pillar && c.keywords.length > 1).slice(0, 4).map((c) => ({ name: c.pillar, keywords: c.keywords.length, volume: c.volume })),
      importKeywords: variations.rows.slice(0, 50).map((r) => r.keyword),
    };
  }

  // No metrics provider: group the real Autocomplete variations by shared words (text analysis).
  const groups =
    source === "none"
      ? groupBySharedWords(variations.rows.map((r) => ({ keyword: r.keyword, volume: null, kd: null })))
          .filter((g) => g.keywords.length >= 2 && !g.pillar.endsWith("(general)") && g.pillar !== "General")
          .slice(0, 8)
          .map((g) => ({ id: g.id, label: g.pillar, count: g.keywords.length, volume: 0, examples: g.keywords.slice(0, 3).map((k) => k.keyword) }))
      : [];
  if (source === "none" && !groups.length)
    for (const g of wordGroups(variations.rows, keyword, 8)) groups.push({ ...g, examples: variations.rows.filter((r) => r.keyword.includes(g.label)).slice(0, 3).map((r) => r.keyword) });

  const countries = demo
    ? DATABASES.map((d) => ({ db: d.code, name: d.name, flag: d.flag, volume: keywordMetrics(keyword, d.code).volume })).sort((a, b) => b.volume - a.volume)
    : [];
  return {
    keyword,
    db,
    topicName: demo ? topicFor(keyword).name : "",
    metrics,
    globalVolume: demo ? keywordMetrics(keyword, db).globalVolume : null,
    countries,
    months: trendMonths(),
    variations: block(variations),
    questions: block(questions),
    related: block(related),
    serp: serpRows,
    rdNeeded: top10.length ? top10[Math.floor(top10.length / 2)] : null,
    ads: demo ? sampleAds(keyword, db, metrics) : [],
    strategy,
    wordGroups: groups,
    source,
    fetchedAt,
    autocomplete: pool.autocomplete,
  };
}

/** Variations shown for a keyword when only Autocomplete is available (all of them are real suggestions). */
const MAX_TEXT_VARIATIONS = 400;

/** Bulk mode: metrics for up to 100 keywords (global volume only from the demo engine in local development). */
export async function getBulkOverview(ownerId: string, keywords: string[], dbInput: string) {
  const db = database(dbInput).code;
  const res = await keywordRows(ownerId, keywords, db);
  const global = res.source === "demo" ? Object.fromEntries(keywords.map((k) => [normalizeKw(k), keywordMetrics(k, db).globalVolume])) : null;
  return { ...res, db, global };
}

export { demoRow };
