import assert from "node:assert/strict";
import { test } from "node:test";

const ab = await import("../src/lib/cx/ops/ab-model");
const { abWinner } = await import("../src/lib/cx/ops/model");

const NOW = Date.parse("2026-10-04T12:00:00Z");
const base = {
  name: "  Autumn   guide ",
  hypothesis: "Questions win",
  channels: ["linkedin", "facebook", "linkedin"],
  linkUrl: "https://example.com/guide",
  textA: "Our guide is live: {link}",
  textB: "Planning your autumn? Read the guide",
  minClicks: 30,
  confidence: 0.95,
  endsAt: null,
  mode: "publish" as const,
  scheduleAt: null,
};

test("cleanAbInput normalises a valid test", () => {
  const r = ab.cleanAbInput(base, NOW);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.name, "Autumn guide");
  assert.deepEqual(r.value.channels, ["linkedin", "facebook"]);
  assert.equal(r.value.scheduleAt, null);
});

test("cleanAbInput rejects bad input with a specific message", () => {
  const err = (patch: Partial<typeof base> | Record<string, unknown>) => {
    const r = ab.cleanAbInput({ ...base, ...patch } as typeof base, NOW);
    return r.ok ? null : r.error;
  };
  assert.match(err({ name: " " })!, /Name/);
  assert.match(err({ channels: [] })!, /channel/);
  assert.match(err({ channels: ["instagram"] })!, /Instagram/);
  assert.match(err({ linkUrl: "" })!, /destination/);
  assert.match(err({ linkUrl: "javascript:alert(1)" })!, /http/);
  assert.match(err({ textB: "Our guide is live: {link}" })!, /identical/);
  assert.match(err({ textB: "" })!, /both variants/);
  assert.match(err({ minClicks: 2 })!, /between 5/);
  assert.match(err({ confidence: 0.8 })!, /90, 95 or 99/);
  assert.match(err({ mode: "schedule", scheduleAt: null })!, /date and time/);
  assert.match(err({ mode: "schedule", scheduleAt: "2026-10-01T10:00:00Z" })!, /past/);
  assert.match(err({ endsAt: "2026-10-04T11:00:00Z" })!, /after/);
  assert.match(err({ channels: ["x"], textA: "a".repeat(270) })!, /Variant A · X: .*over the 280 limit/);
  assert.equal(err({ mode: "schedule", scheduleAt: "2026-10-05T09:00:00Z", endsAt: "2026-10-12T09:00:00Z" }), null);
});

test("variant body, UTM and per-channel problems", () => {
  assert.equal(ab.variantBody("Read it {link} today"), "Read it {link} today");
  assert.equal(ab.variantBody("  Read it  "), "Read it\n\n{link}");
  assert.deepEqual(ab.variantUtm("Autumn Guide!", "b"), { medium: "social", campaign: "ab-autumn-guide", content: "variant-b" });
  // X counts the short link as 23 characters whatever its length.
  assert.deepEqual(ab.variantProblems("a".repeat(255), ["x"]), []);
  assert.equal(ab.variantProblems("a".repeat(260), ["x"]).length, 1);
});

test("effective status: drafts become running once both posts are live; end date expiry", () => {
  const t = { status: "draft", started_at: null, ends_at: null };
  const draft = { status: "draft", scheduled_at: null, published_at: null };
  const pubA = { status: "published", scheduled_at: "2026-10-03T09:00:00.000Z", published_at: "2026-10-03T09:00:05.000Z" };
  const schB = { status: "scheduled", scheduled_at: "2026-10-03T09:00:00.000Z", published_at: null };
  assert.equal(ab.effectiveStatus(t, draft, pubA, NOW).status, "draft");
  const live = ab.effectiveStatus(t, pubA, schB, NOW);
  assert.equal(live.status, "running");
  assert.equal(live.startedAt, "2026-10-03T09:00:05.000Z");
  const future = ab.effectiveStatus({ status: "running", started_at: "2026-10-05T09:00:00.000Z", ends_at: null }, schB, schB, NOW);
  assert.equal(future.notStarted, true);
  assert.equal(ab.statusLabel(future, null), "Scheduled");
  const exp = ab.effectiveStatus({ status: "running", started_at: "2026-10-01T00:00:00Z", ends_at: "2026-10-04T00:00:00Z" }, pubA, pubA, NOW);
  assert.equal(exp.expired, true);
  assert.equal(ab.statusLabel(exp, null), "Time's up");
  assert.equal(ab.statusLabel({ status: "completed", expired: false, notStarted: false }, "b"), "Completed");
  assert.equal(ab.statusLabel({ status: "completed", expired: false, notStarted: false }, null), "Ended");
  assert.equal(ab.effectiveStatus({ status: "completed", started_at: null, ends_at: null }, pubA, pubA, NOW).status, "completed");
});

test("daily series fills missing days with zeros and caps the range", () => {
  const s = ab.dailyVariantSeries(
    [{ day: "2026-10-01", variant: "a", clicks: 3 }, { day: "2026-10-03", variant: "b", clicks: 2 }, { day: "2026-10-03", variant: "a", clicks: 1 }],
    "2026-10-01T15:00:00Z",
    "2026-10-04T08:00:00Z",
  );
  assert.deepEqual(s, [
    { day: "2026-10-01", a: 3, b: 0 },
    { day: "2026-10-02", a: 0, b: 0 },
    { day: "2026-10-03", a: 1, b: 2 },
    { day: "2026-10-04", a: 0, b: 0 },
  ]);
  assert.equal(ab.dailyVariantSeries([], "2026-01-01", "2026-12-31", 30).length, 30);
  assert.deepEqual(ab.dailyVariantSeries([], "2026-10-05", "2026-10-01"), []);
});

test("engagement matches published externalIds to insights; unknown stays null", () => {
  const results = {
    facebook: { status: "published" as const, externalId: "111_222", at: "" },
    linkedin: { status: "published" as const, externalId: "urn:li:share:9", at: "" },
    x: { status: "not_connected" as const, at: "" },
  };
  const recent = {
    facebook: [{ id: "111_222", likes: 4, comments: 1, shares: 0, views: null }],
    linkedin: [{ id: "urn:li:share:9", likes: 2, comments: null, shares: 1, views: 50 }],
  };
  assert.deepEqual(ab.engagementFor(results, recent), { likes: 6, comments: 1, shares: 1, views: 50, matched: 2 });
  assert.deepEqual(ab.engagementFor(results, {}), { likes: null, comments: null, shares: null, views: null, matched: 0 });
  // Facebook "page_post" ids vs bare post ids
  assert.equal(ab.engagementFor({ facebook: { status: "published", externalId: "222", at: "" } }, { facebook: [{ id: "111_222", likes: 0, comments: 0, shares: 0, views: null }] }).likes, 0);
});

test("result labels and status tones", () => {
  assert.deepEqual(ab.resultLabel(undefined, "scheduled"), { label: "Scheduled", tone: "brand" });
  assert.deepEqual(ab.resultLabel({ status: "not_connected", at: "" }, "failed"), { label: "Not connected", tone: "warning" });
  assert.deepEqual(ab.resultLabel({ status: "manual", at: "" }, "published"), { label: "Published manually", tone: "good" });
  assert.equal(ab.abStatusTone({ status: "running", expired: true, notStarted: false }), "warning");
  assert.equal(ab.abStatusTone({ status: "draft", expired: false, notStarted: false }), "neutral");
});

test("winner rule from model.ts as used by the module", () => {
  assert.equal(abWinner(60, 30, { minClicks: 30, confidence: 0.95 }).winner, "a");
  assert.equal(abWinner(40, 30, { minClicks: 30, confidence: 0.95 }).significant, false);
  assert.equal(abWinner(29, 80, { minClicks: 30, confidence: 0.95 }).enough, false);
});
