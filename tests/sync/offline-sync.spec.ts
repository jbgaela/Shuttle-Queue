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
async function login(page: Page, username: string) {
  await page.goto("/");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(process.env.SYNC_TEST_PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Settings", exact: true }).first()).toBeVisible();
  await bridge(page);
  await expect.poll(() => page.evaluate(() => window.syncTest.database.hasSnapshot())).toBe(true);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), {
          once: true,
        }),
      );
  });
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
    for (const [target, name] of [
      [page, "Local name"],
      [device, "Cloud name"],
    ] as const) {
      await target.evaluate(async (displayName) => {
        const rows = await window.syncTest.api.players();
        await window.syncTest.api.updatePlayer(rows[0], {
          displayName,
          gender: "MALE",
          skillLevel: "BEGINNER",
        });
      }, name);
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
