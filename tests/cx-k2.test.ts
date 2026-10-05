import assert from "node:assert/strict";
import { test } from "node:test";

/** WP-K2 monitor streams: media taxonomy, URL filter parsing, card text, card mapping (src/lib/cx/ops/model.ts, src/lib/cx/inbox/stream.ts). */
const m = await import("../src/lib/cx/ops/model");
const s = await import("../src/lib/cx/inbox/stream");
const { MEDIA_SQL, MENTION_MEDIA_SQL } = await import("../src/lib/cx/ops/media");

// ---------------------------------------------------------------- media taxonomy
test("Konnect media types come first, in the product's order", () => {
  const konnect = m.MEDIA_TYPES.filter((x) => x.konnect).map((x) => x.label);
  assert.deepEqual(konnect, [
    "News", "Blogs", "Other - Web", "Twitter Public Tweets", "Twitter Mentions", "Facebook Public Posts", "Facebook Tag Posts", "Facebook Inbox", "Facebook Comments",
    "YouTube", "Instagram", "Instagram Messages", "Instagram Comments", "LinkedIn Comments", "Google Business Reviews", "Instagram Tag Posts", "Instagram Mentions", "LinkedIn Mentions",
  ]);
  const firstOther = m.MEDIA_TYPES.findIndex((x) => !x.konnect);
  assert.ok(m.MEDIA_TYPES.slice(firstOther).every((x) => !x.konnect));
  assert.equal(new Set(m.MEDIA_TYPES.map((x) => x.id)).size, m.MEDIA_TYPES.length);
});

test("mediaTypeOf: channel kind + thread key + thread label", () => {
  const t = (channel_kind: string, external_thread_id: string | null = null, extra: Record<string, unknown> = {}) => m.mediaTypeOf({ channel_kind, external_thread_id, channel_id: "ch1", ...extra });
  assert.equal(t("facebook"), "facebook_messages");
  assert.equal(t("facebook", "fbc:1_2"), "facebook_comments");
  assert.equal(t("facebook", "fbr:9"), "facebook_reviews");
  assert.equal(t("facebook", "fbp:1_2", { subject: "Post on your Page: hello" }), "facebook_posts");
  assert.equal(t("facebook", "fbp:1_2", { subject: "Mentioned your Page in a post: hi" }), "facebook_tags");
  assert.equal(t("instagram"), "instagram_messages");
  assert.equal(t("instagram", "igc:5"), "instagram_comments");
  assert.equal(t("instagram", "igm:5:"), "instagram_mentions");
  assert.equal(t("instagram", "igt:5"), "instagram_tags");
  assert.equal(t("linkedin", "lic|urn:li:share:1|urn:li:comment:2"), "linkedin_comments");
  assert.equal(t("linkedin", "lip|urn:li:share:1"), "linkedin_mentions");
  assert.equal(t("x"), "x");
  assert.equal(t("google-reviews"), "google_reviews");
  assert.equal(t("hackernews"), "forums");
  assert.equal(t("email"), "email");
});

test("tickets created from listening mentions follow the mention source", () => {
  const l = (channel_kind: string, external_thread_id: string | null = null) => m.mediaTypeOf({ channel_kind, external_thread_id, channel_id: null });
  assert.equal(l("x", "1789"), "x_public");
  assert.equal(l("news", "https://example.com/a"), "news");
  assert.equal(l("facebook", "123"), "facebook_posts");
  assert.equal(l("instagram", "abc"), "instagram");
  assert.equal(l("youtube", "vid"), "youtube");
  assert.equal(l("appstore", "r1"), "app_reviews");
  // own-profile thread keys win even without a channel id
  assert.equal(l("instagram", "igc:7"), "instagram_comments");
  // manual tickets (no channel, not a listening kind) keep their kind
  assert.equal(l("phone"), "phone");
  assert.equal(m.mentionMediaType("rss"), "blogs");
  assert.equal(m.mentionMediaType("somewhere"), "web");
  assert.equal(m.mentionMediaType("hackernews"), "forums");
});

test("every produced media type is known, labelled and has a network; SQL mirrors list the same ids", () => {
  const kinds = ["email", "livechat", "webform", "phone", "whatsapp", "x", "linkedin", "youtube", "news", "reddit", "mastodon", "bluesky", "telegram", "discord", "discourse", "appstore", "playstore", "facebook", "instagram", "google-reviews", "hackernews", "nope"];
  for (const k of kinds) for (const channel_id of ["c", null]) {
    const id = m.mediaTypeOf({ channel_kind: k, channel_id });
    assert.ok(m.MEDIA_TYPES.some((x) => x.id === id), `${k}/${channel_id} → ${id}`);
    assert.notEqual(m.mediaLabel(id), id.replace(/_/g, " "), id === "other" ? "" : id);
    assert.ok(m.mediaNetwork(id));
  }
  for (const id of ["x_public", "facebook_tags", "facebook_reviews", "linkedin_comments", "linkedin_mentions", "instagram", "blogs", "web"]) assert.ok(MEDIA_SQL.includes(`'${id}'`), id);
  for (const id of ["news", "blogs", "x_public", "facebook_posts", "instagram", "linkedin_mentions", "youtube", "forums", "app_reviews", "google_reviews", "web"]) assert.ok(MENTION_MEDIA_SQL.includes(`'${id}'`), id);
});

test("channel-profile badge, public vs private, legacy media ids", () => {
  assert.equal(m.profileBadge("instagram_mentions", "PU IG"), "INSTAGRAM MENTIONS ( PU IG )");
  assert.equal(m.profileBadge("facebook_comments", "Brand FB"), "FACEBOOK COMMENTS ( Brand FB )");
  assert.equal(m.profileBadge("x_public", null), "TWITTER PUBLIC TWEETS");
  assert.equal(m.isPublicMedia("instagram_comments"), true);
  assert.equal(m.isPublicMedia("instagram_messages"), false);
  assert.equal(m.isPublicMedia("email"), false);
  assert.deepEqual(m.parseMediaParam("linkedin,news"), ["linkedin_comments", "linkedin_mentions", "news"]);
});

// ---------------------------------------------------------------- URL filters
test("parseDate / dmy / rangeLabel", () => {
  assert.equal(s.parseDate("2026-09-29"), "2026-09-29");
  assert.equal(s.parseDate("29/09/2026"), "2026-09-29");
  assert.equal(s.parseDate("5.10.2026"), "2026-10-05");
  assert.equal(s.parseDate("31/02/2026"), undefined);
  assert.equal(s.parseDate("2026-13-01"), undefined);
  assert.equal(s.parseDate("yesterday"), undefined);
  assert.equal(s.dmy("2026-10-05"), "05/10/2026");
  assert.equal(s.rangeLabel("2026-09-29", "2026-10-05"), "29/09/2026 - 05/10/2026");
  assert.equal(s.rangeLabel(undefined, undefined), "");
});

test("parseStreamFilters validates and normalises the query string", () => {
  const f = s.parseStreamFilters({ from: "05/10/2026", to: "29/09/2026", media: "news,bogus,instagram", sort: "oldest", sentiment: "NEGATIVE", priority: "nope", lang: "HI", attach: "1", page: "3", direction: "note", kind: "mention", q: "  #fees  " });
  assert.equal(f.from, "2026-09-29"); // swapped into order
  assert.equal(f.to, "2026-10-05");
  assert.deepEqual(f.media, ["news", "instagram"]);
  assert.equal(f.sort, "oldest");
  assert.equal(f.sentiment, "negative");
  assert.equal(f.priority, undefined);
  assert.equal(f.lang, "hi");
  assert.equal(f.attach, true);
  assert.equal(f.page, 3);
  assert.equal(f.direction, "note");
  assert.equal(f.kind, "mention");
  assert.equal(f.q, "#fees");
  const d = s.parseStreamFilters({});
  assert.equal(d.sort, "latest");
  assert.equal(d.page, 1);
  assert.deepEqual(d.media, []);
  assert.equal(s.parseStreamFilters({ page: "-4", sort: "x;drop" }).page, 1);
  assert.equal(s.parseStreamFilters({ sort: "x;drop" }).sort, "latest");
  assert.equal(s.moreFilterCount({ sentiment: "positive", attach: true, kind: "message" }), 3);
});

test("patchQuery, toggleListValue, presets", () => {
  assert.equal(s.patchQuery("brand=b&page=4&media=news", { media: null }), "?brand=b");
  assert.equal(s.patchQuery("brand=b", { page: "2" }), "?brand=b&page=2");
  assert.equal(s.toggleListValue(["news"], "blogs"), "news,blogs");
  assert.equal(s.toggleListValue(["news"], "news"), null);
  const now = new Date(2026, 9, 5, 12);
  assert.deepEqual(s.presetRange("7", now), { from: "2026-09-29", to: "2026-10-05" });
  assert.deepEqual(s.presetRange("lastmonth", now), { from: "2026-09-01", to: "2026-09-30" });
  assert.equal(s.matchPreset("2026-09-29", "2026-10-05", now), "7");
  assert.equal(s.matchPreset("2026-09-28", "2026-10-05", now), "custom");
  assert.equal(s.matchPreset(undefined, undefined, now), "");
});

test("profile keys and TICKET STATUS buckets", () => {
  assert.equal(s.profileKeyOf("c1", "t1", "x"), "ch:c1");
  assert.equal(s.profileKeyOf(null, "t1", "x"), "topic:t1");
  assert.equal(s.profileKeyOf(null, null, "news"), "kind:news");
  assert.deepEqual(s.profilePatch("topic:t1"), { profile: null, topic: "t1", channel: null });
  assert.equal(s.selectedProfileKey({ channel: "news" }), "kind:news");
  const b = s.statusBuckets({ new: 2, open: 3, assigned: 1, wip: 1, responded: 4, closed: 5, ignored: 1 });
  assert.deepEqual(b.map((x) => [x.label, x.n]), [["Opened", 5], ["Assigned", 2], ["Responded", 4], ["Closed", 6]]);
  assert.ok(s.statusBuckets({ solved: 2 }).some((x) => x.label === "Resolved" && x.n === 2));
  assert.equal(s.sameStatusList("wip,assigned", "assigned,wip"), true);
});

// ---------------------------------------------------------------- card text
test("richSegments finds links, #hashtags and @handles", () => {
  const seg = s.richSegments("Campus evenings #eveningvibes #fun with @brand_ig see https://example.com/p?x=1 #123 done");
  assert.deepEqual(seg.filter((x) => x.kind === "hashtag").map((x) => x.tag), ["eveningvibes", "fun"]);
  assert.deepEqual(seg.filter((x) => x.kind === "handle").map((x) => x.tag), ["brand_ig"]);
  assert.deepEqual(seg.filter((x) => x.kind === "link").map((x) => x.href), ["https://example.com/p?x=1"]);
  assert.equal(seg.map((x) => x.text).join(""), "Campus evenings #eveningvibes #fun with @brand_ig see https://example.com/p?x=1 #123 done");
  assert.ok(!seg.some((x) => x.kind === "hashtag" && x.tag === "123"));
  // no hashtag inside a URL fragment, emails are not handles
  const s2 = s.richSegments("mail a@b.com or https://x.com/#tag");
  assert.ok(!s2.some((x) => x.kind === "hashtag" || x.kind === "handle"));
  // Devanagari hashtags
  assert.deepEqual(s.richSegments("नमस्ते #गणपति").filter((x) => x.kind === "hashtag").map((x) => x.tag), ["गणपति"]);
});

test("needsClamp", () => {
  assert.equal(s.needsClamp("short"), false);
  assert.equal(s.needsClamp("a\nb\nc\nd"), true);
  assert.equal(s.needsClamp("x".repeat(400)), true);
  assert.equal(s.needsClamp(""), false);
});

// ---------------------------------------------------------------- cards
const row = (over: Partial<Parameters<typeof s.ticketCard>[0]> = {}): Parameters<typeof s.ticketCard>[0] => ({
  id: "t1", number: 42, subject: "Comment on your Page post: hello", status: "open", priority: "normal", channel_kind: "facebook", channel_id: "c1", channel_name: "Brand FB",
  contact_name: "A. Customer", contact_email: null, contact_handle: "a_customer", assignee_id: null, assignee_name: null, sentiment: "positive",
  last_body: "Thanks!", last_direction: "in", last_at: "2026-10-05T10:00:00.000Z", updated_at: "2026-10-05T10:00:00.000Z", messages: 3, crm_status: "open", media_type: "facebook_comments",
  first_body: "Hello #brand\n\nComment on your Page post: https://www.facebook.com/1_2", first_at: "2026-10-05T02:00:00.000Z", post_key: "fb:1_2", post_url: null, post_tickets: 3,
  bookmarked: false, tasks_open: 0, parent_id: null, children: 0, first_response_due: null, resolution_due: null, first_response_at: null, resolved_at: null,
  last_attachments: [{ url: "https://cdn.example/x.jpg", type: "image" }, { type: "image" }], first_attachments: [], mention_url: null, ...over,
});

test("ticketCard: first conversation, thread footer, badge data, related, original link", () => {
  const c = s.ticketCard(row());
  assert.equal(c.kind, "ticket");
  assert.equal(c.handle, "@a_customer");
  assert.equal(c.network, "facebook");
  assert.equal(c.isPublic, true);
  assert.equal(c.first?.body, "Hello #brand"); // "<label>: <link>" footer removed
  assert.equal(c.url, "https://www.facebook.com/1_2");
  assert.equal(c.related, 2);
  assert.equal(c.media.length, 1); // attachments without URL are skipped
  assert.equal(c.realtime, true);
  assert.equal(c.profileKey, "ch:c1");
  // single-message ticket: no FIRST CONVERSATION
  assert.equal(s.ticketCard(row({ messages: 1 })).first, null);
  assert.equal(s.ticketCard(row({ first_at: "2026-10-05T10:00:00.000Z" })).first, null);
  // DM: Reply, not Comment
  assert.equal(s.ticketCard(row({ media_type: "instagram_messages", channel_kind: "instagram" })).isPublic, false);
  // queued variant data
  assert.deepEqual(s.ticketCard(row(), { queued: { assigned: true, position: null } }).queued, { assigned: true, position: null });
});

test("messageCard and mentionCard", () => {
  const mc = s.messageCard({
    id: "m2", ticket_id: "t1", number: 42, subject: "s", direction: "in", author_name: "A. Customer", body: "Second", attachments: [], created_at: "2026-10-05T10:00:00.000Z",
    channel_kind: "instagram", channel_id: null, channel_name: null, topic_id: "tp1", topic_name: "Brand topic", media_type: "instagram", contact_handle: "a", crm_status: "open", sentiment: null, bookmarked: true,
    first_body: "First", first_at: "2026-10-04T10:00:00.000Z", first_id: "m1", messages: 2,
  });
  assert.equal(mc.first?.body, "First");
  assert.equal(mc.profile, "Brand topic");
  assert.equal(mc.profileKey, "topic:tp1");
  assert.equal(mc.bookmarked, true);
  const first = s.messageCard({ ...({} as Parameters<typeof s.messageCard>[0]), id: "m1", ticket_id: "t1", number: 1, subject: "", direction: "in", author_name: "", body: "x", attachments: null, created_at: "2026-10-05T10:00:00.000Z", channel_kind: "email", channel_id: "c", channel_name: "Support", media_type: "email", contact_handle: null, crm_status: "open", sentiment: null, bookmarked: false, first_body: "x", first_at: null, first_id: "m1", messages: 1 });
  assert.equal(first.first, null);
  assert.equal(first.author, "Unknown");
  const n = s.mentionCard({ id: "n1", source: "news", url: "https://news.example/a", author: "Daily", author_handle: null, title: "Headline", body: "Headline and more", published_at: null, fetched_at: "2026-10-05T09:00:00.000Z", sentiment: "negative", status: "new", topic_id: null, topic_name: null, ticket_id: null, media_type: "news" });
  assert.equal(n.kind, "mention");
  assert.equal(n.at, "2026-10-05T09:00:00.000Z");
  assert.equal(n.body, "Headline and more"); // a body that repeats the title is not prefixed with it again
  assert.equal(n.profileKey, "kind:news");
  assert.equal(n.ticketId, null);
});

test("cardFacets, filterCards, sortCards", () => {
  const a = s.ticketCard(row({ id: "a", last_at: "2026-10-01T00:00:00.000Z" }));
  const b = s.ticketCard(row({ id: "b", media_type: "email", channel_kind: "email", channel_id: "c2", channel_name: "Support", last_at: "2026-10-04T00:00:00.000Z", sentiment: "negative", assignee_id: "u1" }));
  const f = s.cardFacets([a, b, a]);
  assert.deepEqual(f.media, [{ id: "facebook_comments", n: 2 }, { id: "email", n: 1 }]);
  assert.equal(f.profiles[0].name, "Brand FB");
  assert.equal(f.total, 3);
  assert.deepEqual(s.filterCards([a, b], { media: ["email"] }).map((c) => c.ticketId), ["b"]);
  assert.deepEqual(s.filterCards([a, b], { profile: "c1" }).map((c) => c.ticketId), ["a"]);
  assert.deepEqual(s.filterCards([a, b], { from: "2026-10-02" }).map((c) => c.ticketId), ["b"]);
  assert.deepEqual(s.filterCards([a, b], { assignee: "none" }).map((c) => c.ticketId), ["a"]);
  assert.deepEqual(s.filterCards([a, b], { media: ["email"] }, { skip: ["media"] }).length, 2);
  assert.deepEqual(s.sortCards([a, b]).map((c) => c.ticketId), ["b", "a"]);
  assert.deepEqual(s.sortCards([a, b], "oldest").map((c) => c.ticketId), ["a", "b"]);
});

test("ticketHref is the stable One Ticket View URL", () => {
  assert.equal(s.ticketHref("brand-1", "t 1"), "/cx/ticket/t%201?brand=brand-1");
  assert.equal(s.ticketHref("b", "t", { act: "compose" }), "/cx/ticket/t?brand=b&act=compose");
});
