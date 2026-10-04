import assert from "node:assert/strict";
import { test } from "node:test";

const t = await import("../src/lib/cx/ops/tracker-model");
const { trackerMatches } = await import("../src/lib/cx/ops/model");

test("cleanTracked normalizes handles and validates post URLs", () => {
  const h = t.cleanTracked({ kind: "handle", platform: "x", value: "  @AcmeCo " });
  assert.deepEqual(h, { ok: true, value: { kind: "handle", platform: "x", value: "acmeco", label: "" } });
  const url = t.cleanTracked({ kind: "handle", platform: "mastodon", value: "https://mastodon.social/@acme" });
  assert.equal(url.ok && url.value.value, "acme");
  const masto = t.cleanTracked({ kind: "handle", platform: "mastodon", value: "@acme@mastodon.social" });
  assert.equal(masto.ok && masto.value.value, "acme@mastodon.social");
  assert.equal(t.cleanTracked({ kind: "handle", platform: "x", value: "bad handle!" }).ok, false);
  assert.equal(t.cleanTracked({ kind: "handle", platform: "x", value: "" }).ok, false);
  const p = t.cleanTracked({ kind: "post", platform: "nope", value: " https://www.instagram.com/p/ABC123/ ", label: "  Launch   post " });
  assert.deepEqual(p, { ok: true, value: { kind: "post", platform: "other", value: "https://www.instagram.com/p/ABC123/", label: "Launch post" } });
  assert.equal(t.cleanTracked({ kind: "post", platform: "x", value: "instagram.com/p/x" }).ok, false);
  assert.equal(t.cleanTracked({ kind: "bogus" as "post", platform: "x", value: "https://a.com" }).ok, false);
});

test("publishedTracked keeps published/manual results with URLs and dedupes against stored posts", () => {
  const posts: import("../src/lib/cx/ops/tracker-model").PubPostRow[] = [
    { id: "p1", title: "", body: "Big   launch today", published_at: "2026-09-01T10:00:00.000Z", results: { facebook: { status: "published", url: "https://www.facebook.com/acme/posts/1" }, x: { status: "failed", url: "https://x.com/acme/status/9" }, linkedin: { status: "manual", url: "https://linkedin.com/feed/update/1" } } },
    { id: "p2", title: "Dup", body: "", published_at: null, results: { instagram: { status: "published", url: "https://instagram.com/p/XYZ/" }, youtube: { status: "published" } } },
  ];
  const stored = [{ id: "s1", kind: "post" as const, platform: "instagram", value: "https://www.instagram.com/p/XYZ", label: "" }];
  const out = t.publishedTracked(posts, stored);
  assert.deepEqual(out.map((o) => o.id), ["pub:p1:facebook", "pub:p1:linkedin"]);
  assert.equal(out[0].label, "Big launch today");
  assert.equal(out[0].kind, "post");
  // published posts match mentions linking to them
  assert.equal(trackerMatches({ body: "see https://facebook.com/acme/posts/1?ref=x" }, out).length, 1);
});

test("ticketState and responseMs", () => {
  assert.equal(t.ticketState({ status: "open", first_response_at: "2026-01-01T00:00:00Z" }), "responded");
  assert.equal(t.ticketState({ status: "closed", first_response_at: null }), "responded");
  assert.equal(t.ticketState({ status: "new", first_response_at: null }), "pending");
  assert.equal(t.responseMs("2026-01-01T00:00:00Z", "2026-01-01T01:30:00Z"), 5_400_000);
  assert.equal(t.responseMs("2026-01-01T02:00:00Z", "2026-01-01T01:00:00Z"), null);
  assert.equal(t.responseMs(null, "2026-01-01T01:00:00Z"), null);
});

test("median", () => {
  assert.equal(t.median([]), null);
  assert.equal(t.median([5]), 5);
  assert.equal(t.median([9, 1, 5]), 5);
  assert.equal(t.median([4, 1, 3, 2]), 2.5);
});

const NOW = Date.parse("2026-10-04T12:00:00Z");
const item = (over: Partial<import("../src/lib/cx/ops/tracker-model").TrackerItem>) => ({
  key: "k", kind: "mention" as const, id: "i", source: "mastodon", sourceLabel: "Mastodon", author: "a", handle: null, text: "", matched: [{ id: "h1", label: "@acme" }],
  publishedAt: "2026-10-01T00:00:00Z", state: "pending" as const, responseMs: null, ticketId: null, ticketNumber: null, url: null, sentiment: null, ...over,
});

test("filterItems by status, match, source and date range", () => {
  const items = [
    item({ key: "1", state: "responded", responseMs: 60_000 }),
    item({ key: "2", source: "news", publishedAt: "2026-08-01T00:00:00Z" }),
    item({ key: "3", state: "ignored", matched: [{ id: "p1", label: "post" }] }),
    item({ key: "4", publishedAt: null }),
  ];
  const f = (patch: Partial<import("../src/lib/cx/ops/tracker-model").TrackerFilters>) => t.filterItems(items, { ...t.DEFAULT_FILTERS, ...patch }, NOW).map((i) => i.key);
  assert.deepEqual(f({}), ["1", "2", "3", "4"]);
  assert.deepEqual(f({ range: "30" }), ["1", "3", "4"]);
  assert.deepEqual(f({ status: "responded" }), ["1"]);
  assert.deepEqual(f({ source: "news" }), ["2"]);
  assert.deepEqual(f({ match: "p1" }), ["3"]);
  assert.deepEqual(f({ range: "custom", from: "2026-07-30", to: "2026-08-01" }), ["2"]);
  assert.deepEqual(f({ range: "custom", from: "2026-09-30", to: "" }), ["1", "3"]);
});

test("trackerMetrics excludes ignored from responded % and medians response times", () => {
  const m = t.trackerMetrics([
    item({ state: "responded", responseMs: 60_000 }),
    item({ state: "responded", responseMs: 180_000 }),
    item({ state: "responded", responseMs: null }),
    item({ state: "pending" }),
    item({ state: "in_progress" }),
    item({ state: "ignored" }),
  ]);
  assert.equal(m.total, 6);
  assert.equal(m.responded, 3);
  assert.equal(m.respondedPct, 60);
  assert.equal(m.pending, 1);
  assert.equal(m.inProgress, 1);
  assert.equal(m.ignored, 1);
  assert.equal(m.medianMs, 120_000);
  assert.equal(t.trackerMetrics([]).respondedPct, null);
  assert.equal(t.trackerMetrics([item({ state: "ignored" })]).respondedPct, null);
});
