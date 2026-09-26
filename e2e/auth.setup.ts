import { test as setup } from "@playwright/test";

const email = process.env.E2E_EMAIL || "e2e@synapseseo.local";
const password = process.env.E2E_PASSWORD || "synapse-e2e-pass";

setup("sign in", async ({ page }) => {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await Promise.race([
    page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 }),
    page.locator("[class*=critical]").first().waitFor({ timeout: 60_000 }),
  ]).catch(() => {});
  if (page.url().includes("/login")) {
    const error = (await page.locator("[class*=critical]").first().textContent().catch(() => "")) ?? "";
    if (/too many requests/i.test(error))
      throw new Error(`Sign-in for ${email} is rate limited (10 attempts / 15 min). Wait, or set E2E_EMAIL to another account.`);
    await page.goto("/register");
    await page.fill("#name", "E2E");
    await page.fill("#email", email);
    await page.fill("#password", password);
    await page.click("button[type=submit]");
    await page.waitForURL("**/dashboard**", { timeout: 60_000 });
  }
  await page.context().storageState({ path: "e2e/.auth/user.json" });
});
