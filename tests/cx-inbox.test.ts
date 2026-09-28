import assert from "node:assert/strict";
import { test } from "node:test";
import { createHmac } from "node:crypto";

const th = await import("../src/lib/cx/inbox/threading");
const rules = await import("../src/lib/cx/inbox/rules");
const sla = await import("../src/lib/cx/inbox/sla");
const wh = await import("../src/lib/cx/inbox/webhooks");

// ---------------------------------------------------------------- email threading
const candidates = [
  { id: "t1", number: 7, subject: "Order 4411 not delivered", contactEmail: "ana@example.com", status: "open", updatedAt: "2026-09-20T10:00:00.000Z" },
  { id: "t2", number: 8, subject: "Invoice question", contactEmail: "bob@example.org", status: "closed", updatedAt: "2026-09-25T10:00:00.000Z" },
  { id: "t3", number: 9, subject: "Invoice question", contactEmail: "bob@example.org", status: "solved", updatedAt: "2026-09-10T10:00:00.000Z" },
];
const known = { "abc123@mail.example.com": "t1", "reply-7@synapse.local": "t1" };
const now = new Date("2026-09-28T12:00:00Z");

test("normalizeSubject strips reply/forward prefixes and ticket tags", () => {
  assert.equal(th.normalizeSubject("RE: Fwd: AW:  Order 4411 not delivered [#7]"), "order 4411 not delivered");
  assert.equal(th.normalizeSubject("Re[2]: Hello"), "hello");
  assert.equal(th.replySubject("Re: Order 4411 [#7]", 7), "Re: Order 4411 [#7]");
});

test("parseMessageIds reads angle-bracketed ids and lowercases them", () => {
  assert.deepEqual(th.parseMessageIds("<ABC123@mail.example.com>\r\n <x@y.z>"), ["abc123@mail.example.com", "x@y.z"]);
  assert.deepEqual(th.parseMessageIds(["<a@b>", "<a@b>"]), ["a@b"]);
});

test("threads by References / In-Reply-To first (including our own reply ids)", () => {
  assert.deepEqual(th.resolveThread({ inReplyTo: "<reply-7@synapse.local>", subject: "totally different" }, known, candidates, now), { ticketId: "t1", by: "references" });
  assert.deepEqual(th.resolveThread({ references: "<zzz@q> <ABC123@mail.example.com>", subject: "x" }, known, candidates, now)?.by, "references");
});

test("threads by [#n] ticket tag, then by subject + sender within the window", () => {
  assert.deepEqual(th.resolveThread({ subject: "Re: anything [#9]", fromEmail: "z@z.z" }, {}, candidates, now), { ticketId: "t3", by: "ticket-tag" });
  assert.deepEqual(th.resolveThread({ subject: "Re: Order 4411 not delivered", fromEmail: "ANA@example.com" }, {}, candidates, now), { ticketId: "t1", by: "subject" });
  // closed tickets and other senders never match by subject; solved ones outside the 14-day window neither
  assert.equal(th.resolveThread({ subject: "Invoice question", fromEmail: "bob@example.org" }, {}, candidates, now), null);
  assert.equal(th.resolveThread({ subject: "Order 4411 not delivered", fromEmail: "eve@example.com" }, {}, candidates, now), null);
});

test("stripQuoted removes quoted history", () => {
  const body = "Thanks, that worked!\n\nOn Mon, 21 Sep 2026 at 10:00, Support <help@acme.com> wrote:\n> Please try again\n> Regards";
  assert.equal(th.stripQuoted(body), "Thanks, that worked!");
});

// ---------------------------------------------------------------- rules
const R = (r: Partial<import("../src/lib/cx/inbox/rules").Rule>) => ({ id: "r", kind: "route" as const, name: "", position: 0, active: true, match: "all" as const, conditions: [], actions: {}, ...r });
const ctx = { channel: "email", subject: "Refund please", body: "I want to cancel my order, it arrived broken.", intent: "cancellation", sentiment: "negative", language: "en", email: "ana@bigcorp.com" };

test("conditions: is/is_not lists, phrase contains, email domain", () => {
  assert.ok(rules.matchCondition({ field: "channel", op: "is", value: "email, livechat" }, ctx));
  assert.ok(!rules.matchCondition({ field: "channel", op: "is_not", value: "email" }, ctx));
  assert.ok(rules.matchCondition({ field: "keyword", op: "contains", value: "broken, damaged" }, ctx));
  assert.ok(!rules.matchCondition({ field: "keyword", op: "contains", value: "roken" }, ctx), "phrase must start at a word boundary");
  assert.ok(rules.matchCondition({ field: "email_domain", op: "is", value: "bigcorp.com" }, ctx));
  assert.ok(rules.matchCondition({ field: "subject", op: "not_contains", value: "invoice" }, ctx));
});

test("route rules: first match by position wins; tag rules all apply; inactive ignored", () => {
  const set = [
    R({ id: "late", position: 2, conditions: [{ field: "sentiment", op: "is", value: "negative" }], actions: { team: "Care", priority: "high" } }),
    R({ id: "first", position: 1, match: "any", conditions: [{ field: "intent", op: "is", value: "cancellation" }, { field: "language", op: "is", value: "hi" }], actions: { team: "Retention", assignee: "u1", tags: ["Churn"] } }),
    R({ id: "off", position: 0, active: false, conditions: [{ field: "channel", op: "is", value: "email" }], actions: { team: "Nope" } }),
    R({ id: "tag1", kind: "tag", conditions: [{ field: "keyword", op: "contains", value: "refund" }], actions: { tags: ["refund", "churn"] } }),
    R({ id: "tag2", kind: "tag", conditions: [{ field: "keyword", op: "contains", value: "invoice" }], actions: { tags: ["billing"] } }),
  ];
  const r = rules.evaluateRules(set, ctx);
  assert.deepEqual(r.matched, ["first", "tag1"]);
  assert.equal(r.actions.team, "Retention");
  assert.equal(r.actions.assignee, "u1");
  assert.equal(r.actions.priority, null);
  assert.deepEqual(r.actions.tags, ["churn", "refund"]);
  assert.equal(rules.matchRule(R({ conditions: [] }), ctx), false, "a rule without conditions never matches");
});

// ---------------------------------------------------------------- SLA
test("withDefaults: policy targets are independent; 1h/24h only when the priority has no policy", () => {
  const from = "2026-09-28T10:00:00.000Z";
  assert.deepEqual(sla.withDefaults({ firstResponseMinutes: null, resolutionMinutes: null, firstResponseDue: null, resolutionDue: null }, from), { firstResponseDue: "2026-09-28T11:00:00.000Z", resolutionDue: "2026-09-29T10:00:00.000Z", source: "default" });
  const onlyResolution = sla.withDefaults({ firstResponseMinutes: null, resolutionMinutes: 480, firstResponseDue: null, resolutionDue: new Date("2026-09-28T18:00:00Z") }, from);
  assert.deepEqual(onlyResolution, { firstResponseDue: null, resolutionDue: "2026-09-28T18:00:00.000Z", source: "policy" });
  // business-hours dues computed by the SLA settings module are kept as given
  const bh = sla.withDefaults({ firstResponseMinutes: 30, resolutionMinutes: 600, firstResponseDue: "2026-09-29T09:30:00.000Z", resolutionDue: "2026-09-30T11:00:00.000Z" }, from);
  assert.equal(bh.firstResponseDue, "2026-09-29T09:30:00.000Z");
  assert.deepEqual(sla.dueDates(from, sla.DEFAULT_SLA), { firstResponseDue: "2026-09-28T11:00:00.000Z", resolutionDue: "2026-09-29T10:00:00.000Z" });
});

test("slaStatus: running, breached, met, paused", () => {
  const base = { status: "open", first_response_due: "2026-09-28T11:00:00.000Z", resolution_due: "2026-09-29T10:00:00.000Z", first_response_at: null, resolved_at: null };
  const s1 = sla.slaStatus(base, new Date("2026-09-28T10:30:00Z"));
  assert.equal(s1.firstResponse.state, "running");
  assert.equal(s1.firstResponse.remainingMs, 30 * 60_000);
  const s2 = sla.slaStatus(base, new Date("2026-09-28T12:00:00Z"));
  assert.deepEqual(s2.breached, ["first_response"]);
  const s3 = sla.slaStatus({ ...base, first_response_at: "2026-09-28T10:20:00.000Z", status: "solved", resolved_at: "2026-09-30T00:00:00.000Z" }, new Date("2026-10-01T00:00:00Z"));
  assert.equal(s3.firstResponse.state, "met");
  assert.equal(s3.resolution.state, "breached");
  const s4 = sla.slaStatus({ ...base, status: "solved" }, new Date("2026-09-28T12:00:00Z"));
  assert.equal(s4.firstResponse.state, "n/a");
  assert.equal(s4.resolution.state, "paused");
  assert.equal(sla.formatSpan(-(3 * 3600_000 + 5 * 60_000)), "3h 5m");
  assert.equal(sla.formatSpan(52 * 3600_000), "2d 4h");
  assert.equal(sla.formatSpan(20_000), "<1m");
  const noTarget = sla.slaStatus({ ...base, first_response_due: null }, new Date("2026-09-28T12:00:00Z"));
  assert.equal(noTarget.firstResponse.state, "n/a");
});

// ---------------------------------------------------------------- webhooks
test("WhatsApp Cloud API webhook → inbound messages", () => {
  const body = { object: "whatsapp_business_account", entry: [{ id: "WABA", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { display_phone_number: "15550001111", phone_number_id: "PN1" }, contacts: [{ profile: { name: "Ravi" }, wa_id: "919800000000" }], messages: [
    { from: "919800000000", id: "wamid.A", timestamp: "1790000000", type: "text", text: { body: "Hi, my order is late" } },
    { from: "919800000000", id: "wamid.B", timestamp: "1790000010", type: "image", image: { id: "MEDIA1", caption: "photo" } },
  ] } }] }] };
  const m = wh.mapWhatsApp(body);
  assert.equal(m.length, 2);
  assert.deepEqual([m[0].senderName, m[0].accountId, m[0].text, m[0].messageId], ["Ravi", "PN1", "Hi, my order is late", "wamid.A"]);
  assert.deepEqual(m[1].attachments, [{ type: "image", id: "MEDIA1" }]);
  assert.equal(m[0].timestamp, new Date(1790000000 * 1000).toISOString());
  assert.deepEqual(wh.mapWhatsApp({ object: "page" }), []);
});

test("Meta Messenger / Instagram webhook → inbound messages (echoes skipped) and signature check", () => {
  const body = { object: "instagram", entry: [{ id: "IG1", time: 1790000000000, messaging: [
    { sender: { id: "U1" }, recipient: { id: "IG1" }, timestamp: 1790000000000, message: { mid: "m1", text: "Love it" } },
    { sender: { id: "IG1" }, recipient: { id: "U1" }, timestamp: 1790000000001, message: { mid: "m2", text: "thanks", is_echo: true } },
  ] }] };
  const m = wh.mapMeta(body);
  assert.equal(m.length, 1);
  assert.deepEqual([m[0].platform, m[0].accountId, m[0].senderId, m[0].text], ["instagram", "IG1", "U1", "Love it"]);
  const raw = JSON.stringify(body);
  const sig = "sha256=" + createHmac("sha256", "s3cret").update(raw).digest("hex");
  assert.ok(wh.verifyMetaSignature("s3cret", raw, sig));
  assert.ok(!wh.verifyMetaSignature("other", raw, sig));
  assert.ok(!wh.verifyMetaSignature("s3cret", raw, null));
});

test("Meta comments, visitor posts and mentions → threaded inbound items; own replies skipped", () => {
  const page = { object: "page", entry: [{ id: "P1", changes: [
    { field: "feed", value: { item: "comment", verb: "add", comment_id: "P1_c1", post_id: "P1_p1", parent_id: "P1_p1", from: { id: "U1", name: "Asha" }, message: "When do admissions open?", created_time: 1790000000 } },
    { field: "feed", value: { item: "comment", verb: "add", comment_id: "P1_c2", post_id: "P1_p1", parent_id: "P1_c1", from: { id: "U2", name: "Ravi" }, message: "Same question" } },
    { field: "feed", value: { item: "comment", verb: "add", comment_id: "P1_c3", post_id: "P1_p1", parent_id: "P1_c1", from: { id: "P1", name: "Page" }, message: "Our reply" } },
    { field: "feed", value: { item: "comment", verb: "edited", comment_id: "P1_c1", post_id: "P1_p1", from: { id: "U1" }, message: "edit" } },
    { field: "feed", value: { item: "status", verb: "add", post_id: "P1_p9", from: { id: "U3", name: "Neha" }, message: "Visitor post" } },
    { field: "mention", value: { item: "post", verb: "add", post_id: "X_p5", sender_id: "U4", sender_name: "Dev", message: "Great campus @Page" } },
  ] }] };
  const r = wh.mapMetaChanges(page);
  assert.deepEqual(r.items.map((i) => [i.messageId, i.thread?.key, i.senderName]), [
    ["P1_c1", "fbc:P1_c1", "Asha"], ["P1_c2", "fbc:P1_c1", "Ravi"], ["P1_p9", "fbp:P1_p9", "Neha"], ["X_p5", "fbp:X_p5", "Dev"],
  ]);
  assert.equal(r.items[0].timestamp, new Date(1790000000 * 1000).toISOString());
  const ig = { object: "instagram", entry: [{ id: "IG1", time: 1790000000, changes: [
    { field: "comments", value: { id: "c9", text: "Fees?", from: { id: "IGU1", username: "asha" }, media: { id: "m1", media_product_type: "REELS" } } },
    { field: "comments", value: { id: "c10", parent_id: "c9", text: "thanks", from: { id: "IG1", username: "brand" }, media: { id: "m1" } } },
    { field: "mentions", value: { media_id: "m7", comment_id: "c77" } },
    { field: "mentions", value: { media_id: "m8" } },
  ] }] };
  const g = wh.mapMetaChanges(ig);
  assert.deepEqual(g.items.map((i) => [i.messageId, i.thread?.key, i.thread?.label, i.senderName]), [["c9", "igc:c9", "Comment on your reel", "@asha"]]);
  assert.deepEqual(g.mentions, [{ accountId: "IG1", mediaId: "m7", commentId: "c77" }, { accountId: "IG1", mediaId: "m8", commentId: null }]);
  assert.deepEqual(wh.parseMetaThread("igm:m7:c77"), { kind: "igm", id: "m7", commentId: "c77" });
  assert.deepEqual(wh.parseMetaThread("igm:m8:"), { kind: "igm", id: "m8", commentId: null });
  assert.equal(wh.parseMetaThread("<abc@mail>"), null);
  assert.deepEqual(wh.mapMetaChanges({ object: "whatsapp_business_account" }), { items: [], mentions: [] });
});
