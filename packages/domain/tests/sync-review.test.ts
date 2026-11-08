import test from "node:test";
import assert from "node:assert/strict";
import { reviewSyncSnapshots } from "../src/sync-review.js";
import type { CloudSnapshotV2 } from "../src/index.js";

const fixture = (): CloudSnapshotV2 => ({
  schemaVersion: 2,
  queueMasterId: "account",
  settings: null,
  workspace: {
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: null,
    lateArrivalCutoffAt: null,
    matchmakingAlgorithm: "test",
    matchmakingRevision: 1,
    version: 1,
  },
  players: [
    {
      id: "p",
      displayName: "Alice",
      gender: "FEMALE",
      skillLevel: "BEGINNER",
      skillWeight: 2,
      status: "ACTIVE",
    },
  ],
  queuePlayers: [],
  courts: [],
  matches: [],
  payments: [],
  audits: [],
  feeConfig: null,
});
test("three-way merges independent fields but requires review for the same field", () => {
  const base = fixture(),
    local = fixture(),
    cloud = fixture();
  local.players[0]!.displayName = "Alice Local";
  cloud.players[0]!.skillLevel = "INTERMEDIATE";
  const merged = reviewSyncSnapshots(local, cloud, base);
  assert.equal(merged.conflicts.length, 0);
  assert.equal(merged.snapshot.players[0]!.displayName, "Alice Local");
  assert.equal(merged.snapshot.players[0]!.skillLevel, "INTERMEDIATE");
  cloud.players[0]!.displayName = "Alice Cloud";
  const conflict = reviewSyncSnapshots(local, cloud, base);
  assert.equal(conflict.conflicts[0]!.field, "displayName");
  const resolved = reviewSyncSnapshots(local, cloud, base, {
    [conflict.conflicts[0]!.key]: { choice: "local" },
  });
  assert.equal(resolved.conflicts.length, 0);
  assert.equal(resolved.snapshot.players[0]!.displayName, "Alice Local");
});
test("delete versus edit remains reviewable and an unchanged deletion stays deleted", () => {
  const base = fixture(),
    local = fixture(),
    cloud = fixture();
  local.players = [];
  assert.equal(reviewSyncSnapshots(local, cloud, base).snapshot.players.length, 0);
  cloud.players[0]!.displayName = "Edited";
  assert.equal(reviewSyncSnapshots(local, cloud, base).conflicts.length, 1);
});
test("same-name new identities require explicit reuse or rename", () => {
  const base = fixture(),
    local = fixture(),
    cloud = fixture();
  local.players.push({ ...local.players[0]!, id: "local", displayName: "Bob" });
  cloud.players.push({ ...cloud.players[0]!, id: "remote", displayName: "Bob" });
  const review = reviewSyncSnapshots(local, cloud, base);
  assert.equal(review.conflicts[0]!.kind, "identity");
  const key = review.conflicts[0]!.key;
  assert.equal(
    reviewSyncSnapshots(local, cloud, base, { [key]: { choice: "cloud" } }).snapshot.players.length,
    2,
  );
  const renamed = reviewSyncSnapshots(local, cloud, base, {
    [key]: { choice: "rename", name: "Other Bob" },
  });
  assert.equal(renamed.conflicts.length, 0);
  assert.equal(renamed.snapshot.players.length, 3);
});

test("concurrent queue identities require review and remap payments only after explicit reuse", () => {
  const base = fixture(),
    local = fixture(),
    cloud = fixture();
  const row = {
    id: "local-queue",
    playerId: "p",
    displayName: "Alice",
    gender: "FEMALE" as const,
    skillLevel: "BEGINNER" as const,
    skillWeight: 2,
    status: "WAITING" as const,
    queueEnteredAt: null,
    checkedInAt: null,
    checkedOutAt: null,
    restStartedAt: null,
    lastMatchEndedAt: null,
    currentMatchId: null,
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
    version: 1,
  };
  local.queuePlayers = [row];
  cloud.queuePlayers = [{ ...row, id: "cloud-queue" }];
  local.payments = [
    {
      id: "payment",
      queuePlayerId: row.id,
      kind: "COLLECTION",
      method: "CASH",
      amountMinor: 500,
      reference: null,
      note: null,
      reversalOfPaymentId: null,
      recordedById: "account",
      occurredAt: "2026-01-01T01:00:00.000Z",
      createdAt: "2026-01-01T01:00:00.000Z",
    },
  ];
  const review = reviewSyncSnapshots(local, cloud, base);
  assert.equal(review.conflicts[0]!.collection, "queuePlayers");
  const resolved = reviewSyncSnapshots(local, cloud, base, {
    [review.conflicts[0]!.key]: { choice: "cloud" },
  });
  assert.equal(resolved.conflicts.length, 0);
  assert.equal(resolved.snapshot.queuePlayers.length, 1);
  assert.equal(resolved.snapshot.payments[0]!.queuePlayerId, "cloud-queue");
});
