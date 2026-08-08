import test from "node:test";
import assert from "node:assert/strict";
import { applyPlayerDeletion, previewPlayerDeletion, suggestMatch, validateScores, type CloudSnapshotV1, type MatchHistory, type MatchPlayer } from "../src/index.js";

test("validates the default race-to-31 scoring rule", () => {
  const result = validateScores([{ teamAScore: 31, teamBScore: 29 }], { pointsToWin: 31, winBy: 1, scoreCap: 31, bestOf: 1 });
  assert.equal(result[0]?.winnerTeam, "A");
  assert.throws(() => validateScores([{ teamAScore: 31, teamBScore: 31 }], { pointsToWin: 31, winBy: 1, scoreCap: 31, bestOf: 1 }));
});

test("suggests a deterministic eligible group", () => {
  const players: MatchPlayer[] = ["a", "b", "c", "d"].map((id, index) => ({ id, displayName: id, gender: index % 2 ? "FEMALE" : "MALE", skillWeight: index + 1, skillLevel: "NEWBIE", status: "WAITING", gamesPlayed: 0, queueEnteredAt: new Date(index).toISOString(), lastMatchEndedAt: null, manualPriority: 0 }));
  const history: MatchHistory = { partners: new Map(), opponents: new Map(), quartets: new Map() };
  const suggestion = suggestMatch(players, "OPEN", history);
  assert.ok(suggestion);
  assert.equal(new Set([...suggestion.teamA, ...suggestion.teamB].map((player) => player.id)).size, 4);
});

test("previews and applies an account-wide player deletion cascade", () => {
  const snapshot: CloudSnapshotV1 = {
    schemaVersion: 1,
    queueMasterId: "account",
    settings: null,
    players: [
      { id: "p1", displayName: "Alice", gender: "FEMALE", skillLevel: "NEWBIE", skillWeight: 1, status: "ACTIVE" },
      { id: "p2", displayName: "Bob", gender: "MALE", skillLevel: "BEGINNER", skillWeight: 2, status: "ACTIVE" },
      { id: "p3", displayName: "Cara", gender: "FEMALE", skillLevel: "INTERMEDIATE", skillWeight: 3, status: "ACTIVE" },
    ],
    sessions: [{ id: "s1", name: "Session", normalizedName: "session", sessionDate: "2025-01-01", status: "ACTIVE", startedAt: null, endedAt: null, cancelledAt: null, pointsToWin: 31, winBy: 1, scoreCap: 31, bestOf: 1, minimumRestMinutes: 0, matchmakingAlgorithm: "v2", matchmakingRevision: 1, version: 1 }],
    sessionPlayers: [
      { id: "sp1", sessionId: "s1", playerId: "p1", displayName: "Alice", gender: "FEMALE", skillLevel: "NEWBIE", skillWeight: 1, status: "WAITING", matchesPlayed: 1, wins: 1, losses: 0, pointsFor: 31, pointsAgainst: 20, amountDueMinor: 100, version: 1 },
      { id: "sp2", sessionId: "s1", playerId: "p2", displayName: "Bob", gender: "MALE", skillLevel: "BEGINNER", skillWeight: 2, status: "WAITING", matchesPlayed: 1, wins: 0, losses: 1, pointsFor: 20, pointsAgainst: 31, amountDueMinor: 100, version: 1 },
      { id: "sp3", sessionId: "s1", playerId: "p3", displayName: "Cara", gender: "FEMALE", skillLevel: "INTERMEDIATE", skillWeight: 3, status: "WAITING", matchesPlayed: 1, wins: 0, losses: 1, pointsFor: 20, pointsAgainst: 31, amountDueMinor: 100, version: 1 },
    ],
    courts: [],
    matches: [{ id: "m1", sessionId: "s1", courtId: null, status: "COMPLETED", source: "MANUAL", matchmakingMode: null, algorithmVersion: null, suggestionKey: null, suggestionExplanation: null, queuedAt: "2025-01-01T00:00:00.000Z", startedAt: "2025-01-01T00:00:00.000Z", completedAt: "2025-01-01T00:30:00.000Z", cancelledAt: null, cancellationReason: null, winnerTeam: "A", currentRevisionId: "r1", version: 1, participants: [{ id: "mp1", matchId: "m1", sessionPlayerId: "sp1", team: "A", teamSlot: 1 }, { id: "mp2", matchId: "m1", sessionPlayerId: "sp2", team: "B", teamSlot: 1 }], scoreRevisions: [{ id: "r1", matchId: "m1", revisionNumber: 1, winnerTeam: "A", games: [{ id: "g1", scoreRevisionId: "r1", gameNumber: 1, teamAScore: 31, teamBScore: 20, winnerTeam: "A" }] }] }],
    feeConfigs: [{ id: "f1", sessionId: "s1", mode: "EQUAL_SPLIT", currencyCode: "PHP", expectedSessionCostMinor: 200, participationRule: "EVER_CHECKED_IN", version: 1 }],
    payments: [{ id: "pay1", sessionId: "s1", sessionPlayerId: "sp1", kind: "COLLECTION", amountMinor: 100, recordedById: "account", occurredAt: "2025-01-01", createdAt: "2025-01-01" }],
    audits: [],
    careerStats: [{ playerId: "p1", matchesPlayed: 1 }],
  };
  const preview = previewPlayerDeletion(snapshot, ["p1"]);
  assert.deepEqual(preview.busyPlayers, []);
  assert.deepEqual(preview.affectedMatchIds, ["m1"]);
  assert.deepEqual(preview.otherParticipantPlayerIds, ["p2"]);
  const result = applyPlayerDeletion(snapshot, ["p1"]);
  assert.deepEqual(result.snapshot.players.map((player) => player.id), ["p2", "p3"]);
  assert.equal(result.snapshot.matches.length, 0);
  assert.equal(result.snapshot.payments.length, 0);
  assert.equal(result.snapshot.sessionPlayers.find((player) => player.id === "sp2")?.matchesPlayed, 0);
  assert.equal(result.snapshot.sessionPlayers.find((player) => player.id === "sp2")?.amountDueMinor, 100);
});

test("blocks deletion of queued or playing players", () => {
  const snapshot = { schemaVersion: 1, queueMasterId: "a", settings: null, players: [{ id: "p", displayName: "Busy", gender: "MALE", skillLevel: "NEWBIE", skillWeight: 1, status: "ACTIVE" }], sessions: [], sessionPlayers: [{ id: "sp", sessionId: "s", playerId: "p", displayName: "Busy", gender: "MALE", skillLevel: "NEWBIE", skillWeight: 1, status: "PLAYING", matchesPlayed: 0, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, version: 1 }], courts: [], matches: [], feeConfigs: [], payments: [], audits: [], careerStats: [] } as CloudSnapshotV1;
  assert.equal(previewPlayerDeletion(snapshot, ["p"]).busyPlayers.length, 1);
  assert.throws(() => applyPlayerDeletion(snapshot, ["p"]), /Busy players/);
});
