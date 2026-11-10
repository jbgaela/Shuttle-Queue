import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type * as Bridge from "../sync/browser-entry";

declare global {
  interface Window {
    syncTest: typeof Bridge;
    offlineSoakMetrics?: { longTaskMs: number[] };
  }
}

const PASSWORD = process.env.SYNC_TEST_PASSWORD;
const SOAK_MINUTES = { warmup: 5, online: 10, disconnected: 30, reconnect: 10, cooldown: 5 };
const OFFLINE_MUTATIONS_PER_DEVICE = 400;
const DEVICE_COUNT = 5;
const OFFLINE_ACTION_INTERVAL_MS = 4_500;
const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function login(page: Page, username: string) {
  await page.goto("/");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Settings", exact: true }).first()).toBeVisible();
  await expect(page.getByTestId("offline-workspace-ready")).toBeAttached();
  await page.addScriptTag({ path: "/artifacts/browser-bridge.js" });
  await page.evaluate(() => {
    const metrics = { longTaskMs: [] as number[] };
    window.offlineSoakMetrics = metrics;
    if (PerformanceObserver.supportedEntryTypes.includes("longtask"))
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) metrics.longTaskMs.push(entry.duration);
      }).observe({ type: "longtask", buffered: true });
  });
}

async function editPlayer(page: Page, currentName: string, nextName: string) {
  const startedAt = performance.now();
  await page.getByRole("button", { name: `Edit ${currentName}`, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Edit player" });
  await dialog.getByLabel("Display name").fill(nextName);
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: `Edit ${nextName}`, exact: true })).toBeVisible();
  return performance.now() - startedAt;
}

async function localState(page: Page) {
  return page.evaluate(async () => {
    const accountId = await window.syncTest.repository.currentAccountId();
    const [snapshot, meta] = await Promise.all([
      window.syncTest.database.readSnapshot(accountId),
      window.syncTest.database.getMeta(accountId),
    ]);
    const pendingAudits = await window.syncTest.database.listPendingAudits(accountId);
    return { accountId, snapshot, meta, pendingAudits };
  });
}

const percentile = (values: number[], fraction: number) => {
  const sorted = values.toSorted((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
};

test("60-minute five-device offline event workload preserves a 2,000-action backlog", async ({
  browser,
}) => {
  test.setTimeout(3_900_000);
  if (!PASSWORD) throw new Error("Disposable soak credentials are missing.");

  const contexts: BrowserContext[] = [];
  const devices: Array<{ context: BrowserContext; page: Page; currentNames: string[] }> = [];
  const metrics: Record<string, unknown> = {
    startedAt: new Date().toISOString(),
    scheduleMinutes: SOAK_MINUTES,
    target: { accounts: 1, players: 100, courts: 10, matches: 500, payments: 1000 },
    devices: DEVICE_COUNT,
    offlineMutationsPerDevice: OFFLINE_MUTATIONS_PER_DEVICE,
  };
  const navigationMs: number[] = [];
  const searchMs: number[] = [];
  const syncMs: number[] = [];
  const localActionMs: number[] = [];
  const phaseEnd = (phase: string, startedAt: number) => {
    metrics[`${phase}DurationMs`] = Date.now() - startedAt;
    console.log(`Soak phase completed: ${phase} (${String(metrics[`${phase}DurationMs`])} ms)`);
  };

  try {
    const username = "browser-chromium-load-01";
    for (let index = 0; index < DEVICE_COUNT; index += 1) {
      const context = await browser.newContext({
        locale: "en-US",
        timezoneId: "Asia/Manila",
        serviceWorkers: "allow",
      });
      contexts.push(context);
      const page = await context.newPage();
      await login(page, username);
      const firstPlayer = index * 20 + 1;
      devices.push({
        context,
        page,
        currentNames: Array.from(
          { length: 20 },
          (_, playerIndex) => `Seed ${firstPlayer + playerIndex}`,
        ),
      });
    }

    for (const device of devices) {
      const startedAt = performance.now();
      await device.page.getByRole("button", { name: "Players", exact: true }).click();
      await expect(device.page.getByText("Player directory", { exact: true })).toBeVisible();
      navigationMs.push(performance.now() - startedAt);
      const search = device.page.getByRole("searchbox", { name: "Search player directory" });
      const searchStartedAt = performance.now();
      await search.fill("Seed 1");
      await expect(device.page.getByText("Seed 1", { exact: true })).toBeVisible();
      searchMs.push(performance.now() - searchStartedAt);
      await search.fill("");
    }

    console.log("Soak phase started: 5-minute warmup");
    let phaseStartedAt = Date.now();
    await delay(SOAK_MINUTES.warmup * 60_000);
    phaseEnd("warmup", phaseStartedAt);

    console.log("Soak phase started: 10 minutes online with five active devices");
    phaseStartedAt = Date.now();
    for (let interval = 0; interval < SOAK_MINUTES.online; interval += 1) {
      await Promise.all(
        devices.map(async (device, index) => {
          const nextName = `Online ${index + 1} ${String(interval + 1).padStart(2, "0")}`;
          localActionMs.push(await editPlayer(device.page, device.currentNames[0]!, nextName));
          device.currentNames[0] = nextName;
        }),
      );
      await delay(60_000);
    }
    phaseEnd("online", phaseStartedAt);

    console.log("Soak phase started: 30-minute disconnected event and 2,000 local edits");
    for (const device of devices) await device.context.setOffline(true);
    phaseStartedAt = Date.now();
    const offlineStart = phaseStartedAt;
    let acceptedOfflineMutations = 0;
    await Promise.all(
      devices.map(async (device, deviceIndex) => {
        for (let iteration = 0; iteration < OFFLINE_MUTATIONS_PER_DEVICE; iteration += 1) {
          const actionStartedAt = Date.now();
          const playerIndex = iteration % device.currentNames.length;
          const nextName = `Offline ${deviceIndex + 1} ${String(iteration + 1).padStart(3, "0")}`;
          localActionMs.push(
            await editPlayer(device.page, device.currentNames[playerIndex]!, nextName),
          );
          device.currentNames[playerIndex] = nextName;
          acceptedOfflineMutations += 1;
          const waitMs = OFFLINE_ACTION_INTERVAL_MS - (Date.now() - actionStartedAt);
          if (waitMs > 0) await delay(waitMs);
          if (acceptedOfflineMutations % 100 === 0)
            console.log(`Offline mutations accepted: ${acceptedOfflineMutations}/2000`);
        }
      }),
    );
    if (acceptedOfflineMutations !== DEVICE_COUNT * OFFLINE_MUTATIONS_PER_DEVICE)
      throw new Error(`Only ${acceptedOfflineMutations} offline UI mutations were accepted.`);
    const disconnectedRemaining = SOAK_MINUTES.disconnected * 60_000 - (Date.now() - offlineStart);
    if (disconnectedRemaining > 0) await delay(disconnectedRemaining);
    metrics.acceptedOfflineMutations = acceptedOfflineMutations;
    metrics.disconnectedDurationMs = Date.now() - offlineStart;
    phaseEnd("disconnected", phaseStartedAt);

    const localBeforeReconnect = await Promise.all(devices.map(({ page }) => localState(page)));
    metrics.localBeforeReconnect = localBeforeReconnect.map(
      ({ snapshot, meta, pendingAudits }) => ({
        dirty: meta?.dirty,
        playerCount: snapshot?.players.length,
        pendingAuditCount: pendingAudits.length,
      }),
    );
    const pendingAuditCount = localBeforeReconnect.reduce(
      (total, { pendingAudits }) => total + pendingAudits.length,
      0,
    );
    if (pendingAuditCount < acceptedOfflineMutations)
      throw new Error(
        `Only ${pendingAuditCount} local audit records remained for ${acceptedOfflineMutations} offline actions.`,
      );

    console.log("Soak phase started: reconnect and reconcile five device baselines");
    phaseStartedAt = Date.now();
    const reconnectStartedAt = Date.now();
    for (const device of devices) await device.context.setOffline(false);
    await Promise.all(
      devices.map(async ({ page }) => {
        await page.getByRole("button", { name: "Settings", exact: true }).first().click();
        await expect(page.getByText("Offline workspace", { exact: true })).toBeVisible();
        const state = await localState(page);
        if (state.meta?.dirty) {
          const syncButton = page.getByRole("button", { name: "Sync now", exact: true });
          if (await syncButton.isEnabled()) {
            const syncStartedAt = performance.now();
            await syncButton.click();
            await expect
              .poll(async () => (await localState(page)).meta?.dirty, { timeout: 120_000 })
              .toBe(false);
            syncMs.push(performance.now() - syncStartedAt);
          }
        }
      }),
    );
    await expect
      .poll(
        async () =>
          Promise.all(devices.map(async ({ page }) => (await localState(page)).meta?.dirty)),
        { timeout: 120_000 },
      )
      .toEqual(Array.from({ length: DEVICE_COUNT }, () => false));
    const convergenceMs = Date.now() - reconnectStartedAt;
    metrics.convergenceMs = convergenceMs;
    if (convergenceMs > 120_000)
      throw new Error(`Conflict-free local work took ${convergenceMs} ms to converge.`);

    const remote = await devices[0]!.page.evaluate(() => window.syncTest.api.syncSnapshot());
    const expectedNames = devices.flatMap(({ currentNames }) => currentNames);
    for (const name of expectedNames)
      expect(remote.snapshot.players.some((player) => player.displayName === name)).toBe(true);

    const accountId = localBeforeReconnect[0]!.accountId;
    const { stdout } = await promisify(execFile)(
      "node",
      ["--import", "tsx", "tests/integration/inspect-sync.ts", accountId, "--summary"],
      { cwd: "/workspace/backend", env: process.env },
    );
    const database = JSON.parse(stdout);
    metrics.database = { ...database, cloudRevision: database.state.cloudRevision };
    if (database.players !== 100 || database.matches !== 500 || database.payments !== 1000)
      throw new Error("The original qualification fixture changed during offline reconciliation.");
    if (database.audits < acceptedOfflineMutations)
      throw new Error(
        `Only ${database.audits} of ${acceptedOfflineMutations} local mutations reached MongoDB.`,
      );
    const reconnectRemaining = SOAK_MINUTES.reconnect * 60_000 - (Date.now() - phaseStartedAt);
    if (reconnectRemaining > 0) await delay(reconnectRemaining);
    phaseEnd("reconnect", phaseStartedAt);

    console.log("Soak phase started: 5-minute cooldown");
    phaseStartedAt = Date.now();
    await delay(SOAK_MINUTES.cooldown * 60_000);
    phaseEnd("cooldown", phaseStartedAt);

    const browserMetrics = await Promise.all(
      devices.map(({ page }) =>
        page.evaluate(() => ({
          longTaskMs: window.offlineSoakMetrics?.longTaskMs ?? [],
          heapBytes:
            (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
              ?.usedJSHeapSize ?? null,
        })),
      ),
    );
    const longTasks = browserMetrics.flatMap((device) => device.longTaskMs);
    metrics.measurements = {
      localActions: localActionMs.length,
      localActionP50Ms: Math.round(percentile(localActionMs, 0.5) * 100) / 100,
      localActionP95Ms: Math.round(percentile(localActionMs, 0.95) * 100) / 100,
      localActionMaxMs: Math.round(Math.max(...localActionMs) * 100) / 100,
      navigationP95Ms: Math.round(percentile(navigationMs, 0.95)),
      searchP95Ms: Math.round(percentile(searchMs, 0.95)),
      syncActionP95Ms: Math.round(percentile(syncMs, 0.95)),
      maxMainThreadLongTaskMs: longTasks.length ? Math.round(Math.max(...longTasks)) : 0,
      deviceHeapBytes: browserMetrics.map((device) => device.heapBytes),
    };
    metrics.completedAt = new Date().toISOString();
    await writeFile("/artifacts/soak-metrics.json", JSON.stringify(metrics, null, 2));
    console.log(JSON.stringify(metrics, null, 2));

    expect(localActionMs.length).toBeGreaterThanOrEqual(acceptedOfflineMutations);
    expect(percentile(localActionMs, 0.95)).toBeLessThanOrEqual(500);
    expect(percentile(navigationMs, 0.95)).toBeLessThanOrEqual(1_000);
    expect(percentile(searchMs, 0.95)).toBeLessThanOrEqual(1_000);
    expect(Math.max(...longTasks)).toBeLessThanOrEqual(2_000);
  } finally {
    metrics.completedAt ??= new Date().toISOString();
    await writeFile("/artifacts/soak-metrics.json", JSON.stringify(metrics, null, 2));
    await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
  }
});
