import assert from "node:assert/strict";
import test from "node:test";
import { playerHistoryStats } from "../../src/lib/player-history-stats.ts";

const participant = (queuePlayerId, displayName, team) => ({ queuePlayerId, sessionPlayerId: queuePlayerId, displayName, gender: "MALE", skillLevel: "BEGINNER", team, teamSlot: 1 });

test("offline player history stats average timed matches and count participants", () => {
  const result = playerHistoryStats([
    { durationSeconds: 60, participants: [participant("p1", "Player", "A"), participant("p2", "Zoe", "A"), participant("p3", "Amy", "B")] },
    { durationSeconds: 180, participants: [participant("p1", "Player", "B"), participant("p2", "Zoe", "A"), participant("p3", "Amy", "B")] },
    { durationSeconds: null, participants: [participant("p4", "Other", "A"), participant("p2", "Zoe", "B")] },
  ], "p1");
  assert.equal(result.averageDurationSeconds, 120);
  assert.deepEqual(result.mostPlayedPartner, { queuePlayerId: "p3", sessionPlayerId: "p3", displayName: "Amy", count: 1 });
  assert.deepEqual(result.mostPlayedOpponent, { queuePlayerId: "p3", sessionPlayerId: "p3", displayName: "Amy", count: 1 });
});

test("player history stats return null for unavailable summaries", () => {
  assert.deepEqual(playerHistoryStats([{ durationSeconds: null, participants: [participant("p1", "Player", "A")] }], "p1"), {
    averageDurationSeconds: null,
    mostPlayedPartner: null,
    mostPlayedOpponent: null,
  });
});
