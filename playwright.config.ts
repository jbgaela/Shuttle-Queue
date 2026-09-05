import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const testPort = process.env.UI_TEST_PORT ?? "3100";
const baseURL = process.env.UI_TEST_BASE_URL ?? `http://127.0.0.1:${testPort}`;
const frontendRoot = path.resolve(__dirname);
const outputDir = process.env.UI_TEST_OUTPUT_DIR ?? path.join(process.env.TEMP ?? ".", "badminton-queue-test-artifacts");
const reportDir = process.env.UI_TEST_REPORT_DIR ?? path.join(process.env.TEMP ?? ".", "badminton-queue-playwright-report");
const serverMode = process.env.UI_TEST_SERVER_MODE ?? "dev";
const nextBinary = process.platform === "win32" ? ".\\node_modules\\.bin\\next.cmd" : "node_modules/.bin/next";
const serverCommand = serverMode === "production"
  ? `${nextBinary} start --hostname 127.0.0.1 --port ${testPort}`
  : `${nextBinary} dev --webpack --hostname 127.0.0.1 --port ${testPort}`;
const distDir = process.env.UI_TEST_DIST_DIR ?? (serverMode === "production" ? ".next" : ".next-ui-test");

export default defineConfig({
  testDir: "./tests/ui",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  outputDir,
  reporter: [["list"], ["html", { outputFolder: reportDir, open: "never" }]],
  use: {
    baseURL,
    locale: "en-US",
    timezoneId: "UTC",
    colorScheme: "light",
    reducedMotion: "reduce",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 10_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: serverCommand,
    cwd: frontendRoot,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { UI_TEST_DIST_DIR: distDir },
    gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
    stdout: "ignore",
    stderr: "pipe",
  },
});
