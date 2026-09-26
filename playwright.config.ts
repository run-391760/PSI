import { defineConfig } from "@playwright/test";

const STATE = "e2e/.auth/user.json";

export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  workers: 3,
  reporter: [["line"]],
  use: { baseURL: process.env.BASE || "http://127.0.0.1:3200", channel: "chrome", viewport: { width: 1440, height: 900 } },
  projects: [
    // Signs in once (the app rate-limits logins) and saves the session for the other tests.
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    { name: "app", dependencies: ["setup"], testIgnore: /auth\.setup\.ts/, use: { storageState: STATE } },
  ],
});
