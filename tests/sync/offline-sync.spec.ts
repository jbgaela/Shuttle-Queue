import { expect, test, type Page } from "@playwright/test";
import type * as Bridge from "./browser-entry";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

declare global {
  interface Window {
    syncTest: typeof Bridge;
  }
}

// Reset only the disposable server process; its production rate limits remain enabled.
test.beforeEach(async () => {
  await fault("restart");
});
test.afterEach(async () => {
  await fault("release");
});

async function fault(path: string) {
  const response = await fetch("http://127.0.0.1:4002/" + path, {
    signal: AbortSignal.timeout(30_000),
  });
  expect(response.ok).toBe(true);
}
async function bridge(page: Page) {
  await page.addScriptTag({ path: "/artifacts/browser-bridge.js" });
}
async function assetDownloads(reset = false) {
  const response = await fetch("http://127.0.0.1:4002/asset-count" + (reset ? "?reset=1" : ""));
  expect(response.ok).toBe(true);
  return ((await response.json()) as { count: number }).count;
}
async function login(page: Page, username: string) {
  await page.goto("/");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(process.env.SYNC_TEST_PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Settings", exact: true }).first()).toBeVisible();
  await expect(page.getByTestId("offline-workspace-ready")).toBeAttached();
  await bridge(page);
  await expect.poll(() => page.evaluate(() => window.syncTest.database.hasSnapshot())).toBe(true);
}
async function local(page: Page) {
  return page.evaluate(async () => {
    const accountId = await window.syncTest.repository.currentAccountId();
    return {
      accountId,
      snapshot: await window.syncTest.database.readSnapshot(accountId),
      meta: await window.syncTest.database.getMeta(accountId),
    };
  });
}
async function sync(page: Page) {
  return page.evaluate(async () =>
    window.syncTest.repository.syncAccount(
      await window.syncTest.repository.currentAccountId(),
      "manual",
    ),
  );
}
async function addPlayer(page: Page, name: string) {
  return page.evaluate(
    (displayName) =>
      window.syncTest.api.createPlayer({ displayName, gender: "MALE", skillLevel: "BEGINNER" }),
    name,
  );
}
async function cloud(page: Page) {
  return page.evaluate(() => window.syncTest.api.syncSnapshot());
}
async function settings(page: Page) {
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await expect(page.getByText("Offline workspace", { exact: true })).toBeVisible();
}
async function assertPersisted(page: Page) {
  const state = await local(page);
  const remote = (await cloud(page)).snapshot as NonNullable<typeof state.snapshot>;
  const { stdout } = await promisify(execFile)(
    "node",
    ["--import", "tsx", "tests/integration/inspect-sync.ts", state.accountId],
    { cwd: "/workspace/backend", env: process.env },
  );
  const database = JSON.parse(stdout);
  expect(database.players.map((row: { id: string }) => row.id).sort()).toEqual(
    state.snapshot!.players.map((row) => row.id).sort(),
  );
  expect(database.players.map((row: { id: string }) => row.id).sort()).toEqual(
    remote.players.map((row) => row.id).sort(),
  );
  expect(database.state.cloudRevision).toBe(state.meta!.baseCloudRevision);
  expect(database.state.schemaVersion).toBe(3);
  expect(database.receipts).toBe(database.state.cloudRevision - 1);
  expect(database.audits).toBe(remote.audits.length);
  expect(state.snapshot!.audits.length).toBe(database.audits);
  expect(database.payments.length).toBe(remote.payments.length);
  expect(database.matches.length).toBe(remote.matches.length);
  for (const row of database.payments) {
    expect(remote.payments.find((item) => item.id === row.id)).toMatchObject(row);
    expect(state.snapshot!.payments.find((item) => item.id === row.id)).toMatchObject(row);
  }
  expect(database.matches.map((row: { id: string }) => row.id).sort()).toEqual(
    state.snapshot!.matches.map((row) => row.id).sort(),
  );
  for (const row of database.queuePlayers) {
    expect(remote.queuePlayers.find((item) => item.id === row.id)).toMatchObject(row);
    expect(state.snapshot!.queuePlayers.find((item) => item.id === row.id)).toMatchObject(row);
  }
  await settings(page);
  await expect(page.getByText("Up to date", { exact: true }).first()).toBeVisible();
}

async function cachedAssets(page: Page) {
  return page.evaluate(async () => {
    const cacheName = (await caches.keys()).find((name) => name.startsWith("shuttle-precache-"));
    if (!cacheName) throw new Error("No build-specific offline UI cache was installed.");
    const cache = await caches.open(cacheName);
    const requests = await cache.keys();
    const script = requests.find((request) => new URL(request.url).pathname.endsWith(".js"));
    const stylesheet = requests.find((request) => new URL(request.url).pathname.endsWith(".css"));
    const metadata = requests.find(
      (request) => new URL(request.url).pathname === "/offline-build.json",
    );
    if (!script || !stylesheet || !metadata)
      throw new Error("The offline UI cache is missing required app assets.");
    return {
      cacheName,
      assetCount: requests.length,
      script: script.url,
      stylesheet: stylesheet.url,
      metadata: metadata.url,
    };
  });
}

test("offline match and player work remains available in history, rankings, and fees", async ({
  page,
  context,
}, info) => {
  await login(page, `browser-${info.project.name}-ui-continuity`);
  const setup = await page.evaluate(async () => {
    const accountId = await window.syncTest.repository.currentAccountId();
    const snapshot = (await window.syncTest.database.readSnapshot(accountId))!;
    const teamA =
      snapshot.synergyTeams?.[0]?.queuePlayerIds ??
      (snapshot.queuePlayers.slice(0, 2).map((player) => player.id) as [string, string]);
    const pairedPlayers = new Set(teamA);
    return {
      teamA,
      teamB: snapshot.queuePlayers
        .filter((player) => !pairedPlayers.has(player.id))
        .slice(0, 2)
        .map((player) => player.id),
      courtId: snapshot.courts[0]!.id,
    };
  });
  const queued = await page.evaluate(
    ({ teamA, teamB }) => window.syncTest.api.createManualMatch("workspace", { teamA, teamB }),
    setup,
  );
  expect((await sync(page)).state).toBe("uploaded");
  await page.reload();
  await expect(page.getByTestId("offline-workspace-ready")).toBeAttached();
  await bridge(page);

  const courtSelect = page.locator(`#queued-court-${queued.id}`);
  await courtSelect.selectOption(setup.courtId);
  await page.getByRole("button", { name: "Start match", exact: true }).click();
  await expect(page.getByText("Queued match started.", { exact: true })).toBeVisible();

  await context.setOffline(true);
  await page.getByRole("button", { name: "Edit match", exact: true }).click();
  const editDialog = page.getByRole("dialog", { name: "Edit live match" });
  await editDialog.getByRole("button", { name: "Swap teams", exact: true }).click();
  await editDialog.getByRole("button", { name: "Save live match", exact: true }).click();
  await expect(editDialog).toHaveCount(0);

  await page.getByRole("button", { name: "Enter final score" }).click();
  const scoreDialog = page.getByRole("dialog", { name: "Record the score" });
  await scoreDialog
    .getByLabel(/game 1 score$/)
    .nth(0)
    .fill("31");
  await scoreDialog
    .getByLabel(/game 1 score$/)
    .nth(1)
    .fill("12");
  await scoreDialog.getByRole("button", { name: "Confirm final score" }).click();
  await expect(page.getByText("Result saved. Court is available again.")).toBeVisible();

  await page.getByRole("button", { name: "Players", exact: true }).click();
  await page.getByLabel("Display name").fill("Offline UI player");
  await page.getByRole("button", { name: "Create player", exact: true }).click();
  await expect(page.getByText("Offline UI player", { exact: true })).toBeVisible();
  const offline = await local(page);
  expect(offline.meta?.dirty).toBe(true);
  expect(
    offline.snapshot?.players.some((player) => player.displayName === "Offline UI player"),
  ).toBe(true);
  const offlineMatch = offline.snapshot?.matches.find((match) => match.id === queued.id);
  expect(offlineMatch?.status).toBe("COMPLETED");
  expect(
    offlineMatch?.participants
      .filter((participant) => participant.team === "A")
      .map((participant) => participant.queuePlayerId)
      .sort(),
  ).toEqual([...setup.teamB].sort());

  await context.setOffline(false);
  expect(["clean", "uploaded"]).toContain((await sync(page)).state);
  const remote = await cloud(page);
  expect(remote.snapshot.players.some((player) => player.displayName === "Offline UI player")).toBe(
    true,
  );
  expect(remote.snapshot.matches.find((match) => match.id === queued.id)?.status).toBe("COMPLETED");
  await assertPersisted(page);

  await page.getByRole("button", { name: "History", exact: true }).click();
  const historyMatch = page.getByTestId(`history-match-${queued.id}`);
  await expect(historyMatch).toBeVisible();
  await historyMatch.getByTestId("history-match-toggle").click();
  await expect(historyMatch).toContainText("31");
  await expect(historyMatch).toContainText("12");

  await page.getByRole("button", { name: "Rankings", exact: true }).click();
  await expect(page.getByTestId(`ranking-row-${setup.teamA[0]}`)).toBeVisible();

  await page.getByRole("button", { name: "Fees", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Keep fees accounted for." })).toBeVisible();
  await expect(page.getByTestId("log-payment-card")).toBeVisible();

  await page.getByRole("button", { name: "Players", exact: true }).click();
  await expect(page.getByText("Offline UI player", { exact: true })).toBeVisible();
});

test("a held cloud request times out while visible offline edits still save", async ({
  page,
  context,
}, info) => {
  await login(page, `browser-${info.project.name}-ui-continuity`);
  await fault("arm-request?mode=hold&method=GET&path=%2Fapi%2Fv2%2Fworkspace");
  const cloudRequest = page.evaluate(async () => {
    try {
      await window.syncTest.api.cloudWorkspace();
      return { code: "UNEXPECTED_SUCCESS", message: "" };
    } catch (error) {
      return {
        code: error instanceof Error && "code" in error ? String(error.code) : "UNKNOWN",
        message: error instanceof Error ? error.message : "Request failed.",
      };
    }
  });
  await expect.poll(async () => (await fetch("http://127.0.0.1:4002/observed")).ok).toBe(true);

  await context.setOffline(true);
  await page.getByRole("button", { name: "Players", exact: true }).click();
  await page.getByLabel("Display name").fill("Saved during cloud timeout");
  await page.getByRole("button", { name: "Create player", exact: true }).click();
  await expect(page.getByText("Saved during cloud timeout", { exact: true })).toBeVisible();
  expect(await cloudRequest).toMatchObject({
    code: "REQUEST_TIMEOUT",
    message: expect.stringContaining("local work is saved"),
  });
  expect((await local(page)).meta?.dirty).toBe(true);
});

test("the total sync deadline includes cross-tab lock waiting and preserves pending work", async ({
  page,
  context,
}, info) => {
  test.skip(info.project.name !== "chromium", "The lock deadline check uses Chromium Web Locks.");
  await login(page, "browser-chromium-sync-deadline");
  await context.setOffline(true);
  const accountId = await page.evaluate(async () => {
    const accountId = await window.syncTest.repository.currentAccountId();
    const target = window as Window & {
      __syncDeadlineRelease?: () => void;
      __syncDeadlineRestoreTimer?: () => void;
    };
    const originalSetTimeout = window.setTimeout.bind(window);
    Object.defineProperty(window, "setTimeout", {
      configurable: true,
      writable: true,
      value: (handler: TimerHandler, timeout = 0) =>
        originalSetTimeout(handler, timeout === 60_000 ? 50 : timeout),
    });
    target.__syncDeadlineRestoreTimer = () =>
      Object.defineProperty(window, "setTimeout", {
        configurable: true,
        writable: true,
        value: originalSetTimeout,
      });
    let releaseLock = () => undefined;
    let signalLockReady = () => undefined;
    const holdLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const lockReady = new Promise<void>((resolve) => {
      signalLockReady = resolve;
    });
    target.__syncDeadlineRelease = releaseLock;
    void navigator.locks.request(`shuttle-queue-sync:${accountId}`, async () => {
      signalLockReady();
      await holdLock;
    });
    await lockReady;
    return accountId;
  });

  try {
    await page.getByRole("button", { name: "Players", exact: true }).click();
    await page.getByLabel("Display name").fill("Pending behind sync lock");
    await page.getByRole("button", { name: "Create player", exact: true }).click();
    await expect(page.getByText("Pending behind sync lock", { exact: true })).toBeVisible();

    const timeout = await page.evaluate(async (id) => {
      const startedAt = performance.now();
      try {
        await window.syncTest.repository.syncAccount(id, "manual");
        return { code: "UNEXPECTED_SUCCESS", elapsedMs: performance.now() - startedAt };
      } catch (error) {
        return {
          code: error instanceof Error && "code" in error ? String(error.code) : "UNKNOWN",
          elapsedMs: performance.now() - startedAt,
        };
      }
    }, accountId);
    expect(timeout.code).toBe("SYNC_TIMEOUT");
    expect(timeout.elapsedMs).toBeLessThan(5_000);
    expect((await local(page)).meta?.dirty).toBe(true);
  } finally {
    await page.evaluate(() => {
      const target = window as Window & {
        __syncDeadlineRelease?: () => void;
        __syncDeadlineRestoreTimer?: () => void;
      };
      target.__syncDeadlineRelease?.();
      target.__syncDeadlineRestoreTimer?.();
      delete target.__syncDeadlineRelease;
      delete target.__syncDeadlineRestoreTimer;
    });
  }

  await context.setOffline(false);
  await sync(page);
  expect((await local(page)).meta?.dirty).toBe(false);
  expect(
    (await cloud(page)).snapshot.players.some(
      (player) => player.displayName === "Pending behind sync lock",
    ),
  ).toBe(true);
});

test("ten mid-session offline cycles, offline sync, reload, online sync and another sync", async ({
  page,
  context,
}, info) => {
  await login(page, `browser-${info.project.name}-cycles`);
  for (let cycle = 0; cycle < 10; cycle += 1) {
    await context.setOffline(true);
    await addPlayer(page, `Offline ${cycle}`);
    if (cycle === 0)
      await page.evaluate(async () => {
        const { api, repository, database } = window.syncTest;
        const accountId = await repository.currentAccountId();
        const snapshot = (await database.readSnapshot(accountId))!;
        const partners = snapshot.synergyTeams![0]!.queuePlayerIds;
        const ids = [
          ...partners,
          ...snapshot.queuePlayers.filter((row) => !partners.includes(row.id)).map((row) => row.id),
        ];
        const queued = await api.createManualMatch("workspace", {
          teamA: ids.slice(0, 2),
          teamB: ids.slice(2, 4),
        });
        const edited = await api.updateMatch(queued, {
          teamA: ids.slice(2, 4),
          teamB: ids.slice(0, 2),
        });
        await api.startMatch(edited.id, snapshot.courts[0]!.id);
        await api.completeMatch(edited.id, [{ teamAScore: 31, teamBScore: 12 }]);
        const completed = (await database.readSnapshot(accountId))!.matches.find(
          (row) => row.id === edited.id,
        )!;
        await api.correctMatch(
          edited.id,
          [{ teamAScore: 31, teamBScore: 16 }],
          "Docker offline correction",
          completed.version,
        );
        await api.createPayment("workspace", {
          queuePlayerId: ids[0],
          kind: "COLLECTION",
          amountMinor: 5000,
          method: "CASH",
        });
      });
    expect((await sync(page)).state).toBe("pending");
    expect((await local(page)).meta?.dirty).toBe(true);
    // WebKit emulator rejects worker navigations: https://github.com/microsoft/playwright/issues/42775
    // The real-origin outage reload scenario below runs in every engine.
    if (cycle === 0 && info.project.name !== "webkit") {
      await page.reload();
      await bridge(page);
      expect(
        (await local(page)).snapshot?.players.some((row) => row.displayName === "Offline 0"),
      ).toBe(true);
    }
    await context.setOffline(false);
    await sync(page);
    await addPlayer(page, `Online ${cycle}`);
    await sync(page);
    await page.reload();
    await expect(page.getByTestId("offline-workspace-ready")).toBeAttached();
    await bridge(page);
    const state = await local(page);
    expect(state.meta?.dirty).toBe(false);
    expect(state.snapshot?.players).toHaveLength(4 + 2 * (cycle + 1));
    expect((await cloud(page)).snapshot).toMatchObject({
      players: expect.arrayContaining(state.snapshot!.players),
    });
    await assertPersisted(page);
  }
  await settings(page);
  await expect(page.getByText("Up to date", { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: `/artifacts/${info.project.name}-sync-clean.png`, fullPage: true });
});

test("lost response after commit replays the same durable operation after reload", async ({
  page,
}, info) => {
  await login(page, `browser-${info.project.name}-replay`);
  await addPlayer(page, "Committed once");
  await fault("arm?mode=drop");
  await expect(sync(page)).rejects.toThrow();
  const state = await local(page);
  expect(state.meta?.dirty).toBe(true);
  await fault("release");
  await page.reload();
  await bridge(page);
  await sync(page);
  const remote = await cloud(page);
  expect(
    (remote.snapshot as typeof state.snapshot)!.players.filter(
      (row) => row.displayName === "Committed once",
    ),
  ).toHaveLength(1);
  expect((await local(page)).meta?.dirty).toBe(false);
  await assertPersisted(page);
});

test("editing during a paused upload preserves both the acknowledgement and newer work", async ({
  page,
}, info) => {
  await login(page, `browser-${info.project.name}-inflight`);
  await addPlayer(page, "First batch");
  await fault("arm?mode=hold");
  const pending = sync(page);
  await fault("observed");
  await addPlayer(page, "Second batch");
  await fault("release");
  await pending;
  expect((await local(page)).meta?.dirty).toBe(true);
  await page.unroute("**/api/v2/sync/snapshot");
  await sync(page);
  const names = (await local(page)).snapshot!.players.map((row) => row.displayName);
  expect(names).toContain("First batch");
  expect(names).toContain("Second batch");
  expect((await local(page)).meta?.dirty).toBe(false);
  await assertPersisted(page);
});

test("two independent devices preserve independent edits and review incompatible fields", async ({
  page,
  browser,
}, info) => {
  const username = `browser-${info.project.name}-conflicts`;
  await login(page, username);
  const other = await browser.newContext({
    baseURL: "http://localhost:3100",
    serviceWorkers: "allow",
  });
  const device = await other.newPage();
  try {
    await login(device, username);
    await addPlayer(page, "Device A");
    await addPlayer(device, "Device B");
    await sync(page);
    await sync(device);
    await sync(page);
    expect((await local(page)).snapshot!.players.map((row) => row.displayName)).toEqual(
      expect.arrayContaining(["Device A", "Device B"]),
    );
    await addPlayer(page, "Shared conflict target");
    await sync(page);
    await sync(device);
    const conflictTargetId = await page.evaluate(
      async () =>
        (await window.syncTest.api.players()).find(
          (player) => player.displayName === "Shared conflict target",
        )!.id,
    );
    const otherConflictTargetId = await device.evaluate(
      async () =>
        (await window.syncTest.api.players()).find(
          (player) => player.displayName === "Shared conflict target",
        )!.id,
    );
    expect(otherConflictTargetId).toBe(conflictTargetId);
    for (const [target, name] of [
      [page, "Local name"],
      [device, "Cloud name"],
    ] as const) {
      await target.evaluate(
        async ({ id, displayName }) => {
          const player = (await window.syncTest.api.players()).find((row) => row.id === id);
          if (!player) throw new Error("The shared conflict target is missing from this device.");
          await window.syncTest.api.updatePlayer(player, {
            displayName,
            gender: "MALE",
            skillLevel: "BEGINNER",
          });
        },
        { id: conflictTargetId, displayName: name },
      );
    }
    await sync(device);
    await expect(sync(page)).rejects.toThrow(/review/i);
    await settings(page);
    const review = page.getByRole("region", { name: "Review sync conflicts" });
    await expect(review).toBeVisible();
    await addPlayer(device, "Added while reviewing");
    await sync(device);
    for (const select of await review.getByRole("combobox").all())
      await select.selectOption("local");
    await review.getByRole("button", { name: "Apply choices and sync" }).click();
    await expect(review).toHaveCount(0);
    expect((await local(page)).meta?.dirty).toBe(true);
    await expect(sync(page)).rejects.toThrow(/review/i);
    await expect(review).toBeVisible();
    for (const select of await review.getByRole("combobox").all())
      await select.selectOption("local");
    await review.getByRole("button", { name: "Apply choices and sync" }).click();
    await expect(review).toHaveCount(0);
    expect((await local(page)).meta?.dirty).toBe(false);
    await assertPersisted(page);
    await sync(device);
    await addPlayer(page, "Same name");
    await addPlayer(device, "Same name");
    await sync(device);
    await expect(sync(page)).rejects.toThrow(/review/i);
    const identity = page.getByRole("region", { name: "Review sync conflicts" });
    await expect(identity).toBeVisible();
    await identity.getByRole("combobox").selectOption("rename");
    await identity.getByLabel("New name").fill("Renamed local player");
    await identity.getByRole("button", { name: "Apply choices and sync" }).click();
    await expect(identity).toHaveCount(0);
    await assertPersisted(page);
    await sync(device);
    await addPlayer(page, "Reuse name");
    await addPlayer(device, "Reuse name");
    await sync(device);
    await expect(sync(page)).rejects.toThrow(/review/i);
    await expect(identity).toBeVisible();
    await identity.getByRole("combobox").selectOption("cloud");
    await identity.getByRole("button", { name: "Apply choices and sync" }).click();
    await expect(identity).toHaveCount(0);
    expect(
      (await local(page)).snapshot!.players.filter((row) => row.displayName === "Reuse name"),
    ).toHaveLength(1);
    await assertPersisted(page);
    await page.screenshot({
      path: `/artifacts/${info.project.name}-conflict-resolved.png`,
      fullPage: true,
    });
  } finally {
    await other.close();
  }
});

test("two tabs, reconnect and manual sync cannot lose or duplicate work", async ({
  page,
  context,
}, info) => {
  await login(page, `browser-${info.project.name}-tabs`);
  const tab = await context.newPage();
  await tab.goto("/");
  await bridge(tab);
  await context.setOffline(true);
  await addPlayer(page, "Across tabs");
  await context.setOffline(false);
  await Promise.all([sync(page), sync(tab), sync(page)]);
  expect((await local(page)).meta?.dirty).toBe(false);
  const snapshot = (await cloud(page)).snapshot as NonNullable<
    Awaited<ReturnType<typeof local>>["snapshot"]
  >;
  expect(snapshot.players.filter((row) => row.displayName === "Across tabs")).toHaveLength(1);
  await assertPersisted(page);
});

test("retained legacy snapshot without baseline survives reload and upgrades", async ({
  page,
}, info) => {
  await login(page, `browser-${info.project.name}-legacy`);
  await addPlayer(page, "Legacy pending");
  await page.evaluate(async () => {
    const accountId = await window.syncTest.repository.currentAccountId();
    await window.syncTest.database.offlineDb.snapshots.update(accountId, {
      baseline: undefined,
      pendingUpload: undefined,
    });
  });
  await page.reload();
  await bridge(page);
  await sync(page);
  expect(
    (await local(page)).snapshot!.players.some((row) => row.displayName === "Legacy pending"),
  ).toBe(true);
  expect((await local(page)).meta?.dirty).toBe(false);
  await assertPersisted(page);
});

test("backend failure retains the durable batch and retries after service recovery", async ({
  page,
}, info) => {
  await login(page, `browser-${info.project.name}-failure`);
  await addPlayer(page, "Recoverable");
  await fault("arm?mode=unavailable");
  await expect(sync(page)).rejects.toThrow(/outage/);
  expect((await local(page)).meta?.dirty).toBe(true);
  await fault("release");
  await sync(page);
  expect((await local(page)).meta?.dirty).toBe(false);
  await assertPersisted(page);
});

test("expired authentication preserves pending work through sign-in", async ({
  page,
  context,
}, info) => {
  const username = `browser-${info.project.name}-session`;
  await login(page, username);
  await addPlayer(page, "Pending through reauthentication");
  await context.clearCookies();
  await expect(sync(page)).rejects.toThrow();
  expect((await local(page)).meta?.dirty).toBe(true);
  await login(page, username);
  await sync(page);
  expect(
    (await local(page)).snapshot!.players.some(
      (row) => row.displayName === "Pending through reauthentication",
    ),
  ).toBe(true);
  await assertPersisted(page);
});

test("cached workspace reload survives a real origin socket outage", async ({ page }, info) => {
  await login(page, `browser-${info.project.name}-reload`);
  await addPlayer(page, "Pending during origin outage");
  await fault("origin-offline");
  await page.reload();
  await bridge(page);
  await expect(page.getByRole("button", { name: "Settings", exact: true }).first()).toBeVisible();
  expect(
    (await local(page)).snapshot!.players.some(
      (row) => row.displayName === "Pending during origin outage",
    ),
  ).toBe(true);
  await expect(sync(page)).rejects.toThrow();
  expect((await local(page)).meta?.dirty).toBe(true);
  await fault("origin-online");
  await sync(page);
  await assertPersisted(page);
});

test("first and repeat login enter only after real UI and account storage checks", async ({
  page,
}, info) => {
  await assetDownloads(true);
  const firstStarted = Date.now();
  await login(page, "browser-" + info.project.name + "-readiness");
  const firstLoginMs = Date.now() - firstStarted;
  const firstAssetDownloads = await assetDownloads(true);
  const first = await cachedAssets(page);
  const metadata = await page.evaluate(async ({ cacheName, metadata }) => {
    return (await (await caches.open(cacheName)).match(metadata))!.json();
  }, first);
  expect(metadata.buildId).toBe(
    await page.getByTestId("offline-workspace-ready").getAttribute("data-build-id"),
  );
  const cachedScript = await page.evaluate(async (assetUrl) => {
    const cache = await caches.open(
      (await caches.keys()).find((name) => name.startsWith("shuttle-precache-"))!,
    );
    return Boolean(await cache.match(assetUrl));
  }, first.script);
  expect(cachedScript).toBe(true);

  const repeatStarted = Date.now();
  await page.reload();
  await expect(page.getByTestId("offline-workspace-ready")).toBeAttached();
  const repeatOpeningMs = Date.now() - repeatStarted;
  const repeatAssetDownloads = await assetDownloads();
  await expect(page.getByRole("button", { name: "Settings", exact: true }).first()).toBeVisible();
  expect(await cachedAssets(page)).toMatchObject({ cacheName: first.cacheName });
  expect(repeatAssetDownloads).toBe(0);
  info.annotations.push({
    type: "offline-preparation-metrics",
    description: JSON.stringify({
      firstLoginMs,
      repeatOpeningMs,
      cachedAssets: first.assetCount,
      firstAssetDownloads,
      repeatAssetDownloads,
    }),
  });
});

test("missing scripts and invalid cached responses are repaired before entry", async ({
  page,
}, info) => {
  await login(page, "browser-" + info.project.name + "-cache-repair");
  const assets = await cachedAssets(page);
  await page.evaluate(async ({ cacheName, script, stylesheet }) => {
    const cache = await caches.open(cacheName);
    await cache.put(
      script,
      new Response("<html>wrong content</html>", { headers: { "content-type": "text/html" } }),
    );
    await cache.delete(stylesheet);
  }, assets);

  await page.reload();
  await expect(page.getByTestId("offline-workspace-ready")).toBeAttached();
  const repaired = await page.evaluate(async ({ cacheName, script, stylesheet }) => {
    const cache = await caches.open(cacheName);
    const js = await cache.match(script);
    const css = await cache.match(stylesheet);
    return {
      scriptType: js?.headers.get("content-type"),
      cssType: css?.headers.get("content-type"),
    };
  }, assets);
  expect(repaired.scriptType).toContain("javascript");
  expect(repaired.cssType).toContain("text/css");
});

for (const mode of ["html", "404", "drop"] as const) {
  test(`a ${mode} response for a missing app file is rejected and retry succeeds`, async ({
    page,
  }, info) => {
    await login(page, "browser-" + info.project.name + "-asset-html-response");
    const assets = await cachedAssets(page);
    await page.evaluate(async ({ cacheName, metadata }) => {
      await (await caches.open(cacheName)).delete(metadata);
    }, assets);
    await fault(`asset-arm?mode=${mode}&persistent=1&path=%2Foffline-build.json`);
    await page.reload();
    await expect(page.locator("p[role='alert']")).toContainText(
      mode === "drop"
        ? /Some app files could not be downloaded|offline app worker did not respond/
        : "Some app files could not be downloaded",
    );
    await expect(page.getByTestId("offline-workspace-ready")).toHaveCount(0);
    await expect
      .poll(async () => {
        const response = await fetch("http://127.0.0.1:4002/asset-observed");
        return response.ok;
      })
      .toBe(true);
    await fault("asset-release");
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByTestId("offline-workspace-ready")).toBeAttached();
  });
}

test("an unsupported browser gets an actionable diagnostic before workspace entry", async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: undefined });
  });
  await page.goto("/");
  await page.getByLabel("Username").fill(`browser-${info.project.name}-readiness`);
  await page.getByLabel("Password", { exact: true }).fill(process.env.SYNC_TEST_PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("p[role='alert']")).toContainText(
    "does not support offline app installation",
  );
  await expect(page.getByTestId("offline-workspace-ready")).toHaveCount(0);
  await page.screenshot({ path: `/artifacts/${info.project.name}-unsupported-preparation.png` });
});

test("a missing app file blocks offline entry and retry repairs it after reconnect", async ({
  page,
}, info) => {
  await login(page, "browser-" + info.project.name + "-missing-offline-file");
  const assets = await cachedAssets(page);
  await page.evaluate(async ({ cacheName, script }) => {
    await (await caches.open(cacheName)).delete(script);
  }, assets);
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false }),
  );
  await fault("origin-offline");
  await page.reload();
  await expect(page.locator("p[role='alert']")).toContainText("Some app files are missing");
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toHaveCount(0);

  await fault("origin-online");
  await page.evaluate(() =>
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true }),
  );
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByTestId("offline-workspace-ready")).toBeAttached();
  const repaired = await page.evaluate(
    async ({ cacheName, script }) =>
      (await (await caches.open(cacheName)).match(script))?.headers.get("content-type") ?? null,
    assets,
  );
  expect(repaired).toContain("javascript");
});

test("storage persistence denial warns without blocking a verified workspace", async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: {
        persisted: async () => false,
        persist: async () => false,
      },
    });
  });
  await login(page, `browser-${info.project.name}-readiness`);
  expect(await page.evaluate(() => navigator.storage.persisted())).toBe(false);
  await expect(page.getByTestId("offline-workspace-ready")).toBeAttached();
  await expect(
    page.getByText("Offline data is saved, but this browser may clear stored files later.", {
      exact: true,
    }),
  ).toBeVisible();
});

test("missing account data offline blocks entry while preserving the retained profile", async ({
  page,
}, info) => {
  await login(page, "browser-" + info.project.name + "-missing-account-data");
  const accountId = (await local(page)).accountId;
  await page.evaluate(async (id) => {
    await window.syncTest.database.offlineDb.snapshots.delete(id);
  }, accountId);
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false }),
  );
  await fault("origin-offline");
  await page.reload();
  await expect(page.locator("p[role='alert']")).toContainText("no saved offline queue");
  await expect(page.getByRole("heading", { name: "Badminton Queueing System" })).toHaveCount(0);

  await fault("origin-online");
  await page.evaluate(() =>
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true }),
  );
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByTestId("offline-workspace-ready")).toBeAttached();
  await bridge(page);
  await expect(
    page.evaluate((id) => window.syncTest.database.hasSnapshot(id), accountId),
  ).resolves.toBe(true);
});

test("an account change in another tab invalidates readiness and preserves old account data", async ({
  page,
  context,
}, info) => {
  await login(page, "browser-" + info.project.name + "-account-a");
  const accountA = await local(page);
  await addPlayer(page, "Preserved for account A");
  const otherTab = await context.newPage();
  await otherTab.goto("/");
  await expect(otherTab.getByTestId("offline-workspace-ready")).toBeAttached();
  await bridge(otherTab);
  await otherTab.evaluate(() =>
    window.syncTest.database.saveProfile({
      accountId: "test-account-b",
      username: "account-b",
      role: "QUEUE_MASTER",
      updatedAt: new Date().toISOString(),
    }),
  );
  await expect(page.locator("p[role='alert']")).toContainText("account changed in another tab");
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toHaveCount(0);
  await expect(
    page.evaluate((id) => window.syncTest.database.readSnapshot(id), accountA.accountId),
  ).resolves.toBeTruthy();
});

test("an IndexedDB write failure keeps the workspace closed and can be retried", async ({
  page,
}, info) => {
  await login(page, "browser-" + info.project.name + "-idb-write-failure");
  await page.addInitScript(() => {
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
      if (
        sessionStorage.getItem("shuttle-test-fail-readiness-write") === "1" &&
        value &&
        typeof value === "object" &&
        "readinessProbe" in value
      )
        throw new DOMException("Simulated quota limit", "QuotaExceededError");
      return originalPut.call(this, value, key);
    };
  });
  await page.evaluate(() => sessionStorage.setItem("shuttle-test-fail-readiness-write", "1"));
  await page.reload();
  await expect(page.locator("p[role='alert']")).toContainText("Simulated quota limit");
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toHaveCount(0);
  await page.evaluate(() => sessionStorage.removeItem("shuttle-test-fail-readiness-write"));
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByTestId("offline-workspace-ready")).toBeAttached();
});

test("an interrupted build install preserves A and applies B at the next safe opening", async ({
  page,
  context,
}, info) => {
  await login(page, "browser-" + info.project.name + "-version-update");
  const buildA = await page.getByTestId("offline-workspace-ready").getAttribute("data-build-id");
  const cachedA = await cachedAssets(page);
  await addPlayer(page, "Kept in the old active session");
  await fault("ui-build?build=b");
  const buildBAsset = await page.evaluate(async () => {
    const response = await fetch("/serwist/sw.js", { cache: "no-store" });
    const script = await response.text();
    const asset = script.match(/url:"([^"]*\/app\/page-[^"]+\.js)"/)?.[1];
    if (!response.ok || !asset) throw new Error("Could not inspect the new offline app manifest.");
    return asset;
  });
  await fault("asset-arm?mode=hold&path=" + encodeURIComponent(buildBAsset));
  const updatedTab = await context.newPage();
  await updatedTab.goto("/");
  await expect(updatedTab.getByTestId("offline-workspace-ready")).toBeAttached();
  await expect(updatedTab.getByTestId("offline-workspace-ready")).toHaveAttribute(
    "data-build-id",
    buildA!,
  );
  await expect(page.getByRole("button", { name: "Settings", exact: true }).first()).toBeVisible();
  await fault("asset-observed");
  await expect
    .poll(() =>
      updatedTab.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration("/");
        return registration?.installing?.state ?? "";
      }),
    )
    .toBe("installing");
  await expect
    .poll(() => page.evaluate((cacheName) => caches.has(cacheName), cachedA.cacheName))
    .toBe(true);
  await fault("asset-release");
  await expect
    .poll(() =>
      updatedTab.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration("/");
        return Boolean(registration?.waiting);
      }),
    )
    .toBe(true);
  await page.close();
  await updatedTab.reload();
  await expect
    .poll(async () => {
      const ready = updatedTab.getByTestId("offline-workspace-ready");
      const buildId = await ready.getAttribute("data-build-id").catch(() => null);
      return buildId && buildId !== buildA ? buildId : "pending";
    })
    .not.toBe("pending");
  await expect(updatedTab.getByTestId("offline-workspace-ready")).toBeAttached();
  await expect(
    updatedTab.getByRole("button", { name: "Settings", exact: true }).first(),
  ).toBeVisible();
  await bridge(updatedTab);
  expect(
    (await local(updatedTab)).snapshot!.players.some(
      (player) => player.displayName === "Kept in the old active session",
    ),
  ).toBe(true);
  await expect
    .poll(() => updatedTab.evaluate((cacheName) => caches.has(cacheName), cachedA.cacheName))
    .toBe(false);
});
