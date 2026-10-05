import assert from "node:assert/strict";
import { test } from "node:test";

/** WP-K4 Community Engagement + Calls Analytics: pure aggregation (src/lib/cx/reports/engagement-model.ts). */
const m = await import("../src/lib/cx/reports/engagement-model");
type TaskRow = import("../src/lib/cx/reports/engagement-model").TaskRow;
type SurveyRow = import("../src/lib/cx/reports/engagement-model").SurveyRow;

const NOW = Date.parse("2026-10-05T12:00:00Z");
const RANGE = { from: "2026-09-29", to: "2026-10-05" };
const task = (p: Partial<TaskRow>): TaskRow => ({
  id: p.id ?? "k1", number: 1, title: "Call back", status: "open", priority: "normal", assigneeId: null, assignee: null, classificationId: null, classification: "",
  at: "2026-10-01T10:00:00.000Z", dueAt: null, completedAt: null, createdAt: "2026-10-01T10:00:00.000Z", ticketNumber: null, ...p,
});

test("overdue follows the drill rule: due in the past and not done/cancelled", () => {
  assert.equal(m.isOverdue({ dueAt: "2026-10-04T00:00:00Z", status: "open" }, NOW), true);
  assert.equal(m.isOverdue({ dueAt: "2026-10-04T00:00:00Z", status: "done" }, NOW), false);
  assert.equal(m.isOverdue({ dueAt: "2026-10-04T00:00:00Z", status: "cancelled" }, NOW), false);
  assert.equal(m.isOverdue({ dueAt: "2026-10-06T00:00:00Z", status: "open" }, NOW), false);
  assert.equal(m.isOverdue({ dueAt: null, status: "open" }, NOW), false);
});

test("task tiles: per-status counts, active (= open_all), overdue, time to complete", () => {
  const rows = [
    task({ id: "a", status: "open", dueAt: "2026-10-02T00:00:00Z" }),
    task({ id: "b", status: "in_progress" }),
    task({ id: "c", status: "done", createdAt: "2026-10-01T10:00:00.000Z", completedAt: "2026-10-01T12:30:00.000Z" }),
    task({ id: "d", status: "cancelled", dueAt: "2026-10-02T00:00:00Z" }),
    task({ id: "e", status: "waiting" }),
  ];
  const t = m.taskTiles(rows, NOW);
  assert.equal(t.total, 5);
  assert.deepEqual(t.byStatus, { open: 1, in_progress: 1, waiting: 1, done: 1, cancelled: 1 });
  assert.equal(t.active, 3);
  assert.equal(t.overdue, 1);
  assert.equal(t.avgCompleteSeconds, 9000);
  assert.equal(t.completionRate, 20);
  assert.equal(m.taskTiles([], NOW).avgCompleteSeconds, null);
  assert.equal(m.taskTiles([], NOW).completionRate, null);
});

test("task trend buckets by local created day and status; weekly buckets start Monday", () => {
  const rows = [task({ id: "a", at: "2026-09-29T23:30:00.000Z" }), task({ id: "b", at: "2026-10-05T01:00:00.000Z", status: "done" })];
  const daily = m.taskTrend(rows, RANGE, "day");
  assert.equal(daily.length, 7);
  assert.equal(daily[0].key, "2026-09-29");
  assert.equal(daily[0].open, 1);
  assert.equal(daily[6].done, 1);
  const weekly = m.taskTrend(rows, RANGE, "week");
  assert.deepEqual(weekly.map((r) => r.key), ["2026-09-28", "2026-10-05"]);
});

test("by priority keeps every priority (highest first) with status splits", () => {
  const rows = [task({ id: "a", priority: "urgent", status: "done" }), task({ id: "b", priority: "urgent" }), task({ id: "c", priority: "low" })];
  const p = m.taskByPriority(rows);
  assert.deepEqual(p.map((r) => r.key), ["urgent", "high", "normal", "low"]);
  assert.equal(p[0].total, 2);
  assert.equal(p[0].done, 1);
  assert.equal(p[0].open, 1);
  assert.equal(p[1].total, 0);
});

test("by assignee: busiest first, unassigned ('none') last, overdue per assignee", () => {
  const rows = [
    task({ id: "a", assigneeId: "u1", assignee: "Agent One" }),
    task({ id: "b", assigneeId: "u2", assignee: "Agent Two", dueAt: "2026-10-01T00:00:00Z" }),
    task({ id: "c", assigneeId: "u2", assignee: "Agent Two", status: "done" }),
    task({ id: "d" }),
    task({ id: "e" }),
    task({ id: "f" }),
  ];
  const a = m.taskByAssignee(rows, NOW);
  assert.deepEqual(a.map((x) => x.key), ["u2", "u1", "none"]);
  assert.equal(a[0].overdue, 1);
  assert.equal(a[0].active, 1);
  assert.equal(a[0].byStatus.done, 1);
  assert.equal(a[2].name, "Unassigned");
  assert.equal(a[2].total, 3);
});

test("by classification: 'none' = unclassified, largest first, limited", () => {
  const rows = [task({ id: "a", classificationId: "c1", classification: "Billing > Refund" }), task({ id: "b", classificationId: "c1", classification: "Billing > Refund" }), task({ id: "c" })];
  const c = m.taskByClassification(rows);
  assert.deepEqual(c, [{ key: "c1", label: "Billing > Refund", count: 2 }, { key: "none", label: "Unclassified", count: 1 }]);
  assert.equal(m.taskByClassification(rows, 1).length, 1);
});

test("overdue list: most overdue first, with the overdue duration", () => {
  const rows = [task({ id: "a", dueAt: "2026-10-05T11:00:00Z" }), task({ id: "b", dueAt: "2026-10-04T12:00:00Z" }), task({ id: "c", dueAt: "2026-10-01T00:00:00Z", status: "done" })];
  const o = m.overdueTasks(rows, NOW);
  assert.deepEqual(o.map((x) => x.id), ["b", "a"]);
  assert.equal(o[0].overdueSeconds, 86400);
});

test("task scope param: only 'mine' selects mine", () => {
  assert.equal(m.taskScope("mine"), "mine");
  assert.equal(m.taskScope("all"), "all");
  assert.equal(m.taskScope("c.abc"), "all");
  assert.equal(m.taskScope(undefined), "all");
});

const resp = (p: Partial<SurveyRow>): SurveyRow => ({
  id: p.id ?? "r1", surveyId: "s1", kind: "csat", score: 5, comment: "", sentiment: null, at: "2026-10-01T10:00:00.000Z", agentId: null, agent: null, ticketId: null, ticketNumber: null, contact: null, ...p,
});

test("CSAT bands use the drill rule (>=4 satisfied, 3 neutral, <=2 unsatisfied)", () => {
  assert.equal(m.bandOf(5), "satisfied");
  assert.equal(m.bandOf(4), "satisfied");
  assert.equal(m.bandOf(3), "neutral");
  assert.equal(m.bandOf(2), "unsatisfied");
  assert.equal(m.bandOf(1), "unsatisfied");
  assert.equal(m.bandOf(null), null);
});

test("CSAT summary: responses include unscored rows; average and % satisfied over scored only", () => {
  const s = m.csatSummary([resp({ score: 5 }), resp({ score: 4 }), resp({ score: 2 }), resp({ score: null })]);
  assert.equal(s.responses, 4);
  assert.equal(s.scored, 3);
  assert.equal(s.average, 3.67);
  assert.ok(Math.abs(s.satisfiedPct! - 66.6667) < 0.01);
  assert.deepEqual(s.bands, { satisfied: 2, neutral: 0, unsatisfied: 1 });
  assert.equal(m.csatSummary([]).average, null);
  assert.equal(m.csatSummary([]).satisfiedPct, null);
});

test("NPS: promoters minus detractors, n/a without answers", () => {
  const n = m.npsSummary([10, 9, 8, 6, 0, null]);
  assert.equal(n.n, 5);
  assert.equal(n.promoters, 2);
  assert.equal(n.passives, 1);
  assert.equal(n.detractors, 2);
  assert.equal(n.score, 0);
  assert.equal(m.npsSummary([]).score, null);
  assert.equal(m.npsSummary([10, 10, 7]).score, 66.7);
});

test("score distribution covers every score with its band", () => {
  const d = m.scoreDistribution([resp({ score: 5 }), resp({ score: 5 }), resp({ score: 1 })]);
  assert.deepEqual(d.map((x) => [x.key, x.count, x.band]), [["1", 1, "unsatisfied"], ["2", 0, "unsatisfied"], ["3", 0, "neutral"], ["4", 0, "satisfied"], ["5", 2, "satisfied"]]);
});

test("survey trend: bands per bucket and the bucket's average (null when nothing scored)", () => {
  const t = m.surveyTrend([resp({ score: 5, at: "2026-09-30T08:00:00.000Z" }), resp({ score: 2, at: "2026-09-30T09:00:00.000Z" }), resp({ score: null, at: "2026-10-01T09:00:00.000Z" })], RANGE, "day");
  const d30 = t.find((r) => r.key === "2026-09-30")!;
  assert.equal(d30.satisfied, 1);
  assert.equal(d30.unsatisfied, 1);
  assert.equal(d30.average, 3.5);
  assert.equal(t.find((r) => r.key === "2026-10-01")!.average, null);
});

test("survey by agent: 'none' last, band counts and % satisfied", () => {
  const a = m.surveyByAgent([resp({ agentId: "u1", agent: "Agent One", score: 5 }), resp({ agentId: "u1", agent: "Agent One", score: 1 }), resp({ score: 4 })]);
  assert.deepEqual(a.map((x) => x.key), ["u1", "none"]);
  assert.equal(a[0].responses, 2);
  assert.equal(a[0].satisfied, 1);
  assert.equal(a[0].unsatisfied, 1);
  assert.equal(a[0].satisfiedPct, 50);
  assert.equal(a[1].name, "No agent");
});

test("response rate is n/a without invites", () => {
  assert.equal(m.responseRate(0, 0), null);
  assert.equal(m.responseRate(3, 12), 25);
});

test("queue trend buckets queued/assigned by local time; wait to assign over assignments in range", () => {
  const rows = [
    { ticketId: "t1", queuedAt: "2026-09-30T20:00:00.000Z", assignedAt: "2026-09-30T20:30:00.000Z" },
    { ticketId: "t2", queuedAt: "2026-09-28T10:00:00.000Z", assignedAt: "2026-09-29T10:00:00.000Z" },
    { ticketId: "t3", queuedAt: "2026-10-02T10:00:00.000Z", assignedAt: null },
  ];
  // +330 min (IST): 20:00Z on 30/09 is 01:30 on 01/10 local.
  const tr = m.queueTrend(rows, RANGE, "day", 330);
  assert.equal(tr.find((r) => r.key === "2026-10-01")!.queued, 1);
  assert.equal(tr.find((r) => r.key === "2026-10-01")!.assigned, 1);
  assert.equal(tr.find((r) => r.key === "2026-09-29")!.assigned, 1);
  assert.equal(tr.find((r) => r.key === "2026-10-02")!.queued, 1);
  assert.equal(tr.reduce((s, r) => s + r.queued, 0), 2);
  const w = m.waitToAssign(rows, RANGE, 330);
  assert.equal(w.n, 2);
  assert.equal(w.average, (1800 + 86400) / 2);
  assert.equal(w.longest, 86400);
  assert.equal(w.median, (1800 + 86400) / 2);
  assert.equal(m.waitToAssign([], RANGE, 0).average, null);
});

test("waiting summary: count and oldest wait", () => {
  assert.deepEqual(m.waitingSummary([{ queuedAt: "2026-10-05T11:00:00Z" }, { queuedAt: "2026-10-05T10:00:00Z" }], NOW), { count: 2, oldestSeconds: 7200 });
  assert.deepEqual(m.waitingSummary([], NOW), { count: 0, oldestSeconds: null });
});

test("status log: overlap with the range, open entries run until now, break summary", () => {
  const log = [
    { id: "1", name: "Agent One", status: "Lunch", started_at: "2026-10-05T10:00:00Z", ended_at: null },
    { id: "2", name: "Agent One", status: "Available", started_at: "2026-10-05T08:00:00Z", ended_at: "2026-10-05T10:00:00Z" },
    { id: "3", name: "Agent Two", status: "Meeting", started_at: "2026-10-01T09:00:00Z", ended_at: "2026-10-01T09:30:00Z" },
    { id: "4", name: "Agent Two", status: "Meeting", started_at: "2026-09-01T09:00:00Z", ended_at: "2026-09-01T09:30:00Z" },
  ];
  const rows = m.statusLogRows(log, RANGE, 0, NOW);
  assert.deepEqual(rows.map((r) => r.id), ["1", "2", "3"]);
  assert.equal(rows[0].seconds, 7200);
  assert.equal(rows[0].open, true);
  assert.equal(rows[1].isBreak, false);
  const b = m.breakSummary(rows);
  assert.deepEqual(b.map((x) => [x.name, x.sessions, x.total]), [["Agent One", 1, 7200], ["Agent Two", 1, 1800]]);
  assert.equal(m.isBreak("Offline"), false);
  assert.equal(m.isBreak("Away"), true);
});

test("avgSpan skips missing and negative spans; countPerBucket counts local instants", () => {
  const s = m.avgSpan([{ a: "2026-10-01T00:00:00Z", b: "2026-10-01T01:00:00Z" }, { a: "2026-10-01T00:00:00Z", b: null }, { a: "2026-10-01T02:00:00Z", b: "2026-10-01T01:00:00Z" }], (x) => x.a, (x) => x.b);
  assert.deepEqual(s, { n: 1, average: 3600 });
  const c = m.countPerBucket(["2026-09-29T10:00:00.000Z", "2026-09-29T11:00:00.000Z", "2026-09-01T00:00:00.000Z"], RANGE, "day");
  assert.equal(c[0].count, 2);
  assert.equal(c.reduce((x, r) => x + r.count, 0), 2);
  assert.equal(m.perDay(14, RANGE), 2);
});

test("local time helpers", () => {
  assert.equal(m.toLocal("2026-10-05T20:00:00.000Z", 330), "2026-10-06T01:30:00.000Z");
  assert.equal(m.toLocal(null, 330), null);
  assert.equal(m.dmyTime("2026-10-05T20:00:00.000Z", 330), "06/10/2026 01:30");
  assert.equal(m.dmyTime(null, 0), "n/a");
});

test("calls tabs: four tabs, unknown falls back to overview", () => {
  assert.deepEqual(m.CALL_TABS.map((t) => t.id), ["overview", "agent-performance", "live-status", "agentwise"]);
  assert.equal(m.callTab("live-status"), "live-status");
  assert.equal(m.callTab("nope"), "overview");
  assert.ok(m.CALL_TABS.every((t) => t.metrics.length >= 3));
});
