import assert from "node:assert/strict";
import { test } from "node:test";
import { anchorType, bulkRowsFromDfs, rateProspects, samplesByDomain, scoreLiveAudit } from "../src/lib/backlinks/map";
import { expectedCtr, keywordSnippets, mapAdvancedSerp, mergeSerps, mapGscPage, measureRival, pairsFromGsc, recommendedFromAutocomplete, semanticFromTexts, summarizeRivals } from "../src/lib/content/bench-map";
import type { PageFacts } from "../src/lib/content/extract";
import { generateIdeas, isRealBenchmark, priorityScore, type StoredBenchmark } from "../src/lib/content/ideas";

test("bulk rows map DataForSEO bulk items and keep unknowns null", () => {
  const targets = [
    { input: "a.com", target: "a.com", kind: "domain" as const, domain: "a.com" },
    { input: "b.com", target: "b.com", kind: "domain" as const, domain: "b.com" },
  ];
  const rows = bulkRowsFromDfs(targets, {
    ranks: new Map([["a.com", { target: "a.com", rank: 512 }]]),
    backlinks: new Map([["a.com", { target: "a.com", backlinks: 12000 }]]),
    referringDomains: new Map([["a.com", { target: "a.com", referring_domains: 400, referring_domains_nofollow: 100, referring_ips: 350 }]]),
    newLostRd: new Map([["a.com", { new_referring_domains: 12, lost_referring_domains: 3 }]]),
  });
  assert.equal(rows[0].authorityScore, 51);
  assert.equal(rows[0].followPct, 75);
  assert.equal(rows[0].referringIps, 350);
  assert.equal(rows[0].newRd30, 12);
  assert.equal(rows[0].newBl30, null);
  assert.equal(rows[1].authorityScore, null);
  assert.equal(rows[1].backlinks, null);
});

test("live audit toxicity uses spam score plus real markers only", () => {
  const samples = samplesByDomain([
    { domain_from: "best-casino-links.xyz", url_from: "https://best-casino-links.xyz/p", anchor: "cheap running shoes", domain_from_ip: "10.0.0.1", page_from_external_links: 420 },
    { domain_from: "blog.example.org", url_from: "https://blog.example.org/a", anchor: "Acme", domain_from_ip: "10.0.0.2" },
    { domain_from: "news.site", url_from: "https://news.site/x", anchor: "acme.com", domain_from_ip: "10.0.0.3" },
  ]);
  const rows = scoreLiveAudit(
    [
      { domain: "best-casino-links.xyz", spamScore: 70, authorityScore: 2, backlinks: 300, firstSeen: "2025-01-01", lastSeen: "", follow: true },
      { domain: "blog.example.org", spamScore: 5, authorityScore: 40, backlinks: 2, firstSeen: "2025-02-01", lastSeen: "", follow: true },
      { domain: "news.site", spamScore: null, authorityScore: 60, backlinks: 1, firstSeen: "", lastSeen: "", follow: false },
    ],
    samples,
    { domain: "acme.com", brandTerms: [] },
  );
  const bad = rows[0];
  assert.equal(bad.domain, "best-casino-links.xyz");
  assert.equal(bad.toxicity, 100);
  for (const m of ["High spam score", "Spam in domain name", "Suspicious TLD", "Low Authority Score", "Sitewide link", "Too many outbound links", "Money anchor text", "Same IP network"]) assert.ok(bad.markers.includes(m), m);
  const brand = rows.find((r) => r.domain === "blog.example.org")!;
  assert.ok(!brand.markers.includes("Money anchor text"));
  assert.equal(rows.find((r) => r.domain === "news.site")!.toxicity, 10); // 0 spam score + shared /24 subnet
  assert.equal(anchorType("acme.com", "acme.com"), "naked");
});

test("prospects come from competitors' referring domains and real SERPs", () => {
  const out = rateProspects({
    domain: "acme.com",
    competitors: ["rival1.com", "rival2.com"],
    ours: ["already.com"],
    competitorLinks: {
      "rival1.com": [{ domain: "shared.org", authorityScore: 55 }, { domain: "already.com", authorityScore: 40 }, { domain: "spammy.xyz", authorityScore: 10, spamScore: 80 }],
      "rival2.com": [{ domain: "shared.org", authorityScore: 55 }],
    },
    serps: { "trail shoes": [{ domain: "guide.net", position: 3 }, { domain: "google.com", position: 1 }] },
  });
  const domains = out.map((p) => p.domain);
  assert.deepEqual(domains.sort(), ["guide.net", "shared.org"]);
  const shared = out.find((p) => p.domain === "shared.org")!;
  assert.equal(shared.competitors.length, 2);
  assert.equal(out.find((p) => p.domain === "guide.net")!.keywords[0].position, 3);
});

test("advanced SERP mapping extracts organic, features, PAA and related searches", () => {
  const serp = mapAdvancedSerp({
    items: [
      { type: "featured_snippet", url: "https://x.com" },
      { type: "organic", rank_group: 2, url: "https://www.b.com/p", domain: "www.b.com", title: "B", description: "About trail shoes and more" },
      { type: "organic", rank_group: 1, url: "https://a.com/", domain: "a.com", title: "A", description: "A" },
      { type: "people_also_ask", items: [{ title: "What are trail shoes?" }] },
      { type: "related_searches", items: ["Trail Shoes Women", "trail shoes men"] },
      { type: "images" },
    ],
  });
  assert.deepEqual(serp.organic.map((o) => o.domain), ["a.com", "b.com"]);
  assert.ok(serp.features.includes("featured_snippet") && serp.features.includes("image_pack") && serp.features.includes("people_also_ask"));
  assert.deepEqual(serp.questions, ["What are trail shoes?"]);
  assert.deepEqual(serp.related, ["trail shoes women", "trail shoes men"]);
  assert.equal(keywordSnippets(serp.organic, ["trail shoes"]).length, 1);
  assert.equal(mergeSerps([serp.organic, [{ position: 1, url: "https://www.b.com/p", domain: "b.com", title: "B", description: "" }]])[0].url, "https://www.b.com/p");
});

const facts = (over: Partial<PageFacts> = {}): PageFacts => ({
  finalUrl: "https://acme.com/trail-shoes",
  status: 200,
  https: true,
  bytes: 50_000,
  title: "Trail shoes | Acme",
  metaDescription: "Buy trail shoes",
  h1s: ["Trail shoes"],
  h2s: ["Sizing"],
  h3Count: 0,
  canonical: "https://acme.com/trail-shoes",
  robots: "",
  noindex: false,
  lang: "en",
  viewport: true,
  og: { title: true, description: true, image: true },
  hreflang: 0,
  schemaTypes: ["Product"],
  invalidJsonLd: 0,
  words: 400,
  paragraphs: 5,
  longParagraphs: 0,
  flesch: 60,
  grade: 8,
  avgSentenceLength: 15,
  longSentences: 0,
  passiveShare: 0,
  images: 2,
  imagesMissingAlt: 0,
  imagesEmptyAlt: 0,
  imagesNoDimensions: 0,
  internalLinks: 10,
  externalLinks: 2,
  nofollowLinks: 0,
  jumpLinks: 0,
  lists: 1,
  tables: 0,
  hasVideo: false,
  questionHeadings: 0,
  snippet: "trail shoes for every runner",
  ...over,
});

test("crawled rivals are summarized and share semantic terms", () => {
  const organic = [1, 2, 3, 4].map((i) => ({ position: i, url: `https://r${i}.com/`, title: `Trail shoes ${i}`, description: "", domain: `r${i}.com` }));
  const rivals = organic.map((o, i) => measureRival(o, "trail shoes", i < 3 ? { facts: facts({ words: 1000 + i * 100 }), text: "trail shoes cushioning grip trail shoes waterproof membrane" } : null, "HTTP 403"));
  const avg = summarizeRivals(rivals)!;
  assert.equal(avg.crawled, 3);
  assert.equal(avg.words, 1100);
  assert.equal(avg.mentions, 2);
  assert.equal(rivals[3].words, null);
  assert.equal(summarizeRivals(rivals.slice(2)), null);
  const sem = semanticFromTexts(["trail shoes"], [
    { domain: "r1.com", text: "Cushioning and grip matter. Waterproof membrane keeps feet dry. r1 sale." },
    { domain: "r2.com", text: "Look for grip, cushioning and a waterproof membrane." },
    { domain: "r3.com", text: "Grip on rocks; waterproof membrane; drop." },
  ]);
  const terms = sem.map((s) => s.term);
  assert.ok(terms.includes("waterproof membrane"));
  assert.ok(terms.includes("grip"));
  assert.ok(!terms.includes("trail") && !terms.includes("shoes") && !terms.includes("r1"));
  assert.equal(sem[0].of, 3);
});

test("Search Console rows map to page pairs and page data", () => {
  const pairs = pairsFromGsc([
    { keys: ["https://acme.com/a", "trail shoes"], clicks: 10, impressions: 500, ctr: 0.02, position: 6.34 },
    { keys: ["https://acme.com/a", "acme"], clicks: 30, impressions: 100, ctr: 0.3, position: 1 },
    { keys: ["https://acme.com/b", "hiking boots"], clicks: 5, impressions: 900, ctr: 0.005, position: 12 },
  ]);
  assert.deepEqual(pairs.map((p) => [p.url, p.keyword]), [["https://acme.com/a", "acme"], ["https://acme.com/b", "hiking boots"]]);
  const g = mapGscPage("sc-domain:acme.com", { start: "2026-08-27", end: "2026-09-23" }, [{ clicks: 12, impressions: 2000, ctr: 0.006, position: 5.2 }], [
    { keys: ["trail shoes"], clicks: 10, impressions: 800, ctr: 0.0125, position: 6.1 },
    { keys: ["how to clean trail running shoes"], clicks: 0, impressions: 300, ctr: 0, position: 9 },
  ], [{ keys: ["https://acme.com/other"], clicks: 20, impressions: 1500, ctr: 0.01, position: 4 }]);
  assert.equal(g.queries[0].query, "trail shoes");
  assert.equal(g.page?.impressions, 2000);
  assert.ok(expectedCtr(1) > expectedCtr(8));
});

test("ideas use only real sources and legacy demo benchmarks are detected", () => {
  const bench: StoredBenchmark = {
    v: 2,
    serp: null,
    serpError: null,
    gscError: null,
    gsc: mapGscPage("sc-domain:acme.com", { start: "s", end: "e" }, [{ clicks: 12, impressions: 2000, ctr: 0.004, position: 5.2 }], [
      { keys: ["trail shoes"], clicks: 10, impressions: 800, ctr: 0.0125, position: 6.1 },
      { keys: ["waterproof hiking shoes"], clicks: 1, impressions: 400, ctr: 0.002, position: 8 },
      { keys: ["how to clean trail running shoes"], clicks: 0, impressions: 300, ctr: 0, position: 9 },
    ], [{ keys: ["https://acme.com/other"], clicks: 20, impressions: 1500, ctr: 0.01, position: 4 }]),
  };
  const f = facts();
  const ideas = generateIdeas({ url: f.finalUrl, keyword: "trail shoes", domain: "acme.com", facts: f, use: { inTitle: true, inH1: true, inMeta: true, inUrl: true, inFirst100: true, inH2: false, inAlt: false, mentions: 3, density: 0.7, semanticUsed: [], semanticMissing: [] }, fetchError: null, fetchStatus: 200, bench });
  const ids = ideas.map((i) => i.id);
  assert.ok(ids.includes("strategy:quick-win"));
  assert.ok(ids.includes("strategy:cannibal"));
  assert.ok(ids.includes("content:low-ctr"));
  assert.ok(ids.includes("content:query-gap"));
  assert.ok(ids.includes("semantic:gsc-questions"));
  assert.ok(!ideas.some((i) => i.source === "demo"));
  assert.ok(!ids.some((i) => i.startsWith("backlinks:")));
  assert.ok(!ids.includes("content:length"), "no length comparison without a real top-10 benchmark");
  assert.ok(isRealBenchmark(bench) && !isRealBenchmark({ metrics: { volume: 100 } }));
  const p = priorityScore(bench, ideas);
  assert.ok(p > 0 && p <= 100);
});

test("autocomplete suggestions become recommended words", () => {
  const rec = recommendedFromAutocomplete("trail shoes", ["trail shoes women", "trail shoes for women waterproof", "trail shoes waterproof", "trail shoes near me", "trail shoes men"]);
  assert.deepEqual(rec, ["waterproof", "women"]);
});
