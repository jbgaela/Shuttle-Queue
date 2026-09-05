import type { Route } from "@playwright/test";

export function guidedSnapshot() {
  const startedAt = "2026-01-01T00:00:00.000Z";
  const skills = ["NEWBIE", "BEGINNER", "INTERMEDIATE", "INTERMEDIATE"] as const;
  const weights = { NEWBIE: 1, BEGINNER: 2, INTERMEDIATE: 4 } as const;
  const players = skills.map((skillLevel, index) => ({
    id: `guided-player-${index + 1}`,
    displayName: `Guided Player ${index + 1}`,
    gender: index % 2 === 0 ? "MALE" : "FEMALE",
    skillLevel,
    skillWeight: weights[skillLevel],
    status: "ACTIVE",
  }));
  const queuePlayers = players.map((player, index) => ({
    id: `guided-queue-${index + 1}`,
    playerId: player.id,
    displayName: player.displayName,
    gender: player.gender,
    skillLevel: player.skillLevel,
    skillWeight: player.skillWeight,
    status: "WAITING",
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
    checkedInAt: startedAt,
    checkedOutAt: null,
    restStartedAt: null,
    queueEnteredAt: startedAt,
    lastMatchEndedAt: null,
    version: 1,
  }));
  return {
    schemaVersion: 2,
    queueMasterId: "account-1",
    settings: { id: "guided-settings", pointsToWin: 21, winBy: 2, scoreCap: null, bestOf: 1, minimumRestMinutes: 0, lateArrivalGraceMinutes: 15, defaultFeeMode: "NONE", defaultFixedFeeMinor: null, currencyCode: "PHP", timeZone: "Asia/Manila", defaultLateArrivalCutoffTime: null, version: 1 },
    workspace: { startedAt, endedAt: null, lateArrivalCutoffAt: null, matchmakingAlgorithm: "v13-undefeated-ordered-gap-fallback", matchmakingRevision: 1, version: 1 },
    players,
    queuePlayers,
    synergyTeams: [],
    courts: [{ id: "guided-court-1", name: "Court 1", normalizedName: "court-1", displayOrder: 0, status: "AVAILABLE", currentMatchId: null, closedAt: null, version: 1 }],
    matches: [],
    feeConfig: null,
    payments: [],
    audits: [],
  };
}

export async function mockGuidedApi(route: Route) {
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
    await route.fulfill({ json: { data: { user: { id: "account-1", username: "guided-a11y-test", role: "QUEUE_MASTER" }, csrfToken: "test-token" } }, headers });
    return;
  }
  if (path === "/sync/snapshot") {
    await route.fulfill({ json: { data: { snapshot: guidedSnapshot(), cloudRevision: 1 } }, headers });
    return;
  }
  if (path === "/workspace/public-rankings") {
    await route.fulfill({ json: { data: { current: null, archives: [] } }, headers });
    return;
  }
  await route.fulfill({ status: 404, json: { error: { message: "Unexpected Guided test request" } }, headers });
}
