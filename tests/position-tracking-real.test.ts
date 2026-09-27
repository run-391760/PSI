import assert from "node:assert/strict";
import { test } from "node:test";
import {
  availableDays,
  batchFilter,
  gscWindow,
  keywordBatches,
  mapGscSnapshots,
  queryRegex,
  suggestionsFromQueries,
  type GscApiRow,
} from "../src/lib/position-tracking/gsc-map";
import { aggregateDay, ctrFor, type RankRow } from "../src/lib/position-tracking/metrics";

const row = (keys: string[], clicks: number, impressions: number, position: number): GscApiRow => ({ keys, clicks, impressions, ctr: impressions ? clicks / impressions : 0, position });

const keywords = [
  { id: "k1", keyword: "running shoes" },
  { id: "k2", keyword: "trail shoes (women)" },
  { id: "k3", keyword: "shoe care" },
];

// Realistic Search Analytics rows (dimensions [date, query, device]).
const queryRows: GscApiRow[] = [
  row(["2026-09-20", "running shoes", "DESKTOP"], 12, 340, 4.27),
  row(["2026-09-20", "running shoes", "MOBILE"], 30, 910, 6.81),
  row(["2026-09-20", "running shoes", "TABLET"], 1, 20, 9.0),
  row(["2026-09-21", "running shoes", "DESKTOP"], 9, 300, 5.04),
  row(["2026-09-20", "trail shoes (women)", "DESKTOP"], 0, 15, 18.4),
  // Case variant of the same query is merged (impression-weighted position).
  row(["2026-09-21", "Trail Shoes (Women)", "DESKTOP"], 1, 10, 12.0),
  row(["2026-09-21", "trail shoes (women)", "DESKTOP"], 0, 30, 16.0),
  // Not tracked → ignored.
  row(["2026-09-20", "shoes sale", "DESKTOP"], 50, 1000, 2.1),
];
// dimensions [date, query, device, page]
const pageRows: GscApiRow[] = [
  row(["2026-09-20", "running shoes", "DESKTOP", "https://www.shop.com/running"], 11, 300, 4.0),
  row(["2026-09-20", "running shoes", "DESKTOP", "https://www.shop.com/blog/best-running-shoes"], 1, 60, 8.2),
  row(["2026-09-20", "running shoes", "DESKTOP", "https://www.shop.com/tiny"], 0, 2, 40),
  row(["2026-09-21", "running shoes", "DESKTOP", "https://www.shop.com/running"], 9, 300, 5.0),
  row(["2026-09-20", "trail shoes (women)", "DESKTOP", "https://www.shop.com/trail"], 0, 15, 18.4),
];

test("mapGscSnapshots: one snapshot per keyword × device × available day; no impressions = null (not 100)", () => {
  const snaps = mapGscSnapshots({ domain: "shop.com", keywords, devices: ["desktop"], days: ["2026-09-20", "2026-09-21"], queryRows, pageRows });
  assert.equal(snaps.length, 3 * 2);
  const get = (id: string, day: string) => snaps.find((s) => s.keyword_id === id && s.day === day)!;

  const a = get("k1", "2026-09-20");
  assert.equal(a.positions["shop.com"], 4.3);
  assert.equal(a.clicks, 12);
  assert.equal(a.impressions, 340);
  assert.equal(a.urls["shop.com"], "https://www.shop.com/running");
  // The 2-impression page is below 10% of the top page's impressions → not a competing URL.
  assert.deepEqual(a.own_urls.map((u) => u.url), ["https://www.shop.com/running", "https://www.shop.com/blog/best-running-shoes"]);
  assert.equal(a.own_urls[1].position, 8.2);
  assert.deepEqual(a.features, []);

  const merged = get("k2", "2026-09-21");
  assert.equal(merged.impressions, 40);
  assert.equal(merged.clicks, 1);
  assert.equal(merged.positions["shop.com"], 15); // (12×10 + 16×30) / 40

  const none = get("k3", "2026-09-20");
  assert.equal(none.positions["shop.com"], null);
  assert.equal(none.urls["shop.com"], null);
  assert.equal(none.clicks, 0);
  assert.equal(none.impressions, 0);
  assert.deepEqual(none.own_urls, []);
});

test("mapGscSnapshots: devices are separate, tablet ignored, days without site data skipped", () => {
  const snaps = mapGscSnapshots({ domain: "shop.com", keywords: keywords.slice(0, 1), devices: ["desktop", "mobile"], days: ["2026-09-20"], queryRows, pageRows });
  assert.equal(snaps.length, 2);
  const mobile = snaps.find((s) => s.device === "mobile")!;
  assert.equal(mobile.positions["shop.com"], 6.8);
  assert.equal(mobile.impressions, 910);
  assert.equal(mobile.urls["shop.com"], null); // no page rows for mobile → position known, page unknown
  assert.ok(!snaps.some((s) => s.day === "2026-09-21"));
});

test("query batching and filters", () => {
  assert.equal(queryRegex(["a.b", "c+d"]), "(?i)^(?:a\\.b|c\\+d)$");
  const many = Array.from({ length: 130 }, (_, i) => `keyword number ${i}`);
  const batches = keywordBatches(many, 3000, 60);
  assert.deepEqual(batches.map((b) => b.length), [60, 60, 10]);
  assert.ok(keywordBatches(many, 200, 1000).every((b) => b.join("|").length < 220));
  assert.deepEqual(batchFilter(["running shoes"], "usa"), [
    { groupType: "and", filters: [{ dimension: "query", operator: "equals", expression: "running shoes" }, { dimension: "country", operator: "equals", expression: "usa" }] },
  ]);
  const f = batchFilter(["a", "b"], null)[0].filters;
  assert.equal(f.length, 1);
  assert.equal(f[0].operator, "includingRegex");
});

test("availableDays and fetch windows", () => {
  assert.deepEqual(availableDays([row(["2026-09-21"], 1, 1, 1), row(["2026-09-19"], 1, 1, 1), row(["2026-09-01"], 1, 1, 1)], "2026-09-10", "2026-09-25"), ["2026-09-19", "2026-09-21"]);
  assert.deepEqual(gscWindow({ end: "2026-09-25", lastDay: null, firstDay: null, backfill: 90 }), { from: "2026-06-28", to: "2026-09-25" });
  // Daily run: re-fetch the last 3 stored days plus newer ones.
  assert.deepEqual(gscWindow({ end: "2026-09-25", lastDay: "2026-09-22", firstDay: "2026-06-28" }), { from: "2026-09-20", to: "2026-09-25" });
  // New keywords: the campaign's whole history (max 90 days).
  assert.deepEqual(gscWindow({ end: "2026-09-25", lastDay: "2026-09-22", firstDay: "2026-01-01", history: true }), { from: "2026-06-28", to: "2026-09-25" });
});

test("suggestionsFromQueries: real top queries, volume/KD unknown", () => {
  const s = suggestionsFromQueries([row(["running shoes"], 40, 1200, 5.55), row(["site:shop.com"], 3, 3, 1), row(["Running  Shoes"], 2, 100, 7), row(["shoe care"], 1, 900, 22)]);
  assert.deepEqual(s.map((x) => x.keyword), ["running shoes", "shoe care"]);
  assert.equal(s[0].clicks, 42);
  assert.equal(s[0].volume, null);
  assert.equal(s[0].kd, null);
});

test("aggregateDay measured: clicks are traffic, average over ranking keywords only", () => {
  const snaps = mapGscSnapshots({ domain: "shop.com", keywords, devices: ["desktop"], days: ["2026-09-20"], queryRows, pageRows });
  const [agg] = aggregateDay("2026-09-20", snaps as unknown as RankRow[], ["shop.com"], new Map(), { measured: true });
  assert.equal(agg.keywords, 3);
  assert.equal(agg.ranked, 2);
  assert.equal(agg.clicks, 12);
  assert.equal(agg.traffic, 12);
  assert.equal(agg.impressions, 355);
  assert.equal(agg.avgPosition, (4.3 + 18.4) / 2);
  assert.equal(agg.top10, 1);
  assert.ok(agg.visibility > 0 && Number.isFinite(agg.visibility));
});

test("ctrFor interpolates fractional positions", () => {
  assert.equal(ctrFor(1), 0.28);
  assert.ok(Math.abs(ctrFor(1.5) - (0.28 + 0.155) / 2) < 1e-9);
  assert.ok(ctrFor(4.3) < ctrFor(4) && ctrFor(4.3) > ctrFor(5));
  assert.ok(Number.isFinite(ctrFor(10.4)) && Number.isFinite(ctrFor(0.5)));
});
