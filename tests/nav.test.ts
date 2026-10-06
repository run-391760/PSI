import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { ALL_TOOLS, NAV, NAV_SECTIONS, POPULAR_TOOLS, SEARCH_ONLY, toolByHref } from "../src/components/shell/nav";
import { draftInputFromDoc, migratedDraftIdOf, migrationClaimable, MIGRATION_STALE_MS, pendingMarker } from "../src/lib/optimizer/migrate-doc";

const APP = path.join(process.cwd(), "src", "app", "(app)");
const routeExists = (href: string) => fs.existsSync(path.join(APP, ...href.split("?")[0].split("/").filter(Boolean), "page.tsx"));

test("SEO nav: unique links, every link is a real page, retired duplicates are gone", () => {
  const hrefs = ALL_TOOLS.map((t) => t.href);
  assert.equal(new Set(hrefs).size, hrefs.length);
  for (const h of [...hrefs, ...SEARCH_ONLY.map((s) => s.href)]) assert.ok(routeExists(h), `${h} has a page`);
  for (const gone of ["/writing-assistant", "/seo-content-template", "/alerts"]) assert.ok(!hrefs.includes(gone), `${gone} is not in the menu`);
  assert.ok(SEARCH_ONLY.some((s) => s.href === "/alerts"), "alerts stay searchable");
});

test("SEO nav: sections are known, popular tools exist, hidden tools stay reachable", () => {
  const sections = new Set(NAV_SECTIONS.map((s) => s.id));
  for (const g of NAV) if (g.section) assert.ok(sections.has(g.section), `${g.id} section`);
  assert.equal(POPULAR_TOOLS.length, 7);
  for (const t of POPULAR_TOOLS) assert.ok(toolByHref(t.href), `${t.href} popular`);
  const visible = ALL_TOOLS.filter((t) => !t.defaultHidden).length;
  assert.ok(visible <= 22 && visible >= 15, `${visible} visible rows`);
  assert.ok(ALL_TOOLS.some((t) => t.defaultHidden), "some tools are hidden by default");
  assert.equal(toolByHref("/optimizer/schema")?.href, "/optimizer");
});

test("Writing Assistant migration claim rules", () => {
  const now = Date.now();
  assert.equal(migratedDraftIdOf({ migratedDraftId: "abc" }), "abc");
  assert.equal(migratedDraftIdOf({ migratedDraftId: pendingMarker() }), null);
  assert.equal(migratedDraftIdOf(null), null);
  assert.ok(migrationClaimable(null, now));
  assert.ok(migrationClaimable({}, now));
  assert.ok(migrationClaimable({ migratedDraftId: pendingMarker(new Date(now - MIGRATION_STALE_MS - 1000)) }, now), "stale claim can be taken over");
  assert.ok(!migrationClaimable({ migratedDraftId: pendingMarker(new Date(now)) }, now), "fresh claim is respected");
  assert.ok(!migrationClaimable({ migratedDraftId: "draft-1" }, now), "migrated documents are not migrated again");
  const input = draftInputFromDoc({ id: "d", title: "MBA guide", body: "# MBA", keywords: ["mba admission", "mba fees"], settings: {} });
  assert.equal(input.keyword, "mba admission");
  assert.deepEqual(input.keywords, ["mba fees"]);
});
