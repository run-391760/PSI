import assert from "node:assert/strict";
import { test } from "node:test";

/** WP-K4 listening reports: Media Type Analysis, Twitter / Instagram and Classifications (pure models). */
const media = await import("../src/lib/cx/reports/media-model");
const social = await import("../src/lib/cx/reports/social-model");
const cls = await import("../src/lib/cx/reports/classifications-model");

type S = "positive" | "negative" | "neutral";
const row = (mediaType: string, sentiment: S, at = "2026-09-29T10:00:00.000Z", extra: Record<string, unknown> = {}) => ({ mediaType, sentiment, at, engagement: null as number | null, score: null as number | null, kind: "mention" as "mention" | "ticket", profile: null as string | null, ...extra });

// ---------------------------------------------------------------- media type

test("topMediaTypes ranks by conversations, ties by id, and honours the limit", () => {
  const rows = [row("news", "neutral"), row("email", "neutral"), row("email", "negative"), row("x", "positive"), row("blogs", "neutral")];
  assert.deepEqual(media.topMediaTypes(rows, 3), ["email", "blogs", "news"]);
  assert.deepEqual(media.topMediaTypes([], 3), []);
});

test("mediaKpis gives % change vs the previous period and n/a (null) without a previous value", () => {
  const cur = [row("email", "neutral"), row("email", "neutral"), row("email", "positive"), row("news", "neutral")];
  const prev = [row("email", "neutral"), row("email", "negative")];
  const k = media.mediaKpis(cur, prev, 5);
  assert.equal(k.length, 2);
  assert.deepEqual(k[0], { mediaType: "email", value: 3, previous: 2, change: 50 });
  assert.equal(k[1].mediaType, "news");
  assert.equal(k[1].change, null);
  assert.equal(media.mediaKpis(cur, prev, 1).length, 1);
});

test("mediaTable adds shares and mediaTotals sums every media type", () => {
  const rows = [row("email", "positive"), row("email", "negative"), row("news", "neutral"), row("news", "neutral")];
  const t = media.mediaTable(rows);
  assert.equal(t.length, 2);
  assert.equal(t[0].share + t[1].share, 100);
  const email = t.find((r) => r.mediaType === "email")!;
  assert.equal(email.pctPositive, 50);
  assert.deepEqual(media.mediaTotals(t), { total: 4, positive: 1, negative: 1, neutral: 2 });
  assert.deepEqual(media.mediaTable([]), []);
  assert.equal(media.pct2(33.33333), 33.33);
});

// ---------------------------------------------------------------- twitter / instagram

test("networkMedia follows the media-type catalogue", () => {
  const x = social.networkMedia("twitter");
  assert.ok(x.includes("x") && x.includes("x_public"));
  assert.ok(!x.includes("instagram_comments"));
  const ig = social.networkMedia("instagram");
  for (const m of ["instagram_messages", "instagram_comments", "instagram_mentions", "instagram_tags"]) assert.ok(ig.includes(m), m);
  assert.ok(!ig.includes("x"));
});

test("effectiveMedia narrows the media filter to the network, or falls back to all of its media types", () => {
  assert.deepEqual(social.effectiveMedia(["x", "news"], "twitter"), ["x"]);
  assert.deepEqual(social.effectiveMedia([], "twitter"), social.networkMedia("twitter"));
  assert.deepEqual(social.effectiveMedia(["email"], "instagram"), social.networkMedia("instagram"));
});

test("ofMedia keeps only the network's rows", () => {
  const rows = [row("x", "neutral"), row("x_public", "positive"), row("news", "neutral"), row("instagram_comments", "negative")];
  assert.equal(social.ofMedia(rows, social.networkMedia("twitter")).length, 2);
  assert.equal(social.ofMedia(rows, social.networkMedia("instagram")).length, 1);
});

test("sentimentKpis counts each sentiment with % change; null when the previous period had none", () => {
  const k = social.sentimentKpis([row("x", "positive"), row("x", "positive"), row("x", "negative")], [row("x", "positive")]);
  assert.deepEqual(k.total, { value: 3, change: 200 });
  assert.deepEqual(k.positive, { value: 2, change: 100 });
  assert.deepEqual(k.negative, { value: 1, change: null });
  assert.deepEqual(k.neutral, { value: 0, change: null });
});

test("rankPosts: engagement first, then sentiment strength, then newest", () => {
  const rows = [
    { id: "a", engagement: null, score: 0.9, at: "2026-09-29T10:00:00Z" },
    { id: "b", engagement: 12, score: 0.1, at: "2026-09-28T10:00:00Z" },
    { id: "c", engagement: null, score: -0.9, at: "2026-09-30T10:00:00Z" },
    { id: "d", engagement: null, score: null, at: "2026-09-30T11:00:00Z" },
  ];
  assert.deepEqual(social.rankPosts(rows).map((r) => r.id), ["b", "c", "a", "d"]);
  assert.equal(social.rankPosts(rows, 2).length, 2);
});

test("profileCounts counts ticket rows per inbox profile and keeps empty profiles", () => {
  const rows = [row("x", "neutral", undefined, { kind: "ticket", profile: "ch-1" }), row("x", "neutral", undefined, { kind: "ticket", profile: "ch-1" }), row("x", "neutral", undefined, { kind: "mention", profile: "ch-2" })];
  assert.deepEqual(social.profileCounts(rows, [{ id: "ch-2", name: "Support B" }, { id: "ch-1", name: "Support A" }]), [
    { id: "ch-1", name: "Support A", count: 2 },
    { id: "ch-2", name: "Support B", count: 0 },
  ]);
});

test("profileState shows stats only for a connected profile, else an error or the connect card", () => {
  assert.equal(social.profileState(null, null), "connect");
  assert.equal(social.profileState({ connected: false }, null), "connect");
  assert.equal(social.profileState({ connected: true }, { stats: { followers: 1 }, error: null }), "live");
  assert.equal(social.profileState({ connected: true }, { stats: null, error: "401" }), "error");
});

test("recentEngagement uses only posts that report views", () => {
  assert.equal(social.recentEngagement([]), null);
  assert.equal(social.recentEngagement([{ views: null, likes: 5, comments: 1, shares: 0 }]), null);
  assert.equal(social.recentEngagement([{ views: 100, likes: 5, comments: 3, shares: 2 }, { views: null, likes: 50, comments: 0, shares: 0 }]), 10);
});

// ---------------------------------------------------------------- classifications

const TREE = [
  { id: "c1", parentId: null, label: "Complaint", hidden: false },
  { id: "c2", parentId: null, label: "Query", hidden: false },
  { id: "c3", parentId: null, label: "Old bucket", hidden: true },
  { id: "c1a", parentId: "c1", label: "Delivery", hidden: false },
  { id: "c1b", parentId: "c1", label: "Billing", hidden: false },
  { id: "c1a1", parentId: "c1a", label: "Late", hidden: false },
];
const t = (classes: string[], sentiment: S = "neutral", at = "2026-09-29T10:00:00.000Z") => ({ classes, sentiment, at });

test("tree helpers: children, path, node pick and descendants", () => {
  assert.deepEqual(cls.childrenOf(TREE, null).map((n) => n.id), ["c1", "c2", "c3"]);
  assert.deepEqual(cls.pathTo(TREE, "c1a1").map((n) => n.id), ["c1", "c1a", "c1a1"]);
  assert.deepEqual(cls.pathTo(TREE, "nope"), []);
  assert.equal(cls.pickNode(TREE, "c1"), "c1");
  assert.equal(cls.pickNode(TREE, "c2"), null, "a leaf has no level to open");
  assert.equal(cls.pickNode(TREE, "missing"), null);
  assert.equal(cls.pickNode(TREE, undefined), null);
  assert.deepEqual(cls.descendants(TREE, "c1").sort(), ["c1a", "c1a1", "c1b"]);
});

test("pathTo survives a cycle in malformed data", () => {
  const loop = [{ id: "a", parentId: "b", label: "A", hidden: false }, { id: "b", parentId: "a", label: "B", hidden: false }];
  assert.ok(cls.pathTo(loop, "a").length <= 20);
});

test("levelBreakdown at the top level counts paths, shares and Unclassified; hides empty hidden nodes", () => {
  const rows = [t(["c1", "c1a", "c1a1"], "negative"), t(["c1", "c1b"], "negative"), t(["c2"], "positive"), t([]), t([])];
  const b = cls.levelBreakdown(rows, TREE, null);
  assert.equal(b.base, 5);
  assert.deepEqual(b.items.map((i) => i.id), ["c1", "c2"]);
  const c1 = b.items[0];
  assert.equal(c1.total, 2);
  assert.equal(c1.negative, 2);
  assert.equal(c1.share, 40);
  assert.equal(c1.hasChildren, true);
  assert.equal(b.items[1].hasChildren, false);
  assert.equal(b.rest.total, 2);
  assert.equal(b.rest.share, 40);
});

test("levelBreakdown below a node uses the parent's tickets and reports No sub-classification", () => {
  const rows = [t(["c1", "c1a", "c1a1"]), t(["c1", "c1a"]), t(["c1"]), t(["c2"])];
  const b = cls.levelBreakdown(rows, TREE, "c1");
  assert.equal(b.base, 3);
  assert.deepEqual(b.items.map((i) => [i.id, i.total]), [["c1a", 2], ["c1b", 0]]);
  assert.equal(b.rest.total, 1);
  const deeper = cls.levelBreakdown(rows, TREE, "c1a");
  assert.deepEqual(deeper.items.map((i) => [i.id, i.total]), [["c1a1", 1]]);
  assert.equal(deeper.rest.total, 1);
});

test("hidden nodes still show when they have tickets", () => {
  const b = cls.levelBreakdown([t(["c3"])], TREE, null);
  assert.ok(b.items.some((i) => i.id === "c3" && i.hidden && i.total === 1));
});

test("classifiedCounts and asIds", () => {
  assert.deepEqual(cls.classifiedCounts([{ classes: ["c1"] }, { classes: [] }]), { total: 2, classified: 1, unclassified: 1, rate: 50 });
  assert.equal(cls.classifiedCounts([]).rate, null);
  assert.deepEqual(cls.asIds(["a", 3, "", "b"]), ["a", "b"]);
  assert.deepEqual(cls.asIds(null), []);
  assert.deepEqual(cls.asIds("a"), []);
});
