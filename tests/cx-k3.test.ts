import assert from "node:assert/strict";
import { test } from "node:test";

/** WP-K3 settings and topics: pure helpers (topic query building, CIDR allowlists, clusters, profiles) and schema. */
const q = await import("../src/lib/cx/listening/topic-query");
const s = await import("../src/lib/cx/admin/pure/settings");
const qu = await import("../src/lib/cx/admin/pure/queue");
const c = await import("../src/lib/cx/listening/connectors");
const schema = await import("../src/lib/schema/cx-settings");
const ops = await import("../src/lib/schema/cx-ops");
const listening = await import("../src/lib/schema/cx-listening");

// ---------------------------------------------------------------- schema
test("cx-settings schema: idempotent, every column also added with ADD COLUMN IF NOT EXISTS", () => {
  const sql = schema.cxSettingsSchema;
  for (const t of ["cx_settings_group", "cx_settings_profiles", "cx_settings_invites", "cx_settings_user_groups", "cx_settings_ip", "cx_settings_social_profiles", "cx_settings_profile_mentions"]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${t} \\(`));
    assert.match(sql, new RegExp(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS`));
  }
  for (const line of sql.split("\n").filter((l) => l.startsWith("ALTER TABLE"))) if (/NOT NULL/.test(line)) assert.match(line, /DEFAULT/, line);
  assert.ok(!/CREATE TABLE(?! IF NOT EXISTS)/.test(sql));
});

test("existing tables are extended in their own schema files", () => {
  assert.match(ops.cxOpsSchema, /ALTER TABLE cx_ops_profile_groups ADD COLUMN IF NOT EXISTS topic_ids jsonb NOT NULL DEFAULT '\[\]'/);
  assert.match(ops.cxOpsSchema, /ALTER TABLE cx_ops_profile_groups ADD COLUMN IF NOT EXISTS color text NOT NULL DEFAULT ''/);
  for (const col of ["and_contains", "exclude_authors", "exclude_sites", "countries", "min_followers", "verified_only", "fetch_frequency", "objective", "created_by", "last_fetched_at"])
    assert.match(listening.cxListeningSchema, new RegExp(`ALTER TABLE cx_listening_topic_opts ADD COLUMN IF NOT EXISTS ${col} `));
});

// ---------------------------------------------------------------- topic query
const spec = { ...q.EMPTY_SPEC, contains: ["Acme Corp", "acme", "acme AND (refund OR delay)"], andContains: ["fees", "exam"], excluded: ["jobs", "stock price"] };

test("displayQuery builds the Konnect-style boolean search query", () => {
  assert.equal(q.displayQuery(spec), '("Acme Corp" OR "acme" OR ("acme" AND ("refund" OR "delay"))) AND ("fees" OR "exam") AND NOT ("jobs" OR "stock price")');
  assert.equal(q.displayQuery({ contains: ["A", "B"], andContains: [], excluded: [] }), '"A" OR "B"');
  assert.equal(q.displayQuery({ contains: [], andContains: ["x"], excluded: [] }), "");
});

test("cleanTerms / splitTerms dedupe case-insensitively and keep rules intact", () => {
  assert.deepEqual(q.cleanTerms([" Acme ", "acme", '"ACME"', "", "Beta  Co"]), ["Acme", "Beta Co"]);
  assert.deepEqual(q.splitTerms("a, b;c\nacme AND (x OR y)"), ["a", "b", "c", "acme AND (x OR y)"]);
});

test("engineQueries chunks CONTAINS under the length cap and adds AND CONTAINS, exclusions and -site:", () => {
  const many = { ...spec, contains: Array.from({ length: 40 }, (_, i) => `Acme Institute of Thing ${i}`), excludeSites: ["https://www.spam.example.com/x"] };
  const r = q.engineQueries(many, { sites: true, maxLen: 480, maxQueries: 5 });
  assert.ok(r.queries.length > 1);
  assert.equal(r.dropped, 0);
  for (const x of r.queries) {
    assert.ok(x.length <= 480, `${x.length}`);
    assert.match(x, /\(fees OR exam\) -jobs -"stock price" -site:spam\.example\.com$/);
  }
  const all = r.queries.join(" ");
  for (let i = 0; i < 40; i++) assert.ok(all.includes(`"Acme Institute of Thing ${i}"`));
  const capped = q.engineQueries(many, { maxQueries: 1 });
  assert.equal(capped.queries.length, 1);
  assert.ok(capped.dropped > 0);
});

test("plainQueries and hashtagsOf for engines without OR", () => {
  assert.deepEqual(q.plainQueries(spec), ['"acme corp"', "acme", "acme refund"]);
  assert.deepEqual(q.hashtagsOf({ contains: ["#AcmeCorp", "Acme Corp", "x"] }), ["acmecorp"]);
});

test("matchesSpec honours CONTAINS, AND CONTAINS and DOES NOT CONTAIN", () => {
  assert.equal(q.matchesSpec("Acme Corp announced exam dates", spec), true);
  assert.equal(q.matchesSpec("Acme Corp announced new dates", spec), false, "AND CONTAINS missing");
  assert.equal(q.matchesSpec("Acme Corp exam and stock price news", spec), false, "excluded phrase");
  assert.equal(q.matchesSpec("Beta exam", spec), false, "CONTAINS missing");
  assert.equal(q.matchesSpec("acme refund exam", spec), true, "legacy rule");
  assert.equal(q.matchesSpec("exam only", spec, { requireContains: false }), true);
});

test("rejectReason applies exclusions, regional filters, followers and verification without guessing unknowns", () => {
  const base = { author: "Jane", authorHandle: "@jane@mastodon.social", authorFollowers: 50, authorVerified: false, url: "https://blog.spam.example.com/post", country: "IN", language: "en" };
  const none = { excludeAuthors: [], excludeSites: [], countries: [], languages: [], minFollowers: 0, verifiedOnly: false };
  assert.equal(q.rejectReason(base, none), null);
  assert.equal(q.rejectReason(base, { ...none, excludeAuthors: ["@jane"] }), "excluded author");
  assert.equal(q.rejectReason(base, { ...none, excludeSites: ["spam.example.com"] }), "excluded site");
  assert.equal(q.rejectReason(base, { ...none, countries: ["US"] }), "country");
  assert.equal(q.rejectReason({ ...base, country: null }, { ...none, countries: ["US"] }), null, "unknown country kept");
  assert.equal(q.rejectReason(base, { ...none, languages: ["hi"] }), "language");
  assert.equal(q.rejectReason(base, { ...none, minFollowers: 100 }), "followers");
  assert.equal(q.rejectReason({ ...base, authorFollowers: null }, { ...none, minFollowers: 100 }), null, "unknown followers kept");
  assert.equal(q.rejectReason(base, { ...none, verifiedOnly: true }), "not verified");
  assert.equal(q.rejectReason({ ...base, authorVerified: null }, { ...none, verifiedOnly: true }), null);
});

test("isDue respects fetch frequency, manual runs and never-fetched topics", () => {
  const now = new Date("2026-10-05T12:00:00Z");
  assert.equal(q.isDue("daily", null, now), true);
  assert.equal(q.isDue("daily", "2026-10-05T06:00:00Z", now), false);
  assert.equal(q.isDue("daily", "2026-10-05T06:00:00Z", now, true), true);
  assert.equal(q.isDue("6h", "2026-10-05T06:00:00Z", now), true);
  assert.equal(q.isDue("hourly", "2026-10-05T11:04:00Z", now), true, "5-minute grace");
  assert.equal(q.isDue("hourly", "2026-10-05T11:10:00Z", now), false);
  assert.equal(q.newsEditions({ countries: ["in", "US", "gb", "AE"] }, "US").join(), "IN,US,GB");
  assert.equal(q.normalizeSite("https://www.Example.com/path"), "example.com");
  assert.equal(q.normalizeSite("not a site"), "");
});

// ---------------------------------------------------------------- CIDR allowlist
test("parseCidr / ipInCidr handle IPv4, IPv6 and IPv4-mapped addresses", () => {
  assert.equal(s.parseCidr("10.1.2.3/8")?.text, "10.0.0.0/8");
  assert.equal(s.parseCidr("203.0.113.7")?.text, "203.0.113.7/32");
  assert.equal(s.parseCidr("2001:db8::1/32")?.text, "2001:db8::/32");
  assert.equal(s.parseCidr("::1")?.text, "::1/128");
  assert.equal(s.parseCidr("300.1.1.1"), null);
  assert.equal(s.parseCidr("10.0.0.0/33"), null);
  assert.equal(s.ipInCidr("::ffff:10.2.3.4", "10.0.0.0/8"), true);
  assert.equal(s.ipInCidr("11.0.0.1", "10.0.0.0/8"), false);
  assert.equal(s.ipInCidr("2001:db8:5::9", "2001:db8::/32"), true);
  assert.equal(s.ipInCidr("2001:db9::1", "2001:db8::/32"), false);
  assert.equal(s.ipInCidr("10.0.0.1", "2001:db8::/32"), false);
});

test("validateAllowlist requires the current IP when enabled", () => {
  assert.deepEqual(s.validateAllowlist(["203.0.113.0/24 # office", "", "203.0.113.9/24"], true, "203.0.113.50"), { ok: true, cidrs: ["203.0.113.0/24"] });
  const r = s.validateAllowlist(["198.51.100.0/24"], true, "203.0.113.50");
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /203\.0\.113\.50/);
  assert.equal(s.validateAllowlist([], true, "1.2.3.4").ok, false);
  assert.equal(s.validateAllowlist(["0.0.0.0/0"], false, "").ok, false);
  assert.equal(s.validateAllowlist(["bogus"], false, "").ok, false);
  assert.equal(s.validateAllowlist(["198.51.100.0/24"], false, "203.0.113.50").ok, true, "saving while off doesn't need the current IP");
  assert.equal(s.validateAllowlist(["1.2.3.4"], true, "").ok, false, "unknown current IP");
});

test("clientIpFrom takes the right-most forwarded address", () => {
  const h = (m: Record<string, string>) => (n: string) => m[n] ?? null;
  assert.equal(s.clientIpFrom(h({ "x-forwarded-for": "6.6.6.6, 203.0.113.7" })), "203.0.113.7");
  assert.equal(s.clientIpFrom(h({ "x-real-ip": "::ffff:198.51.100.1" })), "198.51.100.1");
  assert.equal(s.clientIpFrom(h({})), "");
});

// ---------------------------------------------------------------- clusters and profiles
test("cleanCluster accepts topics, validates known ids and colors", () => {
  const known = { channelIds: ["c1", "c2"], topicIds: ["t1"], sources: ["news"] };
  assert.deepEqual(s.cleanCluster({ name: "  PU   Overall ", channelIds: ["c1", "c1", "zz"], topicIds: ["t1", "tx"], sources: ["news", "bogus"], color: "#3E63DD" }, known), {
    ok: true,
    value: { name: "PU Overall", description: "", channelIds: ["c1"], topicIds: ["t1"], sources: ["news"], isDefault: false, color: "#3e63dd" },
  });
  assert.equal(s.cleanCluster({ name: "Only topics", channelIds: [], topicIds: ["t1"] }, known).ok, true);
  assert.equal(s.cleanCluster({ name: "", channelIds: ["c1"], topicIds: [] }, known).ok, false);
  assert.equal(s.cleanCluster({ name: "Empty", channelIds: ["zz"], topicIds: [] }, known).ok, false);
  assert.equal(s.cleanCluster({ name: "Bad color", channelIds: ["c1"], topicIds: [], color: "red" }, known).ok, false);
});

test("clusterChips counts per network like Konnect (incl. Topic)", () => {
  assert.deepEqual(s.clusterChips(["facebook", "instagram", "facebook", "x", "gbp"], 2).map((c) => c.label), ["2 Facebook","1 Google Business Location", "1 Instagram", "2 Topic", "1 Twitter"]);
  assert.deepEqual(s.clusterChips([], 0), []);
});

test("splitPicker filters Selected vs Other lists by search", () => {
  const all = [{ id: "a", name: "PU Twitter", network: "x" }, { id: "b", name: "Life IG", network: "instagram" }, { id: "t", name: "Brand", network: "topic" }];
  assert.deepEqual(s.splitPicker(all, ["a"], ""), { selected: [all[0]], other: [all[1], all[2]] });
  assert.deepEqual(s.splitPicker(all, ["a"], "insta").other.map((x) => x.id), ["b"]);
});

test("profileSections, profileState and profileHandle for Omni-Channel Setup cards", () => {
  const sec = s.profileSections([{ kind: "email" }, { kind: "facebook" }, { kind: "zzz" }, { kind: "facebook" }]);
  assert.deepEqual(sec.map((x) => [x.kind, x.items.length]), [["facebook", 2], ["email", 1], ["zzz", 1]]);
  assert.deepEqual(s.profileState({ status: "active" }), { label: "Active", tone: "good" });
  assert.deepEqual(s.profileState({ status: "active", last_error: "boom" }), { label: "Error", tone: "critical" });
  assert.deepEqual(s.profileState({ status: "paused", last_error: "boom" }), { label: "Paused", tone: "neutral" });
  assert.equal(s.profileHandle("email", { user: "u@x.com", fromAddress: "support@x.com" }), "support@x.com");
  assert.equal(s.profileHandle("telegram", { bot: "acme_bot" }), "@acme_bot");
  assert.equal(s.profileHandle("facebook", { accountId: "123" }), "123");
  assert.equal(s.isHexColor(s.colorFor("abc")), true);
  assert.equal(s.colorFor("abc"), s.colorFor("abc"));
});

test("cleanUserGroup keeps only brand members", () => {
  assert.deepEqual(s.cleanUserGroup({ name: " Night  shift ", memberIds: ["u1", "u1", "x"] }, ["u1", "u2"]), { ok: true, value: { name: "Night shift", description: "", memberIds: ["u1"] } });
  assert.equal(s.cleanUserGroup({ name: "Empty", memberIds: ["x"] }, ["u1"]).ok, false);
});

test("distributeRouted sends routed tickets only to the user group's agents", () => {
  const agent = (id: string) => ({ id, status: "available" as const, paused: false, load: 0, capacity: 5, lastAssignedAt: null, officeStart: null, officeEnd: null, timezone: null });
  const r = qu.distributeRouted("round_robin", [agent("a"), agent("b")], [{ id: "t1", allowed: ["b"] }, { id: "t2", allowed: ["zz"] }, { id: "t3" }], 0);
  assert.equal(r.assignments.find((x) => x.ticketId === "t1")?.agentId, "b");
  assert.equal(r.assignments.some((x) => x.ticketId === "t2"), false, "no member available: the ticket waits");
  assert.ok(r.assignments.some((x) => x.ticketId === "t3"));
});

// ---------------------------------------------------------------- public social profiles
test("parseSocialHandle normalizes handles and profile URLs", () => {
  assert.deepEqual(s.parseSocialHandle("mastodon", "https://mastodon.social/@acme"), { ok: true, handle: "@acme@mastodon.social", url: "https://mastodon.social/@acme" });
  assert.deepEqual(s.parseSocialHandle("bluesky", "https://bsky.app/profile/Acme.bsky.social"), { ok: true, handle: "acme.bsky.social", url: "https://bsky.app/profile/acme.bsky.social" });
  assert.equal((s.parseSocialHandle("youtube", "https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv") as { handle: string }).handle, "UCabcdefghijklmnopqrstuv");
  assert.equal((s.parseSocialHandle("youtube", "@acme") as { handle: string }).handle, "@acme");
  assert.equal((s.parseSocialHandle("reddit", "https://www.reddit.com/r/acme/") as { handle: string }).handle, "r/acme");
  assert.equal((s.parseSocialHandle("hackernews", "https://news.ycombinator.com/user?id=pg") as { handle: string }).handle, "pg");
  assert.equal((s.parseSocialHandle("x", "https://x.com/acme") as { handle: string }).handle, "@acme");
  assert.equal((s.parseSocialHandle("linkedin", "https://www.linkedin.com/company/acme/") as { handle: string }).handle, "company/acme");
  assert.equal(s.parseSocialHandle("mastodon", "acme").ok, false);
  assert.equal(s.parseSocialHandle("bluesky", "").ok, false);
});

test("profileFetchable marks networks without a free source as needing an API", () => {
  const keys = { reddit: false, youtubeKey: false };
  assert.equal(s.profileFetchable("bluesky", keys, "acme.bsky.social").ok, true);
  assert.equal(s.profileFetchable("instagram", keys, "@acme").ok, false);
  assert.equal(s.profileFetchable("reddit", keys, "r/acme").ok, false);
  assert.equal(s.profileFetchable("reddit", { ...keys, reddit: true }, "r/acme").ok, true);
  assert.equal(s.profileFetchable("youtube", keys, "@acme").ok, false);
  assert.equal(s.profileFetchable("youtube", keys, "UCabcdefghijklmnopqrstuv").ok, true);
});

test("public feed mappers: YouTube channel RSS and Bluesky author feed", () => {
  const xml = `<?xml version="1.0"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
    <title>Acme Channel</title><author><name>Acme Channel</name></author>
    <entry><yt:videoId>abc123</yt:videoId><yt:channelId>UCabcdefghijklmnopqrstuv</yt:channelId><title>Launch day</title><published>2026-10-01T10:00:00+00:00</published>
      <author><name>Acme Channel</name></author>
      <media:group><media:title>Launch day</media:title><media:thumbnail url="https://i.ytimg.com/vi/abc123/hqdefault.jpg" width="480" height="360"/><media:description>We launched.</media:description><media:community><media:statistics views="1234"/></media:community></media:group></entry>
  </feed>`;
  const v = c.mapYouTubeFeed(xml);
  assert.equal(v.length, 1);
  assert.equal(v[0].externalId, "video:abc123");
  assert.equal(v[0].title, "Launch day");
  assert.equal(v[0].body, "We launched.");
  assert.deepEqual(v[0].engagement, { views: 1234 });
  assert.equal(v[0].publishedAt, "2026-10-01T10:00:00.000Z");
  const b = c.mapBlueskyAuthorFeed({ feed: [{ post: { uri: "at://did:plc:x/app.bsky.feed.post/3k", author: { handle: "acme.bsky.social", verification: { verifiedStatus: "valid" } }, record: { text: "hello", createdAt: "2026-10-01T00:00:00Z" } } }] });
  assert.equal(b.length, 1);
  assert.equal(b[0].authorVerified, true);
  assert.equal(b[0].url, "https://bsky.app/profile/acme.bsky.social/post/3k");
});
