import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/soak",
  workers: 1,
  retries: 0,
  timeout: 3_900_000,
  expect: { timeout: 120_000 },
  outputDir: "/artifacts/soak-browser-results",
  reporter: [
    ["list"],
    ["json", { outputFile: "/artifacts/soak-browser-results.json" }],
    ["html", { outputFolder: "/artifacts/soak-browser-report", open: "never" }],
  ],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://localhost:3100",
    serviceWorkers: "allow",
    locale: "en-US",
    timezoneId: "Asia/Manila",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium-five-device", use: { ...devices["Desktop Chrome"] } }],
});
