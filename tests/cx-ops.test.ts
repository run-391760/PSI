import assert from "node:assert/strict";
import { test } from "node:test";

/** WP-B operational modules: pure helpers in src/lib/cx/ops/model.ts (+ the A/B and tracker model suites). */
const m = await import("../src/lib/cx/ops/model");
const inbox = await import("../src/lib/cx/inbox/model");
const schema = await import("../src/lib/schema/cx-ops");

// ---------------------------------------------------------------- schema
test("cx-ops schema: idempotent SQL with ADD COLUMN IF NOT EXISTS for every column", () => {
  const sql = schema.cxOpsSchema;
  for (const t of ["cx_ops_profile_groups", "cx_ops_bookmarks", "cx_ops_tasks", "cx_ops_task_events", "cx_ops_ticket_posts", "cx_ops_tracked", "cx_ops_ab_tests", "cx_ops_user_prefs"]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${t} \\(`));
    assert.match(sql, new RegExp(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS`));
  }
  // ALTERs never add a NOT NULL column without a default (would fail on tables with rows)
  for (const line of sql.split("\n").filter((l) => l.startsWith("ALTER TABLE"))) {
    if (/NOT NULL/.test(line)) assert.match(line, /DEFAULT/, line);
  }
  assert.ok(!/CREATE TABLE(?! IF NOT EXISTS)/.test(sql));
  assert.ok(!/CREATE (UNIQUE )?INDEX(?! IF NOT EXISTS)/.test(sql));
});

// ---------------------------------------------------------------- media types
test("mediaTypeOf maps channel kind + Meta thread key to Konnect-style media types", () => {
  assert.equal(m.mediaTypeOf({ channel_kind: "email" }), "email");
  assert.equal(m.mediaTypeOf({ channel_kind: "facebook", external_thread_id: "fbc:123_456" }), "facebook_comments");
  assert.equal(m.mediaTypeOf({ channel_kind: "facebook", external_thread_id: "fbp:99_1" }), "facebook_posts");
  assert.equal(m.mediaTypeOf({ channel_kind: "facebook", external_thread_id: null }), "facebook_messages");
  assert.equal(m.mediaTypeOf({ channel_kind: "instagram", external_thread_id: "igc:1" }), "instagram_comments");
  assert.equal(m.mediaTypeOf({ channel_kind: "instagram", external_thread_id: "igm:5:" }), "instagram_mentions");
  assert.equal(m.mediaTypeOf({ channel_kind: "instagram", external_thread_id: "igt:5" }), "instagram_tags");
  assert.equal(m.mediaTypeOf({ channel_kind: "instagram" }), "instagram_messages");
  assert.equal(m.mediaTypeOf({ channel_kind: "hackernews" }), "forums");
  assert.equal(m.mediaTypeOf({ channel_kind: "playstore" }), "app_reviews");
  assert.equal(m.mediaTypeOf({ channel_kind: "google-reviews" }), "google_reviews");
  assert.equal(m.mediaTypeOf({ channel_kind: "carrier-pigeon" }), "other");
  // every produced id is a known media type with a label
  for (const k of ["email", "livechat", "webform", "phone", "whatsapp", "x", "linkedin", "youtube", "news", "reddit", "mastodon", "bluesky", "telegram", "discord", "discourse", "appstore"])
    assert.ok(m.MEDIA_TYPES.some((t) => t.id === m.mediaTypeOf({ channel_kind: k })), k);
});
test("MEDIA_SQL mirrors mediaTypeOf (same kinds listed)", async () => {
  // media.ts imports the DB module lazily only inside functions, so importing it is safe.
  const { MEDIA_SQL } = await import("../src/lib/cx/ops/media");
  for (const id of ["facebook_comments", "facebook_posts", "facebook_messages", "instagram_comments", "instagram_mentions", "instagram_tags", "instagram_messages", "forums", "app_reviews", "google_reviews", "other"])
    assert.ok(MEDIA_SQL.includes(`'${id}'`), id);
});
test("profileBadge and parseMediaParam", () => {
  assert.equal(m.profileBadge("instagram_messages", "PU IG"), "INSTAGRAM MESSAGES ( PU IG )");
  assert.equal(m.profileBadge("facebook_comments", "PU FB"), "FACEBOOK COMMENTS ( PU FB )");
  assert.equal(m.profileBadge("webform", null), "WEB FORM");
  assert.deepEqual(m.parseMediaParam("email, facebook_comments,bogus,email"), ["email", "facebook_comments"]);
  assert.deepEqual(m.parseMediaParam(undefined), []);
});

// ---------------------------------------------------------------- post keys
test("normalizePostUrl canonicalises post URLs per platform", () => {
  assert.equal(m.normalizePostUrl("https://www.reddit.com/r/india/comments/abc123/some_title/def456/?utm=1"), "reddit.com/comments/abc123");
  assert.equal(m.normalizePostUrl("https://old.reddit.com/r/india/comments/ABC123/"), "reddit.com/comments/abc123");
  assert.equal(m.normalizePostUrl("https://news.ycombinator.com/item?id=4242&p=2"), "news.ycombinator.com/item?id=4242");
  assert.equal(m.normalizePostUrl("https://youtu.be/xyz"), "youtube.com/watch?v=xyz");
  assert.equal(m.normalizePostUrl("https://m.youtube.com/watch?v=xyz&t=10"), "youtube.com/watch?v=xyz");
  assert.equal(m.normalizePostUrl("https://www.instagram.com/reel/Cx9/?igsh=1"), "instagram.com/p/Cx9");
  assert.equal(m.normalizePostUrl("https://example.com/blog/post/#comments"), "example.com/blog/post");
  assert.equal(m.normalizePostUrl("not a url"), null);
  assert.equal(m.normalizePostUrl("ftp://x.com/a"), null);
});
test("postKeyOf: mention URL, Meta thread keys and links in the first message", () => {
  assert.deepEqual(m.postKeyOf({ mentionUrl: "https://news.ycombinator.com/item?id=1", externalThreadId: "hn-1" }), { key: "url:news.ycombinator.com/item?id=1", url: "https://news.ycombinator.com/item?id=1" });
  assert.deepEqual(m.postKeyOf({ externalThreadId: "fbp:111_222" }), { key: "fb:111_222", url: "https://www.facebook.com/111_222" });
  assert.equal(m.postKeyOf({ externalThreadId: "igm:777:888", firstBody: "hi" })?.key, "ig:777");
  assert.equal(m.postKeyOf({ externalThreadId: "igt:555" })?.key, "ig:555");
  // Page comment threads: the post link appended to the first message identifies the post
  const a = m.postKeyOf({ externalThreadId: "fbc:222_9", firstBody: "Nice!\n\nComment on your Page post: https://www.facebook.com/111_222" });
  const b = m.postKeyOf({ externalThreadId: "fbc:222_10", firstBody: "Bad service\n\nComment on your Page post: https://www.facebook.com/111_222" });
  assert.equal(a?.key, "fb:111_222");
  assert.equal(a?.key, b?.key); // two comment threads on the same post share a key
  assert.equal(m.postKeyOf({ externalThreadId: "fbc:222_9" })?.key, "fbc-post:222");
  assert.equal(m.postKeyOf({ externalThreadId: "igc:1", firstBody: "no link" }), null);
  assert.equal(m.postKeyOf({ externalThreadId: null, firstBody: "email body https://facebook.com/1" }), null); // not a social thread
});

// ---------------------------------------------------------------- profile groups
test("cleanGroup validates names, known profiles and sources", () => {
  const known = { channelIds: ["c1", "c2"], sources: ["news", "reddit"] as const };
  assert.deepEqual(m.cleanGroup({ name: "  PU   Overall ", channelIds: ["c1", "c1", "x"], sources: ["news", "bogus"] }, known), { ok: true, value: { name: "PU Overall", description: "", channelIds: ["c1"], sources: ["news"], isDefault: false } });
  assert.equal(m.cleanGroup({ name: "", channelIds: ["c1"], sources: [] }, known).ok, false);
  const r = m.cleanGroup({ name: "Empty", channelIds: ["zzz"], sources: [] }, known);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /at least one/);
});

// ---------------------------------------------------------------- tasks
test("taskDueState and taskReminderDue", () => {
  const now = Date.parse("2026-10-04T12:00:00Z");
  assert.equal(m.taskDueState({ status: "done", due_at: "2026-10-01T00:00:00Z" }, now), "done");
  assert.equal(m.taskDueState({ status: "open", due_at: null }, now), "none");
  assert.equal(m.taskDueState({ status: "open", due_at: "2026-10-04T11:00:00Z" }, now), "overdue");
  assert.equal(m.taskDueState({ status: "open", due_at: "2026-10-12T11:00:00Z" }, now), "later");
  const r = { status: "open", due_at: "2026-10-04T13:00:00Z", remind_minutes: 60, reminded_at: null };
  assert.equal(m.taskReminderDue(r, now), true); // exactly 60 min before
  assert.equal(m.taskReminderDue({ ...r, remind_minutes: 15 }, now), false);
  assert.equal(m.taskReminderDue({ ...r, reminded_at: "2026-10-04T11:59:00Z" }, now), false);
  assert.equal(m.taskReminderDue({ ...r, status: "cancelled" }, now), false);
  assert.equal(m.taskReminderDue({ ...r, due_at: null }, now), false);
});
test("taskInputError", () => {
  assert.equal(m.taskInputError({ title: "Call back" }), null);
  assert.match(m.taskInputError({ title: "  " })!, /title/);
  assert.match(m.taskInputError({ title: "x", status: "wip" })!, /status/);
  assert.match(m.taskInputError({ title: "x", priority: "p0" })!, /priority/);
  assert.match(m.taskInputError({ title: "x", dueAt: "tomorrow-ish" })!, /due/);
  assert.match(m.taskInputError({ title: "x", remindMinutes: -5 })!, /reminder/);
  assert.equal(m.taskStatusLabel("in_progress"), "In progress");
});

// ---------------------------------------------------------------- A/B winner rule
test("abWinner: minimum clicks, binomial z-test, lift", () => {
  const o = { minClicks: 30, confidence: 0.95 };
  assert.equal(m.abWinner(0, 0, o).winner, null);
  assert.match(m.abWinner(0, 0, o).reason, /No tracked clicks/);
  const few = m.abWinner(25, 5, o);
  assert.equal(few.winner, null);
  assert.equal(few.leader, "a");
  assert.match(few.reason, /at least 30/);
  const close = m.abWinner(52, 48, o);
  assert.equal(close.winner, null);
  assert.equal(close.significant, false);
  const clear = m.abWinner(80, 40, o); // z = 40/sqrt(120) = 3.65
  assert.equal(clear.winner, "a");
  assert.ok(clear.z > 3.6 && clear.z < 3.7);
  assert.equal(Math.round(clear.lift!), 100);
  assert.equal(m.abWinner(40, 80, o).winner, "b");
  assert.equal(m.abWinner(60, 60, o).leader, null);
  assert.equal(m.zFor(0.95), 1.96);
  assert.ok(Math.abs(m.zFor(0.97) - 2.17) < 0.01);
});

// ---------------------------------------------------------------- Mentions Tracker
test("trackerMatches finds @handles and links to tracked posts; responseState", () => {
  const tracked = [
    { id: "1", kind: "handle" as const, platform: "x", value: "@ParulUniversity", label: "" },
    { id: "2", kind: "post" as const, platform: "reddit", value: "https://www.reddit.com/r/gujarat/comments/abc1/admissions/", label: "" },
  ];
  assert.deepEqual(m.trackerMatches({ body: "Thanks @paruluniversity for the help!" }, tracked).map((t) => t.id), ["1"]);
  assert.deepEqual(m.trackerMatches({ body: "@paruluniversityfans is a different account" }, tracked), []);
  assert.deepEqual(m.trackerMatches({ url: "https://old.reddit.com/r/gujarat/comments/abc1/admissions/xyz9/" }, tracked).map((t) => t.id), ["2"]);
  assert.equal(m.normHandle("https://x.com/@Acme/"), "acme");
  assert.equal(m.responseState({ status: "new" }), "pending");
  assert.equal(m.responseState({ status: "ignored", ticket_id: "t" }), "ignored");
  assert.equal(m.responseState({ status: "actioned", ticket_id: "t", ticket_first_response_at: null, ticket_status: "open" }), "in_progress");
  assert.equal(m.responseState({ status: "actioned", ticket_id: "t", ticket_first_response_at: "2026-10-01T00:00:00Z" }), "responded");
  assert.equal(m.responseState({ status: "actioned" }), "responded");
});

// ---------------------------------------------------------------- compose, search, prefs, plan
test("composeCap: only email can start conversations here", () => {
  assert.equal(m.composeCap("email").canStart, true);
  for (const k of ["whatsapp", "facebook", "instagram", "x", "livechat", "webform", "telegram"]) assert.equal(m.composeCap(k).canStart, false, k);
  assert.equal(m.composeCap("unknown").canStart, false);
});
test("quick search: field terms routed per entity, snippets", () => {
  const { terms, text } = inbox.parseSearch('refund email:riya@x.com sentiment:negative status:open -tag:spam');
  assert.equal(text, "refund");
  const s = m.searchScopes(terms);
  assert.deepEqual(s.contacts.map((t) => t.field), ["email"]);
  assert.deepEqual(s.mentions.map((t) => t.field), ["sentiment"]);
  assert.deepEqual(s.tasks.map((t) => t.field), ["status"]);
  assert.equal(m.snippet("The quick brown fox jumps over the lazy dog", "fox", 15), "…brown fox jumps…");
  assert.equal(m.snippet("short", "zzz"), "short");
});
test("notification prefs, month series, sizes, wait labels", () => {
  assert.deepEqual(m.normNotify({ taskDue: false, junk: 1 } as never), { ...m.DEFAULT_NOTIFY, taskDue: false });
  const series = m.monthSeries([{ month: "2026-09", n: 4 }, { month: "2026-01", n: 9 }], 3, new Date("2026-10-04T00:00:00Z"));
  assert.deepEqual(series, [{ month: "2026-08", n: 0 }, { month: "2026-09", n: 4 }, { month: "2026-10", n: 0 }]);
  assert.equal(m.fmtBytes(512), "512 B");
  assert.equal(m.fmtBytes(1536), "1.5 KB");
  assert.equal(m.fmtBytes(null), "n/a");
  assert.equal(m.waitLabel(4 * 60_000), "4m");
  assert.equal(m.waitLabel(125 * 60_000), "2h 05m");
  assert.equal(m.waitLabel(-1), "n/a");
});

// ---------------------------------------------------------------- inbox prefs extension (card view)
test("inbox prefs: card view mode and filter panel state are sanitized", () => {
  assert.equal(inbox.normPrefs({}).mode, "cards"); // WP-K2: Konnect "Ticket view" (cards) is the default
  assert.equal(inbox.normPrefs({ mode: "cards" }).mode, "cards");
  assert.equal(inbox.normPrefs({ mode: "weird" as "cards" }).mode, "split");
  assert.equal(inbox.normPrefs({}).panel, true);
  assert.equal(inbox.normPrefs({ panel: false }).panel, false);
});

// Sub-module fixture suites (A/B testing, Mentions Tracker) run with this file.
await import("./cx-ops-ab.test");
await import("./cx-ops-tracker.test");
