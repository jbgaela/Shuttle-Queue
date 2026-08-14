import assert from "node:assert/strict";
import test from "node:test";
import { hasPlayerNameConflict, normalizePlayerName } from "../../src/lib/player-names.ts";

const players = [
  { id: "player-1", displayName: "Alice Santos" },
  { id: "player-2", displayName: "Bob Reyes" },
];

test("player names are compared case-insensitively with normalized whitespace", () => {
  assert.equal(normalizePlayerName("  ALICE   Santos  "), "alice santos");
  assert.equal(hasPlayerNameConflict(players, [], "  alice  SANTOS "), true);
});

test("player names use Unicode compatibility normalization", () => {
  assert.equal(hasPlayerNameConflict(players, [], "Ａｌｉｃｅ Santos"), true);
});

test("editing excludes the current player but still detects another profile", () => {
  assert.equal(hasPlayerNameConflict(players, [], "Alice Santos", "player-1"), false);
  assert.equal(hasPlayerNameConflict(players, [], "Bob Reyes", "player-1"), true);
});

test("a matching name already in the current queue is rejected", () => {
  const queuePlayers = [{ playerId: "legacy-player", displayName: "Queue Only" }];
  assert.equal(hasPlayerNameConflict([], queuePlayers, "queue only"), true);
});
