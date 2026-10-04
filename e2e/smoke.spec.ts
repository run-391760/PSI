import { expect, test } from "@playwright/test";

/** Every report must render for a signed-in user without console errors or server errors. */
const ROUTES = [
  "/dashboard",
  "/projects",
  "/domain-overview?q=nike.com&db=US",
  "/traffic-analytics?q=nike.com",
  "/organic-research?q=nike.com&db=US",
  "/organic-research?q=nike.com&db=US&tab=positions",
  "/keyword-gap?d=nike.com&d=adidas.com&db=US",
  "/backlink-gap?d=nike.com&d=adidas.com",
  "/market-explorer?q=nike.com",
  "/advertising-research?q=nike.com&db=US",
  "/keyword-overview?q=running+shoes&db=US",
  "/keyword-magic-tool?q=running+shoes&db=US",
  "/keyword-strategy",
  "/ppc-keyword-tool",
  "/topic-research?q=running+shoes&db=US",
  "/position-tracking",
  "/organic-traffic-insights",
  "/backlink-analytics?q=nike.com",
  "/backlink-audit",
  "/link-building",
  "/bulk-analysis",
  "/site-audit",
  "/on-page-checker",
  "/seo-content-template?q=running+shoes&db=US",
  "/writing-assistant",
  "/log-file-analyzer",
  "/local/listings",
  "/local/map-rank-tracker",
  "/local/reviews",
  "/brand-monitoring",
  "/ai-visibility",
  "/sensor",
  "/alerts",
  "/reports",
  "/activity",
  "/settings",
  "/cx",
  "/cx/listening",
  "/cx/listening/dashboards",
  "/cx/listening/topics",
  "/cx/crisis",
  "/cx/inbox",
  "/cx/contacts",
  "/cx/publishing",
  "/cx/publishing/calendar",
  "/cx/analytics",
  "/cx/dashboards",
  "/cx/surveys",
  "/cx/quality",
  "/cx/settings/channels",
  "/cx/settings/team",
  "/cx/settings/automation",
  "/cx/listening/reviews",
  "/cx/listening/ugc",
  "/cx/crisis/playbooks",
  "/cx/command",
  "/cx/command/streams",
  "/cx/reports",
  "/cx/knowledge",
  "/cx/ask",
  "/cx/settings/fields",
  "/cx/settings/queue",
  "/cx/settings/roles",
  "/cx/settings/alerts",
  "/cx/settings/api",
  "/cx/settings",
  "/cx/inbox/queued",
  "/cx/messages",
  "/cx/bookmarks",
  "/cx/tasks",
  "/cx/search",
  "/cx/compose",
  "/cx/mentions-tracker",
  "/cx/ab-testing",
  "/cx/profile",
  "/cx/plan",
  "/cx/settings/profile-groups",
];

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test("unauthenticated users are redirected to sign in", async ({ page }) => {
    await page.goto("/domain-overview?q=nike.com");
    await expect(page).toHaveURL(/\/login/);
  });
});

for (const route of ROUTES) {
  test(`renders ${route}`, async ({ page }) => {
    const problems: string[] = [];
    page.on("console", (m) => m.type() === "error" && problems.push(m.text()));
    page.on("pageerror", (e) => problems.push(e.message));
    page.on("response", (r) => r.status() >= 500 && problems.push(`HTTP ${r.status()} ${r.url()}`));
    const res = await page.goto(route, { waitUntil: "networkidle" });
    expect(res?.status()).toBeLessThan(400);
    await expect(page.locator("h1").first()).toBeVisible();
    await expect(page.getByText("This tool is being built.")).toHaveCount(0);
    // Real-data policy: with DEMO_DATA unset no report may show synthetic data.
    await expect(page.getByText("Demo data", { exact: true })).toHaveCount(0);
    expect(problems).toEqual([]);
  });
}
