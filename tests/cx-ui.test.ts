import assert from "node:assert/strict";
import { test } from "node:test";

const p = await import("../src/lib/cx/ui/prefs-logic");
const h = await import("../src/lib/cx/ui/home-logic");

const groups = [
  { id: "home", label: "", items: [{ href: "/cx" }] },
  { id: "inbox", label: "Inbox", items: [{ href: "/cx/inbox" }, { href: "/cx/contacts" }] },
  { id: "listen", label: "Listen", items: [{ href: "/cx/listening" }, { href: "/cx/crisis" }, { href: "/cx/listening/ugc", defaultHidden: true }] },
];
const hrefs = (gs: { items: { href: string }[] }[]) => gs.map((g) => g.items.map((i) => i.href));

// ---------------------------------------------------------------- normalisation
test("normalizePrefs coerces junk into defaults", () => {
  assert.deepEqual(p.normalizePrefs(null), p.DEFAULT_PREFS);
  assert.deepEqual(p.normalizePrefs("x"), p.DEFAULT_PREFS);
  const n = p.normalizePrefs({ focus: "yes", density: "tiny", collapsed: true, nav: { pinned: ["/a", "/a", 3, ""], hidden: "no", order: { g: ["/b"], bad: 5 } }, panels: { "s.a": { state: "hidden", label: "A" }, "s.b": { state: "weird" }, "s.c": "x" } });
  assert.equal(n.focus, false);
  assert.equal(n.density, "comfortable");
  assert.equal(n.collapsed, true);
  assert.deepEqual(n.nav, { pinned: ["/a"], hidden: [], shown: [], order: { g: ["/b"] } });
  assert.deepEqual(n.panels, { "s.a": { state: "hidden", label: "A" } });
});

test("normalizePatch keeps only known keys that were sent", () => {
  assert.deepEqual(p.normalizePatch({ focus: true, evil: 1 }), { focus: true });
  assert.deepEqual(p.normalizePatch({ density: "compact" }), { density: "compact" });
  assert.deepEqual(p.normalizePatch({ nav: null }), { nav: { pinned: [], hidden: [], shown: [], order: {} } });
  assert.deepEqual(p.normalizePatch([]), {});
});

test("normalize caps list sizes and key lengths", () => {
  const many = Array.from({ length: 500 }, (_, i) => `/p${i}`);
  assert.equal(p.normalizeNav({ hidden: many }).hidden.length, 200);
  assert.deepEqual(p.normalizeNav({ hidden: ["x".repeat(500)] }).hidden, []);
});

// ---------------------------------------------------------------- menu customisation
test("applyNavPrefs: defaults drop default-hidden items", () => {
  assert.deepEqual(hrefs(p.applyNavPrefs(groups, p.DEFAULT_NAV)), [["/cx"], ["/cx/inbox", "/cx/contacts"], ["/cx/listening", "/cx/crisis"]]);
});

test("applyNavPrefs: pinned group first, hidden removed, empty groups dropped, shown default-hidden restored", () => {
  const nav = { pinned: ["/cx/crisis"], hidden: ["/cx/inbox", "/cx/contacts"], shown: ["/cx/listening/ugc"], order: {} };
  const out = p.applyNavPrefs(groups, nav);
  assert.deepEqual(out.map((g) => g.id), ["pinned", "home", "listen"]);
  assert.deepEqual(hrefs(out), [["/cx/crisis"], ["/cx"], ["/cx/listening", "/cx/listening/ugc"]]);
});

test("order: custom order applied, unknown items appended in default order", () => {
  const nav = { ...p.DEFAULT_NAV, order: { listen: ["/cx/crisis", "/gone"] } };
  assert.deepEqual(p.orderedItems(groups[2], nav).map((i) => i.href), ["/cx/crisis", "/cx/listening", "/cx/listening/ugc"]);
});

test("moveItem swaps within group and is a no-op at the edges", () => {
  let nav = p.moveItem(p.DEFAULT_NAV, groups[1], "/cx/contacts", -1);
  assert.deepEqual(nav.order.inbox, ["/cx/contacts", "/cx/inbox"]);
  assert.equal(p.moveItem(nav, groups[1], "/cx/contacts", -1), nav);
  nav = p.moveItem(nav, groups[1], "/cx/contacts", 1);
  assert.deepEqual(nav.order.inbox, ["/cx/inbox", "/cx/contacts"]);
});

test("togglePin un-hides; hiding unpins; showing a default-hidden item records it", () => {
  let nav = p.setItemHidden(p.DEFAULT_NAV, { href: "/cx/inbox" }, true);
  assert.deepEqual(nav.hidden, ["/cx/inbox"]);
  nav = p.togglePin(nav, "/cx/inbox");
  assert.deepEqual(nav.pinned, ["/cx/inbox"]);
  assert.deepEqual(nav.hidden, []);
  nav = p.setItemHidden(nav, { href: "/cx/inbox" }, true);
  assert.deepEqual(nav.pinned, []);
  const ugc = { href: "/cx/listening/ugc", defaultHidden: true };
  assert.equal(p.isNavItemHidden(ugc, p.DEFAULT_NAV), true);
  nav = p.setItemHidden(p.DEFAULT_NAV, ugc, false);
  assert.deepEqual(nav.shown, ["/cx/listening/ugc"]);
  assert.equal(p.isNavItemHidden(ugc, nav), false);
  nav = p.setItemHidden(nav, ugc, true);
  assert.deepEqual(nav, p.DEFAULT_NAV);
  assert.equal(p.navIsDefault(nav), true);
});

test("movePinned reorders pins; hiddenNavItems lists user- and default-hidden", () => {
  const nav = p.movePinned({ ...p.DEFAULT_NAV, pinned: ["/a", "/b"] }, "/b", -1);
  assert.deepEqual(nav.pinned, ["/b", "/a"]);
  assert.deepEqual(p.hiddenNavItems(groups, { ...p.DEFAULT_NAV, hidden: ["/cx/contacts"] }).map((i) => i.href), ["/cx/contacts", "/cx/listening/ugc"]);
});

// prefs.nav is shared by the SEO and CX menus: one workspace's edits must leave the other's alone.
const seoGroups = [
  { id: "seo-top", label: "", items: [{ href: "/dashboard" }, { href: "/optimizer" }] },
  { id: "seo-keywords", label: "Keywords", items: [{ href: "/keyword-overview" }, { href: "/topic-research", defaultHidden: true }] },
];
const seoOwn = (href: string) => seoGroups.some((g) => g.items.some((i) => i.href === href));

test("movePinned with `within` skips the other workspace's pins", () => {
  const nav = { ...p.DEFAULT_NAV, pinned: ["/dashboard", "/cx/inbox", "/optimizer"] };
  assert.deepEqual(p.movePinned(nav, "/optimizer", -1, seoOwn).pinned, ["/optimizer", "/cx/inbox", "/dashboard"]);
  assert.equal(p.movePinned(nav, "/dashboard", -1, seoOwn), nav);
  assert.equal(p.movePinned(nav, "/optimizer", 1, seoOwn), nav);
  // Without `within` the move is a plain neighbour swap.
  assert.deepEqual(p.movePinned(nav, "/optimizer", -1).pinned, ["/dashboard", "/optimizer", "/cx/inbox"]);
});

test("scopeNav: scoped flag, own pins, and reset() keeps the other workspace's prefs", () => {
  const nav = {
    pinned: ["/dashboard", "/cx/inbox", "/optimizer"],
    hidden: ["/keyword-overview", "/cx/contacts"],
    shown: ["/topic-research", "/cx/listening/ugc"],
    order: { "seo-keywords": ["/topic-research", "/keyword-overview"], inbox: ["/cx/contacts", "/cx/inbox"] },
  };
  const s = p.scopeNav(nav, seoGroups);
  assert.equal(s.scoped, true);
  assert.deepEqual(s.pinned, ["/dashboard", "/optimizer"]);
  assert.deepEqual(s.reset(), { pinned: ["/cx/inbox"], hidden: ["/cx/contacts"], shown: ["/cx/listening/ugc"], order: { inbox: ["/cx/contacts", "/cx/inbox"] } });
  // The CX scope resets its own half and keeps the SEO one.
  assert.deepEqual(p.scopeNav(nav, groups).reset(), { pinned: ["/dashboard", "/optimizer"], hidden: ["/keyword-overview"], shown: ["/topic-research"], order: { "seo-keywords": ["/topic-research", "/keyword-overview"] } });
});

test("scopeNav: not scoped when only the other workspace is customised", () => {
  const cxOnly = { pinned: ["/cx/inbox"], hidden: ["/cx/contacts"], shown: ["/cx/listening/ugc"], order: { inbox: ["/cx/contacts", "/cx/inbox"] } };
  const s = p.scopeNav(cxOnly, seoGroups);
  assert.equal(s.scoped, false);
  assert.deepEqual(s.pinned, []);
  assert.deepEqual(s.reset(), cxOnly);
  assert.equal(p.scopeNav(p.DEFAULT_NAV, seoGroups).scoped, false);
  assert.equal(p.scopeNav(cxOnly, groups).scoped, true);
});

test("activeHref picks the longest matching prefix", () => {
  assert.equal(p.activeHref("/cx/listening/ugc", ["/cx", "/cx/listening", "/cx/listening/ugc"]), "/cx/listening/ugc");
  assert.equal(p.activeHref("/cx/listening/reviews/x", ["/cx", "/cx/listening"]), "/cx/listening");
  assert.equal(p.activeHref("/cxfoo", ["/cx"]), undefined);
});

// ---------------------------------------------------------------- hideable panels
test("panel state: default fallback, setPanel drops default entries, scoped hidden list and restore", () => {
  let panels = p.setPanel({}, "home.trends", "collapsed", "Trends", "collapsed");
  assert.deepEqual(panels, {});
  assert.equal(p.panelState(panels, "home.trends", "collapsed"), "collapsed");
  panels = p.setPanel(panels, "home.trends", "hidden", "Trends", "collapsed");
  panels = p.setPanel(panels, "home.setup", "hidden", "Setup");
  panels = p.setPanel(panels, "dash.list", "hidden", "List");
  panels = p.setPanel(panels, "home.team", "open", "Team", "collapsed");
  assert.deepEqual(p.hiddenPanels(panels, "home"), [{ id: "home.setup", label: "Setup" }, { id: "home.trends", label: "Trends" }]);
  assert.deepEqual(p.hiddenPanels(panels, "hom"), []);
  const restored = p.restorePanels(panels, "home");
  assert.deepEqual(Object.keys(restored).sort(), ["dash.list", "home.team"]);
  assert.deepEqual(Object.keys(p.restorePanels(panels)), ["home.team"]);
});

test("focus shortcut is Ctrl/Cmd + backslash only", () => {
  assert.equal(p.isFocusShortcut({ key: "\\", metaKey: true, ctrlKey: false, altKey: false }), true);
  assert.equal(p.isFocusShortcut({ key: "\\", metaKey: false, ctrlKey: true, altKey: false }), true);
  assert.equal(p.isFocusShortcut({ key: "\\", metaKey: false, ctrlKey: false, altKey: false }), false);
  assert.equal(p.isFocusShortcut({ key: "\\", metaKey: true, ctrlKey: false, altKey: true }), false);
  assert.equal(p.isFocusShortcut({ key: "k", metaKey: true, ctrlKey: false, altKey: false }), false);
});

// ---------------------------------------------------------------- overview
const now = new Date("2026-10-04T12:00:00Z");
const min = (m: number) => new Date(now.getTime() + m * 60000).toISOString();
const ticket = (id: string, over: Partial<import("../src/lib/cx/ui/home-logic").TicketRow> = {}) => ({
  id, number: Number(id.replace(/\D/g, "")) || 1, subject: `Ticket ${id}`, priority: "normal", channel_kind: "email",
  created_at: min(-600), first_response_at: null, first_response_due: null, resolution_due: null, ...over,
});

test("nextDue ignores first-response deadline once answered", () => {
  assert.equal(h.nextDue({ first_response_at: null, first_response_due: min(10), resolution_due: min(100) }), new Date(min(10)).getTime());
  assert.equal(h.nextDue({ first_response_at: min(-5), first_response_due: min(-30), resolution_due: min(100) }), new Date(min(100)).getTime());
  assert.equal(h.nextDue({ first_response_at: null, first_response_due: null, resolution_due: null }), null);
});

test("relTime formats past and future", () => {
  const t = now.getTime();
  assert.equal(h.relTime(t + 25 * 60000, t), "in 25m");
  assert.equal(h.relTime(t - 3 * 3600000, t), "3h ago");
  assert.equal(h.relTime(t - 3 * 86400000, t), "3d ago");
});

test("buildAttention orders breached > crisis > at risk > unassigned and dedupes tickets", () => {
  const sla = [
    ticket("t1", { first_response_due: min(30) }), // at risk
    ticket("t2", { first_response_due: min(-120) }), // breached 2h
    ticket("t3", { resolution_due: min(-10), first_response_at: min(-300) }), // breached 10m
    ticket("t9", { first_response_due: min(500) }), // outside risk window
  ];
  const unassigned = [ticket("t2", { created_at: min(-900) }), ticket("t4", { created_at: min(-60), priority: "urgent" }), ticket("t5", { created_at: min(-2000) })];
  const crises = [
    { id: "c1", title: "Spike", severity: "warning", status: "open", detected_at: min(-30) },
    { id: "c2", title: "Outage", severity: "critical", status: "monitoring", detected_at: min(-90) },
    { id: "c3", title: "Old", severity: "critical", status: "resolved", detected_at: min(-90) },
  ];
  const out = h.buildAttention({ sla, unassigned, crises }, now);
  assert.deepEqual(out.map((a) => a.key), ["t:t2", "t:t3", "c:c2", "c:c1", "t:t1", "t:t5", "t:t4"]);
  assert.deepEqual(out.map((a) => a.kind), ["sla_breached", "sla_breached", "crisis", "crisis", "sla_risk", "unassigned", "unassigned"]);
  assert.equal(out[0].detail, "First response overdue 2h ago");
  assert.equal(out[1].detail, "Resolution overdue 10m ago");
  assert.equal(out[4].detail, "First response due in 30m");
  assert.match(out[6].detail, /urgent$/);
  assert.equal(h.buildAttention({ sla, unassigned, crises }, now, 3).length, 3);
});

test("headlineKpis: n/a with setup links when sources are missing (missing is not zero)", () => {
  const base = { channels: 0, tickets: 0, open: 0, unassigned: 0, queued: null, slaConfigured: false, slaRisk: 0, slaBreached: 0, topics: 0, negativeToday: 0, mentionsToday: 0 };
  const empty = h.headlineKpis(base);
  assert.equal(empty.open.value, null);
  assert.equal(empty.open.setup?.href, "/cx/settings/channels");
  assert.equal(empty.unassigned.value, null);
  assert.equal(empty.sla.value, null);
  assert.equal(empty.sla.setup?.href, "/cx/settings/team?tab=sla");
  assert.equal(empty.negative.value, null);
  assert.equal(empty.negative.setup?.href, "/cx/listening/topics");

  const live = h.headlineKpis({ ...base, channels: 1, tickets: 5, open: 3, unassigned: 2, queued: 1, slaConfigured: true, slaRisk: 2, slaBreached: 1, topics: 1, negativeToday: 4, mentionsToday: 9 });
  assert.deepEqual([live.open.value, live.unassigned.value, live.sla.value, live.negative.value], [3, 2, 2, 4]);
  assert.equal(live.unassigned.sub, "1 waiting in queue");
  assert.equal(live.sla.sub, "1 already breached");
  assert.equal(live.negative.sub, "of 9 mentions today");
  // Real zeros stay zeros once the source exists.
  const zero = h.headlineKpis({ ...base, channels: 1, slaConfigured: true, topics: 1 });
  assert.deepEqual([zero.open.value, zero.unassigned.value, zero.sla.value, zero.negative.value], [0, 0, 0, 0]);
});
