import assert from "node:assert/strict";
import { test } from "node:test";

const i = await import("../src/lib/cx/listening/insights");
const cm = await import("../src/lib/cx/listening/crisis-math");
const so = await import("../src/lib/cx/listening/social");
const c = await import("../src/lib/cx/listening/connectors");
const sd = await import("../src/lib/cx/listening/social-data");

const row = (o: Partial<Record<string, unknown>>) =>
  ({ id: String(Math.random()), topic_id: "t1", source: "news", author: "a", author_handle: null, author_followers: null, title: "", body: "", language: "en", published_at: null, sentiment: "neutral", intent: null, ...o }) as never;
const topics = [{ id: "t1", name: "Acme", kind: "brand", keywords: ["acme"] }];

test("period comparison merges previous series and compares counts", () => {
  const merged = i.withPrevious([{ date: "d1", mentions: 3 }, { date: "d2", mentions: 5 }], [{ mentions: 1 }, { mentions: 10 }], ["mentions"]);
  assert.deepEqual(merged[1], { date: "d2", mentions: 5, prev_mentions: 10 });
  const cmp = i.compareCounts([{ key: "news", count: 4 }], [{ key: "news", count: 2 }, { key: "reddit", count: 3 }]);
  assert.equal(cmp[0].key, "news");
  assert.equal(cmp[0].change, 100);
  assert.equal(cmp.find((x) => x.key === "reddit")!.count, 0);
});

test("phrase clouds and sentiment-split clouds", () => {
  const rows = [
    row({ body: "Acme refund delay again, customer service slow", sentiment: "negative" }),
    row({ body: "the refund delay is terrible at acme", sentiment: "negative" }),
    row({ body: "love the new acme dashboard design", sentiment: "positive" }),
    row({ body: "new dashboard design looks great", sentiment: "positive" }),
  ];
  const p2 = i.topPhrases(rows, topics, 2, 10);
  assert.ok(p2.some((p) => p.term === "refund delay" && p.count === 2));
  assert.ok(p2.some((p) => p.term === "dashboard design"));
  assert.ok(!p2.some((p) => p.term.split(" ").includes("the")), "stop words break phrases");
  const clouds = i.sentimentClouds(rows, topics, 10);
  assert.ok(clouds.negative.some((t) => t.term === "refund" && t.tone === "negative"));
  assert.ok(clouds.positive.some((t) => t.term === "dashboard"));
  assert.ok(!clouds.negative.some((t) => t.term === "acme"), "topic keywords excluded");
});

test("peak windows per source (UTC)", () => {
  const rows = [
    ...[14, 14, 15, 16].map((h) => row({ source: "news", published_at: `2026-09-22T${h}:10:00Z` })), // Tuesday
    row({ source: "mastodon", published_at: "2026-09-26T02:00:00Z" }),
  ];
  const p = i.peakWindows(rows);
  const news = p.bySource.find((s) => s.source === "news")!;
  assert.equal(news.peakStart, 14);
  assert.equal(news.peakDay, "Tue");
  assert.equal(news.peakShare, 1);
  assert.equal(p.grid[1][14], 2);
  assert.equal(p.top[0].hour, 14);
});

test("trending issues: N mentions of X, k× normal", () => {
  const now = new Date("2026-09-28T12:00:00Z");
  const docs: { id: string; kind: "mention" | "ticket"; text: string; at: string }[] = [];
  // Baseline: 14 days, one "login" mention every other day plus filler.
  for (let d = 1; d <= 14; d++) {
    docs.push({ id: `b${d}`, kind: "mention", text: `weekly product update number ${d}`, at: new Date(now.getTime() - (d + 1) * 86400000).toISOString() });
    if (d % 2) docs.push({ id: `l${d}`, kind: "mention", text: "login works fine", at: new Date(now.getTime() - (d + 1) * 86400000).toISOString() });
  }
  for (let k = 0; k < 6; k++) docs.push({ id: `c${k}`, kind: k < 2 ? "ticket" : "mention", text: "cannot login after update, password reset broken", at: new Date(now.getTime() - k * 3600000).toISOString() });
  const t = i.trendingIssues(docs, now, { windowHours: 24, baselineDays: 14 });
  const login = t.find((x) => x.term === "login");
  assert.ok(login, "login is trending");
  assert.equal(login!.count, 6);
  assert.equal(login!.tickets, 2);
  assert.ok((login!.ratio ?? 0) >= 3);
  assert.ok(t.some((x) => x.term === "password reset" && x.isNew));
  assert.match(i.trendLabel(login!), /6 mentions and tickets of “login”, \d+\.\d× normal/);
});

test("review rating trend and drop alert", () => {
  const now = new Date("2026-09-28T00:00:00Z");
  const at = (d: number) => new Date(now.getTime() - d * 86400000).toISOString();
  const reviews = [...[10, 12, 15, 20, 25, 30].map((d) => ({ published_at: at(d), rating: 5 })), ...[1, 2, 3].map((d) => ({ published_at: at(d), rating: 2 }))];
  const r = i.ratingDrop(reviews, now, { threshold: 0.5 });
  assert.equal(r.baselineAvg, 5);
  assert.equal(r.recentAvg, 2);
  assert.equal(r.triggered, true);
  assert.equal(i.ratingDrop(reviews.slice(0, 7), now).triggered, false, "needs 3 recent reviews");
  const s = i.ratingSeries(reviews, [at(3).slice(0, 10), at(2).slice(0, 10), at(1).slice(0, 10)]);
  assert.equal(s[2].rolling, 2);
  assert.deepEqual(i.ratingDistribution(reviews).map((x) => x.count), [6, 0, 0, 3, 0]);
});

test("buzz YoY is null before coverage", () => {
  const rows = [row({ published_at: "2026-09-10T00:00:00Z" }), row({ published_at: "2025-09-03T00:00:00Z" }), row({ published_at: "2026-08-01T00:00:00Z" })];
  const y = i.buzzYoY(rows, new Date("2026-09-28T00:00:00Z"), new Date("2025-09-01T00:00:00Z"), 3);
  assert.deepEqual(y.map((m) => m.month), ["2026-07", "2026-08", "2026-09"]);
  assert.equal(y[2].mentions, 1);
  assert.equal(y[2].lastYear, 1);
  assert.equal(y[0].lastYear, null, "July 2025 is before coverage");
  assert.equal(i.buzzYoY(rows, new Date("2026-09-28T00:00:00Z"), null, 1)[0].mentions, null);
});

test("geography: storefront, ccTLD and named places", () => {
  assert.equal(i.countryFromHost("timesofindia.indiatimes.co.in"), "IN");
  assert.equal(i.countryFromHost("www.reuters.com"), null);
  assert.deepEqual(i.placeIn("Students in Vadodara protest"), { country: "IN", state: "Gujarat", city: "Vadodara" });
  const g = i.geoTree([
    { source: "appstore", author_handle: null, title: "", body: "great", country: "GB" },
    { source: "news", author_handle: "www.thehindu.co.in", title: "Fees hiked in Ahmedabad", body: "" },
    { source: "mastodon", author_handle: null, title: "", body: "Nothing here" },
  ]);
  assert.equal(g.located, 2);
  const inNode = g.root.children.find((c) => c.name === "IN")!;
  assert.equal(inNode.children[0].name, "Gujarat");
  assert.equal(inNode.children[0].children[0].name, "Ahmedabad");
});

test("crisis risk score and recovery curve", () => {
  const hi = cm.riskScore({ volumeZ: 8, negative: 40, mentions: 50, reach: 2_000_000 });
  const lo = cm.riskScore({ volumeZ: 0.5, negative: 0, mentions: 5, reach: null });
  assert.ok(hi.score >= 70 && hi.band === "high");
  assert.ok(lo.score < 40 && lo.band === "low" && !lo.reachKnown);
  assert.equal(cm.riskScore({ volumeZ: 5, negative: 0, mentions: 0, reach: null }).score, 0);

  const daily = cm.dailyCounts(
    [
      ...Array.from({ length: 14 }, (_, d) => ({ published_at: `2026-06-${String(d + 1).padStart(2, "0")}T10:00:00Z`, sentiment: "neutral" })),
      ...Array.from({ length: 20 }, () => ({ published_at: "2026-06-15T10:00:00Z", sentiment: "negative" })),
      ...Array.from({ length: 30 }, (_, d) => ({ published_at: new Date(Date.UTC(2026, 5, 16 + d, 10)).toISOString(), sentiment: "neutral" })),
    ],
    "2026-06-01",
    "2026-09-13",
  );
  const r = cm.recoveryCurve(daily, "2026-06-15T08:00:00Z", new Date("2026-08-20T00:00:00Z"), 14);
  assert.equal(r.baseline.volume, 1);
  assert.equal(r.baseline.negativeShare, 0);
  assert.equal(r.points[0].volumeIndex, 2000);
  const [d30, d60, d90] = r.milestones;
  assert.equal(d30.reached, true);
  assert.equal(d30.recovered, true);
  assert.equal(d60.volumeIndex, 0);
  assert.equal(d90.reached, false);
  assert.equal(d90.recovered, null);
});

test("engagement-rate formula, best times and content tags", () => {
  const f = so.parseFormula({ weights: { likes: 1, comments: 2, shares: 3, views: 0 }, denominator: "followers" });
  assert.equal(so.engagementRate({ likes: 10, comments: 5, shares: 2, views: 1000 }, f, 1000), 2.6);
  assert.equal(so.engagementRate({ likes: 10, comments: null, shares: null, views: 100 }, { ...f, denominator: "views" }, null), 10);
  assert.equal(so.engagementRate({ likes: null, comments: null, shares: null, views: null }, f, 100), null);
  assert.equal(so.engagementRate({ likes: 1, comments: 0, shares: 0, views: 0 }, f, null), null, "unknown followers → n/a");
  assert.equal(so.formulaText(f), "(likes + 2×comments + 3×shares) ÷ followers × 100");
  assert.equal(so.parseFormula({ weights: { likes: -3 }, denominator: "x" }).weights.likes, 1);

  const b = so.bestTimes([
    { at: "2026-09-22T14:00:00Z", weight: 100 },
    { at: "2026-09-29T14:30:00Z", weight: 80 },
    { at: "2026-09-26T03:00:00Z", weight: 2 },
  ]);
  assert.equal(b.bestDays[0], "Tue");
  assert.equal(b.bestHours[0], 14);
  assert.equal(so.bestTimes([{ at: "2026-09-22T23:30:00Z", weight: 1 }], 330).grid[2][5], 1, "IST shifts to Wed 05:00");

  const now = Date.now();
  const iso = (d: number) => new Date(now - d * 86400000).toISOString();
  const perf = so.tagPerformance(
    [
      { campaign_id: "c1", channels: ["x"], published_at: iso(1), clicks: 10, engagements: 50, rate: 2 },
      { campaign_id: "c1", channels: ["linkedin"], published_at: iso(3), clicks: 4, engagements: null, rate: null },
      { campaign_id: "c1", channels: ["x"], published_at: iso(40), clicks: 7, engagements: 5, rate: 1 },
      { campaign_id: null, channels: ["x"], published_at: iso(2), clicks: 0, engagements: null, rate: null },
    ],
    [{ id: "c1", name: "Launch" }],
    new Date(now - 30 * 86400000),
    new Date(now - 60 * 86400000),
  );
  assert.deepEqual(
    { tag: perf[0].tag, posts: perf[0].posts, prevPosts: perf[0].prevPosts, clicks: perf[0].clicks, prevClicks: perf[0].prevClicks, engagements: perf[0].engagements, avgRate: perf[0].avgRate },
    { tag: "Launch", posts: 2, prevPosts: 1, clicks: 14, prevClicks: 7, engagements: 50, avgRate: 2 },
  );
  assert.equal(perf[1].tag, "Untagged");
});

test("UGC media from Mastodon and Bluesky payloads", () => {
  const m = c.mapMastodon([
    {
      id: "1", uri: "https://m.s/1", url: "https://m.s/@a/1", content: "<p>Our new campus!</p>", account: { acct: "a", display_name: "A", followers_count: 5 }, created_at: "2026-09-20T10:00:00Z",
      media_attachments: [{ type: "image", url: "https://files.m.s/a.jpg", preview_url: "https://files.m.s/a_small.jpg", description: "Campus" }, { type: "audio", url: "https://files.m.s/a.mp3" }],
    },
  ]);
  assert.deepEqual(m[0].media, [{ type: "image", url: "https://files.m.s/a.jpg", preview: "https://files.m.s/a_small.jpg", alt: "Campus" }]);
  const b = c.blueskyMedia({ $type: "app.bsky.embed.recordWithMedia#view", media: { $type: "app.bsky.embed.images#view", images: [{ thumb: "https://cdn.bsky.app/t.jpg", fullsize: "https://cdn.bsky.app/f.jpg", alt: "" }] } });
  assert.equal(b[0].url, "https://cdn.bsky.app/f.jpg");
  assert.equal(b[0].alt, null);
  assert.deepEqual(c.mastodonMedia([{ type: "image", url: "http://insecure/x.jpg" }]), [], "https only");
});

test("GA4 dimension rows → labelled counts", () => {
  const rows = [
    { dimensionValues: [{ value: "India" }], metricValues: [{ value: "120" }] },
    { dimensionValues: [{ value: "" }], metricValues: [{ value: "3" }] },
    { dimensionValues: [{ value: "United States" }], metricValues: [{ value: "340" }] },
  ];
  assert.deepEqual(sd.mapGa4Dim(rows), [
    { label: "United States", users: 340 },
    { label: "India", users: 120 },
    { label: "(not set)", users: 3 },
  ]);
});
