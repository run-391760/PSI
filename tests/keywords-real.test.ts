import assert from "node:assert/strict";
import { test } from "node:test";

process.env.APP_SECRET = "test-secret-for-unit-tests";
delete process.env.DEMO_DATA;
delete process.env.DATAFORSEO_LOGIN;
delete process.env.DATAFORSEO_PASSWORD;

const { textIntents } = await import("../src/lib/keywords/intent");
const { regexChunks, escapeRe2, seedFilterGroups, mergeKeywordStats, toCells, sitePerformance, rankSites } = await import("../src/lib/keywords/gsc-map");
const { mapDfsSerpItems, top10Sets, cleanTitle } = await import("../src/lib/keywords/serp-map");
const { clusterBySerps, groupBySharedWords } = await import("../src/lib/keywords/cluster");
const { groupTotals } = await import("../src/lib/keywords/ppc-model");
const { autocompletePoolRows, selectIdeas } = await import("../src/lib/keywords/ideas");
const { textRow, metricsSource, visibleStoredRow } = await import("../src/lib/keywords/metrics");

const site = { site: "sc-domain:example.com", project: "Example", projectId: "p1" };
const site2 = { site: "https://blog.example.org/", project: "Blog", projectId: "p2" };

test("text intent: rules only, never a guess", () => {
  assert.deepEqual(textIntents("buy running shoes"), ["transactional"]);
  assert.deepEqual(textIntents("best running shoes"), ["commercial"]);
  assert.deepEqual(textIntents("how to clean running shoes"), ["informational"]);
  assert.deepEqual(textIntents("nike login"), ["navigational"]);
  assert.deepEqual(textIntents("running shoes"), []);
  assert.deepEqual(textRow("running shoes").volume, null);
});

test("metrics source is none without DataForSEO and DEMO_DATA", () => {
  assert.equal(metricsSource(), "none");
  const hidden = visibleStoredRow({ ...textRow("best crm"), volume: 5400, kd: 60, cpc: 12.5, source: "demo" });
  assert.equal(hidden.volume, null);
  assert.equal(hidden.cpc, null);
  assert.equal(hidden.source, "none");
  assert.deepEqual(hidden.intents, ["commercial"]);
  const live = visibleStoredRow({ ...textRow("best crm"), volume: 5400, source: "dataforseo" });
  assert.equal(live.volume, 5400);
});

test("GSC regex chunks escape RE2 and respect the length limit", () => {
  assert.equal(escapeRe2("c++ (tutorial)?"), "c\\+\\+ \\(tutorial\\)\\?");
  const kws = Array.from({ length: 400 }, (_, i) => `keyword number ${i}`);
  const chunks = regexChunks(kws, 1000);
  assert.ok(chunks.length > 1);
  assert.equal(chunks.flatMap((c) => c.keywords).length, 400);
  for (const c of chunks) {
    assert.ok(c.regex.length <= 1000, `regex too long: ${c.regex.length}`);
    assert.ok(c.regex.startsWith("^(?:") && c.regex.endsWith(")$"));
  }
});

test("seed filter: every meaningful word (stemmed) must appear", () => {
  assert.deepEqual(seedFilterGroups("Running Shoes for women"), [
    {
      groupType: "and",
      filters: [
        { dimension: "query", operator: "contains", expression: "running" },
        { dimension: "query", operator: "contains", expression: "shoe" },
        { dimension: "query", operator: "contains", expression: "women" },
      ],
    },
  ]);
});

test("GSC rows → per-keyword stats with best page and best site", () => {
  const stats = mergeKeywordStats([
    {
      site,
      queryRows: [
        { keys: ["running shoes"], clicks: 120, impressions: 4000, ctr: 0.03, position: 7.26 },
        { keys: ["trail running shoes"], clicks: 3, impressions: 900, ctr: 0.00333, position: 14.1 },
      ],
      pageRows: [
        { keys: ["running shoes", "https://example.com/shoes/"], clicks: 100, impressions: 3000, ctr: 0.033, position: 6.9 },
        { keys: ["running shoes", "https://example.com/blog/best-shoes"], clicks: 20, impressions: 1000, ctr: 0.02, position: 9 },
      ],
    },
    { site: site2, queryRows: [{ keys: ["trail running shoes"], clicks: 10, impressions: 1500, ctr: 0.0067, position: 11 }] },
  ]);
  assert.deepEqual(stats["running shoes"], { keyword: "running shoes", clicks: 120, impressions: 4000, ctr: 0.03, position: 7.3, page: "https://example.com/shoes/", site: site.site, project: "Example" });
  assert.equal(stats["trail running shoes"].site, site2.site);
  assert.equal(stats["trail running shoes"].page, null);
  assert.deepEqual(toCells(stats)["running shoes"], { im: 4000, cl: 120, po: 7.3, pg: "https://example.com/shoes/", s: site.site });
});

test("Keyword Overview 'your site' card model", () => {
  const perf = sitePerformance(
    "running shoes",
    site,
    [
      { keys: ["running shoes"], clicks: 50, impressions: 2000, ctr: 0.025, position: 8.44 },
      { keys: ["running shoes for flat feet"], clicks: 4, impressions: 800, ctr: 0.005, position: 12 },
    ],
    [
      { keys: ["https://example.com/b"], clicks: 5, impressions: 400, ctr: 0.0125, position: 15 },
      { keys: ["https://example.com/a"], clicks: 45, impressions: 1600, ctr: 0.028, position: 7.8 },
    ],
  );
  assert.deepEqual(perf.exact, { clicks: 50, impressions: 2000, ctr: 0.025, position: 8.4 });
  assert.equal(perf.pages[0].url, "https://example.com/a");
  assert.deepEqual(perf.related.map((r) => r.query), ["running shoes for flat feet"]);
  const none = sitePerformance("running shoes", site2, [{ keys: ["shoes"], clicks: 1, impressions: 10, ctr: 0.1, position: 30 }], []);
  assert.equal(none.exact, null);
  assert.deepEqual(rankSites([none, perf]).map((s) => s.site), [site.site, site2.site]);
});

test("DataForSEO SERP items → organic top 10 sets", () => {
  const items = mapDfsSerpItems([
    { type: "paid", url: "https://ad.example/", rank_group: 1 },
    { type: "organic", rank_group: 2, url: "https://b.com/x", title: "B", domain: "b.com" },
    { type: "organic", rank_group: 1, url: "https://www.a.com/", title: "A - Brand", domain: "www.a.com" },
    { type: "organic", rank_group: 11, url: "https://k.com/", title: "K", domain: "k.com" },
  ]);
  assert.deepEqual(items.map((i) => i.domain), ["a.com", "b.com", "k.com"]);
  assert.equal(top10Sets(items).urls.size, 2);
  assert.equal(cleanTitle("Best Running Shoes of 2026 | Runner's World"), "Best Running Shoes of 2026");
  assert.deepEqual(mapDfsSerpItems(undefined), []);
});

test("SERP-overlap clustering is pure and skips keywords without SERPs", () => {
  const s = (urls: string[]) => ({ urls: new Set(urls), domains: new Set(urls.map((u) => new URL(u).hostname)) });
  const u = (n: number) => `https://s${n}.com/`;
  const serps = new Map([
    ["running shoes", s([1, 2, 3, 4, 5].map(u))],
    ["best running shoes", s([1, 2, 3, 9, 10].map(u))],
    ["shoe repair", s([20, 21, 22].map(u))],
  ]);
  const clusters = clusterBySerps(
    [
      { keyword: "running shoes", volume: 1000, kd: 50 },
      { keyword: "best running shoes", volume: 500, kd: 70 },
      { keyword: "shoe repair", volume: null, kd: null },
      { keyword: "no serp", volume: 10, kd: 1 },
    ],
    serps,
  );
  assert.equal(clusters[0].pillar, "running shoes");
  assert.equal(clusters[0].keywords.length, 2);
  assert.equal(clusters[0].avgKd, 60);
  assert.equal(clusters.find((c) => c.pillar === "shoe repair")?.hasVolume, false);
  assert.ok(!clusters.some((c) => c.pillar === "no serp"));
});

test("grouping by shared words needs no metrics", () => {
  const groups = groupBySharedWords(["trail running shoes", "trail running shoes women", "running shoes women", "running shoes for flat feet", "flat feet running shoes"].map((keyword) => ({ keyword, volume: null, kd: null })));
  assert.ok(groups.length >= 2);
  assert.ok(groups.every((g) => !g.hasVolume && g.volume === 0));
  assert.equal(groups.reduce((n, g) => n + g.keywords.length, 0), 5);
});

test("PPC totals are n/a without metrics, never 0", () => {
  const kw = (volume: number | null, cpc: number | null) => ({ id: "x", groupId: "g", keyword: "k", match: "exact" as const, volume, cpc, competition: null, source: "none" });
  const empty = groupTotals([kw(null, null), kw(null, null)], 0.035);
  assert.equal(empty.volume, null);
  assert.equal(empty.clicks, null);
  assert.equal(empty.cost, null);
  const real = groupTotals([kw(1000, 2), kw(null, null)], 0.05);
  assert.equal(real.volume, 1000);
  assert.equal(real.clicks, 50);
  assert.equal(real.cost, 100);
});

test("Autocomplete pool: real suggestions in Google's order, null metrics", () => {
  const rows = autocompletePoolRows("running shoes", {
    status: "ok",
    fetchedAt: "2026-09-26T00:00:00.000Z",
    data: {
      seed: "running shoes",
      db: "US",
      queries: 35,
      failed: 0,
      suggestions: [
        { keyword: "running shoes", query: "running shoes", rank: 0 },
        { keyword: "running shoes for women", query: "running shoes", rank: 1 },
        { keyword: "how to choose running shoes", query: "how running shoes", rank: 0 },
        { keyword: "buy running shoes online", query: "running shoes b", rank: 0 },
      ],
    },
  });
  assert.deepEqual(rows.map((r) => r.keyword), ["running shoes", "running shoes for women", "how to choose running shoes", "buy running shoes online"]);
  assert.ok(rows.every((r) => r.volume == null && r.kd == null && r.cpc == null));
  const pool = { seed: "running shoes", db: "US", topicName: "", rows, source: "autocomplete" as const, fetchedAt: "", autocomplete: { status: "ok" as const, count: 4 }, relReady: true };
  const all = selectIdeas(pool, "broad", false);
  assert.deepEqual(all.rows.map((r) => r.keyword), rows.map((r) => r.keyword));
  assert.equal(selectIdeas(pool, "broad", true).total, 1);
  assert.equal(selectIdeas(pool, "related", false).total, 0);
  assert.equal(all.rows.find((r) => r.keyword === "buy running shoes online")?.i, "T");
});
