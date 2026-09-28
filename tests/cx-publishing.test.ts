import assert from "node:assert/strict";
import { test } from "node:test";

const core = await import("../src/lib/cx/publishing/core");
const ad = await import("../src/lib/cx/publishing/adapters");

const creds = { externalId: "1234567890", token: "TOKEN" };

test("UTM builder keeps existing params, overwrites utm_*, skips blanks, rejects non-http", () => {
  const u = core.buildUtmUrl("https://example.com/p?a=1&utm_source=old#top", { source: "x", medium: "social", campaign: "Autumn launch", term: " ", content: "" });
  const p = new URL(u);
  assert.equal(p.searchParams.get("a"), "1");
  assert.equal(p.searchParams.get("utm_source"), "x");
  assert.equal(p.searchParams.get("utm_campaign"), "Autumn launch");
  assert.equal(p.searchParams.has("utm_term"), false);
  assert.equal(p.hash, "#top");
  assert.throws(() => core.buildUtmUrl("javascript:alert(1)", {}));
  assert.throws(() => core.buildUtmUrl("example.com", {}));
});

test("short codes, devices and referrers", () => {
  const code = core.shortCode(new Uint8Array([0, 1, 2, 3, 55, 56, 200]));
  assert.equal(code.length, 7);
  assert.ok(core.isShortCode(code));
  assert.equal(core.isShortCode("../etc"), false);
  assert.equal(core.shortCode(new Uint8Array([0, 1, 2, 3, 55, 56, 200])), code);
  assert.equal(core.deviceOf("facebookexternalhit/1.1"), "bot");
  assert.equal(core.deviceOf("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148"), "mobile");
  assert.equal(core.deviceOf("Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)"), "tablet");
  assert.equal(core.deviceOf("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Chrome/130"), "desktop");
  assert.equal(core.referrerHost("https://www.linkedin.com/feed/"), "linkedin.com");
  assert.equal(core.referrerHost("not a url"), null);
});

test("text rendering, X character counting and channel validation", () => {
  const text = core.renderText("Read the guide {link}", { x: "Short take: {link} #seo" }, "x", (k) => `https://s.example/l/${k}`);
  assert.equal(text, "Short take: https://s.example/l/x #seo");
  assert.equal(core.renderText("Read the guide {link}", {}, "linkedin", () => null), "Read the guide");
  assert.equal(core.countChars("hi https://a-very-long-domain.example/with/a/long/path?q=1", "x"), 3 + 23);
  assert.equal(core.countChars("héllo 👋", "facebook"), 7);
  assert.deepEqual(core.channelProblems("x".repeat(281), "x", 0), ["1 characters over the 280 limit."]);
  assert.deepEqual(core.channelProblems("Caption", "instagram", 0), ["Instagram needs an image or video."]);
  assert.equal(core.channelProblems(Array.from({ length: 31 }, (_, i) => `#t${i}`).join(" "), "instagram", 1).length, 1);
  assert.deepEqual(core.channelProblems("ok", "linkedin", 0), []);
});

test("scheduler: due logic, outcome status and schedule gate", () => {
  const now = new Date("2026-10-01T10:00:00Z");
  assert.equal(core.isDue({ status: "scheduled", scheduled_at: "2026-10-01T09:59:00Z" }, now), true);
  assert.equal(core.isDue({ status: "scheduled", scheduled_at: "2026-10-01T10:00:00Z" }, now), true);
  assert.equal(core.isDue({ status: "scheduled", scheduled_at: "2026-10-01T10:01:00Z" }, now), false);
  assert.equal(core.isDue({ status: "approved", scheduled_at: "2026-10-01T09:00:00Z" }, now), false);
  assert.equal(core.isDue({ status: "scheduled", scheduled_at: null }, now), false);
  const at = now.toISOString();
  assert.equal(core.outcomeStatus({ x: { status: "published", at }, linkedin: { status: "manual", at } }), "published");
  assert.equal(core.outcomeStatus({ x: { status: "published", at }, youtube: { status: "not_connected", at } }), "published");
  assert.equal(core.outcomeStatus({ x: { status: "published", at }, facebook: { status: "failed", at } }), "failed");
  assert.equal(core.outcomeStatus({ x: { status: "not_connected", at } }), "failed");
  assert.equal(core.scheduleTarget("draft", false), "scheduled");
  assert.deepEqual(core.scheduleTarget("draft", true), { error: "This brand requires approval: submit the post for approval first." });
  assert.equal(core.scheduleTarget("approved", true), "scheduled");
});

test("bulk CSV: quoting, time zones, channel aliases and row errors", () => {
  const csv = `date,time,channels,text,link,campaign,first_comment,media
2026-10-05,09:30,x|twitter;linkedin,"Guide is live, read it: {link}",https://example.com/g,Autumn,,a.jpg|b.png
2026-10-06,18:00,facebook,"He said ""hi""",,,"First!",
2026-09-01,10:00,x,Old,,,,
2026-10-07,10:00,tiktok,Nope,,,,
bad-date,10:00,x,Nope,,,,
2026-10-08,10:00,x,,,,,`;
  const now = new Date("2026-09-28T00:00:00Z");
  const { rows, errors } = core.parseBulkCsv(csv, -120, now); // browser at UTC+2
  assert.equal(rows.length, 2);
  assert.equal(rows[0].at, "2026-10-05T07:30:00.000Z");
  assert.deepEqual(rows[0].channels, ["x", "linkedin"]);
  assert.equal(rows[0].text, "Guide is live, read it: {link}");
  assert.deepEqual(rows[0].media, ["a.jpg", "b.png"]);
  assert.equal(rows[1].text, 'He said "hi"');
  assert.equal(rows[1].firstComment, "First!");
  assert.deepEqual(errors.map((e) => e.line), [4, 5, 6, 7]);
  assert.match(errors[1].error, /tiktok/);
});

test("adapter payloads: Facebook, Instagram, LinkedIn, X", () => {
  const input = { text: "Hello (world) #launch", firstComment: "", link: "https://s.example/l/abc", media: [] };
  const fb = ad.facebookFeedRequest(creds, input);
  assert.match(fb.url, /graph\.facebook\.com\/v\d+\.\d+\/1234567890\/feed$/);
  assert.deepEqual(fb.body, { message: input.text, access_token: "TOKEN", link: input.link });
  const fbMulti = ad.facebookFeedRequest(creds, input, ["p1", "p2"]);
  assert.deepEqual(fbMulti.body?.attached_media, [{ media_fbid: "p1" }, { media_fbid: "p2" }]);
  assert.equal(fbMulti.body?.link, undefined);
  assert.deepEqual(ad.facebookPhotoRequest(creds, "https://cdn/x.jpg", false).body, { url: "https://cdn/x.jpg", published: false, access_token: "TOKEN" });

  assert.deepEqual(ad.instagramContainerRequest(creds, { url: "https://cdn/a.jpg", kind: "image" }, "Cap").body, { access_token: "TOKEN", image_url: "https://cdn/a.jpg", caption: "Cap" });
  assert.deepEqual(ad.instagramContainerRequest(creds, { url: "https://cdn/v.mp4", kind: "video" }, "Cap").body, { access_token: "TOKEN", media_type: "REELS", video_url: "https://cdn/v.mp4", caption: "Cap" });
  assert.deepEqual(ad.instagramContainerRequest(creds, { url: "https://cdn/v.mp4", kind: "video" }, "", { carouselItem: true }).body, { access_token: "TOKEN", media_type: "VIDEO", video_url: "https://cdn/v.mp4", is_carousel_item: true });
  assert.deepEqual(ad.instagramContainerRequest(creds, null, "Cap", { children: ["c1", "c2"] }).body, { access_token: "TOKEN", media_type: "CAROUSEL", children: "c1,c2", caption: "Cap" });

  const li = ad.linkedinPostRequest({ externalId: "urn:li:organization:42", token: "T" }, input);
  assert.equal(li.url, "https://api.linkedin.com/rest/posts");
  assert.equal(li.headers?.["X-Restli-Protocol-Version"], "2.0.0");
  assert.equal(li.body?.author, "urn:li:organization:42");
  assert.equal(li.body?.commentary, "Hello \\(world\\) \\#launch");
  assert.deepEqual(li.body?.content, { article: { source: input.link, title: input.link } });
  assert.deepEqual(ad.linkedinPostRequest({ externalId: "urn:li:organization:42", token: "T" }, input, ["urn:li:image:1"]).body?.content, { media: { id: "urn:li:image:1" } });

  assert.deepEqual(ad.xTweetRequest(creds, "Hi", { mediaIds: ["1", "2", "3", "4", "5"], replyTo: "99" }).body, { text: "Hi", media: { media_ids: ["1", "2", "3", "4"] }, reply: { in_reply_to_tweet_id: "99" } });
  assert.equal(ad.xTweetRequest(creds, "Hi").headers?.authorization, "Bearer TOKEN");
});

test("API error messages", () => {
  assert.equal(ad.apiErrorMessage({ error: { message: "(#200) Permissions error", code: 200 } }, 403), "HTTP 403: (#200) Permissions error");
  assert.equal(ad.apiErrorMessage({ detail: "You are not permitted to perform this action." }, 403), "HTTP 403: You are not permitted to perform this action.");
  assert.equal(ad.apiErrorMessage({}, 500), "HTTP 500");
});

test("insights mapping: YouTube, Meta, X, LinkedIn", () => {
  const yt = ad.mapYoutube(
    { items: [{ id: "UCabc", snippet: { title: "Brand TV", customUrl: "@brandtv" }, statistics: { viewCount: "123456", subscriberCount: "7800", hiddenSubscriberCount: false, videoCount: "42" } }] },
    { items: [{ id: "vid1", snippet: { title: "Launch", publishedAt: "2026-09-20T10:00:00Z" }, statistics: { viewCount: "900", likeCount: "31" } }] },
  )!;
  assert.equal(yt.followers, 7800);
  assert.equal(yt.views, 123456);
  assert.equal(yt.posts, 42);
  assert.equal(yt.recent[0].url, "https://www.youtube.com/watch?v=vid1");
  assert.equal(yt.recent[0].comments, null); // hidden/missing stays n/a, not 0
  assert.equal(ad.mapYoutube({ items: [] }, {}), null);
  assert.equal(ad.mapYoutube({ items: [{ id: "UCx", snippet: {}, statistics: { hiddenSubscriberCount: true, subscriberCount: "100" } }] }, {})!.followers, null);

  const fb = ad.mapFacebook({ id: "1", name: "Brand", followers_count: 1500 }, { data: [{ id: "1_2", message: "Hi", created_time: "2026-09-01T00:00:00+0000", reactions: { summary: { total_count: 12 } }, comments: { summary: { total_count: 3 } } }] });
  assert.equal(fb.followers, 1500);
  assert.deepEqual([fb.recent[0].likes, fb.recent[0].comments, fb.recent[0].shares], [12, 3, 0]);

  const ig = ad.mapInstagram({ username: "brand", followers_count: 900, media_count: 55 }, { data: [{ id: "m1", caption: "Cap", like_count: 40, comments_count: 2, permalink: "https://www.instagram.com/p/x/" }] });
  assert.equal(ig.handle, "@brand");
  assert.equal(ig.recent[0].likes, 40);

  const x = ad.mapX({ data: { id: "1", name: "Brand", username: "brand", public_metrics: { followers_count: 321, tweet_count: 1000 } } }, { data: [{ id: "t1", text: "Hi", public_metrics: { impression_count: 500, like_count: 5, reply_count: 1, retweet_count: 2 } }] });
  assert.equal(x.followers, 321);
  assert.deepEqual([x.recent[0].views, x.recent[0].shares], [500, 2]);

  assert.equal(ad.mapLinkedIn("urn:li:organization:42", { firstDegreeSize: 2048 }).followers, 2048);
});
