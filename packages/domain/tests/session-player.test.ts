import test from "node:test";
import assert from "node:assert/strict";
import { removeSessionPlayer, type CloudSnapshotV2 } from "../src/index.js";

const snapshot = (status: "INACTIVE" | "WAITING" | "RESTING" | "QUEUED" | "PLAYING" | "CHECKED_OUT" = "INACTIVE"): CloudSnapshotV2 => ({
  schemaVersion: 2,
  queueMasterId: "account",
  settings: null,
  workspace: { startedAt: "2025-01-01", lateArrivalCutoffAt: null, matchmakingAlgorithm: "v2", matchmakingRevision: 4, version: 7 },
  players: [{ id: "p1", displayName: "Player 1", gender: "MALE", skillLevel: "NEWBIE", skillWeight: 1, status: "ACTIVE" }, { id: "p2", displayName: "Player 2", gender: "MALE", skillLevel: "NEWBIE", skillWeight: 1, status: "ACTIVE" }],
  queuePlayers: [{ id: "q1", playerId: "p1", displayName: "Player 1", gender: "MALE", skillLevel: "NEWBIE", skillWeight: 1, status, matchesPlayed: 0, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, checkedInAt: status === "CHECKED_OUT" ? "2025-01-01T01:00:00.000Z" : null, version: 1 }, { id: "q2", playerId: "p2", displayName: "Player 2", gender: "MALE", skillLevel: "NEWBIE", skillWeight: 1, status: "CHECKED_OUT", matchesPlayed: 0, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, checkedInAt: "2025-01-01T01:00:00.000Z", amountDueMinor: 300, version: 1 }],
  courts: [], matches: [], feeConfig: { id: "fee", mode: "EQUAL_SPLIT", currencyCode: "PHP", expectedQueueCostMinor: 300, participationRule: "ALL_ACTIVE", version: 1 }, payments: [], audits: [],
});

test("removes an unstarted session player without deleting the directory profile", () => {
  const current = snapshot();
  const result = removeSessionPlayer(current, "q1");
  assert.deepEqual(result.snapshot.queuePlayers.map((player) => player.id), ["q2"]);
  assert.deepEqual(result.snapshot.players.map((player) => player.id), ["p1", "p2"]);
  assert.equal(result.snapshot.workspace.matchmakingRevision, 5);
  assert.equal(result.snapshot.workspace.version, 8);
  assert.equal(current.queuePlayers.length, 2);
});

test("removes a checked-out player and recalculates equal-split fees", () => {
  const result = removeSessionPlayer(snapshot("CHECKED_OUT"), "q1");
  assert.equal(result.snapshot.queuePlayers[0]?.id, "q2");
  assert.equal(result.snapshot.queuePlayers[0]?.amountDueMinor, 300);
});

test("rejects active states and session history", () => {
  for (const status of ["WAITING", "RESTING", "QUEUED", "PLAYING"] as const) assert.throws(() => removeSessionPlayer(snapshot(status), "q1"), /Only inactive or checked-out/);
  const withMatch = snapshot();
  withMatch.matches = [{ id: "m1", status: "COMPLETED", source: "MANUAL", pointsToWin: 21, winBy: 2, scoreCap: null, bestOf: 1, queuedAt: "2025-01-01T00:00:00.000Z", version: 1, participants: [{ id: "mp1", matchId: "m1", queuePlayerId: "q1", team: "A", teamSlot: 0 }], scoreRevisions: [] }];
  assert.throws(() => removeSessionPlayer(withMatch, "q1"), /Only inactive or checked-out/);
  const withPayment = snapshot();
  withPayment.payments = [{ id: "pay1", queuePlayerId: "q1", kind: "COLLECTION", amountMinor: 100, recordedById: "account", occurredAt: "2025-01-01T00:00:00.000Z", createdAt: "2025-01-01T00:00:00.000Z" }];
  assert.throws(() => removeSessionPlayer(withPayment, "q1"), /Only inactive or checked-out/);
});

test("rejects removal after the session has ended", () => {
  const ended = snapshot("INACTIVE");
  ended.workspace.endedAt = "2025-01-01T00:00:00.000Z";
  assert.throws(() => removeSessionPlayer(ended, "q1"), /queue session has ended/);
});
