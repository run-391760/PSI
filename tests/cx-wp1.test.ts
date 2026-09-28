import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const m = await import("../src/lib/cx/inbox/model");
const x = await import("../src/lib/cx/inbox/xlsx");

// ---------------------------------------------------------------- CRM statuses (D1, D3)
test("toStored maps Konnect statuses onto core status + overlay", () => {
  assert.deepEqual(m.toStored("wip"), { status: "open", overlay: "wip" });
  assert.deepEqual(m.toStored("follow_up"), { status: "pending", overlay: "follow_up" });
  assert.deepEqual(m.toStored("ignored"), { status: "closed", overlay: "ignored" });
  assert.deepEqual(m.toStored("reopened"), { status: "open", overlay: "reopened" });
  assert.deepEqual(m.toStored("solved"), { status: "solved", overlay: null });
  assert.deepEqual(m.toStored("pending"), { status: "pending", overlay: null });
});
test("effectiveStatus: overlays only while the core status matches; derived Assigned / Responded", () => {
  assert.equal(m.effectiveStatus({ status: "open", overlay: "wip" }), "wip");
  assert.equal(m.effectiveStatus({ status: "solved", overlay: "wip" }), "solved"); // automation changed the core status
  assert.equal(m.effectiveStatus({ status: "pending", overlay: "follow_up" }), "follow_up");
  assert.equal(m.effectiveStatus({ status: "closed", overlay: "ignored" }), "ignored");
  assert.equal(m.effectiveStatus({ status: "open", overlay: null, last_direction: "out", assignee_id: "u1" }), "responded");
  assert.equal(m.effectiveStatus({ status: "open", overlay: null, last_direction: "in", assignee_id: "u1" }), "assigned");
  assert.equal(m.effectiveStatus({ status: "new", overlay: null, last_direction: "in" }), "new");
  assert.equal(m.crmLabel("follow_up"), "Follow-up");
  assert.equal(m.crmLabel("solved"), "Resolved");
  assert.ok(!m.SETTABLE_STATUSES.some((s) => s.id === "assigned" || s.id === "responded"));
});
test("reopenOnInbound: resolved/pending/follow-up reopen, WIP only with the setting, closed/ignored never", () => {
  assert.deepEqual(m.reopenOnInbound({ status: "solved" }, { reopenWip: false }), { status: "open", overlay: "reopened" });
  assert.deepEqual(m.reopenOnInbound({ status: "pending", overlay: "follow_up" }, { reopenWip: false }), { status: "open", overlay: "reopened" });
  assert.equal(m.reopenOnInbound({ status: "open", overlay: "wip" }, { reopenWip: false }), null);
  assert.deepEqual(m.reopenOnInbound({ status: "open", overlay: "wip" }, { reopenWip: true }), { status: "open", overlay: "reopened" });
  assert.equal(m.reopenOnInbound({ status: "closed", overlay: "ignored" }, { reopenWip: true }), null);
  assert.equal(m.reopenOnInbound({ status: "open" }, { reopenWip: true }), null);
});

// ---------------------------------------------------------------- locking, reminders, collision (D7, D11, D14)
test("isTicketLocked after N days from resolution", () => {
  const now = Date.parse("2026-09-28T12:00:00Z");
  const t = { status: "solved", resolved_at: "2026-09-20T12:00:00Z" };
  assert.equal(m.isTicketLocked(t, 7, now), true);
  assert.equal(m.isTicketLocked(t, 10, now), false);
  assert.equal(m.isTicketLocked(t, 0, now), false);
  assert.equal(m.isTicketLocked({ status: "open", resolved_at: null }, 1, now), false);
});
test("reminderError enforces the 10-minute minimum and a one-year horizon", () => {
  const now = Date.parse("2026-09-28T12:00:00Z");
  assert.match(m.reminderError("2026-09-28T12:05:00Z", now)!, /10 minutes/);
  assert.equal(m.reminderError("2026-09-28T12:10:00Z", now), null);
  assert.match(m.reminderError("2028-01-01T00:00:00Z", now)!, /year/);
  assert.match(m.reminderError("nope", now)!, /valid/);
});
test("lockState: fresh lock by another agent blocks; stale lock is free", () => {
  const now = Date.parse("2026-09-28T12:00:00Z");
  assert.equal(m.lockState({ user_id: "a", seen_at: "2026-09-28T11:59:50Z" }, "b", now), "other");
  assert.equal(m.lockState({ user_id: "b", seen_at: "2026-09-28T11:59:50Z" }, "b", now), "mine");
  assert.equal(m.lockState({ user_id: "a", seen_at: "2026-09-28T11:58:00Z" }, "b", now), "free");
  assert.equal(m.lockState(null, "b", now), "free");
});

// ---------------------------------------------------------------- @mentions (D5)
test("findMentions matches @Full Name, @First and @email-user, not substrings", () => {
  const agents = [{ id: "1", name: "Priya Shah", email: "priya@acme.com" }, { id: "2", name: "Raj Patel", email: "rp@acme.com" }, { id: "3", name: "Raja K", email: "raja@acme.com" }];
  assert.deepEqual(m.findMentions("@Priya Shah please check", agents), ["1"]);
  assert.deepEqual(m.findMentions("cc @rp and @raja", agents).sort(), ["2", "3"]);
  assert.deepEqual(m.findMentions("email priya@acme.com", agents), []);
  assert.deepEqual(m.findMentions("@Raj.", agents), ["2"]);
});

// ---------------------------------------------------------------- email rules (D15, D19, E5, E6)
test("parseAddresses and domain restriction", () => {
  assert.deepEqual(m.parseAddresses("A <a@x.com>, b@Y.org; bad, a@x.com"), { valid: ["a@x.com", "b@y.org"], invalid: ["bad"] });
  assert.deepEqual(m.blockedRecipients(["a@acme.com", "b@mail.acme.com", "c@gmail.com"], ["acme.com"]), ["c@gmail.com"]);
  assert.deepEqual(m.blockedRecipients(["c@gmail.com"], []), []);
  assert.deepEqual(m.normDomains("@Acme.com, https://partner.in/x, nope"), ["acme.com", "partner.in"]);
});
test("composeSubject keeps one ticket tag and prefixes forward/escalation", () => {
  assert.equal(m.composeSubject("Refund [#12]", 12, "compose"), "Refund [#12]");
  assert.equal(m.composeSubject("Refund", 12, "forward"), "Fwd: Refund [#12]");
  assert.equal(m.composeSubject("Refund", 12, "escalate"), "Escalation: Refund [#12]");
});
test("links: segments, email HTML (escaped) with signature, plain text", () => {
  assert.deepEqual(m.linkSegments("See [docs](https://a.io/x) or https://b.io."), [{ text: "See " }, { text: "docs", href: "https://a.io/x" }, { text: " or " }, { text: "https://b.io", href: "https://b.io" }, { text: "." }]);
  const html = m.toEmailHtml("Hi <b>\n[Track](https://t.io?a=1&b=2)", { text: "Priya", imageCid: "sig@x" });
  assert.match(html, /Hi &lt;b&gt;<br><a href="https:\/\/t.io\?a=1&amp;b=2">Track<\/a>/);
  assert.match(html, /cid:sig@x/);
  assert.equal(m.toPlainText("Go [here](https://h.io)", "Priya"), "Go here (https://h.io)\n\n-- \nPriya");
  assert.match(m.quoteMessage({ author_name: "Ana", created_at: "2026-09-28T10:00:00Z", body: "a\nb" }), /Ana wrote:\n> a\n> b$/);
});

// ---------------------------------------------------------------- placeholders (E4)
test("fillTemplate: built-ins, custom fields, contact attributes, unknown kept", () => {
  const out = m.fillTemplate("Hi {{first_name}}, {{ticket}} for {{field.order_id}} / {{order_id}} ({{contact.City}}) {{missing}} — {{agent}}", {
    name: "Ana Diaz", ticket: 7, agent: "Raj", brand: "Acme", fields: { order_id: "A-99" }, contact: { city: "Pune" },
  });
  assert.equal(out, "Hi Ana, #7 for A-99 / A-99 (Pune) {{missing}} — Raj");
  assert.equal(m.fillTemplate("{{name}}", {}), "there");
  assert.equal(m.fillTemplate("{{field.tags}}", { fields: { tags: ["a", "b"] } }), "a, b");
});

// ---------------------------------------------------------------- search syntax (C8, C9)
test("parseSearch: field:value, quotes, negation, #number, pasted URL, custom field keys", () => {
  const r = m.parseSearch('refund status:wip -tag:spam assignee:"Priya Shah" #42 https://x.com/acme/status/123 order_id:A-9 foo:bar', ["order_id"]);
  assert.equal(r.text, "refund foo:bar");
  assert.deepEqual(r.terms, [
    { field: "status", value: "wip", neg: false },
    { field: "tag", value: "spam", neg: true },
    { field: "assignee", value: "Priya Shah", neg: false },
    { field: "ticket", value: "42", neg: false },
    { field: "post", value: "https://x.com/acme/status/123", neg: false },
    { field: "order_id", value: "A-9", neg: false },
  ]);
});
test("searchSuggestions: field names, then values; applySuggestion replaces the last word", () => {
  assert.ok(m.searchSuggestions("refund sta").some((s) => s.insert === "status:"));
  assert.deepEqual(m.searchSuggestions("status:fo").map((s) => s.insert), ["status:follow_up "]);
  assert.ok(m.searchSuggestions("ord", [{ key: "order_id", label: "Order ID" }]).some((s) => s.insert === "order_id:"));
  assert.equal(m.applySuggestion("refund sta", "status:"), "refund status:");
});

// ---------------------------------------------------------------- contacts & journey (K2, K4)
test("phoneKey compares the last 10 digits", () => {
  assert.equal(m.phoneKey("+91 98765-43210"), "9876543210");
  assert.equal(m.phoneKey("098765 43210"), "9876543210");
  assert.equal(m.phoneKey("12345"), null);
});
test("journeyWindow filters by window and sorts", () => {
  const now = Date.parse("2026-09-28T00:00:00Z");
  const items = [
    { at: "2026-09-27T00:00:00Z", kind: "message" as const, title: "a" },
    { at: "2026-08-01T00:00:00Z", kind: "ticket" as const, title: "b" },
    { at: "2026-03-01T00:00:00Z", kind: "note" as const, title: "c" },
  ];
  assert.deepEqual(m.journeyWindow(items, 30, "desc", now).map((i) => i.title), ["a"]);
  assert.deepEqual(m.journeyWindow(items, 60, "asc", now).map((i) => i.title), ["b", "a"]);
  assert.deepEqual(m.journeyWindow(items, 0, "desc", now).map((i) => i.title), ["a", "b", "c"]);
});

// ---------------------------------------------------------------- settings / prefs
test("normSettings / normPrefs sanitize stored JSON", () => {
  assert.deepEqual(m.normSettings({ lockDays: -4 as number, allowedEmailDomains: ["ACME.com", "x"] }), { ...m.DEFAULT_SETTINGS, lockDays: 0, allowedEmailDomains: ["acme.com"] });
  assert.equal(m.normPrefs({ layout: "weird" as "chat" }).layout, "ticket");
  assert.equal(m.normPrefs({ enterToSend: true }).enterToSend, true);
});

// ---------------------------------------------------------------- exports (C13, D25)
test("hms and transcript", () => {
  assert.equal(m.hms(3_725_000), "01:02:05");
  assert.equal(m.hms(null), "");
  const tx = m.transcriptText({ number: 3, subject: "Late order", channel: "email", contact: "Ana", status: "WIP" },
    [{ direction: "in", author_name: "Ana", body: "Where is it?", created_at: "2026-09-28T10:00:00Z", attachments: [{ name: "a.png" }] }, { direction: "note", author_name: "Raj", body: "Check [courier](https://c.io)", created_at: "2026-09-28T10:05:00Z" }],
    [{ actor: "Raj", detail: "status → WIP", created_at: "2026-09-28T10:06:00Z" }]);
  assert.match(tx, /Ticket #3: Late order/);
  assert.match(tx, /Ana \(customer\)\nWhere is it\?\nAttachments: a.png/);
  assert.match(tx, /Raj \(private note\)\nCheck courier \(https:\/\/c.io\)/);
  assert.match(tx, /Raj status → WIP/);
});
test("xlsx: valid zip container Excel can open (checked with unzip -t) and CSV quoting", () => {
  assert.equal(x.crc32(Buffer.from("123456789")), 0xcbf43926);
  assert.equal(x.colName(0), "A");
  assert.equal(x.colName(27), "AB");
  const buf = x.buildXlsx([{ name: "Tickets", rows: [["#", "Subject"], [1, 'Say "hi" & <bye>'], [2, null]] }, { name: "B/ad:name", rows: [["x"]] }]);
  assert.equal(buf.readUInt32LE(0), 0x04034b50);
  const dir = mkdtempSync(path.join(tmpdir(), "wp1-"));
  const f = path.join(dir, "t.xlsx");
  writeFileSync(f, buf);
  const out = execFileSync("unzip", ["-t", f]).toString();
  assert.match(out, /No errors detected/);
  const sheet = execFileSync("unzip", ["-p", f, "xl/worksheets/sheet1.xml"]).toString();
  assert.match(sheet, /Say &quot;hi&quot; &amp; &lt;bye&gt;/);
  assert.match(execFileSync("unzip", ["-p", f, "xl/workbook.xml"]).toString(), /name="B ad name"/);
  assert.equal(x.toCsv([["a", 'b"c', "d,e"]]), '﻿a,"b""c","d,e"');
});
