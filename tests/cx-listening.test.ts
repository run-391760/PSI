import assert from "node:assert/strict";
import { test } from "node:test";

const c = await import("../src/lib/cx/listening/connectors");
const s = await import("../src/lib/cx/listening/sources");
const sp = await import("../src/lib/cx/listening/spikes");
const a = await import("../src/lib/cx/listening/analytics");

// Fixtures follow the real response shapes of each API (trimmed).

test("Google News RSS → mentions", () => {
  const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>
  <item><title>Acme recalls widgets after fire reports - Reuters</title><link>https://news.google.com/rss/articles/abc?oc=5</link>
  <guid isPermaLink="false">CBMiabc</guid><pubDate>Mon, 21 Sep 2026 14:05:00 GMT</pubDate>
  <description>&lt;a href="https://news.google.com/x"&gt;Acme recalls widgets after fire reports&lt;/a&gt;&amp;nbsp;&amp;nbsp;&lt;font color="#6f6f6f"&gt;Reuters&lt;/font&gt;</description>
  <source url="https://www.reuters.com">Reuters</source></item>
  <item><title>Dup - X</title><link>https://news.google.com/rss/articles/abc2</link><guid>CBMiabc</guid><pubDate>Mon, 21 Sep 2026 14:05:00 GMT</pubDate></item>
  </channel></rss>`;
  const r = c.mapNewsRss(xml);
  assert.equal(r.length, 1);
  assert.equal(r[0].source, "news");
  assert.equal(r[0].title, "Acme recalls widgets after fire reports");
  assert.equal(r[0].author, "Reuters");
  assert.equal(r[0].authorHandle, "www.reuters.com");
  assert.equal(r[0].externalId, "CBMiabc");
  assert.equal(r[0].publishedAt, "2026-09-21T14:05:00.000Z");
});

test("Hacker News Algolia hits → mentions (story + comment)", () => {
  const r = c.mapHackerNews({
    hits: [
      { objectID: "41000001", title: "Show HN: Acme CLI", url: "https://acme.dev", author: "pg", points: 120, num_comments: 45, created_at: "2026-09-20T10:00:00.000Z", story_text: null },
      { objectID: "41000002", comment_text: "Acme&#x27;s pricing is <i>terrible</i>", story_title: "Acme raises prices", author: "dang", created_at: "2026-09-20T11:00:00.000Z" },
      { title: "no id" },
    ],
  });
  assert.equal(r.length, 2);
  assert.deepEqual(r[0].engagement, { points: 120, comments: 45 });
  assert.equal(r[0].url, "https://news.ycombinator.com/item?id=41000001");
  assert.equal(r[0].body, "https://acme.dev");
  assert.equal(r[1].title, "Comment on: Acme raises prices");
  assert.equal(r[1].body, "Acme's pricing is terrible");
});

test("Mastodon statuses → mentions", () => {
  const r = c.mapMastodon([
    { id: "1131", uri: "https://fosstodon.org/users/jo/statuses/1131", url: "https://fosstodon.org/@jo/1131", created_at: "2026-09-20T09:00:00.000Z", language: "de", content: "<p>Neues <a href='x'>#acme</a> Update</p>", favourites_count: 3, reblogs_count: 1, replies_count: 0, account: { acct: "jo@fosstodon.org", display_name: "Jo", followers_count: 812 } },
    { id: "9", created_at: "2026-09-20T09:00:00.000Z", content: "hi", account: { acct: "local", display_name: "" } },
  ]);
  assert.equal(r[0].externalId, "https://fosstodon.org/users/jo/statuses/1131");
  assert.equal(r[0].body, "Neues #acme Update");
  assert.equal(r[0].authorHandle, "@jo@fosstodon.org");
  assert.equal(r[0].authorFollowers, 812);
  assert.equal(r[0].language, "de");
  assert.deepEqual(r[0].engagement, { likes: 3, reposts: 1, replies: 0 });
  assert.equal(r[1].authorHandle, "@local@mastodon.social");
  assert.equal(r[1].externalId, "mastodon.social:9");
});

test("Apple customer reviews JSON → mentions (skips app entry)", () => {
  const r = c.mapAppStore(
    {
      feed: {
        entry: [
          { id: { label: "app" }, title: { label: "Acme" } },
          { author: { name: { label: "Dr ian" } }, updated: { label: "2026-09-27T07:16:58-07:00" }, "im:rating": { label: "1" }, id: { label: "14599711637" }, title: { label: "Crashes" }, content: { label: "Crashes on launch" }, "im:voteCount": { label: "2" } },
        ],
      },
    },
    "6448311069",
    "gb",
  );
  assert.equal(r.length, 1);
  assert.equal(r[0].externalId, "6448311069:14599711637");
  assert.equal(r[0].publishedAt, "2026-09-27T14:16:58.000Z");
  assert.deepEqual(r[0].engagement, { rating: 1, votes: 2 });
  assert.equal(r[0].country, "GB");
  assert.equal(c.mapAppStore({ feed: { entry: [] } }, "1").length, 0);
});

test("Reddit listing → mentions", () => {
  const r = c.mapReddit({ data: { children: [{ kind: "t3", data: { name: "t3_abc", id: "abc", title: "Acme support ignored me", selftext: "Three weeks", author: "u1", subreddit_name_prefixed: "r/acme", permalink: "/r/acme/comments/abc/x/", created_utc: 1790000000, score: 42, num_comments: 7 } }] } });
  assert.equal(r[0].externalId, "t3_abc");
  assert.equal(r[0].title, "r/acme: Acme support ignored me");
  assert.equal(r[0].url, "https://www.reddit.com/r/acme/comments/abc/x/");
  assert.equal(r[0].publishedAt, new Date(1790000000 * 1000).toISOString());
  assert.deepEqual(r[0].engagement, { score: 42, comments: 7 });
});

test("YouTube search + commentThreads → mentions", () => {
  const v = c.mapYouTubeSearch({ items: [{ id: { kind: "youtube#video", videoId: "vid1" }, snippet: { publishedAt: "2026-09-19T08:00:00Z", channelId: "UC1", title: "Acme review &amp; test", description: "d", channelTitle: "Tech" } }, { id: { kind: "youtube#channel", channelId: "x" }, snippet: {} }] });
  assert.equal(v.length, 1);
  assert.equal(v[0].externalId, "video:vid1");
  assert.equal(v[0].title, "Acme review & test");
  const cm = c.mapYouTubeComments({ items: [{ id: "th1", snippet: { videoId: "vid1", totalReplyCount: 2, topLevelComment: { id: "cm1", snippet: { authorDisplayName: "@bob", authorChannelId: { value: "UC2" }, textOriginal: "Love Acme", likeCount: 5, publishedAt: "2026-09-19T09:00:00Z" } } } }] }, "Acme review");
  assert.equal(cm[0].externalId, "comment:cm1");
  assert.equal(cm[0].url, "https://www.youtube.com/watch?v=vid1&lc=cm1");
  assert.deepEqual(cm[0].engagement, { likes: 5, replies: 2 });
});

test("Bluesky searchPosts → mentions", () => {
  const r = c.mapBluesky({ posts: [{ uri: "at://did:plc:xyz/app.bsky.feed.post/3kabc", cid: "c", author: { handle: "jo.bsky.social", displayName: "Jo", followersCount: 99 }, record: { text: "acme is down again", createdAt: "2026-09-20T12:00:00.000Z", langs: ["en-US"] }, likeCount: 4, repostCount: 0, replyCount: 1 }] });
  assert.equal(r[0].url, "https://bsky.app/profile/jo.bsky.social/post/3kabc");
  assert.equal(r[0].language, "en");
  assert.equal(r[0].authorFollowers, 99);
});

test("topic keyword rules, exclusions and queries", () => {
  assert.deepEqual(s.parseRule('acme AND (refund OR "late delivery")'), [["acme"], ["refund", "late delivery"]]);
  assert.ok(s.matchesTopic("Acme refund took weeks", ["acme AND (refund OR delay)"], []));
  assert.ok(!s.matchesTopic("Acme is great", ["acme AND (refund OR delay)"], []));
  assert.ok(!s.matchesTopic("Acmeville news", ["acme"], []), "whole words only");
  assert.ok(s.matchesTopic("loving #acme today", ["acme"], []));
  assert.ok(!s.matchesTopic("Acme careers: we're hiring", ["acme"], ["hiring"]));
  assert.equal(s.booleanQuery('acme AND (refund OR "late delivery")', ["jobs"]), 'acme (refund OR "late delivery") -jobs');
  assert.deepEqual(s.simpleQueries("acme AND (refund OR delay)"), ["acme refund", "acme delay"]);
  assert.deepEqual(s.hashtagsFor("Acme Corp OR acme"), ["acmecorp", "acme"]);
  assert.deepEqual(s.parseAppId("gb/284882215"), { country: "gb", id: "284882215" });
  assert.equal(s.parseAppId("abc"), null);
});

test("spike detection: z-score vs trailing baseline", () => {
  const now = new Date("2026-09-28T12:00:00Z");
  const H = 3600_000;
  const mk = (hoursAgo: number, neg = false) => ({ published_at: new Date(now.getTime() - hoursAgo * H).toISOString(), sentiment: neg ? "negative" : "neutral" });
  // 14 days of ~4 mentions/day, then 30 mentions (20 negative) in the last 24h.
  const rows = [];
  for (let d = 1; d <= 14; d++) for (let i = 0; i < 4; i++) rows.push(mk(d * 24 + 2 + i, i === 0));
  for (let i = 0; i < 30; i++) rows.push(mk(1 + i * 0.5, i < 20));
  const b = sp.bucketize(rows, now, 24, 14);
  assert.equal(b.length, 15);
  assert.equal(b[14].total, 30);
  assert.equal(b[0].total, 4);
  const r = sp.detectSpike(b, sp.DEFAULT_SPIKE_SETTINGS);
  assert.ok(r.ready);
  assert.equal(r.volume.mean, 4);
  assert.ok(r.volume.z > 10);
  assert.equal(r.kind, "both");
  assert.equal(r.severity, "critical");

  // Normal day: no trigger.
  const calm = sp.detectSpike(sp.bucketize(rows.slice(0, 56).concat([mk(2), mk(3), mk(4), mk(5)]), now, 24, 14), sp.DEFAULT_SPIKE_SETTINGS);
  assert.equal(calm.triggered, false);

  // Below minimum mentions: no trigger even with a big z.
  const tiny = sp.detectSpike([{ start: "", end: "", total: 0, negative: 0 }, { start: "", end: "", total: 0, negative: 0 }, { start: "", end: "", total: 0, negative: 0 }, { start: "", end: "", total: 3, negative: 0 }], sp.DEFAULT_SPIKE_SETTINGS);
  assert.equal(tiny.triggered, false);

  // Coverage: windows before complete data are dropped → not ready (first fetch is never a spike).
  const early = sp.bucketize(rows, now, 24, 14, new Date(now.getTime() - 30 * H));
  assert.equal(early.length, 1);
  assert.equal(sp.detectSpike(early, sp.DEFAULT_SPIKE_SETTINGS).ready, false);
  assert.equal(sp.zScore(5, [0, 0, 0]).sd, 1);
});

test("dashboard aggregations and tokenization", () => {
  const base = { author_followers: null, author_handle: null, language: "en", intent: "other", title: "" };
  const rows = [
    { ...base, id: "1", topic_id: "a", source: "news", author: "Reuters", body: "Acme outage hits customers", published_at: "2026-09-27T10:00:00.000Z", sentiment: "negative" },
    { ...base, id: "2", topic_id: "a", source: "mastodon", author: "Jo", author_followers: 100, body: "Acme outage again, customers angry", published_at: "2026-09-28T10:00:00.000Z", sentiment: "negative" },
    { ...base, id: "3", topic_id: "b", source: "news", author: "Reuters", body: "Beta launches great product", published_at: "2026-09-28T11:00:00.000Z", sentiment: "positive" },
  ];
  const topics = [{ id: "a", name: "Acme", kind: "brand", keywords: ["acme"] }, { id: "b", name: "Beta", kind: "competitor", keywords: ["beta"] }];
  const sum = a.summary(rows);
  assert.equal(sum.mentions, 3);
  assert.equal(Math.round(sum.netSentiment!), -33);
  assert.equal(sum.reach, 100);
  const sov = a.shareOfVoice(rows, topics);
  assert.equal(sov[0].name, "Acme");
  assert.equal(Math.round(sov[0].share! * 100), 67);
  const trend = a.dailyTrend(rows, a.days("2026-09-28T23:00:00Z", 2));
  assert.deepEqual(trend.map((t) => t.mentions), [1, 2]);
  const terms = a.topTerms(rows, topics);
  assert.equal(terms[0].term, "customers");
  assert.ok(!terms.some((t) => t.term === "acme"));
  assert.equal(terms.find((t) => t.term === "outage")?.tone, "negative");
  assert.deepEqual(a.tokenize("The Acme's app https://x.y is 2026 BROKEN!"), ["acme", "app", "broken"]);
  assert.equal(a.topAuthors(rows).byMentions[0].author, "Reuters");
  assert.equal(a.delta(12, 3, 10), null);
});
