import assert from "node:assert/strict";
import { test } from "node:test";

const vol = await import("../src/lib/sensor/volatility");
const gs = await import("../src/lib/reports/google-snapshot");
const dm = await import("../src/lib/reports/data-map");
const local = await import("../src/lib/local/dfs-map");
const tpl = await import("../src/lib/reports/templates");
const lr = await import("../src/lib/ai-visibility/live-report");

// ------------------------------------------------------------------ SERP Sensor

test("personal volatility from stored Position Tracking rows", () => {
  const dates = ["2026-09-24", "2026-09-25", "2026-09-26"];
  const row = (keyword: string, day: string, pos: number | null, source = "dataforseo") => ({ project_id: "p1", keyword, device: "desktop", day, pos: pos == null ? null : String(pos), source });
  const rows = [row("a", dates[0], 3), row("a", dates[1], 3), row("a", dates[2], 8), row("b", dates[0], 10), row("b", dates[1], 12), row("b", dates[2], null)];
  const r = vol.personalFromRows(rows, dates, [{ id: "p1", name: "P", domain: "p.com" }])!;
  // day 2: |3-3|=0, |10-12|=2 → mean 1 ×2.4 = 2.4 ; day 3: 5 and dropped-out 12 → 8.5×2.4 → capped 10
  assert.deepEqual(r.series, [{ date: dates[1], score: 2.4 }, { date: dates[2], score: 10 }]);
  assert.equal(r.today, 10);
  assert.equal(r.change, 7.6);
  assert.equal(r.source, "dataforseo");
  assert.equal(r.movers[0].keyword, "b");
  assert.equal(r.movers[0].to, null);
  assert.equal(vol.personalFromRows([row("a", dates[2], 3)], dates, []), null);
  assert.equal(vol.personalFromRows(rows.map((x) => ({ ...x, source: "search-console" })), dates, [])!.source, "search-console");
});

const serp = (urls: string[], extra: Record<string, unknown>[] = []) => ({
  items: [...extra, ...urls.map((u, i) => ({ type: "organic", rank_group: i + 1, url: `https://${u}/`, domain: u }))],
});

test("market snapshot mapping, change score, series, features and movers", () => {
  const a = vol.snapshotFromSerp("k", "2026-09-25", serp(["a.com", "b.com", "c.com"], [{ type: "ai_overview" }, { type: "people_also_ask" }]));
  assert.deepEqual(a.results.map((r) => r.rank), [1, 2, 3]);
  assert.deepEqual(a.features, ["ai_overview", "people_also_ask"]);
  const b = vol.snapshotFromSerp("k", "2026-09-26", serp(["b.com", "a.com", "d.com"]));
  // a:1→2 (1), b:2→1 (1), c:3→out(11) (8), d:out→3 (8) → 18/4=4.5 ×2 = 9
  assert.equal(vol.serpChange(a, b), 9);
  assert.equal(vol.serpChange(a, a), 0);
  const series = vol.marketSeries([a, b]);
  assert.deepEqual(series, [{ date: "2026-09-26", score: 9, keywords: 1 }]);
  const f = vol.featureShares([a, b]);
  assert.deepEqual(f.rows.map((r) => r.ai_overview), [100, 0]);
  const m = vol.domainMovers([a], [b]);
  assert.equal(m.winners[0].domain, "b.com");
  assert.ok(m.losers.some((x) => x.domain === "c.com"));
  assert.deepEqual(vol.snapshotFromSerp("x", "d", undefined), { keyword: "x", day: "d", results: [], features: [] });
});

// ------------------------------------------------------------------ Google snapshot

test("google snapshot from organicInsights", () => {
  const t = (clicks: number, impressions: number, position: number) => ({ clicks, impressions, ctr: impressions ? clicks / impressions : 0, position });
  const ga = (sessions: number, keyEvents = 3) => ({ sessions, users: 0, newUsers: 0, engagementRate: 0.6, avgDuration: 0, pageViews: 0, keyEvents });
  const snap = gs.googleSnapshot({
    range: { start: "2026-08-27", end: "2026-09-23", prevStart: "", prevEnd: "", days: 28 },
    gsc: {
      site: "sc-domain:acme.com",
      totals: t(1000, 20000, 8.44),
      previous: t(800, 18000, 9.1),
      daily: [{ date: "2026-09-22", ...t(30, 600, 8) }, { date: "2026-09-23", ...t(40, 700, 8) }],
      queries: [{ query: "b", ...t(10, 50, 3) }, { query: "a", ...t(90, 900, 1.23) }],
      pages: [],
      countries: [],
      devices: [],
    },
    gscError: null,
    ga4: { property: "properties/1", totals: ga(5000), previous: ga(4000), organic: ga(2000, 12), organicPrevious: ga(0), daily: [{ date: "2026-09-23", sessions: 100, organic: 55 }], channels: [{ channel: "Organic Search", ...ga(2000) }], landingPages: [] },
    ga4Error: null,
    pages: [{ path: "/", url: "https://acme.com/", clicks: 500, impressions: 9000, position: 2.345, queries: 4, topQuery: "a", sessions: 800, engagementRate: 0.5, keyEvents: 2 }],
  });
  assert.equal(snap.clicks, 1000);
  assert.equal(snap.clicksDelta, 25);
  assert.equal(snap.position, 8.4);
  assert.equal(snap.sessions, 2000);
  assert.equal(snap.sessionsDelta, null); // previous 0 → unknown, not infinite
  assert.equal(snap.keyEvents, 12);
  assert.equal(snap.topQueries[0].query, "a");
  assert.deepEqual(snap.daily.find((d) => d.date === "2026-09-23"), { date: "2026-09-23", clicks: 40, impressions: 700, organic: 55 });
  assert.equal(snap.topPages[0].position, 2.3);
  const noGsc = gs.googleSnapshot({ range: { start: "a", end: "b", prevStart: "", prevEnd: "", days: 28 }, gsc: null, gscError: "forbidden", ga4: null, ga4Error: null, pages: [] });
  assert.equal(noGsc.clicks, null);
  assert.deepEqual(noGsc.errors, ["forbidden"]);
});

// ------------------------------------------------------------------ Reports

test("report availability hides unsourced templates and sections", () => {
  const none = { dataforseo: false, google: false, demo: false };
  const project = tpl.templateById("project")!;
  const domain = tpl.templateById("domain")!;
  assert.equal(tpl.templateAvailable(domain, none), false);
  assert.equal(tpl.templateAvailable(project, none), true);
  assert.deepEqual(tpl.defaultSections(project, none), ["summary", "tools", "audit", "rankings"]);
  assert.ok(tpl.defaultSections(project, { ...none, google: true }).includes("search"));
  const bl = tpl.templateById("backlinks")!;
  assert.ok(!tpl.visibleSections(bl, { ...none, dataforseo: true }).some((s) => s.id === "toxicity"));
  assert.ok(tpl.visibleSections(bl, { ...none, demo: true }).some((s) => s.id === "toxicity"));
});

test("tracked ranking rows use the two latest stored days", () => {
  const r = dm.rankingRows([
    { keyword: "a", day: "2026-09-25", pos: "5", url: null },
    { keyword: "a", day: "2026-09-26", pos: "3", url: "https://x.com/a" },
    { keyword: "b", day: "2026-09-26", pos: null, url: null },
    { keyword: "c", day: "2026-09-26", pos: "12", url: "" },
  ]);
  assert.equal(r.day, "2026-09-26");
  assert.equal(r.previousDay, "2026-09-25");
  assert.deepEqual(r.rows.map((x) => [x.keyword, x.position, x.previous]), [["a", 3, 5], ["c", 12, null], ["b", null, null]]);
});

test("backlink report from live Backlinks API summary/overview", () => {
  const b = dm.backlinkReportFromLive(
    { domain: "x.com", topicName: "", homeDb: "US", authorityScore: 41, authorityDelta: null, referringDomains: 120, referringDomainsDelta: null, backlinks: 900, backlinksDelta: null, referringIps: 100, referringIpsDelta: null, outboundDomains: 0, outboundDomainsDelta: null, followRatio: 0.8, sample: { referringDomains: 0, backlinks: 0 } },
    { history: [{ month: "2026-08", referringDomains: 110, backlinks: 850, authorityScore: 40, referringIps: 90 }], velocity: [], last30: { newRd: 0, lostRd: 0, newBl: 0, lostBl: 0 }, asBuckets: [], categories: [], tlds: [], countries: [], anchors: [{ anchor: "x", type: "branded", referringDomains: 3, backlinks: 9 }], anchorTypes: [], attributes: [], linkTypes: [{ label: "Text", value: 800, share: 90 }], topPages: [], topReferringDomains: [{ domain: "r.com", authorityScore: 50, backlinks: 4, country: "", firstSeen: "2025-01-01" }] },
  );
  assert.equal(b.facts.referringDomains, 120);
  assert.equal(b.facts.history[0].referringDomains, 110);
  assert.deepEqual(b.types, [{ type: "text", count: 800 }]);
  assert.deepEqual(b.toxicity, []);
});

// ------------------------------------------------------------------ Local SEO

test("maps grid cell and Google listing / reviews mappings", () => {
  const list = local.mapsBusinesses({
    items: [
      { type: "maps_search", rank_group: 2, title: "Acme Dental Care", domain: "www.acme.com", cid: "2", rating: { value: 4.6, votes_count: 88 } },
      { type: "maps_search", rank_group: 1, title: "City Smiles", url: "https://citysmiles.in/x", cid: "1", rating: { value: 4.9, votes_count: 300 } },
      { type: "maps_paid_item", title: "Ad" },
    ],
  });
  assert.deepEqual(list.map((b) => b.name), ["City Smiles", "Acme Dental Care"]);
  assert.equal(list[0].domain, "citysmiles.in");
  const cell = local.gridCell(list, { domain: "acme.com", name: "Something Else" });
  assert.equal(cell.rank, 2);
  assert.deepEqual(cell.order, ["1", "you"]);
  assert.equal(local.gridCell(list, { domain: "zzz.com", name: "Nope" }).rank, null);

  const g = local.googleListing({
    items: [{ title: "Acme Dental Care", address: "12 MG Road, Vadodara, Gujarat 390001", phone: "+91 98765 43210", url: "https://acme.com/", category: "Dentist", additional_categories: ["Orthodontist"], rating: { value: 4.6, votes_count: 88 }, total_photos: 40, is_claimed: true, place_id: "ChIJ", work_time: { work_hours: { timetable: { monday: [{ open: { hour: 9, minute: 0 }, close: { hour: 18, minute: 30 } }], sunday: null } } } }],
  })!;
  assert.equal(g.reviews, 88);
  assert.match(g.hours, /mon 09:00–18:30/);
  const nap = local.napCheck({ name: "Acme Dental Care", address: "12 MG Road, Vadodara, Gujarat, 390001", phone: "098765 43210", website: "https://www.acme.com", category: "Dental clinic" }, g);
  assert.deepEqual(nap.map((c) => [c.field, c.match]), [["name", true], ["address", true], ["phone", true], ["website", true], ["category", false]]);
  assert.equal(local.googleListing({ items: [] }), null);

  const rv = local.googleReviews({
    rating: { value: 4.5 },
    reviews_count: 120,
    items: [
      { review_id: "r1", rating: { value: 5 }, timestamp: "2026-09-01 10:00:00 +00:00", review_text: "Great", profile_name: "A", owner_answer: "Thanks", owner_timestamp: "2026-09-02 08:00:00 +00:00" },
      { review_id: "r2", rating: { value: 2 }, timestamp: "2026-09-10 10:00:00 +00:00", review_text: "Slow" },
      { review_id: "bad", rating: {}, timestamp: "" },
    ],
  });
  assert.equal(rv.total, 120);
  assert.deepEqual(rv.reviews.map((r) => r.id), ["r2", "r1"]);
  assert.deepEqual(rv.reviews[1].ownerReply, { body: "Thanks", date: "2026-09-02" });
});

// ------------------------------------------------------------------ AI Visibility

test("AI visibility report from live answers only", () => {
  const now = Date.parse("2026-09-26T12:00:00Z");
  const ctx = { domain: "acme.com", db: "US", brand: "Acme", brandTerms: ["acme"], strength: 0, competitors: [{ name: "Rival", domain: "rival.com", strength: 0 }], topic: {} as never, pages: [], category: "shoes", place: "US" };
  const res = (id: string, engine: string, prompt: string, at: string, o: Partial<import("../src/lib/ai-visibility/meta").LiveResult> = {}) => ({ id, prompt, engine, model: "m", createdAt: at, mentioned: false, cited: false, position: null, citedUrls: [], competitors: [], sources: [], sentiment: null, answer: "text", error: null, ...o });
  const live = [
    res("1", "chatgpt", "best shoes", "2026-09-26T10:00:00Z", { mentioned: true, position: 1, cited: true, citedUrls: ["https://acme.com/p"], sources: ["acme.com", "wiki.org"], competitors: ["Rival"], sentiment: "positive" }),
    res("2", "gemini", "best shoes", "2026-09-26T10:00:00Z", { competitors: ["Rival"], sources: ["wiki.org"] }),
    res("3", "claude", "best shoes", "2026-09-26T10:00:00Z", { error: "quota", answer: "" }),
    res("4", "chatgpt", "best shoes", "2026-09-15T10:00:00Z", { mentioned: false }),
    res("5", "chatgpt", "untracked", "2026-09-26T10:00:00Z", { mentioned: true }),
  ];
  const r = lr.liveReport(ctx, [{ id: "p", prompt: "best shoes", source: "custom", createdAt: "" }], live, now);
  assert.equal(r.current.answers, 2); // failed answer and untracked prompt excluded
  assert.equal(r.current.mentioned, 1);
  assert.equal(r.current.cited, 1);
  assert.equal(r.sov, 33.3);
  assert.equal(r.previous.answers, 1);
  assert.deepEqual(r.sources.map((s) => [s.domain, s.answers, s.type]), [["wiki.org", 2, "other"], ["acme.com", 1, "you"]]);
  assert.deepEqual(r.pages, [{ url: "https://acme.com/p", citations: 1 }]);
  assert.deepEqual(r.engines.map((e) => e.id), ["chatgpt", "gemini", "claude"]);
  assert.equal(r.prompts[0].latest.find((c) => c.engine === "claude")!.present, false);
  assert.equal(r.trend.find((t) => t.day === "2026-09-26")!.chatgpt, 100);
  assert.equal(r.trend.find((t) => t.day === "2026-09-20")!.chatgpt, null);
});
