import assert from "node:assert/strict";
import { test } from "node:test";

const m = await import("../src/lib/cx/insights/metrics");
const { buildWidgetSql } = await import("../src/lib/cx/insights/widget-sql");
const { formatMetric } = await import("../src/lib/cx/insights/widget-defs");
const { parseAiScore } = await import("../src/lib/cx/insights/quality");

const T = (iso: string) => new Date(`2026-09-${iso}Z`);
// Fixture tickets shaped like cx_tickets rows.
const tickets = [
  { created_at: T("01T09:00:00"), first_response_at: T("01T09:30:00"), resolved_at: T("01T12:00:00"), first_response_due: T("01T10:00:00"), resolution_due: T("01T17:00:00"), priority: "normal" },
  { created_at: T("02T09:00:00"), first_response_at: T("02T11:00:00"), resolved_at: T("03T09:00:00"), first_response_due: T("02T10:00:00"), resolution_due: T("02T17:00:00"), priority: "high" },
  { created_at: T("03T09:00:00"), first_response_at: null, resolved_at: null, first_response_due: T("03T10:00:00"), resolution_due: T("05T10:00:00"), priority: "urgent" },
  { created_at: T("04T09:00:00"), first_response_at: T("04T09:05:00"), resolved_at: null, first_response_due: null, resolution_due: null, priority: "low" },
];
const now = T("04T12:00:00");

test("average first response and resolution times", () => {
  // 30 min, 120 min, 5 min -> 155/3 min
  assert.equal(Math.round(m.avgFirstResponse(tickets)!), Math.round((1800 + 7200 + 300) / 3));
  // 3 h and 24 h
  assert.equal(m.avgResolution(tickets), (3 * 3600 + 24 * 3600) / 2);
  assert.equal(m.avgFirstResponse([]), null);
});

test("SLA compliance counts decided targets only", () => {
  const r = m.slaCompliance(tickets, now);
  // t1: FR met, RES met; t2: FR breached, RES breached; t3: FR breached (open past due), RES pending; t4: no targets
  assert.deepEqual({ met: r.met, breached: r.breached, pending: r.pending }, { met: 2, breached: 3, pending: 1 });
  assert.equal(r.rate, 40);
  // Fallback policy minutes give t4 a first-response target: 5 min reply within 15 min -> met.
  const f = m.slaCompliance([tickets[3]], now, { low: { firstResponse: 15, resolution: null } });
  assert.equal(f.rate, 100);
  assert.equal(m.slaCompliance([], now).rate, null);
});

test("NPS and CSAT", () => {
  const n = m.nps([10, 9, 9, 8, 7, 6, 3, 0, 10, 5]);
  assert.deepEqual({ p: n.promoters, pa: n.passives, d: n.detractors }, { p: 4, pa: 2, d: 4 });
  assert.equal(n.score, 0);
  assert.equal(m.nps([10, 10, 9]).score, 100);
  assert.equal(m.nps([]).score, null);
  const c = m.csat([5, 4, 3, 2, 5]);
  assert.equal(c.score, 60);
  assert.equal(c.average, 3.8);
  assert.equal(m.csat([0, 7]).score, null, "out-of-range values ignored");
});

test("net sentiment and deltas", () => {
  assert.equal(m.netSentiment(30, 10), 50);
  assert.equal(m.netSentiment(0, 0), null);
  assert.equal(m.pctDelta(120, 100), 20);
  assert.equal(m.pctDelta(5, 0), null);
  assert.equal(m.pctDelta(null, 4), null);
});

test("QA weighted scoring with N/A and fatal criteria", () => {
  const sections = [
    { id: "a", name: "Opening", criteria: [{ id: "c1", label: "Greets", weight: 10 }, { id: "c2", label: "Acknowledges", weight: 30 }] },
    { id: "b", name: "Resolution", criteria: [{ id: "c3", label: "Correct answer", weight: 60 }, { id: "f1", label: "No data leak", weight: 0, fatal: true }] },
  ];
  // 10*1 + 30*0.5 + 60*1 = 85 of 100
  const r = m.scoreReview(sections, { c1: 1, c2: 0.5, c3: 1, f1: 1 });
  assert.equal(r.score, 85);
  assert.equal(r.fatal, false);
  assert.equal(r.bySection[0].score, 62.5);
  // N/A drops the criterion from the denominator: (10 + 60) / 70
  assert.equal(m.scoreReview(sections, { c1: 1, c2: null, c3: 1 }).score, 100);
  // Fatal "No" zeroes the review
  const f = m.scoreReview(sections, { c1: 1, c2: 1, c3: 1, f1: 0 });
  assert.equal(f.score, 0);
  assert.equal(f.fatal, true);
  assert.equal(m.scoreReview(sections, {}).score, null);
});

test("business-hours SLA due dates", () => {
  const hours = m.DEFAULT_HOURS; // Mon–Fri 09:00–17:00
  // Friday 2026-09-25 16:00 UTC + 2 business hours -> Monday 2026-09-28 10:00 UTC
  assert.equal(m.addBusinessMinutes(new Date("2026-09-25T16:00:00Z"), 120, hours).toISOString(), "2026-09-28T10:00:00.000Z");
  // Holiday on Monday pushes to Tuesday
  assert.equal(m.addBusinessMinutes(new Date("2026-09-25T16:00:00Z"), 120, hours, [{ date: "2026-09-28", name: "Holiday" }]).toISOString(), "2026-09-29T10:00:00.000Z");
  // Timezone: 09:00 in Asia/Kolkata = 03:30 UTC; ticket at 02:00 UTC (07:30 IST) + 60 min -> 10:00 IST = 04:30 UTC
  assert.equal(m.addBusinessMinutes(new Date("2026-09-28T02:00:00Z"), 60, hours, [], "Asia/Kolkata").toISOString(), "2026-09-28T04:30:00.000Z");
  // No open days -> calendar time
  assert.equal(m.addBusinessMinutes(new Date("2026-09-28T02:00:00Z"), 60, hours.map((h) => ({ ...h, open: false }))).toISOString(), "2026-09-28T03:00:00.000Z");
});

test("day series and sampling", () => {
  const keys = m.dayKeys(3, new Date("2026-09-28T15:00:00Z"));
  assert.deepEqual(keys, ["2026-09-26", "2026-09-27", "2026-09-28"]);
  const filled = m.fillDays([{ day: "2026-09-27", n: 4 }], 3, { n: 0 }, new Date("2026-09-28T15:00:00Z"));
  assert.deepEqual(filled.map((x) => x.n), [0, 4, 0]);
  const s = m.sample([1, 2, 3, 4, 5, 6, 7, 8], 3, 42);
  assert.equal(s.length, 3);
  assert.equal(new Set(s).size, 3);
  assert.deepEqual(m.sample([1, 2, 3, 4, 5, 6, 7, 8], 3, 42), s, "seeded sample is deterministic");
  assert.equal(m.humanDuration(90), "2m");
  assert.equal(m.humanDuration(3 * 3600 + 300), "3h 5m");
  assert.equal(m.humanDuration(null), "n/a");
});

test("widget SQL is whitelisted and parameterized", () => {
  const from = new Date("2026-09-01T00:00:00Z"), to = new Date("2026-09-28T00:00:00Z");
  const q = buildWidgetSql({ source: "tickets", metric: "frt", groupBy: "channel", range: 30, filters: { priority: "high", tag: "x'; DROP TABLE users;--" } }, "p1", from, to, true);
  assert.match(q.sql, /GROUP BY 1/);
  assert.ok(!q.sql.includes("DROP TABLE"));
  assert.deepEqual(q.params, ["p1", from, to, "high", "x'; DROP TABLE users;--"]);
  const bad = buildWidgetSql({ source: "tickets", metric: "nope; DELETE", groupBy: "none", range: 30, filters: {} }, "p1", from, to, false);
  assert.ok(!bad.sql.includes("DELETE") && bad.sql.includes("count(*)"));
  assert.throws(() => buildWidgetSql({ source: "mentions", metric: "count", groupBy: "agent", range: 30, filters: {} }, "p1", from, to, true));
  // Filters not allowed for a source are ignored.
  const mf = buildWidgetSql({ source: "mentions", metric: "count", groupBy: "none", range: 30, filters: { priority: "high" } }, "p1", from, to, false);
  assert.equal(mf.params.length, 3);
  assert.equal(formatMetric(0.5, "hours"), "30m");
  assert.equal(formatMetric(3 / 3600, "hours"), "3s");
  assert.equal(formatMetric(null, "percent"), "n/a");
});

test("AI pre-score parsing keeps known criteria and valid values", () => {
  const sections = [{ id: "s", name: "S", criteria: [{ id: "c1", label: "A", weight: 1 }, { id: "c2", label: "B", weight: 1 }] }];
  const r = parseAiScore('Here you go:\n{"answers":{"c1":1,"c2":0.7,"zz":0},"notes":{"c1":"Greeted"},"summary":"Good."}', sections);
  assert.deepEqual(r, { answers: { c1: 1 }, notes: { c1: "Greeted" }, summary: "Good." });
  assert.equal(parseAiScore("no json", sections), null);
});
