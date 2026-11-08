import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/sync",
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  outputDir: "/artifacts/browser-results",
  reporter: [
    ["list"],
    ["json", { outputFile: "/artifacts/browser-results.json" }],
    ["html", { outputFolder: "/artifacts/browser-report", open: "never" }],
  ],
  use: {
    baseURL: "http://localhost:3100",
    serviceWorkers: "allow",
    locale: "en-US",
    timezoneId: "Asia/Manila",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
