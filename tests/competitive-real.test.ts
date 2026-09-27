import assert from "node:assert/strict";
import { test } from "node:test";

const m = await import("../src/lib/competitive/own-site-map");

// Fixture rows follow the Search Console searchAnalytics.query and GA4 runReport response shapes.

const current = [
  { keys: ["acme shoes"], clicks: 500, impressions: 4000, ctr: 0.125, position: 1.2 },
  { keys: ["running shoes"], clicks: 120, impressions: 9000, ctr: 0.0133, position: 6.44 },
  { keys: ["trail shoes"], clicks: 30, impressions: 2000, ctr: 0.015, position: 14.9 },
  { keys: ["shoe size chart"], clicks: 10, impressions: 800, ctr: 0.0125, position: 8.0 },
];
const previous = [
  { keys: ["acme shoes"], clicks: 450, impressions: 3900, ctr: 0.115, position: 1.3 },
  { keys: ["running shoes"], clicks: 200, impressions: 9500, ctr: 0.021, position: 4.1 },
  { keys: ["trail shoes"], clicks: 5, impressions: 900, ctr: 0.0056, position: 22.0 },
  { keys: ["winter boots"], clicks: 40, impressions: 1500, ctr: 0.027, position: 7.5 },
];
const pageQuery = [
  { keys: ["https://acme.com/", "acme shoes"], clicks: 480, impressions: 3800, ctr: 0.126, position: 1.1 },
  { keys: ["https://shop.acme.com/brand", "acme shoes"], clicks: 20, impressions: 200, ctr: 0.1, position: 3 },
  { keys: ["https://acme.com/running", "running shoes"], clicks: 120, impressions: 9000, ctr: 0.013, position: 6.4 },
  { keys: ["https://acme.com/running", "trail shoes"], clicks: 30, impressions: 2000, ctr: 0.015, position: 14.9 },
];

test("brand terms: domain label plus project terms, spacing-insensitive", () => {
  const terms = m.brandTerms("acme.com", ["Acme Sports", "ac"]);
  assert.deepEqual(terms, ["acme", "acmesports"]);
  assert.ok(m.isBranded("ACME running", terms));
  assert.ok(m.isBranded("acme sports store", terms));
  assert.ok(!m.isBranded("running shoes", terms));
});

test("queries: position changes, new and lost vs previous period, top URL", () => {
  const rows = m.buildQueries({ current, previous, pageQuery, brand: m.brandTerms("acme.com") });
  const by = Object.fromEntries(rows.map((r) => [r.query, r]));
  assert.equal(by["acme shoes"].status, "unchanged"); // moved 0.1
  assert.equal(by["acme shoes"].url, "https://acme.com/");
  assert.equal(by["acme shoes"].branded, true);
  assert.equal(by["running shoes"].status, "declined");
  assert.equal(by["running shoes"].change, -2.3);
  assert.equal(by["running shoes"].position, 6.4);
  assert.equal(by["trail shoes"].status, "improved");
  assert.equal(by["trail shoes"].change, 7.1);
  assert.equal(by["shoe size chart"].status, "new");
  assert.equal(by["shoe size chart"].url, null);
  assert.equal(by["winter boots"].status, "lost");
  assert.equal(by["winter boots"].position, null);
  assert.equal(by["winter boots"].previousClicks, 40);
  assert.equal(rows[0].query, "acme shoes"); // sorted by clicks
  assert.deepEqual(m.statusCounts(rows), { new: 1, improved: 1, declined: 1, unchanged: 1, lost: 1 });
});

test("queries without a comparable period have no statuses and no lost rows", () => {
  const rows = m.buildQueries({ current, previous: null, pageQuery: [], brand: [] });
  assert.equal(rows.length, 4);
  assert.ok(rows.every((r) => r.status === null && r.change === null && r.previousClicks === null));
});

test("position bands and branded split ignore lost queries", () => {
  const rows = m.buildQueries({ current, previous, pageQuery, brand: m.brandTerms("acme.com") });
  assert.deepEqual(
    m.positionBands(rows).map((b) => b.queries),
    [1, 2, 1, 0, 0],
  );
  const split = m.brandSplit(rows);
  assert.deepEqual(split.branded, { clicks: 500, impressions: 4000, queries: 1 });
  assert.deepEqual(split.nonBranded, { clicks: 160, impressions: 11800, queries: 3 });
});

test("totals, deltas and ranges", () => {
  assert.equal(m.gscTotals([]), null);
  assert.deepEqual(m.gscTotals([{ clicks: 10, impressions: 100, ctr: 0.1, position: 4.56 }]), { clicks: 10, impressions: 100, ctr: 0.1, position: 4.6 });
  assert.equal(m.pctChange(120, 100), 20);
  assert.equal(m.pctChange(5, 0), null);
  assert.equal(m.pctChange(5, null), null);
  assert.equal(m.ownRange("6m").days, 180);
  assert.equal(m.ownRange("bogus").id, "3m");
  assert.ok(m.hasComparablePrevious(180));
  assert.ok(!m.hasComparablePrevious(365));
  const daily = m.gscDaily([
    { keys: ["2026-09-02"], clicks: 3, impressions: 30, ctr: 0.1, position: 5 },
    { keys: ["2026-09-01"], clicks: 2, impressions: 20, ctr: 0.1, position: 0 },
  ]);
  assert.deepEqual(daily.map((d) => d.date), ["2026-09-01", "2026-09-02"]);
  assert.equal(daily[0].position, null);
});

test("pages: clicks change, query counts, top query, hosts", () => {
  const pages = m.buildPages(
    [
      { keys: ["https://acme.com/running"], clicks: 150, impressions: 11000, ctr: 0.0136, position: 7.2 },
      { keys: ["https://acme.com/"], clicks: 480, impressions: 3800, ctr: 0.126, position: 1.1 },
      { keys: ["https://shop.acme.com/brand"], clicks: 20, impressions: 200, ctr: 0.1, position: 3 },
    ],
    [{ keys: ["https://acme.com/"], clicks: 400, impressions: 3500, ctr: 0.11, position: 1.2 }],
    pageQuery,
  );
  assert.equal(pages[0].url, "https://acme.com/");
  assert.equal(pages[0].clicksChange, 80);
  const running = pages.find((p) => p.url.endsWith("/running"))!;
  assert.equal(running.queries, 2);
  assert.equal(running.topQuery, "running shoes");
  assert.equal(running.clicksChange, 150);
  const hosts = m.subdomainsFromPages(pages);
  assert.deepEqual(hosts.map((h) => [h.subdomain, h.clicks, h.pages]), [["acme.com", 630, 2], ["shop.acme.com", 20, 1]]);
  assert.equal(hosts[0].share, 96.9);
});

test("countries (alpha-3) and devices", () => {
  const c = m.gscDimension(
    [
      { keys: ["ind"], clicks: 30, impressions: 900, ctr: 0.033, position: 9.1 },
      { keys: ["usa"], clicks: 70, impressions: 1000, ctr: 0.07, position: 5.04 },
      { keys: ["zzz"], clicks: 0, impressions: 5, ctr: 0, position: 40 },
    ],
    "country",
  );
  assert.equal(c[0].label, "United States");
  assert.equal(c[0].flag, "🇺🇸");
  assert.equal(c[0].share, 70);
  assert.equal(c[1].label, "India");
  assert.equal(c[2].label, "ZZZ");
  assert.equal(m.countryInfo("GB").name, "United Kingdom");
  const d = m.gscDimension([{ keys: ["MOBILE"], clicks: 5, impressions: 50, ctr: 0.1, position: 3 }], "device");
  assert.equal(d[0].label, "Mobile");
});

test("GA4: totals, pages/session, daily dates and dimension shares", () => {
  const t = m.ga4Totals([{ value: "1000" }, { value: "700" }, { value: "400" }, { value: "0.62" }, { value: "95.5" }, { value: "2500" }, { value: "33" }, { value: "620" }]);
  assert.deepEqual(t, { sessions: 1000, users: 700, newUsers: 400, engagementRate: 0.62, avgDuration: 95.5, pageViews: 2500, pagesPerSession: 2.5, keyEvents: 33, engagedSessions: 620 });
  assert.equal(m.ga4Totals(undefined).pagesPerSession, null);
  const daily = m.ga4Daily([
    { dimensionValues: [{ value: "20260902" }], metricValues: [{ value: "12" }, { value: "9" }] },
    { dimensionValues: [{ value: "20260901" }], metricValues: [{ value: "10" }, { value: "8" }] },
  ]);
  assert.deepEqual(daily, [
    { date: "2026-09-01", sessions: 10, users: 8 },
    { date: "2026-09-02", sessions: 12, users: 9 },
  ]);
  const row = (v: string, s: string) => ({ dimensionValues: [{ value: v }], metricValues: [{ value: s }, { value: "1" }, { value: "1" }, { value: "0.5" }, { value: "60" }, { value: "2" }, { value: "0" }, { value: "1" }] });
  const channels = m.ga4Dimension([row("Direct", "25"), row("Organic Search", "75")], "channel");
  assert.equal(channels[0].key, "Organic Search");
  assert.equal(channels[0].share, 75);
  assert.equal(m.channelShare(channels, "organic search"), 75);
  const countries = m.ga4Dimension([row("India", "10"), row("Atlantis", "5")], "country");
  assert.equal(countries[0].flag, "🇮🇳");
  assert.equal(countries[1].flag, "🌐");
  const nr = m.ga4Dimension([row("new", "3"), row("returning", "1")], "newReturning");
  assert.deepEqual(nr.map((x) => x.label), ["New", "Returning"]);
});
