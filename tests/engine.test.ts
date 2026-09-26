import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bucketVolume,
  ctrFor,
  domainCompetitors,
  domainFacts,
  domainKeywords,
  keywordMetrics,
  positionOn,
  referringDomains,
  segmentLabel,
  serp,
  topicFor,
  trafficFacts,
} from "../src/lib/seo/engine";

test("keyword metrics are deterministic and within valid ranges", () => {
  for (const k of ["running shoes", "best crm software for small business", "how to lose weight", "parul university admission"]) {
    const a = keywordMetrics(k, "US");
    const b = keywordMetrics(k, "US");
    assert.deepEqual(a, b);
    assert.ok(a.kd >= 0 && a.kd <= 100, "kd in range");
    assert.ok(a.competition >= 0 && a.competition <= 1, "competition in range");
    assert.ok(a.cpc >= 0, "cpc non-negative");
    assert.equal(a.trend.length, 12);
    assert.ok(a.globalVolume >= a.volume, "global volume >= local");
    assert.ok(a.intents.length >= 1 && a.intents.length <= 2);
  }
});

test("volume buckets snap to Google Ads style values", () => {
  assert.equal(bucketVolume(0), 0);
  assert.equal(bucketVolume(12), 10);
  assert.equal(bucketVolume(1234), 1300);
  assert.equal(bucketVolume(98000), 90500);
});

test("organic research and SERP agree on positions", () => {
  const domain = "nike.com";
  for (const k of domainKeywords(domain, "US").filter((r) => !r.branded).slice(0, 15)) {
    const hit = serp(k.keyword, "US").find((r) => r.domain === domain);
    assert.equal(hit?.position, k.position, `${k.keyword}: SERP position matches organic research`);
  }
});

test("domain keyword volumes match keyword overview", () => {
  for (const k of domainKeywords("zillow.com", "US").slice(0, 25)) {
    assert.equal(k.metrics.volume, keywordMetrics(k.keyword, "US").volume);
  }
});

test("domain facts are consistent with history", () => {
  const f = domainFacts("coursera.org", "US");
  assert.equal(f.history.length, 24);
  assert.equal(f.history.at(-1)!.organicTraffic, f.organicTraffic);
  assert.equal(f.history.at(-1)!.referringDomains, f.referringDomains);
  assert.ok(f.authorityScore >= 1 && f.authorityScore <= 100);
  for (const h of f.history) assert.ok(h.top3 <= h.top10 && h.top10 <= h.top20 && h.top20 <= h.top100);
});

test("competitors exclude the domain and are sorted by competition level", () => {
  const c = domainCompetitors("hm.com", "US", 10);
  assert.ok(c.length > 0);
  assert.ok(!c.some((x) => x.domain === "hm.com"));
  for (let i = 1; i < c.length; i++) assert.ok(c[i - 1].competitionLevel >= c[i].competitionLevel);
});

test("brand segmentation and topic detection", () => {
  assert.deepEqual(segmentLabel("paruluniversity"), ["parul", "university"]);
  assert.equal(topicFor("paruluniversity.ac.in").id, "education");
  assert.equal(topicFor("best running shoes").id, "fashion");
});

test("CTR decreases with position and AI Overviews reduce clicks", () => {
  for (let p = 1; p < 30; p++) assert.ok(ctrFor(p) >= ctrFor(p + 1));
  assert.ok(ctrFor(1, ["ai_overview"]) < ctrFor(1));
});

test("daily rank positions are stable for a given day", () => {
  const a = positionOn("nike.com", "sneakers", "US", "desktop", "2026-09-01");
  const b = positionOn("nike.com", "sneakers", "US", "desktop", "2026-09-01");
  assert.equal(a, b);
  assert.ok(a === null || (a >= 1 && a <= 100));
});

test("backlink and traffic samples are consistent", () => {
  const rds = referringDomains("nike.com");
  assert.ok(rds.length > 0 && rds.length <= domainFacts("nike.com", "US").referringDomains);
  const t = trafficFacts("nike.com");
  const share = t.channels.reduce((s, c) => s + c.share, 0);
  assert.ok(Math.abs(share - 100) < 1, "channel shares sum to 100%");
});
