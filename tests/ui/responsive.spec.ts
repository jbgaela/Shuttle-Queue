import { expect, test, type Route } from "@playwright/test";

test.use({ serviceWorkers: "block" });

const TABLET_VIEWPORTS = [
  { name: "portrait", width: 744, height: 1133 },
  { name: "landscape", width: 1133, height: 744 },
] as const;

function liveSnapshot() {
  const startedAt = new Date(Date.now() - 7 * 60_000).toISOString();
  const players = Array.from({ length: 16 }, (_, index) => ({
    id: `player-${index + 1}`,
    displayName: index === 0 ? "Alexandria Tablet-Ready Player" : `Player ${index + 1}`,
    gender: index % 2 === 0 ? "FEMALE" : "MALE",
    skillLevel: "INTERMEDIATE",
    skillWeight: 4,
    status: "ACTIVE",
  }));
  const queuePlayers = players.map((player, index) => ({
    id: `queue-${index + 1}`,
    playerId: player.id,
    displayName: player.displayName,
    gender: player.gender,
    skillLevel: player.skillLevel,
    skillWeight: player.skillWeight,
    status: "PLAYING",
    matchesPlayed: 4,
    wins: 3,
    losses: 1,
    pointsFor: 84,
    pointsAgainst: 72,
    amountDueMinor: 0,
    manualPriority: 0,
    priorityReason: null,
    latePenaltyState: null,
    latePenaltyAppliedAt: null,
    currentMatchId: `match-${Math.floor(index / 4) + 1}`,
    checkedInAt: startedAt,
    checkedOutAt: null,
    restStartedAt: null,
    version: 1,
  }));
  const courts = Array.from({ length: 4 }, (_, index) => ({
    id: `court-${index + 1}`,
    name: index === 0 ? "Court 1 — Long Court Name for Wrapping" : `Court ${index + 1}`,
    normalizedName: `court-${index + 1}`,
    displayOrder: index,
    status: "OCCUPIED",
    currentMatchId: `match-${index + 1}`,
    closedAt: null,
    version: 1,
  }));
  const matches = courts.map((court, courtIndex) => ({
    id: court.currentMatchId,
    courtId: court.id,
    courtIdSnapshot: court.id,
    courtNameSnapshot: court.name,
    status: "IN_PROGRESS",
    source: "MANUAL",
    matchmakingMode: courtIndex === 0 ? "UNDEFEATED_CHALLENGE" : "OPEN",
    algorithmVersion: null,
    suggestionKey: null,
    suggestionExplanation: null,
    pointsToWin: 21,
    winBy: 2,
    scoreCap: null,
    bestOf: 1,
    queuedAt: startedAt,
    startedAt,
    completedAt: null,
    cancelledAt: null,
    cancellationReason: null,
    winnerTeam: null,
    currentRevisionId: null,
    version: 1,
    participants: Array.from({ length: 4 }, (_, slot) => ({
      id: `${court.currentMatchId}-participant-${slot + 1}`,
      matchId: court.currentMatchId,
      queuePlayerId: queuePlayers[courtIndex * 4 + slot]!.id,
      team: slot < 2 ? "A" : "B",
      teamSlot: slot % 2 + 1,
    })),
    scoreRevisions: [],
  }));
  return {
    schemaVersion: 2,
    queueMasterId: "account-1",
    settings: {
      id: "settings-1",
      pointsToWin: 21,
      winBy: 2,
      scoreCap: null,
      bestOf: 1,
      minimumRestMinutes: 0,
      lateArrivalGraceMinutes: 15,
      defaultFeeMode: "NONE",
      defaultFixedFeeMinor: null,
      currencyCode: "PHP",
      timeZone: "Asia/Manila",
      defaultLateArrivalCutoffTime: null,
      version: 1,
    },
    workspace: {
      startedAt,
      endedAt: null,
      lateArrivalCutoffAt: null,
      matchmakingAlgorithm: "v3",
      matchmakingRevision: 1,
      version: 1,
    },
    players,
    queuePlayers,
    courts,
    matches,
    feeConfig: null,
    payments: [],
    audits: [],
  };
}

async function mockLiveApi(route: Route) {
  const corsHeaders = {
    "access-control-allow-origin": "http://127.0.0.1:3100",
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": "content-type, x-csrf-token",
    "access-control-allow-methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
  };
  if (route.request().method() === "OPTIONS") {
    await route.fulfill({ status: 204, headers: corsHeaders });
    return;
  }
  const path = new URL(route.request().url()).pathname.replace("/api/v2", "");
  if (path === "/auth/me") {
    await route.fulfill({ json: { data: { user: { id: "account-1", username: "tablet-test", role: "QUEUE_MASTER" }, csrfToken: "test-token" } }, headers: corsHeaders });
    return;
  }
  if (path === "/sync/snapshot") {
    await route.fulfill({ json: { data: { snapshot: liveSnapshot(), cloudRevision: 1 } }, headers: corsHeaders });
    return;
  }
  if (path === "/workspace/public-rankings") {
    await route.fulfill({ json: { data: { current: null, archives: [] } }, headers: corsHeaders });
    return;
  }
  await route.fulfill({ status: 404, json: { error: { message: "Unexpected test request" } }, headers: corsHeaders });
}

async function expectTabletGrid(page: import("@playwright/test").Page, viewport: { width: number; height: number }) {
  const cards = page.getByTestId("live-court-card");
  await expect(cards).toHaveCount(4);
  const geometry = await cards.evaluateAll((nodes) => nodes.map((node) => {
    const rect = node.getBoundingClientRect();
    return { x: rect.x, y: rect.y, bottom: rect.bottom, width: rect.width, height: rect.height };
  }));
  const columns = new Set(geometry.map((rect) => Math.round(rect.x)));
  expect(columns.size).toBe(2);
  expect(Math.abs(geometry[0]!.y - geometry[1]!.y)).toBeLessThan(2);
  expect(Math.abs(geometry[2]!.y - geometry[3]!.y)).toBeLessThan(2);
  expect(geometry[2]!.y).toBeGreaterThan(geometry[0]!.y);
  expect(geometry[3]!.bottom).toBeLessThanOrEqual(viewport.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(await page.getByRole("button", { name: "Enter final score" }).count()).toBe(4);
  expect(await page.getByRole("button", { name: "Edit match" }).count()).toBe(4);
  expect(await page.getByRole("button", { name: "Cancel match" }).count()).toBe(4);
  expect(await page.locator(".live-action-label-full:visible").count()).toBe(0);
  expect(await page.locator(".live-action-label-compact:visible").count()).toBe(12);
  const actionHeights = await page.locator("[data-testid='live-court-card'] .live-court-actions > button").evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().height));
  expect(Math.min(...actionHeights)).toBeGreaterThanOrEqual(44);
  const statusPills = await page.locator("[data-testid='live-court-card'] .live-court-status-group > span").evaluateAll((pills) => pills.map((pill) => {
    const rect = pill.getBoundingClientRect();
    const card = pill.closest("[data-testid='live-court-card']")?.getBoundingClientRect();
    return { width: rect.width, height: rect.height, contained: Boolean(card && rect.left >= card.left && rect.right <= card.right) };
  }));
  expect(statusPills).toHaveLength(4);
  expect(statusPills.every((pill) => pill.width > 0 && pill.height > 0 && pill.contained)).toBe(true);
  const iconSizes = await page.locator("[data-testid='live-court-card'] svg").evaluateAll((icons) => icons.map((icon) => {
    const rect = icon.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }));
  expect(iconSizes.every((icon) => icon.width > 0 && icon.height > 0 && Math.abs(icon.width - icon.height) < 2)).toBe(true);
}

test.describe("tablet Live court layout", () => {
  test.use({ hasTouch: true });

  for (const viewport of TABLET_VIEWPORTS) {
    test(`${viewport.name} shows four courts above the fold`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.route("**/api/v2/**", mockLiveApi);
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "Courts at a glance." })).toBeVisible();
      await expectTabletGrid(page, viewport);
      await expect(page.getByTitle("Court 1 — Long Court Name for Wrapping")).toBeVisible();

      const cards = page.getByTestId("live-court-card");
      const courtOne = cards.filter({ hasText: "Court 1 — Long Court Name for Wrapping" });
      await expect(courtOne).toHaveCount(1);
      await courtOne.getByRole("button", { name: "Enter final score" }).click();
      const scoreDialog = page.getByRole("dialog", { name: "Record the score" });
      await expect(scoreDialog).toBeVisible();
      await scoreDialog.getByRole("button", { name: "Close score dialog" }).click();

      await courtOne.getByRole("button", { name: "Edit match" }).click();
      const editDialog = page.getByRole("dialog", { name: "Edit live match" });
      await expect(editDialog).toBeVisible();
      await editDialog.getByRole("button", { name: "Close edit live match dialog" }).click();

      await courtOne.getByRole("button", { name: "Cancel match" }).click();
      const cancelDialog = page.getByRole("dialog", { name: "Discard this matchup?" });
      await expect(cancelDialog).toBeVisible();
      await cancelDialog.getByRole("button", { name: "Cancel", exact: true }).click();

      await courtOne.getByRole("button", { name: "More actions for Court 1 — Long Court Name for Wrapping" }).click();
      await expect(page.getByRole("menu", { name: "Actions for Court 1 — Long Court Name for Wrapping" })).toBeVisible();
      await page.keyboard.press("Escape");
    });
  }
});

test.describe("responsive regressions", () => {
  test("mobile keeps one column and full action labels", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route("**/api/v2/**", mockLiveApi);
    await page.goto("/");
    const cards = page.getByTestId("live-court-card");
    await expect(cards).toHaveCount(4);
    const xPositions = await cards.evaluateAll((nodes) => [...new Set(nodes.map((node) => Math.round(node.getBoundingClientRect().x)))]);
    expect(xPositions).toHaveLength(1);
    await expect(page.getByText("Enter final score", { exact: true }).first()).toBeVisible();
    await expect(page.locator(".live-action-label-compact").first()).toBeHidden();
    await expect(page.locator(".live-court-challenge-compact").first()).toBeHidden();
    expect(await page.locator(".live-action-label-full:visible").count()).toBe(12);
  });

  test("desktop keeps the existing two-column card sizing and labels", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.route("**/api/v2/**", mockLiveApi);
    await page.goto("/");
    const cards = page.getByTestId("live-court-card");
    await expect(cards).toHaveCount(4);
    const widths = await cards.evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().width)));
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(560);
    await expect(page.getByText("Enter final score", { exact: true }).first()).toBeVisible();
    expect(await page.locator(".live-action-label-full:visible").count()).toBe(12);
    expect(await page.locator(".live-action-label-compact:visible").count()).toBe(0);
  });
});
