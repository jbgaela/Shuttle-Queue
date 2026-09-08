import { expect, test, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { guidedSnapshot } from "./guided-fixtures";

test.use({ serviceWorkers: "block" });

type HistorySnapshot = ReturnType<typeof guidedSnapshot> & { matches: Array<Record<string, unknown>> };

function historySnapshot(): HistorySnapshot {
  const snapshot = guidedSnapshot() as unknown as HistorySnapshot;
  const startedAt = "2026-09-05T12:00:00.000Z";
  snapshot.players[0]!.displayName = "Alexandria Tablet-Ready Player With A Long Name";
  snapshot.queuePlayers[0]!.displayName = snapshot.players[0]!.displayName;
  snapshot.courts[0]!.name = "Court 1 — Long Court Name for Wrapping";
  const participants = [
    { id: "history-match-1-participant-1", matchId: "history-match-1", queuePlayerId: "guided-queue-1", team: "A", teamSlot: 1 },
    { id: "history-match-1-participant-2", matchId: "history-match-1", queuePlayerId: "guided-queue-2", team: "A", teamSlot: 2 },
    { id: "history-match-1-participant-3", matchId: "history-match-1", queuePlayerId: "guided-queue-3", team: "B", teamSlot: 1 },
    { id: "history-match-1-participant-4", matchId: "history-match-1", queuePlayerId: "guided-queue-4", team: "B", teamSlot: 2 },
  ];
  snapshot.matches = [
    {
      id: "history-match-1",
      courtId: "guided-court-1",
      courtIdSnapshot: "guided-court-1",
      courtNameSnapshot: snapshot.courts[0]!.name,
      status: "COMPLETED",
      source: "MANUAL",
      matchmakingMode: null,
      algorithmVersion: null,
      suggestionKey: null,
      suggestionExplanation: null,
      pointsToWin: 21,
      winBy: 2,
      scoreCap: null,
      bestOf: 3,
      queuedAt: startedAt,
      startedAt,
      completedAt: "2026-09-05T12:30:00.000Z",
      cancelledAt: null,
      cancellationReason: null,
      winnerTeam: "A",
      currentRevisionId: "history-revision-1",
      version: 1,
      participants,
      scoreRevisions: [{ id: "history-revision-1", revisionNumber: 1, winnerTeam: "A", games: [{ id: "history-game-1", scoreRevisionId: "history-revision-1", gameNumber: 1, teamAScore: 21, teamBScore: 18, winnerTeam: "A" }, { id: "history-game-2", scoreRevisionId: "history-revision-1", gameNumber: 2, teamAScore: 21, teamBScore: 19, winnerTeam: "A" }] }],
    },
    {
      id: "history-match-2",
      courtId: null,
      courtIdSnapshot: null,
      courtNameSnapshot: null,
      status: "COMPLETED",
      source: "MANUAL_ADJUSTED",
      matchmakingMode: null,
      algorithmVersion: null,
      suggestionKey: null,
      suggestionExplanation: { generatedOrigin: "SUGGESTION", originalMode: "OPEN" },
      pointsToWin: 21,
      winBy: 2,
      scoreCap: null,
      bestOf: 1,
      queuedAt: "2026-09-05T11:00:00.000Z",
      startedAt: "2026-09-05T11:00:00.000Z",
      completedAt: "2026-09-05T11:15:00.000Z",
      cancelledAt: null,
      cancellationReason: null,
      winnerTeam: "B",
      currentRevisionId: "history-revision-2",
      version: 1,
      participants: participants.map((participant, index) => ({ ...participant, id: `history-match-2-participant-${index + 1}`, matchId: "history-match-2", team: participant.team === "A" ? "B" : "A" })),
      scoreRevisions: [{ id: "history-revision-2", revisionNumber: 1, winnerTeam: "B", games: [{ id: "history-game-2-1", scoreRevisionId: "history-revision-2", gameNumber: 1, teamAScore: 18, teamBScore: 21, winnerTeam: "B" }] }],
    },
  ];
  return snapshot;
}

async function mockHistoryApi(route: Route) {
  const headers = {
    "access-control-allow-origin": "http://127.0.0.1:3100",
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": "content-type, x-csrf-token",
    "access-control-allow-methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
  };
  if (route.request().method() === "OPTIONS") {
    await route.fulfill({ status: 204, headers });
    return;
  }
  const path = new URL(route.request().url()).pathname.replace("/api/v2", "");
  if (path === "/auth/me") {
    await route.fulfill({ json: { data: { user: { id: "account-1", username: "history-ui-test", role: "QUEUE_MASTER" }, csrfToken: "test-token" } }, headers });
    return;
  }
  if (path === "/sync/snapshot") {
    await route.fulfill({ json: { data: { snapshot: historySnapshot(), cloudRevision: 1 } }, headers });
    return;
  }
  if (path === "/workspace/public-rankings") {
    await route.fulfill({ json: { data: { current: null, archives: [] } }, headers });
    return;
  }
  await route.fulfill({ status: 404, json: { error: { message: "Unexpected History test request" } }, headers });
}

test.describe("History correction layout", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/v2/**", mockHistoryApi);
    await page.goto("/");
    await page.getByRole("button", { name: "History" }).click();
    await expect(page.getByRole("heading", { name: "The queue log." })).toBeVisible();
  });

  test("keeps correction actions inside the expanded match", async ({ page }) => {
    const firstMatch = page.getByTestId("history-match-history-match-1");
    const secondMatch = page.getByTestId("history-match-history-match-2");
    await expect(firstMatch).toContainText("Manual");
    await expect(secondMatch).toContainText("Adjusted suggestion");
    await expect(page.getByRole("button", { name: "Edit score" })).toHaveCount(0);

    await firstMatch.getByTestId("history-match-toggle").click();
    await expect(firstMatch.getByRole("button", { name: "Edit score" })).toBeVisible();
    await expect(firstMatch.getByRole("button", { name: "Edit players" })).toBeVisible();
    await expect(secondMatch.getByRole("button", { name: "Edit score" })).toHaveCount(0);

    await firstMatch.getByRole("button", { name: "Edit score" }).click();
    const scoreDialog = page.getByRole("dialog", { name: "Correct the score" });
    await expect(scoreDialog).toBeVisible();
    await expect(scoreDialog.locator("footer")).toBeVisible();
    await scoreDialog.getByRole("button", { name: "Save score correction" }).click();
    await expect(scoreDialog.getByRole("alert")).toContainText("Enter a different score before saving.");
    await scoreDialog.locator('input[aria-label*="game 1 score"]').nth(1).fill("19");
    await scoreDialog.getByRole("button", { name: "Save score correction" }).click();
    await expect(scoreDialog).toBeHidden();
    await expect(firstMatch.getByRole("button", { name: "Edit score" })).toBeFocused();

    await firstMatch.getByRole("button", { name: "Edit players" }).click();
    const playerDialog = page.getByRole("dialog", { name: "Correct the players" });
    await expect(playerDialog).toBeVisible();
    await expect(playerDialog.getByRole("combobox")).toHaveCount(4);
    await playerDialog.getByRole("button", { name: "Save player correction" }).click();
    await expect(playerDialog.getByRole("alert")).toContainText("Choose a different lineup before saving.");
    await playerDialog.getByRole("button", { name: "Cancel" }).click();
    await expect(playerDialog).toBeHidden();

    await firstMatch.getByTestId("history-match-toggle").click();
    await secondMatch.getByTestId("history-match-toggle").click();
    await expect(secondMatch.getByRole("button", { name: "Edit players" })).toBeVisible();
    await expect(firstMatch.getByRole("button", { name: "Edit players" })).toHaveCount(0);
  });

  test("keeps the correction dialog accessible on a phone viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const firstMatch = page.getByTestId("history-match-history-match-1");
    await firstMatch.getByTestId("history-match-toggle").click();
    await firstMatch.getByRole("button", { name: "Edit score" }).click();
    const dialog = page.getByRole("dialog", { name: "Correct the score" });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("footer")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Save score correction" })).toHaveCSS("min-height", "44px");
    await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);

    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations.filter((violation) => violation.impact === "critical")).toEqual([]);
  });
});
