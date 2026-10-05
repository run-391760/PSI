import assert from "node:assert/strict";
import { test } from "node:test";

/** WP-K1: Topic / Profile scope (src/lib/cx/ops/scope-model.ts) — URL encoding, resolution and SQL. */
const s = await import("../src/lib/cx/ops/scope-model");

const OPTIONS: import("../src/lib/cx/ops/scope-model").ScopeOptions = {
  clusters: [
    { id: "g-all", name: "Brand Overall", channelIds: ["ch-ig", "ch-fb"], sources: ["news"], topicIds: ["tp-brand"], isDefault: true },
    { id: "g-city", name: "City Campus", channelIds: ["ch-fb"], sources: [], topicIds: [], isDefault: false },
  ],
  topics: [
    { id: "tp-brand", name: "Brand", kind: "brand", active: true },
    { id: "tp-rival", name: "Rival", kind: "competitor", active: false },
  ],
  profiles: [
    { id: "ch-ig", name: "Brand IG", network: "instagram", type: "channel", status: "active" },
    { id: "ch-fb", name: "Brand FB", network: "facebook", type: "channel", status: "active" },
    { id: "ch-mail", name: "Support mail", network: "email", type: "channel", status: "error" },
    { id: "src_news", name: "Google News", network: "news", type: "source" },
    { id: "src_reddit", name: "Reddit", network: "reddit", type: "source" },
  ],
};

test("encodeScope / decodeScope round-trip, sorted and compact", () => {
  const v = { clusters: ["g-city", "g-all"], topics: [], profiles: ["src_news", "ch-ig"] };
  const enc = s.encodeScope(v);
  assert.equal(enc, "c.g-all.g-city*p.ch-ig.src_news");
  // URLSearchParams leaves the encoding as is (compact, readable links).
  assert.equal(s.withScopeParam("", v).toString(), `scope=${enc}`);
  assert.deepEqual(s.decodeScope(enc), { clusters: ["g-all", "g-city"], topics: [], profiles: ["ch-ig", "src_news"] });
  assert.equal(s.encodeScope(s.EMPTY_SCOPE), "");
  assert.ok(s.sameScope(v, s.decodeScope(enc)));
});

test("ids with separators survive the URL, also through URLSearchParams", () => {
  const v = { clusters: [], topics: ["a.b", "c*d", "é x"], profiles: [] };
  const params = s.withScopeParam("brand=b1&page=3", v);
  assert.equal(params.get("brand"), "b1");
  const back = s.scopeFromParams(new URLSearchParams(params.toString()));
  assert.deepEqual([...back.topics].sort(), ["a.b", "c*d", "é x"].sort());
  assert.equal(s.withScopeParam(params, s.EMPTY_SCOPE).has("scope"), false);
});

test("decodeScope tolerates junk, arrays and duplicates", () => {
  assert.deepEqual(s.decodeScope(undefined), s.EMPTY_SCOPE);
  assert.deepEqual(s.decodeScope(""), s.EMPTY_SCOPE);
  assert.deepEqual(s.decodeScope("zz.1*c..x.x*p.%E0%A4"), { clusters: ["x"], topics: [], profiles: [] });
  assert.deepEqual(s.decodeScope(["t.a", "t.b"]), { clusters: [], topics: ["a"], profiles: [] });
  assert.deepEqual(s.scopeFromParams({ scope: "p.ch-ig" }), { clusters: [], topics: [], profiles: ["ch-ig"] });
});

test("resolveScopeWith: empty = all; clusters expand; union with topics and profiles; unknown ids ignored", () => {
  assert.deepEqual(s.resolveScopeWith(s.EMPTY_SCOPE, OPTIONS), { all: true, channelIds: [], topicIds: [], sourceKinds: [] });
  const r = s.resolveScopeWith({ clusters: ["g-all", "nope"], topics: ["tp-rival", "gone"], profiles: ["ch-mail", "src_reddit", "ch-deleted"] }, OPTIONS);
  assert.equal(r.all, false);
  assert.deepEqual(r.channelIds.sort(), ["ch-fb", "ch-ig", "ch-mail"]);
  assert.deepEqual(r.topicIds.sort(), ["tp-brand", "tp-rival"]);
  assert.deepEqual(r.sourceKinds.sort(), ["news", "reddit"]);
  // A scope of only deleted ids selects nothing (not everything).
  const none = s.resolveScopeWith({ clusters: ["gone"], topics: [], profiles: [] }, OPTIONS);
  assert.deepEqual(none, { all: false, channelIds: [], topicIds: [], sourceKinds: [] });
});

test("scopeNames follows option order; pruneScope drops deleted ids; filterOptions searches name + network", () => {
  assert.deepEqual(s.scopeNames({ clusters: ["g-city", "g-all"], topics: ["tp-brand"], profiles: ["src_news"] }, OPTIONS), ["Brand Overall", "City Campus", "Brand", "Google News"]);
  assert.deepEqual(s.pruneScope({ clusters: ["g-all", "x"], topics: ["y"], profiles: ["ch-ig"] }, OPTIONS), { clusters: ["g-all"], topics: [], profiles: ["ch-ig"] });
  assert.deepEqual(s.filterOptions(OPTIONS.profiles, "FACE").map((p) => p.id), ["ch-fb"]);
  assert.deepEqual(s.filterOptions(OPTIONS.profiles, " brand ").map((p) => p.id), ["ch-ig", "ch-fb"]);
  assert.equal(s.filterOptions(OPTIONS.topics, "").length, 2);
});

test("SQL helpers bind parameters and handle all / nothing", () => {
  const all = s.resolveScopeWith(s.EMPTY_SCOPE, OPTIONS);
  const p0: unknown[] = [];
  assert.equal(s.ticketScopeSql(all, s.binder(p0)), "true");
  assert.equal(s.messageScopeSql(all, s.binder(p0)), "true");
  assert.equal(s.mentionScopeSql(all, s.binder(p0)), "true");
  assert.equal(p0.length, 0);

  const nothing = { all: false, channelIds: [], topicIds: [], sourceKinds: [] };
  assert.equal(s.ticketScopeSql(nothing, s.binder([])), "false");
  assert.equal(s.messageScopeSql(nothing, s.binder([])), "false");
  assert.equal(s.mentionScopeSql(nothing, s.binder([])), "false");

  const r = s.resolveScopeWith({ clusters: ["g-all"], topics: [], profiles: [] }, OPTIONS);
  const params: unknown[] = ["project"];
  const t = s.ticketScopeSql(r, s.binder(params), "t");
  assert.match(t, /t\.channel_id = ANY\(\$2::text\[\]\)/);
  assert.match(t, /t\.channel_id IS NULL AND t\.channel_kind = ANY\(\$3::text\[\]\)/);
  assert.match(t, /sm\.topic_id = ANY\(\$4::text\[\]\)/);
  assert.deepEqual(params, ["project", ["ch-ig", "ch-fb"], ["news"], ["tp-brand"]]);

  const mp: unknown[] = [];
  assert.match(s.messageScopeSql(r, s.binder(mp), "msg"), /^msg\.ticket_id IN \(SELECT st\.id FROM cx_tickets st WHERE \(st\.channel_id/);
  const np: unknown[] = [];
  const mn = s.mentionScopeSql(r, s.binder(np), "x");
  assert.match(mn, /x\.topic_id = ANY\(\$1/);
  assert.match(mn, /x\.source = ANY\(\$2/);
  assert.match(mn, /x\.ticket_id IN \(SELECT ct\.id FROM cx_tickets ct WHERE ct\.channel_id = ANY\(\$3/);
});

test("normalizeScope caps junk input", () => {
  const n = s.normalizeScope({ clusters: ["a", "a", "", 5 as unknown as string], topics: undefined, profiles: ["x".repeat(500)] });
  assert.deepEqual(n, { clusters: ["a"], topics: [], profiles: [] });
  assert.equal(s.isEmptyScope(n), false);
  assert.equal(s.scopeCount(n), 1);
});
