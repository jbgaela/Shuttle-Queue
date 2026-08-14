import assert from "node:assert/strict";
import test from "node:test";
import { createSyncPreview, hasDestructiveSyncChanges } from "../../src/lib/offline/sync-plan.ts";

const snapshot = (overrides = {}) => ({
  players: [],
  queuePlayers: [],
  courts: [],
  matches: [],
  payments: [],
  feeConfig: null,
  ...overrides,
});

test("local player deletion creates a destructive preview with the deleted name", () => {
  const cloud = snapshot({ players: [{ id: "p1", displayName: "Alice" }, { id: "p2", displayName: "Bob" }] });
  const local = snapshot({ players: [{ id: "p2", displayName: "Bob" }] });
  const preview = createSyncPreview(local, cloud, 7, false);

  assert.deepEqual(preview.removed.playerNames, ["Alice"]);
  assert.equal(preview.removed.players, 1);
  assert.equal(hasDestructiveSyncChanges(preview), true);
});

test("additions and edits without removals are safe to upload in the background", () => {
  const cloud = snapshot({ players: [{ id: "p1", displayName: "Alice" }] });
  const local = snapshot({ players: [{ id: "p1", displayName: "Alice Updated" }, { id: "p2", displayName: "Bob" }] });
  const preview = createSyncPreview(local, cloud, 8, false);

  assert.equal(preview.removed.players, 0);
  assert.equal(hasDestructiveSyncChanges(preview), false);
});

test("a newer cloud revision is retained in the preview for explicit confirmation", () => {
  const cloud = snapshot({ players: [{ id: "p1", displayName: "Cloud Alice" }] });
  const local = snapshot({ players: [{ id: "p1", displayName: "Local Alice" }] });
  const preview = createSyncPreview(local, cloud, 12, true);

  assert.equal(preview.cloudChanged, true);
  assert.equal(preview.cloudRevision, 12);
  assert.deepEqual(preview.removed.playerNames, []);
});

test("removing the local fee configuration is treated as destructive", () => {
  const cloud = snapshot({ feeConfig: { id: "fee-1" } });
  const local = snapshot();
  const preview = createSyncPreview(local, cloud, 3, false);

  assert.equal(preview.removed.feeConfig, 1);
  assert.equal(hasDestructiveSyncChanges(preview), true);
});
