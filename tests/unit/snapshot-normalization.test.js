import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSnapshotForSync } from "../../src/lib/offline/snapshot-normalization.ts";

const incompleteSnapshot = (queuePlayers) => ({
  schemaVersion: 2,
  queueMasterId: "account",
  settings: null,
  workspace: { startedAt: "2025-01-01T00:00:00.000Z", lateArrivalCutoffAt: null, matchmakingAlgorithm: "v2", matchmakingRevision: 1, version: 1 },
  players: [],
  queuePlayers,
  courts: [],
  matches: [],
  feeConfig: null,
  payments: [],
  audits: [],
});

test("normalizes omitted queue-player defaults without mutating the local snapshot", () => {
  const originalPlayer = { id: "qp1", playerId: "p1", displayName: "Alice", gender: "FEMALE", skillLevel: "NEWBIE", skillWeight: 1, status: "INACTIVE", matchesPlayed: 0, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, version: 1 };
  const original = incompleteSnapshot([originalPlayer]);
  const normalized = normalizeSnapshotForSync(original);

  assert.equal(originalPlayer.priorityReason, undefined);
  assert.equal(normalized.queuePlayers[0].priorityReason, null);
  assert.equal(normalized.queuePlayers[0].latePenaltyState, null);
  assert.equal(normalized.queuePlayers[0].amountDueMinor, 0);
  assert.equal(normalized.queuePlayers[0].manualPriority, 0);
  assert.equal(normalized.queuePlayers[0].restStartedAt, null);
  assert.ok(JSON.stringify(normalized).includes('"priorityReason":null'));
});

test("preserves populated queue-player values", () => {
  const player = { id: "qp1", playerId: "p1", displayName: "Alice", gender: "FEMALE", skillLevel: "NEWBIE", skillWeight: 1, status: "WAITING", matchesPlayed: 2, wins: 1, losses: 1, pointsFor: 42, pointsAgainst: 40, amountDueMinor: 125, manualPriority: 3, priorityReason: "manual", latePenaltyState: "PENDING", latePenaltyAppliedAt: "2025-01-01T01:00:00.000Z", queueEnteredAt: "2025-01-01T01:00:00.000Z", lastMatchEndedAt: null, currentMatchId: null, checkedInAt: "2025-01-01T01:00:00.000Z", checkedOutAt: null, restStartedAt: null, version: 4 };
  const normalized = normalizeSnapshotForSync(incompleteSnapshot([player]));

  assert.deepEqual(normalized.queuePlayers[0], player);
});
