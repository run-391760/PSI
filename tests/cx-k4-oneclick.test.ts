import assert from "node:assert/strict";
import { test } from "node:test";

const m = await import("../src/lib/cx/reports/one-click-model");
const { buildXlsx } = await import("../src/lib/cx/inbox/xlsx");

const range = { from: "2026-09-01", to: "2026-09-03" };
const post = (over: Partial<{ at: string; sentiment: "positive" | "negative" | "neutral" }> = {}) => ({
  at: "2026-09-02T10:00:00.000Z", author: "Author A", handle: null, network: "news", mediaType: "news", sentiment: "positive" as const, title: "Title", text: "Body text", url: "https://example.com/a", ...over,
});

test("ticketingSummary counts statuses, reply TAT, trend per profile and first-time resolution", () => {
  const rows = [
    { ticketId: "a", at: "2026-09-01T09:00:00.000Z", status: "solved", inQueue: false, agent: "u1", profile: "ch1" },
    { ticketId: "b", at: "2026-09-01T15:00:00.000Z", status: "open", inQueue: true, agent: null, profile: "ch1" },
    { ticketId: "c", at: "2026-09-03T09:30:00.000Z", status: "closed", inQueue: false, agent: "u1", profile: "kind:webform" },
  ];
  const msgs = [
    { ticket_id: "a", direction: "in" as const, created_at: "2026-09-01T09:00:00.000Z" },
    { ticket_id: "a", direction: "out" as const, created_at: "2026-09-01T10:00:00.000Z" },
    { ticket_id: "c", direction: "in" as const, created_at: "2026-09-03T09:30:00.000Z" },
    { ticket_id: "c", direction: "out" as const, created_at: "2026-09-03T09:40:00.000Z" },
    { ticket_id: "c", direction: "in" as const, created_at: "2026-09-03T11:00:00.000Z" },
    { ticket_id: "c", direction: "out" as const, created_at: "2026-09-03T11:20:00.000Z" },
  ];
  const s = m.ticketingSummary(rows, msgs, new Map([["a", 0]]), range, "day", (id) => (id === "ch1" ? "Support mail" : "Web form"));
  assert.equal(s.total, 3);
  assert.equal(s.stats.total, 3);
  assert.equal(s.stats.solved, 1);
  assert.equal(s.stats.open, 1);
  assert.equal(s.stats.closed, 1);
  assert.equal(s.stats.assign_pending, 1);
  // replies: a 3600s; c 600s then 1200s → average (3600+600+1200)/3, first (3600+600)/2, second 1200
  assert.equal(s.tat.average, 1800);
  assert.equal(s.tat.first, 2100);
  assert.equal(s.tat.second, 1200);
  assert.equal(s.tat.third, null);
  assert.deepEqual(s.profiles.map((p) => [p.name, p.total]), [["Support mail", 2], ["Web form", 1]]);
  assert.deepEqual(s.trend.map((r) => [r.key, r.ch1, r["kind:webform"]]), [["2026-09-01", 2, 0], ["2026-09-02", 0, 0], ["2026-09-03", 0, 1]]);
  assert.equal(s.buzz.peakDate, "2026-09-01");
  // a: resolved after 1 reply → first; c: 2 replies → multi; b: open
  assert.deepEqual(s.ftr.counts, { first: 1, multi: 1, noreply: 0, open: 1 });
  assert.equal(s.ftr.rate, 50);
});

test("ticketingSheets: one sheet per widget with D:H:M TAT and n/a for unknowns", () => {
  const s = m.ticketingSummary([], [], new Map(), range, "day", (id) => id);
  const sheets = m.ticketingSheets(s, "day");
  assert.deepEqual(sheets.map((x) => x.name), [...m.TICKETING_SHEETS]);
  const tat = sheets.find((x) => x.name === "Reply TAT")!;
  assert.deepEqual(tat.rows[1], ["Average reply TAT", "n/a", null]);
  const ftr = sheets.find((x) => x.name === "First Time Resolution")!;
  assert.deepEqual(ftr.rows.at(-1), ["First-time resolution rate %", "n/a"]);
  const trend = sheets.find((x) => x.name === "Ticket Trend")!;
  assert.deepEqual(trend.rows[0], ["Period", "Total"]);
  assert.equal(trend.rows.length, 4);
  assert.deepEqual(trend.rows[1], ["01/09/2026", 0]);
});

test("sovSheets maps the Share of Voice view", () => {
  const v = {
    entities: [{ id: "t1", name: "Topic One" }, { id: "owned", name: "Owned profiles" }],
    trend: [{ key: "2026-09-01", t1: 2, owned: 1 }, { key: "2026-09-02", t1: 0, owned: 3 }],
    buzz: { name: "Brand", total: 6, avgPerDay: 2, peakDate: "2026-09-02", peakDateCount: 3, peakHour: 14 },
    sentiment: [{ key: "t1", positive: 1, negative: 1, neutral: 0 }, { key: "owned", positive: 0, negative: 0, neutral: 4 }],
    sov: { total: 6, slices: [{ id: "t1", name: "Topic One", value: 2, pct: 33.3333 }, { id: "owned", name: "Owned profiles", value: 4, pct: 66.6667 }], most: { name: "Owned profiles", value: 4 }, least: { name: "Topic One", value: 2 } },
    posts: { items: [post()] },
    cloud: { words: [{ word: "delivery", count: 3 }] },
  };
  const sheets = m.sovSheets(v, "week");
  assert.deepEqual(sheets.map((x) => x.name), [...m.SOV_SHEETS]);
  assert.deepEqual(sheets[0].rows[0], ["Period", "Topic One", "Owned profiles", "Total"]);
  assert.deepEqual(sheets[0].rows[2], ["Week of 02/09/2026", 0, 3, 3]);
  assert.deepEqual(sheets[1].rows.at(-1), ["Peak time", "2:00 PM"]);
  assert.deepEqual(sheets[2].rows[1], ["Topic One", 1, 1, 0, 2]);
  assert.deepEqual(sheets[3].rows[1], ["Topic One", 2, 33.3]);
  assert.deepEqual(sheets[4].rows[1].slice(0, 6), ["02/09/2026", "Author A", "", "news", "news", "Positive"]);
  assert.deepEqual(sheets[5].rows, [["Word", "Conversations"], ["delivery", 3]]);
});

test("sentimentSheets maps KPIs with change and keeps unknown change empty", () => {
  const counts = { total: 4, positive: 2, negative: 1, neutral: 1 };
  const v = {
    entities: [{ id: "t1", name: "Topic One" }],
    kpis: { total: { value: 4, change: 100 }, positive: { value: 2, change: null }, negative: { value: 1, change: -50 }, neutral: { value: 1, change: 0 } },
    overTime: { data: [{ key: "2026-09-01", positive: 2, negative: 1, neutral: 1 }], peaks: { avgPositive: 1, avgNegative: 0, mostPositiveOn: "2026-09-01", mostNegativeOn: null } },
    byEntity: [{ key: "t1", name: "Topic One", ...counts }],
    extremes: { positive: { most: { name: "Topic One", count: 2, pct: 50 }, least: { name: "Topic One", count: 2, pct: 50 } }, negative: { most: null, least: null } },
    byMedia: { rows: [{ mediaType: "news", ...counts, pctPositive: 50, pctNegative: 25, pctNeutral: 25 }] },
    clouds: { positive: [{ word: "great", count: 2 }], negative: [] },
    trends: [{ label: "Current 7 days", range: { from: "2026-08-28", to: "2026-09-03" }, counts, change: { positive: null, negative: 10, neutral: 0 } }],
    top: { positive: [post()], negative: [post({ sentiment: "negative" })] },
  };
  const sheets = m.sentimentSheets(v, "day");
  assert.deepEqual(sheets.map((x) => x.name), [...m.SENTIMENT_SHEETS]);
  assert.deepEqual(sheets[0].rows.slice(1), [["Total", 4, 100], ["Positive", 2, null], ["Negative", 1, -50], ["Neutral", 1, 0]]);
  assert.deepEqual(sheets[2].rows.at(-1), ["Most negative on", "n/a"]);
  assert.deepEqual(sheets[3].rows[1], ["Positive", 2, 50]);
  assert.deepEqual(sheets[5].rows[3], ["Most negative", "n/a", null, null]);
  assert.deepEqual(sheets[9].rows[1], ["Current 7 days", "28/08/2026", "03/09/2026", 2, null, 1, 10, 1, 0]);
  assert.equal(sheets[11].rows[1][5], "Negative");
});

test("uniqueSheetNames truncates to 31 chars and de-duplicates; workbook builds", () => {
  const sheets = m.uniqueSheetNames([
    { name: "Report", rows: [["a"]] },
    ...m.prefixed("Sentiment", [{ name: "Overall Sentiment", rows: [["a"]] }]),
    ...m.prefixed("SOV", [{ name: "Overall Sentiment", rows: [["a"]] }]),
    { name: "A very long sheet name that goes past the limit", rows: [["a"]] },
    { name: "A very long sheet name that goes past the limit", rows: [["a"]] },
    { name: "bad/name:[x]", rows: [["a"]] },
  ]);
  const names = sheets.map((s) => s.name);
  assert.equal(new Set(names.map((n) => n.toLowerCase())).size, names.length);
  assert.ok(names.every((n) => n.length <= 31));
  assert.equal(names[1], "Sentiment - Overall Sentiment");
  assert.equal(names[4], "A very long sheet name that g 2");
  assert.equal(names[5], "bad name x");
  const buf = buildXlsx(sheets);
  assert.equal(buf.readUInt32LE(0), 0x04034b50);
  assert.ok(buf.toString("latin1").includes("xl/worksheets/sheet6.xml"));
});

test("coverSheet lists the filters; workbookName slugs brand and report", () => {
  const c = m.coverSheet({ report: "Ticketing", brand: "Acme Co", range, scope: "Acme Co", media: [], basis: "publish", interval: "day", generatedAt: new Date("2026-09-03T12:34:56Z") });
  assert.deepEqual(c.rows.find((r) => r[0] === "Period"), ["Period", "01/09/2026 - 03/09/2026"]);
  assert.deepEqual(c.rows.find((r) => r[0] === "Media types"), ["Media types", "All"]);
  assert.deepEqual(c.rows.find((r) => r[0] === "Generated (UTC)"), ["Generated (UTC)", "2026-09-03 12:34"]);
  assert.equal(m.workbookName("Acme Co", "Share of Voice", range), "acme-co-share-of-voice-2026-09-01-to-2026-09-03.xlsx");
  assert.ok(m.isChoice("all") && m.isChoice("ticketing") && !m.isChoice("x"));
});
