import assert from "node:assert/strict";
import { test } from "node:test";

const r = await import("../src/lib/cx/insights/reports-math");
const m = await import("../src/lib/cx/insights/metrics");
const sig = await import("../src/lib/cx/insights/signals");
const { rankArticles } = await import("../src/lib/cx/insights/kb");
const sd = await import("../src/lib/cx/insights/survey-defs");
const ed = await import("../src/lib/cx/insights/export-defs");
const { normalizeAnswers } = await import("../src/lib/cx/insights/quality");
const { widgetWindow, withDashboardFilters, normalizeWidget } = await import("../src/lib/cx/insights/dashboards");

const T = (s: string) => new Date(`2026-09-${s}Z`);
// Mon–Fri 09:00–17:00 UTC, 2026-09-07 is a Monday.
const cfg = { hours: m.DEFAULT_HOURS, holidays: [{ date: "2026-09-09", name: "Holiday" }], timezone: "UTC" };

test("hms formats seconds as HH:MM:SS, hours may exceed 24", () => {
  assert.equal(r.hms(0), "00:00:00");
  assert.equal(r.hms(3725), "01:02:05");
  assert.equal(r.hms(90061), "25:01:01");
  assert.equal(r.hms(59.6), "00:01:00");
  assert.equal(r.hms(null), "");
  assert.equal(r.hms(Number.NaN), "");
});

test("business seconds skip nights, weekends and holidays", () => {
  // Mon 16:00 → Tue 10:00 = 1h Mon + 1h Tue
  assert.equal(r.businessSecondsBetween(T("07T16:00:00"), T("08T10:00:00"), cfg), 2 * 3600);
  // Tue 16:00 → Thu 10:00: Tue 1h, Wed holiday, Thu 1h
  assert.equal(r.businessSecondsBetween(T("08T16:00:00"), T("10T10:00:00"), cfg), 2 * 3600);
  // Fri 16:30 → Mon 09:30 = 30m + 30m
  assert.equal(r.businessSecondsBetween(T("11T16:30:00"), T("14T09:30:00"), cfg), 3600);
  // Entirely outside hours
  assert.equal(r.businessSecondsBetween(T("12T10:00:00"), T("13T18:00:00"), cfg), 0);
  // tat(): calendar vs business, unknown end → null
  assert.equal(r.tat(T("07T16:00:00"), T("08T10:00:00"), "calendar"), 18 * 3600);
  assert.equal(r.tat(T("07T16:00:00"), T("08T10:00:00"), "business", cfg), 2 * 3600);
  assert.equal(r.tat(T("07T16:00:00"), null, "calendar"), null);
});

test("ticket trend buckets by day, week and month with continuous keys", () => {
  const tickets = [
    { created_at: T("07T10:00:00"), resolved_at: T("08T10:00:00") },
    { created_at: T("07T11:00:00"), resolved_at: null },
    { created_at: T("15T11:00:00"), resolved_at: T("15T12:00:00") },
  ];
  const days = r.ticketTrend(tickets, T("07T00:00:00"), T("09T23:59:59"), "day");
  assert.deepEqual(days, [{ key: "2026-09-07", created: 2, solved: 0 }, { key: "2026-09-08", created: 0, solved: 1 }, { key: "2026-09-09", created: 0, solved: 0 }]);
  const weeks = r.ticketTrend(tickets, T("07T00:00:00"), T("20T00:00:00"), "week");
  assert.deepEqual(weeks.map((w) => [w.key, w.created, w.solved]), [["2026-09-07", 2, 1], ["2026-09-14", 1, 1]]);
  assert.equal(r.bucketKey("2026-09-13T23:00:00Z", "week"), "2026-09-07");
  assert.equal(r.bucketKey("2026-09-13T23:00:00Z", "month"), "2026-09");
});

test("agent-wise SLA breaches count met/breached, skip pending", () => {
  const now = T("10T12:00:00");
  const rows = r.agentBreaches(
    [
      { assignee: "Asha", created_at: T("07T09:00:00"), first_response_at: T("07T09:30:00"), first_response_due: T("07T10:00:00"), resolved_at: T("08T09:00:00"), resolution_due: T("07T17:00:00") },
      { assignee: "Asha", created_at: T("09T09:00:00"), first_response_at: null, first_response_due: T("09T10:00:00"), resolved_at: null, resolution_due: T("12T10:00:00") },
      { assignee: null, created_at: T("10T11:00:00"), first_response_at: null, first_response_due: T("10T13:00:00") },
    ],
    now,
  );
  const asha = rows.find((x) => x.agent === "Asha")!;
  assert.equal(asha.frMet, 1);
  assert.equal(asha.frBreached, 1);
  assert.equal(asha.resBreached, 1);
  assert.equal(asha.resMet, 0);
  assert.equal(Math.round(asha.breachRate!), 67);
  const un = rows.find((x) => x.agent === "Unassigned")!;
  assert.equal(un.breached, 0);
  assert.equal(un.breachRate, null);
});

test("reply TAT pairs each customer run with the next agent reply", () => {
  const msgs = [
    { ticket_id: "a", direction: "in" as const, created_at: T("07T09:00:00") },
    { ticket_id: "a", direction: "in" as const, created_at: T("07T09:10:00") },
    { ticket_id: "a", direction: "note" as const, created_at: T("07T09:15:00") },
    { ticket_id: "a", direction: "out" as const, created_at: T("07T09:30:00"), author_user_id: "u1", author: "Asha" },
    { ticket_id: "a", direction: "out" as const, created_at: T("07T09:40:00"), author_user_id: "u1", author: "Asha" },
    { ticket_id: "a", direction: "in" as const, created_at: T("07T16:30:00") },
    { ticket_id: "a", direction: "out" as const, created_at: T("08T09:30:00"), author_user_id: "u2", author: "Ben" },
    { ticket_id: "b", direction: "in" as const, created_at: T("07T10:00:00") },
  ];
  const cal = r.replyTats(msgs);
  assert.deepEqual(cal.map((x) => [x.agent, x.seconds]), [["Asha", 1800], ["Ben", 17 * 3600]]);
  const biz = r.replyTats(msgs, "business", cfg);
  assert.deepEqual(biz.map((x) => x.seconds), [1800, 3600]);
  const s = r.summarize(cal.map((x) => x.seconds));
  assert.equal(s.n, 2);
  assert.equal(s.avg, (1800 + 61200) / 2);
  assert.equal(s.p90, 61200);
  assert.equal(r.summarize([]).avg, null);
});

test("QA scoring: response types, scale fractions, auto-scale, fatal", () => {
  const sections: import("../src/lib/cx/insights/metrics").QaSection[] = [
    {
      id: "s",
      name: "S",
      criteria: [
        { id: "y", label: "Yes/no", weight: 10 },
        { id: "sc", label: "Scale", weight: 20, type: "scale", scaleMax: 5 },
        { id: "in", label: "Notes", weight: 50, type: "input" },
        { id: "au", label: "FRT", weight: 10, type: "auto", auto: { metric: "frt", target: 1 } },
        { id: "f", label: "Fatal", weight: 0, fatal: true },
      ],
    },
  ];
  assert.equal(m.scaleFraction(1, 5), 0);
  assert.equal(m.scaleFraction(4, 5), 0.75);
  assert.equal(m.autoScore({ metric: "frt", target: 1 }, { frtHours: 2, resolutionHours: null, csat: null, sentiment: null }), 0.5);
  assert.equal(m.autoScore({ metric: "frt", target: 1 }, { frtHours: null, resolutionHours: null, csat: null, sentiment: null }), null);
  assert.equal(m.autoScore({ metric: "sentiment", target: 0 }, { frtHours: null, resolutionHours: null, csat: null, sentiment: "neutral" }), 0.5);
  const answers = normalizeAnswers(sections, { y: 1, sc: 4, in: 1, f: 1 }, { frtHours: 2, resolutionHours: null, csat: null, sentiment: null });
  assert.deepEqual(answers, { y: 1, sc: 0.75, au: 0.5, f: 1 });
  // (10*1 + 20*0.75 + 10*0.5) / 40 = 75%; input criteria are never scored
  assert.equal(m.scoreReview(sections, answers).score, 75);
  assert.equal(m.scoreReview(sections, { ...answers, f: 0 }).score, 0);
  assert.equal(m.scoreReview(sections, { in: 1 }).score, null);
  // Out-of-range scale points are dropped
  assert.equal(normalizeAnswers(sections, { sc: 9 }, null).sc, undefined);
});

test("QA early warnings: declining and below-pass", () => {
  assert.deepEqual(m.earlyWarnings([90, 85, 78], 80).flags, ["declining"]);
  assert.deepEqual(m.earlyWarnings([90, 75, 70], 80).flags, ["declining", "below_pass"]);
  assert.deepEqual(m.earlyWarnings([70, 85, 90], 80).flags, []);
  assert.deepEqual(m.earlyWarnings([null, 60], 80).flags, []);
  assert.equal(m.earlyWarnings([60, null, 80]).change, 20);
});

test("signals: CSAT prediction, churn risk and escalation", () => {
  const base = { sentiment: "neutral", intent: "query", priority: "normal", reopens: 0, frBreached: false, resBreached: false, waitingHours: 0, recentTickets: 0, csat: null, inbound: 1 };
  assert.equal(sig.predictCsat(base).value, 4.2);
  const angry = { ...base, sentiment: "negative", intent: "cancellation", reopens: 1, frBreached: true, recentTickets: 3, waitingHours: 30 };
  const p = sig.predictCsat(angry);
  assert.equal(p.known, false);
  assert.equal(p.value, 1.4);
  const c = sig.churnRisk(angry);
  assert.equal(c.score, 90);
  assert.equal(c.level, "high");
  assert.equal(sig.churnRisk(base).score, 0);
  assert.equal(sig.predictCsat({ ...base, csat: 2 }).value, 2);
  assert.equal(sig.churnRisk({ ...base, csat: 2 }).level, "low");
  assert.equal(sig.escalationLikelihood({ ...base, priority: "urgent", sentiment: "negative", intent: "complaint" }).level, "high");
  // inputOf derives breaches and waiting time from timestamps
  const now = T("10T12:00:00").getTime();
  const inp = sig.inputOf({ priority: "high", sentiment: null, intent: null, csat: null, created_at: "2026-09-10T08:00:00Z", first_response_at: null, resolved_at: null, first_response_due: "2026-09-10T09:00:00Z", resolution_due: null, last_in: "2026-09-10T08:00:00Z", last_out: null, inbound: 1, reopens: 0, recent: 0 }, now);
  assert.equal(inp.frBreached, true);
  assert.equal(inp.resBreached, false);
  assert.equal(inp.waitingHours, 4);
});

test("knowledge base ranking prefers title matches and builds snippets", () => {
  const docs = [
    { id: "1", title: "Refund policy", body: "Refunds are issued within 14 days of purchase to the original payment method.", tags: ["billing"] },
    { id: "2", title: "Shipping times", body: "Orders ship in 2 days. For a refund of shipping fees contact billing.", tags: [] },
    { id: "3", title: "Password reset", body: "Use the forgot password link.", tags: [] },
  ];
  const hits = rankArticles("how do I get a refund?", docs, 5);
  assert.deepEqual(hits.map((h) => h.id), ["1", "2"]);
  assert.match(hits[1].snippet, /refund/i);
  assert.deepEqual(rankArticles("the and of", docs), []);
  assert.deepEqual(rankArticles("password", docs).map((h) => h.id), ["3"]);
});

test("survey conditions, inline rating links and template filling", () => {
  const t = { channel: "email", priority: "high", tags: ["vip"], classificationIds: ["c1"], values: { plan: "Gold" } };
  assert.equal(sd.matchesConditions({}, t), true);
  assert.equal(sd.matchesConditions({ channels: ["email"], priorities: ["high"], tags: ["vip", "x"] }, t), true);
  assert.equal(sd.matchesConditions({ channels: ["livechat"] }, t), false);
  assert.equal(sd.matchesConditions({ classificationIds: ["c2"] }, t), false);
  assert.equal(sd.matchesConditions({ fields: [{ key: "plan", value: "gold" }] }, t), true);
  assert.equal(sd.matchesConditions({ fields: [{ key: "plan", value: "silver" }] }, t), false);
  const links = sd.inlineRatingLinks("csat", "https://x.test/s/1?t=abc");
  assert.match(links, /5 – Very satisfied: https:\/\/x\.test\/s\/1\?t=abc&r=5/);
  assert.equal(sd.inlineRatingLinks("nps", "/s/1").split("\n").filter((l) => l.includes("r=")).length, 11);
  const body = sd.fillSurveyTemplate(sd.DEFAULT_TEMPLATE, { name: "", ticket: 7, brand: "Acme", question: "How did we do?", link: "L", ratingLinks: "" });
  assert.match(body, /^Hi there,/);
  assert.match(body, /Acme$/);
  assert.equal(sd.settingsInput.safeParse({ ...sd.DEFAULT_SETTINGS, emailTemplate: "no link" }).success, false);
  assert.equal(sd.settingsInput.safeParse({ ...sd.DEFAULT_SETTINGS, redirectUrl: "javascript:alert(1)" }).success, false);
  assert.equal(sd.settingsInput.safeParse(sd.DEFAULT_SETTINGS).success, true);
});

test("export periods and CSV encoding", () => {
  const now = new Date("2026-09-28T15:00:00Z");
  const y = ed.periodRange("yesterday", now);
  assert.equal(y.from.toISOString(), "2026-09-27T00:00:00.000Z");
  assert.equal(y.to.toISOString(), "2026-09-28T00:00:00.000Z");
  const w = ed.periodRange("7", now);
  assert.equal(w.from.toISOString().slice(0, 10), "2026-09-21");
  assert.equal(w.label, "2026-09-21 to 2026-09-27");
  assert.equal(ed.periodRange("month", now).from.toISOString().slice(0, 10), "2026-09-01");
  assert.equal(ed.toCsv([["a", 'b "q"', "c,d"], ["=SUM(A1)", -5, null]]), 'a,"b ""q""","c,d"\r\n\'=SUM(A1),-5,');
});

test("phrases, widget windows and dashboard filters", () => {
  const p = r.topPhrases(["The refund took too long", "Still waiting for my refund took ages", "refund took forever", "hello"]);
  assert.equal(p[0].term, "refund took");
  assert.equal(p[0].count, 3);
  const win = widgetWindow({ range: 30, from: "2026-09-01", to: "2026-09-10" });
  assert.equal(win.days, 10);
  assert.equal(win.prevFrom.toISOString().slice(0, 10), "2026-08-22");
  const w = normalizeWidget({ id: "w", title: "t", source: "messages", metric: "phrases", chart: "line", groupBy: "date", range: 30, filters: {}, size: 1 });
  assert.equal(w.chart, "cloud");
  assert.equal(w.groupBy, "none");
  const f = withDashboardFilters({ ...w, filters: { channel: "email" } }, { channel: "livechat", priority: "high", fields: [{ key: "plan", value: "Gold" }] });
  assert.deepEqual(f.filters, { channel: "email", priority: "high" });
  assert.equal(f.fields?.length, 1);
});
