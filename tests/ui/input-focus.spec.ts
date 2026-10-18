import { expect, test, type Locator, type Page } from "@playwright/test";
import { guidedSnapshot, mockGuidedApi } from "./guided-fixtures";

test.use({ serviceWorkers: "block" });

async function mockFocusWorkspace(page: Page, inProgress = false) {
  const snapshot = guidedSnapshot();
  const startedAt = snapshot.workspace.startedAt;
  const matches = inProgress ? [{
    id: "focus-match", courtId: "guided-court-1", status: "IN_PROGRESS", source: "MANUAL",
    matchmakingMode: null, suggestionKey: null, suggestionExplanation: null, algorithmVersion: null,
    pointsToWin: 21, winBy: 2, scoreCap: null, bestOf: 1,
    queuedAt: startedAt, startedAt, completedAt: null, cancelledAt: null, winnerTeam: null, version: 1,
    participants: snapshot.queuePlayers.map((player, index) => ({
      id: `focus-participant-${index}`, matchId: "focus-match", queuePlayerId: player.id,
      team: index < 2 ? "A" : "B", teamSlot: index % 2 + 1,
    })),
    scoreRevisions: [],
  }] : [];
  if (inProgress) {
    snapshot.courts[0]!.status = "OCCUPIED";
    Object.assign(snapshot.courts[0]!, { currentMatchId: "focus-match" });
    for (const player of snapshot.queuePlayers) Object.assign(player, { status: "PLAYING", currentMatchId: "focus-match" });
  }
  let revision = 1;
  await page.route("**/api/v2/**", async (route) => {
    if (new URL(route.request().url()).pathname === "/api/v2/sync/snapshot") {
      await route.fulfill({ json: { data: { snapshot: { ...snapshot, matches }, cloudRevision: revision } } });
      return;
    }
    await mockGuidedApi(route);
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Players", exact: true })).toBeVisible();
  return async () => {
    snapshot.players[3]!.displayName = "Guided Player Refreshed";
    snapshot.queuePlayers[3]!.displayName = "Guided Player Refreshed";
    revision += 1;
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
  };
}

async function typeWithoutRefocusing(page: Page, field: Locator, text: string) {
  const original = await field.elementHandle();
  for (const character of text) {
    await page.keyboard.type(character);
    await expect(field).toBeFocused();
    expect(await field.evaluate((element, previous) => element === previous, original)).toBe(true);
  }
}

async function checkDialogKeys(page: Page, dialog: Locator) {
  const controls = dialog.locator("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]").filter({ visible: true });
  await controls.last().focus();
  await page.keyboard.press("Tab");
  await expect(controls.first()).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(controls.last()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
}

for (const viewport of [
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
]) {
  test.describe(viewport.name, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height }, hasTouch: viewport.name !== "desktop" });

    test("directory search keeps its element, focus, and value through filtering and refresh", async ({ page }) => {
      const refresh = await mockFocusWorkspace(page);
      await page.getByRole("button", { name: "Players", exact: true }).click();
      const search = page.getByRole("searchbox", { name: "Search player directory" });
      const editButtons = page.getByRole("button", { name: /^Edit Guided Player/ });
      await expect(editButtons).toHaveCount(4);
      await search.click();
      const original = await search.elementHandle();
      await typeWithoutRefocusing(page, search, "Guided Player 1");
      await expect(search).toHaveValue("Guided Player 1");
      await expect(editButtons).toHaveCount(1);
      await page.keyboard.press("Backspace");
      await expect(editButtons).toHaveCount(4);
      await refresh();
      await expect(page.getByRole("button", { name: "Edit Guided Player Refreshed", exact: true })).toBeVisible();
      await expect(search).toBeFocused();
      await expect(search).toHaveValue("Guided Player ");
      expect(await search.evaluate((element, previous) => element === previous, original)).toBe(true);
      await typeWithoutRefocusing(page, search, "1");
      await expect(editButtons).toHaveCount(1);
      await page.keyboard.press("ControlOrMeta+A");
      await page.keyboard.press("Backspace");
      await expect(search).toHaveValue("");
      await expect(search).toBeFocused();
      await expect(editButtons).toHaveCount(4);
      await typeWithoutRefocusing(page, search, "Nobody");
      await expect(editButtons).toHaveCount(0);
    });

    test("player editing keeps focus through typing and parent query refresh", async ({ page }) => {
      const refresh = await mockFocusWorkspace(page);
      await page.getByRole("button", { name: "Players", exact: true }).click();
      await page.getByRole("button", { name: "Edit Guided Player 1", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Edit player", exact: true });
      const name = dialog.getByLabel("Display name", { exact: true });
      await expect(name).toBeFocused();
      await page.keyboard.press("End");
      await typeWithoutRefocusing(page, name, " Updated");
      await refresh();
      await expect(page.getByRole("button", { name: "Edit Guided Player Refreshed", exact: true })).toBeVisible();
      await expect(name).toBeFocused();
      await expect(name).toHaveValue("Guided Player 1 Updated");
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
    });

    test("manual player search keeps autofocus and survives matchmaker updates", async ({ page }) => {
      await mockFocusWorkspace(page);
      await page.getByRole("button", { name: "Queue", exact: true }).click();
      await page.getByRole("button", { name: "Manual", exact: true }).click();
      await page.getByRole("button", { name: "Add player", exact: true }).first().click();
      const dialog = page.getByRole("dialog", { name: "Choose Team A player" });
      const search = dialog.getByLabel("Search queued players");
      await expect(search).toBeFocused();
      await typeWithoutRefocusing(page, search, "Guided Player 1");
      await expect(search).toHaveValue("Guided Player 1");
      // The matchmaker rerenders every second to update its clock and callbacks.
      await page.waitForTimeout(1_200);
      await expect(search).toBeFocused();
      await checkDialogKeys(page, dialog);
    });

    test("suggested player search keeps autofocus and keyboard navigation", async ({ page }) => {
      await mockFocusWorkspace(page);
      await page.getByRole("button", { name: "Queue", exact: true }).click();
      await page.getByRole("button", { name: "Generate Guided lineup" }).click();
      const suggestion = page.getByRole("region", { name: "Suggested Guided matchup" });
      await suggestion.getByRole("button", { name: "Edit lineup", exact: true }).click();
      await suggestion.getByRole("button").filter({ hasText: "Guided Player" }).first().click();
      const dialog = page.getByRole("dialog", { name: "Team A player 1" });
      const search = dialog.getByLabel("Replace with another waiting player");
      await expect(search).toBeFocused();
      await typeWithoutRefocusing(page, search, "Guided Player");
      await expect(search).toHaveValue("Guided Player");
      await page.waitForTimeout(1_200);
      await expect(search).toBeFocused();
      await checkDialogKeys(page, dialog);
    });

    test("score entry keeps focus through typing and parent query refresh", async ({ page }) => {
      const refresh = await mockFocusWorkspace(page, true);
      await page.getByRole("button", { name: "Enter final score", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Record the score" });
      const score = dialog.getByRole("textbox").first();
      await score.click();
      await typeWithoutRefocusing(page, score, "21");
      await expect(score).toHaveValue("21");
      await refresh();
      await expect(page.locator(".live-team-player-name").filter({ hasText: "Guided Player Refreshed" })).toBeVisible();
      await expect(score).toBeFocused();
      await expect(score).toHaveValue("21");
      await checkDialogKeys(page, dialog);
    });
  });
}
