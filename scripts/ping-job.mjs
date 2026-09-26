// Verifies the worker: signs in, enqueues core.ping, polls until done.
import { chromium } from "@playwright/test";
const base = process.env.BASE || "http://127.0.0.1:3200";
const browser = await chromium.launch({ channel: "chrome" });
const page = await (await browser.newContext()).newPage();
await page.goto(`${base}/login`);
await page.fill("#email", "dev@synapseseo.local");
await page.fill("#password", "synapse-dev-pass");
await page.click("button[type=submit]");
await page.waitForURL("**/dashboard**");
const job = await page.evaluate(async () => (await fetch("/api/health", { method: "POST" })).json());
console.log("enqueued", job.id, job.status);
for (let i = 0; i < 20; i++) {
  await page.waitForTimeout(700);
  const j = await page.evaluate(async (id) => (await fetch(`/api/health?id=${id}`, { method: "POST" })).json(), job.id);
  console.log(j.status, j.progress, j.total, j.message, j.error ?? "", JSON.stringify(j.result ?? ""));
  if (["done", "failed"].includes(j.status)) break;
}
console.log(await page.evaluate(async () => (await fetch("/api/health")).json()));
await browser.close();
