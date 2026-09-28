import assert from "node:assert/strict";
import { test } from "node:test";

const q = await import("../src/lib/cx/admin/pure/queue");
const sla = await import("../src/lib/cx/admin/pure/sla");
const auto = await import("../src/lib/cx/admin/pure/automation");
const perm = await import("../src/lib/cx/admin/pure/permissions");
const wh = await import("../src/lib/cx/admin/pure/webhooks");
const fields = await import("../src/lib/cx/admin/pure/fields");
const pii = await import("../src/lib/cx/admin/pure/pii");
const alerts = await import("../src/lib/cx/admin/pure/alerts");
const conn = await import("../src/lib/cx/admin/pure/connectors");

const now = new Date("2026-09-28T10:00:00Z");
type A = import("../src/lib/cx/admin/pure/queue").QueueAgent;
const agent = (id: string, p: Partial<A> = {}): A => ({ id, status: "available", paused: false, load: 0, capacity: 5, lastAssignedAt: null, ...p });

// ---------------------------------------------------------------- queue assignment
test("round robin rotates in stable id order and skips paused / full / on-break agents", () => {
  const agents = [agent("c"), agent("a"), agent("b", { paused: true }), agent("d", { load: 5 }), agent("e", { status: "break" })];
  const r = q.distribute("round_robin", agents, [{ id: "t1" }, { id: "t2" }, { id: "t3" }], 0, now);
  assert.deepEqual(r.assignments.map((x) => x.agentId), ["a", "c", "a"]);
});

test("round robin one-by-one gives an agent a new ticket only when they have none open", () => {
  const r = q.distribute("rr_one_by_one", [agent("a"), agent("b", { load: 1 }), agent("c")], [{ id: "1" }, { id: "2" }, { id: "3" }], 0, now);
  assert.deepEqual(r.assignments.map((x) => x.agentId), ["a", "c"]);
});

test("availability round robin needs 'available' status and office hours in the agent's time zone", () => {
  const agents = [
    agent("a", { officeStart: "09:00", officeEnd: "18:00", timezone: "Asia/Kolkata" }), // 15:30 IST → in office
    agent("b", { officeStart: "09:00", officeEnd: "17:00", timezone: "America/New_York" }), // 06:00 EDT → out
    agent("c", { status: "break" }),
  ];
  assert.deepEqual(q.eligible("rr_availability", agents, now).map((a) => a.id), ["a"]);
  assert.equal(q.inOffice(now, "22:00", "06:00", "America/Los_Angeles"), true); // 03:00 PDT overnight window
});

test("equal load picks the least-loaded agent; priority is sticky to the previous agent", () => {
  const agents = [agent("a", { load: 3 }), agent("b", { load: 1 }), agent("c", { load: 1, lastAssignedAt: "2026-09-28T09:00:00Z" })];
  assert.equal(q.pickAgent("equal", agents, { cursor: 0, now }).agentId, "b");
  assert.equal(q.pickAgent("priority", agents, { cursor: 0, now, previousAgentId: "a" }).agentId, "a");
  assert.equal(q.pickAgent("priority", [agent("a", { status: "break" }), agent("b")], { cursor: 0, now, previousAgentId: "a" }).agentId, "b");
  assert.equal(q.pickAgent("equal", [agent("x", { paused: true })], { cursor: 0, now }).agentId, null);
});

test("segments, queue order, cleanup, breaks and the queue timer", () => {
  const segs = [{ id: "s1", name: "VIP", weight: 10, match: [{ field: "contact_tag" as const, values: ["VIP"] }] }, { id: "s2", name: "Partners", weight: 5, match: [{ field: "email_domain" as const, values: ["partner.com"] }] }];
  assert.equal(q.segmentFor(segs, { contactTags: ["vip"], email: null, channel: "email", priority: "normal" })?.name, "VIP");
  assert.equal(q.segmentFor(segs, { contactTags: [], email: "x@partner.com", channel: "email", priority: "normal" })?.name, "Partners");
  const ordered = q.orderQueue([
    { id: "1", segmentWeight: 0, priority: "urgent", due: null, created_at: "2026-09-28T08:00:00Z" },
    { id: "2", segmentWeight: 10, priority: "low", due: null, created_at: "2026-09-28T09:00:00Z" },
    { id: "3", segmentWeight: 0, priority: "urgent", due: "2026-09-28T10:30:00Z", created_at: "2026-09-28T09:30:00Z" },
  ]);
  assert.deepEqual(ordered.map((r) => r.id), ["2", "3", "1"]);
  assert.equal(q.cleanupDue("2026-09-28T09:40:00Z", null, 15, now), true);
  assert.equal(q.cleanupDue("2026-09-28T09:40:00Z", "2026-09-28T09:50:00Z", 15, now), false);
  assert.equal(q.breakOverrun("2026-09-28T09:20:00Z", 30, now), true);
  assert.equal(q.breakOverrun("2026-09-28T09:40:00Z", 30, now), false);
  assert.deepEqual(q.queueTimer("2026-09-28T09:55:00Z", 10, now), { minutes: 5, tone: "good" });
  assert.equal(q.queueTimer("2026-09-28T09:30:00Z", 10, now)?.tone, "critical");
});

// ---------------------------------------------------------------- SLA / TAT math
const rule = (p: Partial<import("../src/lib/cx/admin/pure/sla").SlaRule>) => ({ id: "r", name: "r", priority: null, channels: [], segment: null, team: null, first_response_minutes: 60, every_response_minutes: null, resolution_minutes: 480, business_hours: false, start_from: "created" as const, valid_from: null, valid_to: null, windows: [], active: true, position: 1, ...p });

test("SLA rule selection by channel, segment, date range and daily windows", () => {
  const rules = [
    rule({ id: "vip", segment: "VIP", position: 1 }),
    rule({ id: "chat", channels: ["livechat"], position: 2 }),
    rule({ id: "sale", valid_from: "2026-09-01", valid_to: "2026-09-30", windows: [{ start: "09:00", end: "12:00" }], position: 3 }),
    rule({ id: "night", windows: [{ start: "22:00", end: "06:00" }], position: 4 }),
  ];
  const t = { priority: "normal", channel: "email", segment: null, team: null };
  assert.equal(sla.selectSlaRule(rules, { ...t, segment: "VIP" }, now)?.id, "vip");
  assert.equal(sla.selectSlaRule(rules, { ...t, channel: "livechat" }, now)?.id, "chat");
  assert.equal(sla.selectSlaRule(rules, t, now)?.id, "sale");
  assert.equal(sla.selectSlaRule(rules, t, new Date("2026-09-28T23:00:00Z"))?.id, "night");
  assert.equal(sla.selectSlaRule(rules, t, new Date("2026-10-02T10:00:00Z")), null);
});

test("TAT start (publish vs queue assigned), due dates with business hours, HH:MM:SS", () => {
  assert.equal(sla.tatStart("2026-09-28T08:00:00Z", "2026-09-28T09:00:00Z", "queued").toISOString(), "2026-09-28T09:00:00.000Z");
  assert.equal(sla.tatStart("2026-09-28T08:00:00Z", null, "queued").toISOString(), "2026-09-28T08:00:00.000Z");
  const hours = { timezone: "UTC", holidays: [], hours: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, open: day >= 1 && day <= 5, start: "09:00", end: "17:00" })) };
  // Friday 16:00 + 120 business minutes → Monday 10:00
  const due = sla.ruleDueDates({ first_response_minutes: 120, resolution_minutes: null, business_hours: true }, new Date("2026-09-25T16:00:00Z"), hours);
  assert.equal(due.firstResponseDue, "2026-09-28T10:00:00.000Z");
  assert.equal(due.resolutionDue, null);
  assert.equal(sla.hms(3_723_000), "01:02:03");
});

test("every-response time (ERT) spans and next-response due", () => {
  const msgs = [
    { direction: "in" as const, created_at: "2026-09-28T08:00:00Z" },
    { direction: "in" as const, created_at: "2026-09-28T08:05:00Z" },
    { direction: "note" as const, created_at: "2026-09-28T08:06:00Z" },
    { direction: "out" as const, created_at: "2026-09-28T08:20:00Z" },
    { direction: "in" as const, created_at: "2026-09-28T09:00:00Z" },
  ];
  const r = sla.responseSpans(msgs);
  assert.deepEqual(r.spans, [20 * 60_000]);
  assert.equal(r.unansweredSince, "2026-09-28T09:00:00.000Z");
  assert.equal(sla.nextResponseDue(msgs, 30, null), "2026-09-28T09:30:00.000Z");
  assert.equal(sla.nextResponseDue(msgs.slice(0, 4), 30, null), null);
});

test("pre-breach tiers and escalation levels", () => {
  assert.deepEqual(sla.prebreachTiers("2026-09-28T09:00:00Z", "2026-09-28T10:20:00Z", [50, 75, 90], now), [50, 75]);
  assert.deepEqual(sla.prebreachTiers("2026-09-28T09:00:00Z", null, [50], now), []);
  const levels = [{ afterMinutes: 0, notifyUserIds: [], emails: [], reassignTo: null, priority: null }, { afterMinutes: 30, notifyUserIds: [], emails: ["boss@x.com"], reassignTo: null, priority: "urgent" }];
  assert.equal(sla.escalationLevel("2026-09-28T09:45:00Z", levels, now), 1);
  assert.equal(sla.escalationLevel("2026-09-28T09:00:00Z", levels, now), 2);
  assert.equal(sla.escalationLevel(null, levels, now), 0);
});

// ---------------------------------------------------------------- rule matching
const ctx = { channel: "email", subject: "Refund please", body: "My order 42 arrived broken, I want a refund!", intent: "complaint", sentiment: "negative", language: "en", email: "ana@shop.com", classificationLabels: ["billing", "refund"], fields: { order_type: "Prepaid" }, businessOpen: false, priority: "normal", segment: "VIP", contactTags: ["vip"] };
const mk = (id: string, conditions: import("../src/lib/cx/admin/pure/automation").AutoCondition[], actions: import("../src/lib/cx/admin/pure/automation").AutoActions, p: Partial<import("../src/lib/cx/admin/pure/automation").Automation> = {}) =>
  ({ id, name: id, trigger: "created" as const, social_type: "any", position: 1, active: true, stop: false, match: "all" as const, conditions, actions, ...p });

test("automation conditions: classification, fields, length, business hours, social type", () => {
  const m = (c: import("../src/lib/cx/admin/pure/automation").AutoCondition) => auto.matchAutoCondition(c, ctx);
  assert.equal(m({ field: "classification", op: "is", value: "Refund" }), true);
  assert.equal(m({ field: "field", key: "order_type", op: "is", value: "prepaid, cod" }), true);
  assert.equal(m({ field: "field", key: "missing", op: "empty", value: "" }), true);
  assert.equal(m({ field: "length", op: "gt", value: "20" }), true);
  assert.equal(m({ field: "length", op: "lte", value: "20" }), false);
  assert.equal(m({ field: "business_hours", op: "is", value: "closed" }), true);
  assert.equal(m({ field: "social_type", op: "is", value: "private" }), true);
  assert.equal(m({ field: "keyword", op: "contains", value: "refund" }), true);
  assert.equal(m({ field: "keyword", op: "not_contains", value: "invoice" }), true);
  assert.equal(auto.socialType("youtube"), "public");
});

test("automations apply in order, override single values, merge tags/fields, honour stop and trigger", () => {
  const list = [
    mk("a", [{ field: "sentiment", op: "is", value: "negative" }], { priority: "high", tags: ["angry"], fields: { a: "1" } }, { position: 1 }),
    mk("b", [{ field: "business_hours", op: "is", value: "closed" }], { reply: "We're closed, {{first_name}}.", status: "pending", tags: ["after-hours"], queue: true }, { position: 2, stop: true }),
    mk("c", [{ field: "intent", op: "is", value: "complaint" }], { priority: "urgent" }, { position: 3 }),
    mk("d", [{ field: "intent", op: "is", value: "complaint" }], { priority: "low" }, { position: 0, trigger: "customer_reply" }),
    mk("e", [{ field: "channel", op: "is", value: "email" }], { priority: "low" }, { position: 0, social_type: "public" }),
  ];
  const r = auto.evaluateAutomations(list, ctx, "created");
  assert.deepEqual(r.matched, ["a", "b"]);
  assert.equal(r.actions.priority, "high");
  assert.deepEqual(r.actions.tags, ["angry", "after-hours"]);
  assert.equal(r.actions.status, "pending");
  assert.equal(r.actions.queue, true);
  assert.equal(auto.renderTemplate(r.actions.reply!, { name: "Ana Silva", ticket: 7 }), "We're closed, Ana.");
  assert.equal(auto.renderTemplate("Order {{field.order_type}} {{ticket}}", { fields: { order_type: "COD" }, ticket: 3 }), "Order COD #3");
  assert.deepEqual(auto.evaluateAutomations(list, ctx, "customer_reply").matched, ["d"]);
});

// ---------------------------------------------------------------- permissions
test("permission checks: built-in roles, custom roles, admins keep everything", () => {
  const agentPerms = perm.effectivePermissions("agent", null);
  assert.equal(perm.hasPermission(agentPerms, "reply_public"), true);
  assert.equal(perm.hasPermission(agentPerms, "status:closed"), false);
  assert.equal(perm.hasPermission(agentPerms, "page:settings.roles"), false);
  const custom = { id: "r1", name: "Private only", pages: ["page:inbox", "page:nope"], actions: ["reply_private", "download_attachments", "bogus"] };
  const c = perm.effectivePermissions("agent", custom);
  assert.deepEqual([...c].sort(), ["download_attachments", "page:inbox", "reply_private"]);
  assert.equal(perm.hasPermission(perm.effectivePermissions("admin", custom), "page:settings.api"), true);
  assert.equal(perm.effectivePermissions(null, null).size, 0);
  assert.equal(perm.pagePermForPath("/cx/settings/queue"), "page:settings.queue");
  assert.equal(perm.pagePermForPath("/cx/crisis"), "page:listening");
  const imp = perm.parseUserImport([["Email", "Role", "Team"], ["A@x.com", "supervisor", "L1"], ["bad", "agent"], ["b@x.com", "Night shift"]], ["Night shift"]);
  assert.deepEqual(imp.rows.map((r) => [r.email, r.role, r.team, r.customRole]), [["a@x.com", "supervisor", "L1", null], ["b@x.com", "agent", null, "Night shift"]]);
  assert.equal(imp.errors.length, 1);
});

// ---------------------------------------------------------------- webhooks retry + API auth
test("webhook retry backoff gives up after 10 retries; signatures verify; unsafe URLs rejected", () => {
  assert.equal(wh.nextAttemptAt(1, now)?.toISOString(), "2026-09-28T10:01:00.000Z");
  assert.equal(wh.nextAttemptAt(10, now)?.toISOString(), "2026-09-28T18:00:00.000Z");
  assert.equal(wh.nextAttemptAt(11, now), null);
  assert.equal(wh.deliveredOk(204), true);
  assert.equal(wh.deliveredOk(500), false);
  const sig = wh.signPayload("s3cret", 1700000000, '{"a":1}');
  assert.equal(wh.verifySignature("s3cret", 1700000000, '{"a":1}', sig), true);
  assert.equal(wh.verifySignature("other", 1700000000, '{"a":1}', sig), false);
  assert.equal(wh.safeWebhookUrl("http://127.0.0.1:8080/x"), null);
  assert.equal(wh.safeWebhookUrl("https://10.2.3.4/x"), null);
  assert.equal(wh.safeWebhookUrl("ftp://example.com"), null);
  assert.equal(wh.safeWebhookUrl("https://hooks.example.com/cx"), "https://hooks.example.com/cx");
});

test("API auth: account token required, user token required for writes and must match the brand", () => {
  const acc = wh.newToken("account"), usr = wh.newToken("user"), other = wh.newToken("user");
  const db = new Map([
    [wh.tokenHash(acc), { id: "t1", project_id: "p1", user_id: null, kind: "account" as const, revoked: false }],
    [wh.tokenHash(usr), { id: "t2", project_id: "p1", user_id: "u1", kind: "user" as const, revoked: false }],
    [wh.tokenHash(other), { id: "t3", project_id: "p2", user_id: "u2", kind: "user" as const, revoked: false }],
  ]);
  const look = (h: string) => db.get(h);
  const hdr = (h: Record<string, string>) => (n: string) => h[n] ?? null;
  assert.equal(wh.authorize(wh.readTokens(hdr({})), look, false).ok, false);
  const r = wh.authorize(wh.readTokens(hdr({ authorization: `Bearer ${acc}` })), look, false);
  assert.equal(r.ok && r.projectId, "p1");
  const w = wh.authorize(wh.readTokens(hdr({ authorization: `Bearer ${acc}` })), look, true);
  assert.equal(!w.ok && w.status, 403);
  const w2 = wh.authorize(wh.readTokens(hdr({ authorization: `Bearer ${acc}`, "x-user-token": usr })), look, true);
  assert.equal(w2.ok && w2.userId, "u1");
  assert.equal(wh.authorize(wh.readTokens(hdr({ authorization: `Bearer ${acc}`, "x-user-token": other })), look, true).ok, false);
  assert.equal(wh.authorize(wh.readTokens(hdr({ authorization: `Bearer ${usr}` })), look, false).ok, false);
  assert.deepEqual(wh.matchApiRoute("POST", ["tickets", "abc", "classify"])?.params, { id: "abc" });
  assert.equal(wh.matchApiRoute("GET", ["tickets", "abc", "classify"]), null);
  assert.equal(wh.matchApiRoute("GET", ["queue", "active-users"])?.route.name, "activeUsers");
});

// ---------------------------------------------------------------- fields, PII, alerts, connectors
test("field validation, classification CSV round trip and selection chains", () => {
  const def = { label: "Account no", type: "text" as const, options: [], required: true, validation: { regex: "\\d{20}" } };
  assert.equal(fields.validateFieldValue(def, ""), "Account no is required.");
  assert.equal(fields.validateFieldValue(def, "1234"), "Account no has an invalid format.");
  assert.equal(fields.validateFieldValue(def, "12345678901234567890"), null);
  assert.match(fields.validateFieldValue({ label: "Plan", type: "select", options: ["Gold"], required: false, validation: null }, "Silver")!, /not an allowed option/);
  const rows = fields.parseClassificationCsv('Level 1,Level 2,Level 3,Sentiment,Hidden\nBilling,Refund,Delayed,negative,\n"Praise, general",,,positive,yes');
  assert.deepEqual(rows, [{ path: ["Billing", "Refund", "Delayed"], sentiment: "negative", hidden: false }, { path: ["Praise, general"], sentiment: "positive", hidden: true }]);
  const nodes = [
    { id: "1", parentId: null, label: "Billing", level: 1, sentiment: null, hidden: false },
    { id: "2", parentId: "1", label: "Refund", level: 2, sentiment: "negative" as const, hidden: false },
    { id: "3", parentId: "2", label: "Delayed", level: 3, sentiment: null, hidden: false },
  ];
  assert.deepEqual(fields.normalizeSelection(nodes, ["3"]), ["1", "2", "3"]);
  assert.equal(fields.selectionSentiment(nodes, ["1", "2", "3"]), "negative");
  assert.match(fields.classificationsToCsv(nodes), /Billing,Refund,Delayed/);
  assert.equal(fields.fieldKey("Order Number (#)"), "order_number");
});

test("PII masking and allowed email domains", () => {
  assert.equal(pii.maskEmail("ananya@example.com"), "a•••••@e•••.com");
  assert.equal(pii.maskPhone("+91 98765 43210"), "+••••••••••10");
  assert.doesNotMatch(pii.maskText("mail ana@x.io or call +1 415 555 0100"), /ana@x\.io|555/);
  assert.deepEqual(pii.normalizeDomains("@Partner.com, https://acme.io/path bad"), ["partner.com", "acme.io"]);
  assert.equal(pii.emailDomainAllowed("x@eu.partner.com", ["partner.com"]), true);
  assert.equal(pii.emailDomainAllowed("x@gmail.com", ["partner.com"]), false);
  assert.equal(pii.emailDomainAllowed("x@gmail.com", []), true);
});

test("alerts: matching, active hours, Telegram rate limit, payloads", () => {
  const f = { keywords: ["outage"], exclude: ["resolved"], channels: [], sentiments: ["negative"], priorities: [], minItems: 1 };
  const item = { id: "1", kind: "mention" as const, title: "Big outage", body: "site down", channel: "news", sentiment: "negative", priority: null, author: "x", url: "https://x", at: now.toISOString() };
  assert.equal(alerts.matchAlert(f, item), true);
  assert.equal(alerts.matchAlert(f, { ...item, body: "outage resolved" }), false);
  assert.equal(alerts.inActiveHours({ start: "09:00", end: "18:00", timezone: "Asia/Kolkata", days: [1] }, now), true);
  assert.equal(alerts.inActiveHours({ start: "09:00", end: "18:00", timezone: "Asia/Kolkata", days: [0] }, now), false);
  assert.equal(alerts.telegramAllowed("2026-09-28T09:55:00Z", now), false);
  assert.equal(alerts.readyToFire("2026-09-28T09:40:00Z", 15, now), true);
  assert.equal(alerts.slackPayload("Outages", [item]).blocks.length, 2);
  assert.match(alerts.alertCsv([item]), /mention,news,Big outage/);
  assert.equal(alerts.validSlackWebhook("https://hooks.slack.com/services/T0/B0/xyz"), true);
});

test("connectors map Discord, Discourse and Telegram payloads", () => {
  const d = conn.mapDiscordMessages([
    { id: "2", type: 0, content: "second", timestamp: "2026-09-28T09:01:00Z", author: { id: "u1", username: "ana" } },
    { id: "1", type: 0, content: "help!", timestamp: "2026-09-28T09:00:00Z", author: { id: "u1", username: "ana", global_name: "Ana" } },
    { id: "0", type: 0, content: "bot", timestamp: "2026-09-28T08:00:00Z", author: { id: "b", bot: true } },
  ], { guildId: "g", channelId: "c", channelName: "support" });
  assert.deepEqual(d.map((x) => x.externalId), ["1", "2"]);
  assert.equal(d[0].threadId, "discord:c:u1");
  const dc = conn.mapDiscoursePosts({ latest_posts: [{ id: 9, topic_id: 4, topic_slug: "login", topic_title: "Login fails", post_number: 2, post_type: 1, username: "bob", cooked: "<p>Still &amp; broken</p>", created_at: "2026-09-28T09:00:00Z" }, { id: 10, post_type: 1, staff: true, username: "mod", topic_id: 4 }] }, "https://forum.x.com/");
  assert.equal(dc.length, 1);
  assert.equal(dc[0].body, "Still & broken");
  assert.equal(dc[0].url, "https://forum.x.com/t/login/4/2");
  const tg = conn.mapTelegramUpdates({ ok: true, result: [{ update_id: 5, message: { message_id: 1, date: 1790000000, text: "hi", chat: { id: 77, type: "private" }, from: { id: 77, first_name: "Ravi" } } }, { update_id: 6, message: { message_id: 2, date: 1790000001, text: "x", chat: { id: 1 }, from: { is_bot: true } } }] });
  assert.equal(tg.nextOffset, 7);
  assert.equal(tg.items.length, 1);
  assert.equal(tg.items[0].threadId, "telegram:77");
});
