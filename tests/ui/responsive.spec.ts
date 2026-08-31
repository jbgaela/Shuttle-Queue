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

function queueLayoutSnapshot() {
  const snapshot = liveSnapshot() as any;
  snapshot.matches = [];
  snapshot.courts = [];
  snapshot.queuePlayers = snapshot.queuePlayers.map((player: any, index: number) => ({
    ...player,
    status: index < 4 ? "INACTIVE" : "WAITING",
    currentMatchId: null,
    checkedInAt: index < 4 ? null : player.checkedInAt,
    checkedOutAt: null,
    queueEnteredAt: index < 4 ? null : snapshot.workspace.startedAt,
  }));
  return snapshot;
}

function feesSnapshot() {
  const snapshot = liveSnapshot() as any;
  const endedAt = new Date(Date.now() - 60_000).toISOString();
  snapshot.workspace.endedAt = endedAt;
  snapshot.settings.noShowPenaltyMinor = 150;
  snapshot.queuePlayers[0].matchesPlayed = 0;
  snapshot.queuePlayers[0].status = "INACTIVE";
  snapshot.queuePlayers[0].amountDueMinor = 150;
  snapshot.queuePlayers[1].amountDueMinor = 500;
  snapshot.feeConfig = {
    id: "fee-1",
    mode: "FIXED_PER_PLAYER",
    currencyCode: "PHP",
    fixedAmountPerPlayerMinor: 500,
    expectedQueueCostMinor: 0,
    noShowPenaltyMinor: 150,
    participationRule: "ALL_ACTIVE",
    frozenAt: endedAt,
    version: 1,
  };
  snapshot.payments = [
    { id: "payment-1", queuePlayerId: "queue-1", kind: "COLLECTION", method: "CASH", amountMinor: 100, reference: null, note: null, reversalOfPaymentId: null, recordedById: "account-1", occurredAt: endedAt, createdAt: endedAt },
    { id: "payment-2", queuePlayerId: "queue-2", kind: "COLLECTION", method: "EWALLET", amountMinor: 500, reference: null, note: null, reversalOfPaymentId: null, recordedById: "account-1", occurredAt: endedAt, createdAt: endedAt },
  ];
  return snapshot;
}

function rankingSnapshot() {
  const snapshot = liveSnapshot() as any;
  snapshot.queuePlayers.forEach((player: any) => { player.matchesPlayed = 5; player.wins = 4; player.losses = 1; });
  const completedMatch = snapshot.matches[0];
  completedMatch.status = "COMPLETED";
  completedMatch.completedAt = new Date(new Date(completedMatch.startedAt).getTime() + 5 * 60_000).toISOString();
  completedMatch.winnerTeam = "A";
  completedMatch.currentRevisionId = "revision-ranking-test";
  completedMatch.scoreRevisions = [{ id: "revision-ranking-test", revisionNumber: 1, winnerTeam: "A", games: [{ id: "game-ranking-test", scoreRevisionId: "revision-ranking-test", gameNumber: 1, teamAScore: 21, teamBScore: 18, winnerTeam: "A" }] }];
  const player = {
    id: "player-did-not-play",
    displayName: "Did Not Play Player",
    gender: "FEMALE",
    skillLevel: "BEGINNER",
    skillWeight: 2,
    status: "INACTIVE",
  };
  snapshot.players.push(player);
  snapshot.queuePlayers.push({
    id: "queue-did-not-play",
    playerId: player.id,
    displayName: player.displayName,
    gender: player.gender,
    skillLevel: player.skillLevel,
    skillWeight: player.skillWeight,
    status: "INACTIVE",
    matchesPlayed: 0,
    wins: 0,
    losses: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    amountDueMinor: 0,
    manualPriority: 0,
    priorityReason: null,
    latePenaltyState: null,
    latePenaltyAppliedAt: null,
    currentMatchId: null,
    checkedInAt: null,
    checkedOutAt: null,
    restStartedAt: null,
    version: 1,
  });
  return snapshot;
}

const rankingApiState = { cloudWorkspaceReads: 0, publishedVersions: [] as string[], startedAt: "", cloudVersion: 9 as number | null, cloudStartedAt: null as string | null, publishConflictsRemaining: 0, requestOrder: [] as string[] };

function resetRankingApiState() {
  rankingApiState.cloudWorkspaceReads = 0;
  rankingApiState.publishedVersions = [];
  rankingApiState.startedAt = "";
  rankingApiState.cloudVersion = 9;
  rankingApiState.cloudStartedAt = null;
  rankingApiState.publishConflictsRemaining = 0;
  rankingApiState.requestOrder = [];
}

function rankingApiSnapshot() {
  const snapshot = rankingSnapshot() as any;
  rankingApiState.startedAt ||= snapshot.workspace.startedAt;
  snapshot.workspace.startedAt = rankingApiState.startedAt;
  return snapshot;
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

async function mockQueueApi(route: Route) {
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
    await route.fulfill({ json: { data: { user: { id: "account-1", username: "queue-layout-test", role: "QUEUE_MASTER" }, csrfToken: "test-token" } }, headers: corsHeaders });
    return;
  }
  if (path === "/sync/snapshot") {
    await route.fulfill({ json: { data: { snapshot: queueLayoutSnapshot(), cloudRevision: 1 } }, headers: corsHeaders });
    return;
  }
  if (path === "/workspace/public-rankings") {
    await route.fulfill({ json: { data: { current: null, archives: [] } }, headers: corsHeaders });
    return;
  }
  await route.fulfill({ status: 404, json: { error: { message: "Unexpected test request" } }, headers: corsHeaders });
}

async function mockRankingApi(route: Route) {
  const corsHeaders = {
    "access-control-allow-origin": "http://127.0.0.1:3100",
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": "content-type, x-csrf-token, if-match",
    "access-control-allow-methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
  };
  if (route.request().method() === "OPTIONS") {
    await route.fulfill({ status: 204, headers: corsHeaders });
    return;
  }
  const path = new URL(route.request().url()).pathname.replace("/api/v2", "");
  if (path === "/auth/me") {
    await route.fulfill({ json: { data: { user: { id: "account-1", username: "ranking-test", role: "QUEUE_MASTER" }, csrfToken: "test-token" } }, headers: corsHeaders });
    return;
  }
  if (path === "/sync/snapshot") {
    const snapshot = rankingApiSnapshot();
    delete snapshot.workspace.version;
    await route.fulfill({ json: { data: { snapshot, cloudRevision: 1 } }, headers: corsHeaders });
    return;
  }
  if (path === "/workspace" && route.request().method() === "GET") {
    rankingApiState.requestOrder.push("workspace");
    rankingApiState.cloudWorkspaceReads += 1;
    const snapshot = rankingApiSnapshot();
    await route.fulfill({ json: { data: { ...snapshot.workspace, id: "workspace", name: "Current queue", sessionDate: snapshot.workspace.startedAt, startedAt: rankingApiState.cloudStartedAt ?? snapshot.workspace.startedAt, status: "ACTIVE", scoring: { pointsToWin: 21, winBy: 2, scoreCap: null, bestOf: 1 }, version: rankingApiState.cloudVersion } }, headers: corsHeaders });
    return;
  }
  if (path === "/workspace/public-rankings/publish" && route.request().method() === "POST") {
    rankingApiState.requestOrder.push("publish");
    rankingApiState.publishedVersions.push(route.request().headers()["if-match"] ?? "");
    if (rankingApiState.publishConflictsRemaining > 0) {
      rankingApiState.publishConflictsRemaining -= 1;
      rankingApiState.cloudVersion = 10;
      await route.fulfill({ status: 409, json: { error: { code: "VERSION_CONFLICT", message: "The data changed on another device." } }, headers: corsHeaders });
      return;
    }
    const snapshot = rankingApiSnapshot();
    await route.fulfill({ json: { data: { id: "publication-1", sessionStartedAt: snapshot.workspace.startedAt, state: "LIVE", publishedAt: new Date().toISOString(), version: 1, token: "published-token" } }, headers: corsHeaders, status: 201 });
    return;
  }
  if (path === "/workspace/public-rankings") {
    await route.fulfill({ json: { data: { current: null, archives: [] } }, headers: corsHeaders });
    return;
  }
  await route.fulfill({ status: 404, json: { error: { message: "Unexpected test request" } }, headers: corsHeaders });
}

async function mockFeesApi(route: Route) {
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
    await route.fulfill({ json: { data: { user: { id: "account-1", username: "fees-test", role: "QUEUE_MASTER" }, csrfToken: "test-token" } }, headers: corsHeaders });
    return;
  }
  if (path === "/sync/snapshot") {
    await route.fulfill({ json: { data: { snapshot: feesSnapshot(), cloudRevision: 1 } }, headers: corsHeaders });
    return;
  }
  if (path === "/workspace/public-rankings") {
    await route.fulfill({ json: { data: { current: null, archives: [] } }, headers: corsHeaders });
    return;
  }
  await route.fulfill({ status: 404, json: { error: { message: "Unexpected test request" } }, headers: corsHeaders });
}

async function mockPublicRankingApi(route: Route) {
  const corsHeaders = { "access-control-allow-origin": "http://127.0.0.1:3100" };
  if (route.request().method() === "OPTIONS") {
    await route.fulfill({ status: 204, headers: corsHeaders });
    return;
  }
  const path = new URL(route.request().url()).pathname.replace("/api/v2", "");
  if (path === "/public/rankings/public-token" || path === "/public/rankings/empty-token") {
    const rankings = path.endsWith("empty-token") ? [] : [
      { rank: null, playerKey: "early-key", player: "Early Player", matchesPlayed: 1, wins: 1, losses: 0, winRateBasisPoints: 10000, pointsFor: 21, pointsAgainst: 10, pointDifferential: 11 },
      { rank: 1, playerKey: "played-key", player: "Played Player", matchesPlayed: 2, wins: 1, losses: 1, winRateBasisPoints: 5000, pointsFor: 42, pointsAgainst: 40, pointDifferential: 2 },
      { rank: 2, playerKey: "zero-key", player: "Public Did Not Play", matchesPlayed: 0, wins: 0, losses: 0, winRateBasisPoints: 0, pointsFor: 0, pointsAgainst: 0, pointDifferential: 0 },
    ];
    await route.fulfill({ json: { data: { sessionStartedAt: "2026-08-30T08:00:00.000Z", firstMatchStartedAt: "2026-08-30T08:10:00.000Z", state: "LIVE", serverTime: "2026-08-30T08:20:00.000Z", lastUpdatedAt: "2026-08-30T08:20:00.000Z", historyAvailable: true, rankings } }, headers: corsHeaders });
    return;
  }
  if (path === "/public/rankings/public-token/players/played-key/history") {
    await route.fulfill({ json: { data: {
      player: { playerKey: "played-key", player: "Played Player" },
      stats: {
        averageDurationSeconds: 720,
        mostPlayedPartner: { displayName: "A very long partner name that should wrap safely", count: 2 },
        mostPlayedOpponent: { displayName: "Long opponent name", count: 2 },
      },
      matches: [{ matchKey: "match-1", completedAt: "2026-08-30T08:18:00.000Z", result: "WIN", winnerTeam: "A", teamA: ["Played Player", "A very long partner name that should wrap safely"], teamB: ["Long opponent name"], games: [{ gameNumber: 1, teamAScore: 21, teamBScore: 18, winnerTeam: "A" }] }],
    } }, headers: corsHeaders });
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
      await editDialog.getByRole("combobox", { name: "Live court" }).selectOption("court-2");
      await expect(editDialog).toContainText("This court is occupied by another live match.");
      await editDialog.getByRole("button", { name: "Review court swap" }).click();
      await expect(editDialog.getByRole("button", { name: "Confirm court swap" })).toBeVisible();
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

  for (const viewport of [{ name: "mobile", width: 390, height: 844 }, { name: "desktop", width: 1440, height: 900 }] as const) {
    test(`${viewport.name} Queue prioritizes check-in before management controls`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.route("**/api/v2/**", mockQueueApi);
      await page.goto("/");
      await page.getByRole("button", { name: "Queue" }).click();
      await expect(page.getByRole("heading", { name: "Build the next matchup." })).toBeVisible();

      await page.getByRole("button", { name: /Not checked in/ }).click();
      const checkIn = page.getByRole("button", { name: "Check in", exact: true }).first();
      await expect(checkIn).toBeVisible();
      expect(await checkIn.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= window.innerHeight;
      })).toBe(true);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);

      const sectionOrder = await page.locator("h2, h3, p").evaluateAll((nodes) => {
        const labels = ["Build the next matchup.", "Synergy Teams", "End this session"];
        return labels.map((label) => nodes.findIndex((node) => node.textContent?.trim() === label));
      });
      expect(sectionOrder[0]).toBeGreaterThanOrEqual(0);
      expect(sectionOrder[1]).toBeGreaterThan(sectionOrder[0]!);
      expect(sectionOrder[2]).toBeGreaterThan(sectionOrder[1]!);

      await page.getByRole("button", { name: "End session", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "End this session?" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog", { name: "End this session?" })).toHaveCount(0);
    });
  }

  for (const viewport of [{ name: "mobile", width: 390, height: 844 }, { name: "desktop", width: 1440, height: 900 }] as const) {
    test(`${viewport.name} fees prioritize payment entry and keep fee details grouped`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.route("**/api/v2/**", mockFeesApi);
      await page.goto("/");
      await page.getByRole("button", { name: "Fees" }).click();
      await expect(page.getByRole("heading", { name: "Log a payment." })).toBeVisible();
      await expect(page.getByTestId("no-show-penalty-control")).toBeVisible();
      await expect(page.getByText("Did not play / No-show penalties", { exact: true })).toBeVisible();

      const sections = await page.locator("section").evaluateAll((nodes) => nodes.map((node) => node.textContent ?? ""));
      const indexOf = (needle: string) => sections.findIndex((text) => text.includes(needle));
      expect(indexOf("Log a payment.")).toBeLessThan(indexOf("Allocation"));
      expect(indexOf("Players by payment method")).toBeLessThan(indexOf("Did not play / No-show penalties"));

      const mainCards = await page.locator("[data-testid='log-payment-card'], [data-testid='fee-allocation-card']").evaluateAll((nodes) => nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return { left: rect.left, top: rect.top };
      }));
      expect(mainCards).toHaveLength(2);
      expect(mainCards[0]!.top).toBeLessThanOrEqual(mainCards[1]!.top);
      if (viewport.name === "desktop") expect(mainCards[0]!.left).toBeLessThan(mainCards[1]!.left);
      if (viewport.name === "mobile") expect(mainCards[0]!.left).toBeCloseTo(mainCards[1]!.left, 0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

      await page.getByRole("button", { name: "Settings" }).click();
      await expect(page.getByText("No-show penalty.", { exact: true })).toHaveCount(0);
    });
  }

  test("fees preserve no-show penalty validation, save feedback, and disable behavior", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route("**/api/v2/**", mockFeesApi);
    await page.goto("/");
    await page.getByRole("button", { name: "Fees" }).click();
    const control = page.getByTestId("no-show-penalty-control");
    const input = control.getByRole("spinbutton", { name: "Penalty amount (PHP)" });
    const save = control.getByRole("button", { name: "Save", exact: true });
    await input.fill("-1");
    await save.click();
    await expect(control.getByRole("alert")).toContainText("valid non-negative amount");
    await input.fill("0");
    await save.click();
    await expect(page.getByText("No-show penalty updated.", { exact: true })).toBeVisible();
    await expect(control.getByText("Disabled", { exact: true })).toBeVisible();
  });

  test("signed-in rankings separate zero-game players without rank or history controls", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route("**/api/v2/**", mockRankingApi);
    await page.goto("/");
    await page.getByRole("button", { name: "Rankings" }).click();
    await expect(page.getByRole("heading", { name: "LineDrive Afternoon Queue" })).toBeVisible();
    const section = page.getByTestId("did-not-play-section");
    await expect(section).toContainText("Did not play");
    await expect(section).toContainText("Did Not Play Player");
    await expect(section.getByRole("button")).toHaveCount(0);
    await expect(page.getByText("Did Not Play Player", { exact: true })).toHaveCount(1);
  });

  test("publishing uses the authoritative cloud workspace version", async ({ page }) => {
    resetRankingApiState();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route("**/api/v2/**", mockRankingApi);
    await page.goto("/");
    await page.getByRole("button", { name: "Rankings" }).click();
    await expect(page.getByRole("heading", { name: "LineDrive Afternoon Queue" })).toBeVisible();
    await page.getByRole("button", { name: "Publish this session" }).click();
    await expect(page.getByText("Public rankings link is ready.", { exact: true })).toBeVisible();
    expect(rankingApiState.cloudWorkspaceReads).toBeGreaterThan(0);
    expect(rankingApiState.publishedVersions).toEqual(["9"]);
    expect(rankingApiState.requestOrder.indexOf("workspace")).toBeLessThan(rankingApiState.requestOrder.indexOf("publish"));
  });

  test("publishing retries once when the cloud workspace changes", async ({ page }) => {
    resetRankingApiState();
    rankingApiState.publishConflictsRemaining = 1;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route("**/api/v2/**", mockRankingApi);
    await page.goto("/");
    await page.getByRole("button", { name: "Rankings" }).click();
    await expect(page.getByRole("heading", { name: "LineDrive Afternoon Queue" })).toBeVisible();
    await page.getByRole("button", { name: "Publish this session" }).click();
    await expect(page.getByText("Public rankings link is ready.", { exact: true })).toBeVisible();
    expect(rankingApiState.publishedVersions).toEqual(["9", "10"]);
  });

  test("publishing stops when the cloud session changes", async ({ page }) => {
    resetRankingApiState();
    rankingApiState.cloudStartedAt = "2026-01-01T00:00:00.000Z";
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route("**/api/v2/**", mockRankingApi);
    await page.goto("/");
    await page.getByRole("button", { name: "Rankings" }).click();
    await expect(page.getByRole("heading", { name: "LineDrive Afternoon Queue" })).toBeVisible();
    await page.getByRole("button", { name: "Publish this session" }).click();
    await expect(page.locator("main").getByRole("alert")).toContainText("session changed on another device");
    expect(rankingApiState.publishedVersions).toEqual([]);
  });

  test("publishing stops when the cloud version is invalid", async ({ page }) => {
    resetRankingApiState();
    rankingApiState.cloudVersion = null;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route("**/api/v2/**", mockRankingApi);
    await page.goto("/");
    await page.getByRole("button", { name: "Rankings" }).click();
    await expect(page.getByRole("heading", { name: "LineDrive Afternoon Queue" })).toBeVisible();
    await page.getByRole("button", { name: "Publish this session" }).click();
    await expect(page.locator("main").getByRole("alert")).toContainText("version could not be verified");
    expect(rankingApiState.publishedVersions).toEqual([]);
  });

  test("signed-in ranking history shows duration and participant summaries", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route("**/api/v2/**", mockRankingApi);
    await page.goto("/");
    await page.getByRole("button", { name: "Rankings" }).click();
    await expect(page.getByRole("heading", { name: "LineDrive Afternoon Queue" })).toBeVisible();
    const playerRow = page.getByTestId("ranking-row-queue-1");
    expect(await playerRow.count()).toBe(1);
    await playerRow.click();
    await expect(page.getByText("Avg duration", { exact: true })).toBeVisible();
    await expect(page.getByText("5 min", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Player 2 (1)", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Player 3 (1)", { exact: true }).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });

  test("public rankings omit prize labels and keep compact no-game players", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route("**/api/v2/**", mockPublicRankingApi);
    await page.goto("/rankings/shared/public-token");
    await expect(page.getByRole("heading", { name: "LineDrive Afternoon Queue" })).toBeVisible();
    const earlyRow = page.getByRole("button").filter({ hasText: "Early Player" });
    await expect(earlyRow).toHaveCount(1);
    await expect(earlyRow).toContainText("Early Player");
    await expect(page.getByText("1 games · 1W / 0L", { exact: true })).toBeVisible();
    await expect(page.getByText(/games to prize/i)).toHaveCount(0);
    await expect(earlyRow.getByText("Provisional", { exact: true })).toHaveCount(0);
    await expect(page.getByText("100%", { exact: true })).toBeVisible();
    await expect(page.getByText(/Players need 5 completed games/i)).toHaveCount(0);
    await expect(page.getByText("Not yet eligible", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Prize", { exact: true })).toHaveCount(0);
    await expect(page.getByText(/score/i)).toHaveCount(0);
    const section = page.getByTestId("did-not-play-section");
    await expect(section).toContainText("Did not play");
    await expect(section).toContainText("Public Did Not Play");
    await expect(section).toContainText("1");
    await expect(section.locator("li")).toHaveCount(1);
    await expect(section.getByRole("button")).toHaveCount(0);
    await expect(page.getByText("Public Did Not Play", { exact: true })).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });

  test("public ranking history shows player stats only after expanding a row", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route("**/api/v2/**", mockPublicRankingApi);
    await page.goto("/rankings/shared/public-token");
    await expect(page.getByRole("heading", { name: "LineDrive Afternoon Queue" })).toBeVisible();
    const playedRow = page.getByRole("button").filter({ hasText: "Played Player" });
    expect(await playedRow.count()).toBe(1);
    expect(await page.getByText("Avg duration", { exact: true }).count()).toBe(0);
    await playedRow.click();
    await expect(page.getByText("Avg duration", { exact: true })).toBeVisible();
    await expect(page.getByText("12 min", { exact: true })).toBeVisible();
    await expect(page.getByText("A very long partner name that should wrap safely (2)", { exact: true })).toBeVisible();
    await expect(page.getByText("Long opponent name (2)", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.setViewportSize({ width: 1280, height: 900 });
    const statCards = page.getByTestId("public-ranking-history-stats").locator(":scope > div");
    expect(await statCards.count()).toBe(3);
    const cardTops = await statCards.evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().top)));
    expect(new Set(cardTops).size).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });

  test("public rankings can save the current leaderboard to the device", async ({ page }) => {
    await page.route("**/api/v2/**", mockPublicRankingApi);
    await page.goto("/rankings/shared/public-token");
    const saveButton = page.getByRole("button", { name: "Save to device" });
    await expect(saveButton).toBeVisible();
    const downloadPromise = page.waitForEvent("download");
    await saveButton.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^linedrive-rankings-\d{4}-\d{2}-\d{2}\.png$/);
    await expect(page.getByText("Rankings saved to your device.")).toBeVisible();
  });

  test("public rankings disable saving when the leaderboard is empty", async ({ page }) => {
    await page.route("**/api/v2/**", mockPublicRankingApi);
    await page.goto("/rankings/shared/empty-token");
    await expect(page.getByRole("button", { name: "Save to device" })).toBeDisabled();
  });
});
