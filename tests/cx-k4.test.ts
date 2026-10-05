import assert from "node:assert/strict";
import { test } from "node:test";

const m = await import("../src/lib/cx/reports/model");
const f = await import("../src/lib/cx/reports/filters");
const { buildScope } = await import("../src/lib/cx/reports/scope-model");

type Row = import("../src/lib/cx/reports/model").RRow;
let n = 0;
const row = (p: Partial<Row>): Row => ({
  id: `m:${++n}`, kind: "mention", at: "2026-09-29T10:00:00.000Z", sentiment: "neutral", entities: ["a"], mediaType: "news", network: "news",
  author: "Author", handle: null, avatar: null, title: "", text: "", url: null, ticketId: null, ticketNumber: null, mentionId: String(n), engagement: null, score: null, ...p,
});
const R = { from: "2026-09-29", to: "2026-10-05" };

test("parseRange defaults to 7 days, swaps reversed dates and caps at 366 days", () => {
  assert.deepEqual(m.parseRange({}, "2026-10-05"), R);
  assert.deepEqual(m.parseRange({ from: "2026-10-05", to: "2026-09-29" }, "2026-10-05"), R);
  assert.deepEqual(m.parseRange({ from: "2020-01-01", to: "2026-10-05" }, "2026-10-05"), { from: "2025-10-05", to: "2026-10-05" });
  assert.deepEqual(m.parseRange({ from: "junk" }, "2026-10-05"), R);
  assert.equal(m.rangeDays(R), 7);
  assert.deepEqual(m.previousRange(R), { from: "2026-09-22", to: "2026-09-28" });
});

test("formatting: dmy, hour labels, D:H:M turnaround, % change", () => {
  assert.equal(m.dmy("2026-09-29"), "29/09/2026");
  assert.equal(m.dmy("2026-09"), "09/2026");
  assert.equal(m.rangeLabel(R), "29/09/2026 - 05/10/2026");
  assert.equal(m.hourLabel(18), "6:00 PM");
  assert.equal(m.hourLabel(0), "12:00 AM");
  assert.equal(m.hourLabel(null), "n/a");
  assert.equal(m.dhm(2 * 3600 + 22 * 60 + 59), "0D : 2H : 22M");
  assert.equal(m.dhm(26 * 3600), "1D : 2H : 0M");
  assert.equal(m.dhm(null), "n/a");
  assert.equal(m.pctChange(101, 184)!.toFixed(2), "-45.11");
  assert.equal(m.pctChange(5, 0), null);
});

test("timeSeries fills every bucket and counts rows per series", () => {
  const rows = [row({ at: "2026-09-29T01:00:00Z", sentiment: "positive" }), row({ at: "2026-09-29T23:00:00Z", sentiment: "negative" }), row({ at: "2026-10-05T12:00:00Z", sentiment: "positive" })];
  const s = m.timeSeries(rows, R, "day", (r) => [r.sentiment], m.SENTIMENTS);
  assert.equal(s.length, 7);
  assert.deepEqual(s[0], { key: "2026-09-29", positive: 1, negative: 1, neutral: 0 });
  assert.equal(s[6].positive, 1);
  const w = m.timeSeries(rows, R, "week", (r) => [r.sentiment], m.SENTIMENTS);
  assert.deepEqual(w.map((x) => x.key), ["2026-09-28", "2026-10-05"]);
});

test("buzzStats: total, average per day, peak date and hour", () => {
  const rows = [row({ at: "2026-10-03T18:05:00Z" }), row({ at: "2026-10-03T18:40:00Z" }), row({ at: "2026-09-30T09:00:00Z" })];
  const b = m.buzzStats(rows, R);
  assert.equal(b.total, 3);
  assert.equal(b.avgPerDay, 0);
  assert.equal(b.peakDate, "2026-10-03");
  assert.equal(b.peakHour, 18);
  assert.equal(m.buzzStats([], R).peakHour, null);
});

test("share of voice, extremes and media-type split", () => {
  const ents = [{ id: "a", name: "A", kind: "topic" as const }, { id: "b", name: "B", kind: "topic" as const }, { id: "c", name: "C", kind: "topic" as const }];
  const rows = [row({ entities: ["a"], sentiment: "positive" }), row({ entities: ["a"], sentiment: "negative", mediaType: "email" }), row({ entities: ["a", "b"], sentiment: "positive" })];
  const counts = m.entityCounts(rows, ents);
  assert.deepEqual(counts.map((c) => c.total), [3, 1, 0]);
  const sov = m.shareOfVoice(counts);
  assert.equal(sov.total, 4);
  assert.equal(sov.most!.id, "a");
  assert.equal(sov.least!.id, "b");
  assert.equal(sov.slices[0].pct, 75);
  const ex = m.extremes(counts, "positive");
  assert.equal(ex.most!.id, "a");
  assert.equal(ex.most!.count, 2);
  assert.equal(ex.least!.id, "b");
  assert.equal(ex.least!.pct, 100);
  const byMedia = m.byMediaType(rows);
  assert.equal(byMedia[0].mediaType, "news");
  assert.equal(byMedia[1].pctNegative, 100);
});

test("toPercent rescales over the visible keys only", () => {
  const p = m.toPercent([{ key: "x", positive: 1, negative: 1, neutral: 2 }], ["positive", "negative"]);
  assert.equal(p[0].positive, 50);
  assert.equal(p[0].neutral, 2);
});

test("currentTrends: three 7-day windows with change vs the next older window", () => {
  const rows = [
    ...Array.from({ length: 4 }, () => row({ at: "2026-10-01T10:00:00Z", sentiment: "positive" })),
    ...Array.from({ length: 2 }, () => row({ at: "2026-09-25T10:00:00Z", sentiment: "positive" })),
    row({ at: "2026-09-18T10:00:00Z", sentiment: "positive" }),
    row({ at: "2026-09-10T10:00:00Z", sentiment: "positive" }),
  ];
  const t = m.currentTrends(rows, "2026-10-05");
  assert.deepEqual(t.map((x) => x.range), [R, { from: "2026-09-22", to: "2026-09-28" }, { from: "2026-09-15", to: "2026-09-21" }]);
  assert.deepEqual(t.map((x) => x.counts.positive), [4, 2, 1]);
  assert.deepEqual(t.map((x) => x.change.positive), [100, 100, 0]);
  assert.equal(t[0].change.negative, null);
});

test("word cloud counts once per conversation and drops topic keywords", () => {
  const rows = [row({ text: "Refund refund delayed again" }), row({ text: "refund was quick" }), row({ title: "Acme", text: "acme delayed" })];
  const own = m.ownWords(['"acme" AND (refund OR delay)']);
  assert.ok(own.has("acme"));
  const w = m.wordCloud(rows, own);
  assert.deepEqual(w.find((x) => x.word === "delayed"), { word: "delayed", count: 2 });
  assert.equal(w.find((x) => x.word === "acme"), undefined);
  assert.equal(w.find((x) => x.word === "refund"), undefined);
  assert.ok(m.hasWord(rows[0], "Delayed"));
});

test("ticket stats, tiles and reply TAT", () => {
  const s = m.ticketStats([
    { status: "new", in_queue: true, assignee_id: null },
    { status: "reopened", in_queue: false, assignee_id: null },
    { status: "wip", in_queue: false, assignee_id: "u" },
    { status: "solved", in_queue: false, assignee_id: "u" },
  ]);
  assert.equal(s.total, 4);
  assert.equal(s.open, 2);
  assert.equal(s.assign_pending, 1);
  assert.equal(s.solved, 1);
  assert.ok(m.matchesTile({ status: "new", in_queue: true, assignee_id: null }, "assign_pending"));
  assert.ok(!m.matchesTile({ status: "wip" }, "open"));
  const t = (min: number) => new Date(Date.UTC(2026, 8, 29, 10, min)).toISOString();
  const tat = m.replyTat([
    { ticket_id: "1", direction: "in", created_at: t(0) },
    { ticket_id: "1", direction: "in", created_at: t(5) },
    { ticket_id: "1", direction: "out", created_at: t(10) },
    { ticket_id: "1", direction: "note", created_at: t(11) },
    { ticket_id: "1", direction: "in", created_at: t(20) },
    { ticket_id: "1", direction: "out", created_at: t(50) },
    { ticket_id: "2", direction: "in", created_at: t(0) },
    { ticket_id: "2", direction: "out", created_at: t(20) },
    { ticket_id: "3", direction: "in", created_at: t(0) },
  ]);
  assert.equal(tat.first, 15 * 60); // (10 + 20) / 2 minutes
  assert.equal(tat.second, 30 * 60);
  assert.equal(tat.third, null);
  assert.equal(tat.average, 20 * 60);
  assert.equal(tat.averageReplies, 1.5);
  assert.equal(tat.perTicket.get("3")!.length, 0);
});

test("first time resolution", () => {
  const replies = new Map([["a", 1], ["b", 3], ["c", 1]]);
  const r = m.firstTimeResolution([
    { id: "a", status: "solved", reopen_count: 0 },
    { id: "b", status: "closed", reopen_count: 0 },
    { id: "c", status: "solved", reopen_count: 1 },
    { id: "d", status: "open", reopen_count: 0 },
    { id: "e", status: "closed", reopen_count: 0 },
  ], replies);
  assert.deepEqual(r.counts, { first: 1, multi: 2, noreply: 1, open: 1 });
  assert.equal(r.rate!.toFixed(1), "33.3");
});

test("drill specs: declarative maps, windows and row matching", () => {
  const base = { source: "conversations" as const, range: R, interval: "day" as const };
  const spec = m.drillFor({ base, series: "sentiment", x: "bucket" }, { series: "negative", x: "2026-09-29", title: ["Negative", "29/09/2026"] });
  assert.equal(spec.title, "Negative · 29/09/2026");
  assert.equal(spec.sentiment, "negative");
  assert.deepEqual(m.drillWindow(spec), { from: "2026-09-29", to: "2026-09-29" });
  assert.deepEqual(m.drillWindow({ range: R, bucket: "2026-09-28", interval: "week" }), { from: "2026-09-28", to: "2026-10-04" });
  assert.deepEqual(m.drillWindow({ range: R, bucket: "2026-09", interval: "month" }), { from: "2026-09-01", to: "2026-09-30" });
  const neg = row({ sentiment: "negative", at: "2026-09-29T20:00:00Z" });
  assert.ok(m.drillMatches(neg, spec));
  assert.ok(!m.drillMatches(row({ sentiment: "negative", at: "2026-09-30T00:00:00Z" }), spec));
  assert.ok(!m.drillMatches(row({ sentiment: "positive", at: "2026-09-29T20:00:00Z" }), spec));
  assert.ok(!m.drillMatches(neg, { ...spec, source: "tickets" }));
  assert.ok(m.drillMatches(neg, { ...spec, item: neg.id }));
  assert.ok(!m.drillMatches(neg, { ...spec, item: "m:other" }));
  const dims = m.withDim(base, "dims.status", "done");
  assert.deepEqual(dims.dims, { status: "done" });
  const tk = row({ kind: "ticket", status: "new", inQueue: true, agent: null, profile: "ch1" });
  assert.ok(m.drillMatches(tk, { ...base, title: "", source: "tickets", status: "assign_pending", profile: "ch1" }));
  assert.ok(!m.drillMatches(tk, { ...base, title: "", source: "tickets", status: "assigned" }));
  assert.ok(m.drillMatches(row({ kind: "ticket", status: "follow_up" }), { ...base, title: "", source: "tickets", status: "pending,follow_up" }));
  assert.ok(m.refineMatches(row({ text: "Late delivery" }), { q: "late" }));
  assert.ok(!m.refineMatches(row({ text: "fine" }), { q: "late" }));
  const pg = m.pageOf([1, 2, 3, 4, 5], 2, 2);
  assert.deepEqual(pg, { items: [3, 4], total: 5, nextPage: 3 });
});

test("report filters live in the URL", () => {
  const r = f.readFilters({ from: "2026-09-01", to: "2026-09-07", media: "news,bogus,email", basis: "created", interval: "week", scope: "c.x~t.y" }, "2026-10-05");
  assert.deepEqual(r.range, { from: "2026-09-01", to: "2026-09-07" });
  assert.deepEqual(r.media, ["news", "email"]);
  assert.equal(r.basis, "created");
  assert.equal(r.interval, "week");
  const q = f.filterQuery(r);
  assert.deepEqual(f.parseFilterQuery(q), { scope: "c.x~t.y", media: "news,email" });
  assert.equal(f.readFilters({}, "2026-10-05").basis, "publish");
  assert.equal(f.localToday(330, new Date("2026-10-04T20:00:00Z")), "2026-10-05");
});

test("report scope: default compares topics; ticked clusters/topics/profiles become entities", () => {
  const options = {
    clusters: [{ id: "c1", name: "North", channelIds: ["ch1"], sources: ["news"], topicIds: ["t2"], isDefault: false }],
    topics: [{ id: "t1", name: "Brand", kind: "brand", active: true }, { id: "t2", name: "Rival", kind: "competitor", active: true }],
    profiles: [{ id: "ch1", name: "Support mail", network: "email", type: "channel" as const }, { id: "src_mastodon", name: "Mastodon", network: "mastodon", type: "source" as const }],
  };
  const d = buildScope({ clusters: [], topics: [], profiles: [] }, options, "Acme");
  assert.ok(d.isDefault);
  assert.deepEqual(d.mentionEntities({ topic_id: "t1", source: "news" }), ["t1"]);
  assert.deepEqual(d.mentionEntities({ topic_id: null, source: "news" }), ["other"]);
  assert.deepEqual(d.ticketEntities({ channel_id: "ch1", channel_kind: "email", mention_topic: null, from_mention: false }, true), ["owned"]);
  assert.deepEqual(d.ticketEntities({ channel_id: null, channel_kind: "news", mention_topic: "t1", from_mention: true }, true), []);
  assert.deepEqual(d.ticketEntities({ channel_id: null, channel_kind: "news", mention_topic: "t1", from_mention: true }, false), ["t1"]);

  const s = buildScope({ clusters: ["c1"], topics: ["t1"], profiles: ["src_mastodon"] }, options, "Acme");
  assert.deepEqual(s.entities.map((e) => e.name), ["North (C)", "Brand", "Mastodon"]);
  assert.deepEqual(s.mentionEntities({ topic_id: "t2", source: "reddit" }), ["c1"]);
  assert.deepEqual(s.mentionEntities({ topic_id: "t1", source: "news" }), ["c1", "t1"]);
  assert.deepEqual(s.mentionEntities({ topic_id: null, source: "mastodon" }), ["src_mastodon"]);
  assert.deepEqual(s.ticketEntities({ channel_id: "ch1", channel_kind: "email", mention_topic: null, from_mention: false }, true), ["c1"]);
  assert.deepEqual(s.ticketEntities({ channel_id: null, channel_kind: "news", mention_topic: "t2", from_mention: true }, true), []);
  assert.deepEqual(s.ticketEntities({ channel_id: null, channel_kind: "news", mention_topic: "t2", from_mention: true }, false), ["c1"]);
});

test("engagement and mention media types", () => {
  assert.equal(m.engagementOf({ likes: 3, reposts: 2, rating: 5 }), 5);
  assert.equal(m.engagementOf({ rating: 4 }), null);
  assert.equal(m.mentionMediaType("hackernews"), "forums");
  assert.equal(m.mentionMediaType("appstore"), "app_reviews");
  assert.equal(m.mentionMediaType("x"), "x_public");
  assert.equal(m.asSentiment(null), "neutral");
});
