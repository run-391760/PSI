import assert from "node:assert/strict";
import { test } from "node:test";

/** WP-K1: CX shell navigation data (src/components/shell/cx-nav.ts). */
const n = await import("../src/components/shell/cx-nav");
const prefs = await import("../src/lib/cx/ui/prefs-logic");

const q = (s = "") => new URLSearchParams(s);
const monitorItems = n.CX_NAV.filter((g) => g.tab === "monitor" && g.id !== "monitor-more").flatMap((g) => g.items);

test("cxTabFor follows the spec route rule", () => {
  assert.equal(n.cxTabFor("/cx"), "monitor");
  assert.equal(n.cxTabFor("/cx/inbox/queued"), "monitor");
  assert.equal(n.cxTabFor("/cx/settings/channels"), "monitor");
  assert.equal(n.cxTabFor("/cx/analytics"), "analytics");
  assert.equal(n.cxTabFor("/cx/publishing/calendar"), "publish");
  assert.equal(n.cxTabFor("/cx/dashboards/abc"), "dashboard");
  assert.equal(n.cxTabFor("/cx/analyticsx"), "monitor");
  assert.ok(n.isCxPath("/cx") && n.isCxPath("/cx/inbox") && !n.isCxPath("/cxo") && !n.isCxPath("/dashboard"));
});

test("MONITOR sidebar matches the Konnect groups and routes, all visible by default", () => {
  const groups = n.CX_NAV.filter((g) => g.tab === "monitor" && g.id !== "monitor-more");
  assert.deepEqual(groups.map((g) => g.label), ["Omni-Channel Tickets", "Messages", "Setup", "Reports", "Tasks"]);
  assert.deepEqual(
    monitorItems.map((i) => `${i.label}=${i.href}`),
    [
      "Tickets=/cx/inbox", "Queued Tickets=/cx/inbox/queued", "All Messages=/cx/messages", "Bookmarks=/cx/bookmarks",
      "Settings=/cx/settings", "Topics=/cx/listening/topics", "A/B Testing=/cx/ab-testing", "Quick Search=/cx/search",
      "Reports=/cx/reports", "Download=/cx/reports/download", "One-Click Report=/cx/reports/one-click", "Custom Report=/cx/reports/custom",
      "My Tasks=/cx/tasks?view=mine", "All Tasks=/cx/tasks?view=all",
    ],
  );
  assert.ok(monitorItems.every((i) => !i.defaultHidden));
  // The hamburger-only modules are in the customize menu but hidden by default.
  const more = n.CX_NAV.find((g) => g.id === "monitor-more")!;
  assert.ok(more.items.every((i) => i.defaultHidden));
  const visible = prefs.applyNavPrefs(n.CX_NAV, prefs.DEFAULT_NAV).map((g) => g.id);
  assert.ok(!visible.includes("monitor-more"));
});

test("pickActive: longest prefix, query params, defaults, aliases; hamburger-only pages highlight nothing", () => {
  assert.equal(n.pickActive("/cx/inbox", q(), monitorItems), "/cx/inbox");
  assert.equal(n.pickActive("/cx/inbox/queued", q(), monitorItems), "/cx/inbox/queued");
  assert.equal(n.pickActive("/cx/ticket/42", q(), monitorItems), "/cx/inbox");
  assert.equal(n.pickActive("/cx/settings/channels", q(), monitorItems), "/cx/settings");
  assert.equal(n.pickActive("/cx/reports/share-of-voice", q(), monitorItems), "/cx/reports");
  assert.equal(n.pickActive("/cx/reports/download", q(), monitorItems), "/cx/reports/download");
  assert.equal(n.pickActive("/cx/tasks", q("brand=b"), monitorItems), "/cx/tasks?view=mine");
  assert.equal(n.pickActive("/cx/tasks", q("view=all&brand=b"), monitorItems), "/cx/tasks?view=all");
  assert.equal(n.pickActive("/cx/tasks", q("view=overdue"), monitorItems), undefined);
  assert.equal(n.pickActive("/cx/crisis", q(), monitorItems), undefined);
  assert.equal(n.pickActive("/cx/listening", q(), monitorItems), undefined);
  // Exact items: the /cx overview isn't active on sub-pages.
  const menu = n.CX_MENU.flatMap((s) => s.items);
  assert.equal(n.pickActive("/cx", q(), menu), "/cx");
  assert.equal(n.pickActive("/cx/inbox", q(), menu), undefined);
  assert.equal(n.pickActive("/cx/command/streams", q(), menu), "/cx/command/streams");
});

test("secondary panels: spec routes, admin pages highlight Admin, report query items", () => {
  const settings = n.CX_SETTINGS_PANEL.groups.flatMap((g) => g.items);
  assert.deepEqual(settings.map((i) => i.label), ["Group Details", "Omni-Channel Setup", "Topics", "Users", "Clusters", "More Social Profiles", "Integrated Apps", "All Apps", "Admin"]);
  assert.equal(n.pickActive("/cx/settings/team", q(), settings), "/cx/settings/admin");
  assert.equal(n.pickActive("/cx/settings/profile-groups", q(), settings), "/cx/settings/clusters");
  assert.equal(n.pickActive("/cx/settings/channels", q(), settings), "/cx/settings/channels");
  const reports = n.CX_REPORTS_PANEL.groups.flatMap((g) => g.items);
  assert.deepEqual(n.CX_REPORTS_PANEL.groups.map((g) => g.label), ["Social Listening", "Community Engagement", "Calls Analytics"]);
  assert.equal(n.pickActive("/cx/reports/tasks", q("view=mine"), reports), "/cx/reports/tasks?view=mine");
  assert.equal(n.pickActive("/cx/reports/tasks", q(), reports), "/cx/reports/tasks?view=all");
  assert.equal(n.pickActive("/cx/reports/calls", q("tab=agentwise"), reports), "/cx/reports/calls?tab=agentwise");
  // Serializable: no functions in panel data (server layouts pass it to a client component).
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(n.CX_REPORTS_PANEL)));
  assert.deepEqual(JSON.parse(JSON.stringify(n.CX_SETTINGS_PANEL)), n.CX_SETTINGS_PANEL);
});

test("keepParams carries ?brand= into CX links only", () => {
  assert.equal(n.keepParams("/cx/inbox", q("brand=b1&x=2")), "/cx/inbox?brand=b1");
  assert.equal(n.keepParams("/cx/tasks?view=all", q("brand=b1")), "/cx/tasks?view=all&brand=b1");
  assert.equal(n.keepParams("/cx/tasks?brand=own", q("brand=b1")), "/cx/tasks?brand=own");
  assert.equal(n.keepParams("/settings", q("brand=b1")), "/settings");
  assert.equal(n.keepParams("/cx/reports/sentiment", q("brand=b&scope=c.1&page=2"), ["brand", "scope"]), "/cx/reports/sentiment?brand=b&scope=c.1");
});

test("every hamburger module and sidebar item is searchable", () => {
  const hrefs = new Set(n.CX_SEARCH.map((s) => s.href));
  for (const i of [...n.CX_NAV.flatMap((g) => g.items), ...n.CX_MENU.flatMap((s) => s.items)]) assert.ok(hrefs.has(i.href), i.href);
  assert.equal(hrefs.size, n.CX_SEARCH.length);
});
