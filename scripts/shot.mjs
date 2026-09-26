// Usage: node scripts/shot.mjs <outDir> <path> [path...]   (env: BASE, WIDTH, THEME=dark, FULL=1, EMAIL, PASSWORD)
// Signs in (registers on first use) as $EMAIL (default dev@synapseseo.local) and screenshots each path.
// Prints console errors, page errors and failed requests so broken pages are visible.
import { chromium } from "@playwright/test";
import fs from "node:fs";

const base = process.env.BASE || "http://127.0.0.1:3200";
const [outDir, ...paths] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({ viewport: { width: Number(process.env.WIDTH || 1440), height: 900 }, colorScheme: process.env.THEME === "dark" ? "dark" : "light" });
const page = await context.newPage();
const problems = [];
page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text().slice(0, 300)}`));
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message.slice(0, 300)}`));
page.on("response", (r) => r.status() >= 500 && problems.push(`HTTP ${r.status()} ${r.url()}`));

const email = process.env.EMAIL || "dev@synapseseo.local", password = process.env.PASSWORD || "synapse-dev-pass";
await page.goto(`${base}/login`);
await page.fill("#email", email);
await page.fill("#password", password);
await page.click("button[type=submit]");
// Wait until we leave /login (success) or an error callout appears (unknown account).
await Promise.race([
  page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60000 }),
  page.locator("[class*=critical]").first().waitFor({ timeout: 60000 }),
]).catch(() => {});
if (page.url().includes("/login")) {
  await page.goto(`${base}/register`);
  await page.fill("#name", "Dev User");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.waitForURL("**/dashboard**", { timeout: 60000 });
}
for (const p of paths) {
  const t = Date.now();
  problems.length = 0;
  const res = await page.goto(`${base}${p}`, { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForTimeout(400);
  const name = p.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "root";
  await page.screenshot({ path: `${outDir}/${name}.png`, fullPage: process.env.FULL === "1" });
  const h1 = await page.locator("h1").first().textContent().catch(() => "");
  console.log(`${res?.status()} ${p} (${Date.now() - t}ms) h1="${(h1 || "").trim().slice(0, 60)}" -> ${outDir}/${name}.png`);
  for (const pr of problems) console.log("   ! " + pr);
}
await browser.close();
