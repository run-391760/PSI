import assert from "node:assert/strict";
import { test } from "node:test";

process.env.PGLITE_PATH ??= "memory://";
const pv = await import("../src/lib/cx/providers");
const ch = await import("../src/lib/cx/channels");
const ad = await import("../src/lib/cx/publishing/adapters");
const c = await import("../src/lib/cx/listening/connectors");
const s = await import("../src/lib/cx/listening/sources");

const acc = (externalId: string, token: string | null = null) => ({ externalId, token });

test("Publishing creds: account token, then the inbox channel token for the same account, then env", () => {
  const env = { META_PAGE_ID: "P-ENV", META_PAGE_ACCESS_TOKEN: "ENV-TOK" };
  // Env only: unchanged behaviour.
  assert.deepEqual(pv.pickPubCreds("facebook", null, [], env), { externalId: "P-ENV", token: "ENV-TOK", via: "env" });
  assert.deepEqual(pv.pickPubCreds("facebook", acc("P1"), [], env), { externalId: "P1", token: "ENV-TOK", via: "env" });
  assert.equal(pv.pickPubCreds("facebook", null, [], {}), null);
  // Account token wins.
  assert.deepEqual(pv.pickPubCreds("facebook", acc("P1", "ACC"), [acc("P1", "INBOX")], env), { externalId: "P1", token: "ACC", via: "account" });
  // No account token: the inbox channel token of the same Page, never another Page's.
  assert.deepEqual(pv.pickPubCreds("facebook", acc("P1"), [acc("P2", "OTHER"), acc("P1", "INBOX")], env), { externalId: "P1", token: "INBOX", via: "inbox" });
  assert.deepEqual(pv.pickPubCreds("facebook", acc("P1"), [acc("P2", "OTHER")], {}), null);
  // No Publishing account at all: the brand's inbox channel is enough (no second paste).
  assert.deepEqual(pv.pickPubCreds("instagram", null, [acc("IG1", "INBOX")], {}), { externalId: "IG1", token: "INBOX", via: "inbox" });
  // LinkedIn: inbox token, else LINKEDIN_ACCESS_TOKEN; client id/secret are never needed.
  assert.deepEqual(pv.pickPubCreds("linkedin", acc("urn:li:organization:1"), [acc("urn:li:organization:1", "LI")], {}), { externalId: "urn:li:organization:1", token: "LI", via: "inbox" });
  assert.deepEqual(pv.pickPubCreds("linkedin", acc("urn:li:organization:1"), [], { LINKEDIN_ACCESS_TOKEN: "LIENV" }), { externalId: "urn:li:organization:1", token: "LIENV", via: "env" });
});

test("X and YouTube insights fall back to app-level keys", () => {
  // X: user token first, else the app-only bearer (insights only).
  assert.deepEqual(pv.pickPubCreds("x", acc("42", "USER"), [], { X_BEARER_TOKEN: "APP" }), { externalId: "42", token: "USER", via: "account" });
  assert.deepEqual(pv.pickPubCreds("x", acc("42"), [], { X_BEARER_TOKEN: "APP" }), { externalId: "42", token: "APP", via: "app" });
  assert.deepEqual(pv.pickPubCreds("x", null, [], { X_USER_ID: "7", X_USER_ACCESS_TOKEN: "U", X_BEARER_TOKEN: "APP" }), { externalId: "7", token: "U", via: "env" });
  assert.equal(pv.pickPubCreds("x", null, [], { X_BEARER_TOKEN: "APP" }), null); // no account to read
  // YouTube: YOUTUBE_API_KEY first (unchanged), else the brand's stored OAuth token; always needs the channel id.
  assert.deepEqual(pv.pickPubCreds("youtube", acc("UCx", "ya29.tok"), [], { YOUTUBE_API_KEY: "AIzaKEY" }), { externalId: "UCx", token: "AIzaKEY", via: "app" });
  assert.deepEqual(pv.pickPubCreds("youtube", acc("UCx", "ya29.tok"), [], {}), { externalId: "UCx", token: "ya29.tok", via: "account" });
  assert.equal(pv.pickPubCreds("youtube", acc("UCx"), [], {}), null);
  assert.equal(pv.pickPubCreds("youtube", null, [], { YOUTUBE_API_KEY: "AIzaKEY" }), null);
  assert.equal(ad.isGoogleApiKey("AIzaSyA1234567890abcdefghijklmnopqrstuv"), true);
  assert.equal(ad.isGoogleApiKey("ya29.a0AfH6SMB"), false);
});

test("Inbox token: own → Publishing token for the same account → env (Meta Page-scoped)", () => {
  assert.equal(pv.pickInboxToken("facebook", "OWN", "P1", acc("P1", "PUB"), { META_PAGE_ACCESS_TOKEN: "ENV" }), "OWN");
  assert.equal(pv.pickInboxToken("facebook", null, "P1", acc("P1", "PUB"), { META_PAGE_ACCESS_TOKEN: "ENV" }), "PUB");
  assert.equal(pv.pickInboxToken("facebook", null, "P1", acc("P2", "PUB"), { META_PAGE_ACCESS_TOKEN: "ENV" }), "ENV");
  // A Page token belongs to one Page: skip it when META_PAGE_ID names a different Page.
  assert.equal(pv.pickInboxToken("facebook", null, "P1", null, { META_PAGE_ID: "P9", META_PAGE_ACCESS_TOKEN: "ENV" }), null);
  assert.equal(pv.pickInboxToken("facebook", null, "P1", null, { META_PAGE_ID: "P1", META_PAGE_ACCESS_TOKEN: "ENV" }), "ENV");
  assert.equal(pv.pickInboxToken("instagram", null, "IG1", null, { INSTAGRAM_USER_ID: "IG2", META_PAGE_ACCESS_TOKEN: "ENV" }), null);
  // LinkedIn member tokens can manage several organizations: no scoping (same as before).
  assert.equal(pv.pickInboxToken("linkedin", null, "urn:li:organization:1", null, { LINKEDIN_AUTHOR_URN: "urn:li:organization:2", LINKEDIN_ACCESS_TOKEN: "LI" }), "LI");
  assert.equal(pv.pickInboxToken("linkedin", null, "urn:li:organization:1", null, {}), null);
});

test("WhatsApp replies use the channel's phone number id, else WHATSAPP_PHONE_NUMBER_ID", () => {
  const env = { WHATSAPP_TOKEN: "T", WHATSAPP_PHONE_NUMBER_ID: "100" };
  assert.deepEqual(pv.pickWhatsAppSender(null, env), { phoneId: "100", token: "T" });
  assert.deepEqual(pv.pickWhatsAppSender({ phoneId: "200", token: null }, env), { phoneId: "200", token: "T" });
  assert.deepEqual(pv.pickWhatsAppSender({ phoneId: "200", token: "CH" }, env), { phoneId: "200", token: "CH" });
  assert.deepEqual(pv.pickWhatsAppSender({ phoneId: "200", token: null }, { WHATSAPP_TOKEN: "T" }), { phoneId: "200", token: "T" });
  assert.equal(pv.pickWhatsAppSender({ phoneId: null, token: null }, { WHATSAPP_TOKEN: "T" }), null);
  assert.equal(pv.pickWhatsAppSender(null, { WHATSAPP_PHONE_NUMBER_ID: "100" }), null);
});

test("readiness: Meta and LinkedIn need no app keys; news follows ENABLE_NEWS_MENTIONS; one Graph version", () => {
  const saved = { ...process.env };
  try {
    for (const k of ["META_APP_ID", "META_APP_SECRET", "LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET", "META_GRAPH_VERSION", "ENABLE_NEWS_MENTIONS"]) delete process.env[k];
    assert.equal(pv.channelAvailable("facebook"), true);
    assert.equal(pv.channelAvailable("instagram"), true);
    assert.equal(pv.channelAvailable("linkedin"), true);
    assert.equal(pv.channelAvailable("news"), true);
    process.env.ENABLE_NEWS_MENTIONS = "false";
    assert.equal(pv.channelAvailable("news"), false);
    assert.equal(ch.metaGraphUrl(), "https://graph.facebook.com/v23.0");
    process.env.META_GRAPH_VERSION = "v24.0";
    assert.equal(ch.metaGraphUrl(), "https://graph.facebook.com/v24.0");
    assert.match(ad.facebookFeedRequest({ externalId: "1", token: "t" }, { text: "hi", firstComment: "", link: null, media: [] }).url, /graph\.facebook\.com\/v24\.0\/1\/feed$/);
  } finally {
    process.env = saved;
  }
});

test("Google reviews (SEO Local) → listening mentions", () => {
  assert.ok(s.isListenSource("google-reviews"));
  assert.equal(s.sourceLabel("google-reviews"), "Google reviews");
  assert.equal(s.STRICT_MATCH["google-reviews"], false);
  const url = c.googlePlaceUrl({ placeId: "ChIJ123", cid: "999" });
  assert.equal(url, "https://www.google.com/maps/place/?q=place_id:ChIJ123");
  assert.equal(c.googlePlaceUrl({ placeId: null, cid: "999" }), "https://maps.google.com/?cid=999");
  assert.equal(c.googlePlaceUrl(null), null);
  const m = c.mapGoogleReviews(
    [
      { id: "r1", author: "Asha", rating: 5, date: "2026-09-01", text: "Great service", ownerReply: { body: "Thanks!", date: "2026-09-02" } },
      { id: "r2", author: "", rating: 2, date: "2026-08-20", text: "", ownerReply: null },
    ],
    { name: "Acme Cafe", url },
  );
  assert.equal(m.length, 2);
  assert.deepEqual(
    { source: m[0].source, externalId: m[0].externalId, author: m[0].author, title: m[0].title, body: m[0].body, url: m[0].url, publishedAt: m[0].publishedAt, engagement: m[0].engagement },
    { source: "google-reviews", externalId: "review:r1", author: "Asha", title: "5★ Google review of Acme Cafe", body: "Great service", url, publishedAt: "2026-09-01T00:00:00.000Z", engagement: { rating: 5, replied: 1 } },
  );
  // Rating-only reviews keep a title so they are not dropped as empty text.
  assert.equal(m[1].author, "Google user");
  assert.equal(m[1].title, "2★ Google review of Acme Cafe");
  assert.deepEqual(m[1].engagement, { rating: 2, replied: 0 });
});

test("Google reviews are only fetched for brand topics, and skipped quietly without a brand", async () => {
  const none = await c.fetchSource("google-reviews", { keywords: ["acme"], excluded: [], appIds: [], country: "US", language: "en", topicKind: "competitor" });
  assert.deepEqual(none, []);
  assert.deepEqual(await c.fetchSource("google-reviews", { keywords: ["acme"], excluded: [], appIds: [], country: "US", language: "en", topicKind: "brand" }), []);
  assert.deepEqual(await c.fetchSource("google-reviews", { keywords: ["acme"], excluded: [], appIds: [], country: "US", language: "en" }), []);
});
