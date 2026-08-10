import test from "node:test";
import assert from "node:assert/strict";
import { applyPlayerDeletion, previewPlayerDeletion, suggestMatch, validateScores, type CloudSnapshotV2, type MatchHistory, type MatchPlayer } from "../src/index.js";

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

test("prefers lineups with fewer pending late penalties without blocking a valid match", () => {
  const players: MatchPlayer[] = ["a", "b", "c", "d", "e"].map((id, index) => ({ id, displayName: id, gender: "MALE", skillWeight: 2, skillLevel: "NEWBIE", status: "WAITING", gamesPlayed: 0, queueEnteredAt: new Date(index).toISOString(), lastMatchEndedAt: null, manualPriority: 0, latePenaltyState: id === "e" ? "PENDING" : null }));
  const history: MatchHistory = { partners: new Map(), opponents: new Map(), quartets: new Map() };
  const preferred = suggestMatch(players, "OPEN", history);
  assert.ok(preferred);
  assert.equal([...preferred.teamA, ...preferred.teamB].some((player) => player.id === "e"), false);
  const required = suggestMatch(players.filter((player) => player.id !== "d"), "OPEN", history);
  assert.ok(required);
  assert.equal([...required.teamA, ...required.teamB].some((player) => player.id === "e"), true);
});

test("previews and applies an account-wide player deletion cascade", () => {
  const snapshot: CloudSnapshotV2 = {
    schemaVersion: 2,
    queueMasterId: "account",
    settings: null,
    workspace: { startedAt: "2025-01-01", lateArrivalCutoffAt: null, matchmakingAlgorithm: "v2", matchmakingRevision: 1, version: 1 },
    players: [
      { id: "p1", displayName: "Alice", gender: "FEMALE", skillLevel: "NEWBIE", skillWeight: 1, status: "ACTIVE" },
      { id: "p2", displayName: "Bob", gender: "MALE", skillLevel: "BEGINNER", skillWeight: 2, status: "ACTIVE" },
      { id: "p3", displayName: "Cara", gender: "FEMALE", skillLevel: "INTERMEDIATE", skillWeight: 3, status: "ACTIVE" },
    ],
    queuePlayers: [
      { id: "qp1", playerId: "p1", displayName: "Alice", gender: "FEMALE", skillLevel: "NEWBIE", skillWeight: 1, status: "WAITING", matchesPlayed: 1, wins: 1, losses: 0, pointsFor: 31, pointsAgainst: 20, amountDueMinor: 100, version: 1 },
      { id: "qp2", playerId: "p2", displayName: "Bob", gender: "MALE", skillLevel: "BEGINNER", skillWeight: 2, status: "WAITING", matchesPlayed: 1, wins: 0, losses: 1, pointsFor: 20, pointsAgainst: 31, amountDueMinor: 100, version: 1 },
      { id: "qp3", playerId: "p3", displayName: "Cara", gender: "FEMALE", skillLevel: "INTERMEDIATE", skillWeight: 3, status: "WAITING", matchesPlayed: 1, wins: 0, losses: 1, pointsFor: 20, pointsAgainst: 31, amountDueMinor: 100, version: 1 },
    ],
    courts: [],
    matches: [{ id: "m1", courtId: null, status: "COMPLETED", source: "MANUAL", matchmakingMode: null, algorithmVersion: null, suggestionKey: null, suggestionExplanation: null, pointsToWin: 31, winBy: 1, scoreCap: 31, bestOf: 1, queuedAt: "2025-01-01T00:00:00.000Z", startedAt: "2025-01-01T00:00:00.000Z", completedAt: "2025-01-01T00:30:00.000Z", cancelledAt: null, cancellationReason: null, winnerTeam: "A", currentRevisionId: "r1", version: 1, participants: [{ id: "mp1", matchId: "m1", queuePlayerId: "qp1", team: "A", teamSlot: 1 }, { id: "mp2", matchId: "m1", queuePlayerId: "qp2", team: "B", teamSlot: 1 }], scoreRevisions: [{ id: "r1", matchId: "m1", revisionNumber: 1, winnerTeam: "A", games: [{ id: "g1", scoreRevisionId: "r1", gameNumber: 1, teamAScore: 31, teamBScore: 20, winnerTeam: "A" }] }] }],
    feeConfig: { id: "f1", mode: "EQUAL_SPLIT", currencyCode: "PHP", expectedQueueCostMinor: 200, participationRule: "EVER_CHECKED_IN", version: 1 },
    payments: [{ id: "pay1", queuePlayerId: "qp1", kind: "COLLECTION", amountMinor: 100, recordedById: "account", occurredAt: "2025-01-01", createdAt: "2025-01-01" }],
    audits: [],
  };
  const preview = previewPlayerDeletion(snapshot, ["p1"]);
  assert.deepEqual(preview.busyPlayers, []);
  assert.deepEqual(preview.affectedMatchIds, ["m1"]);
  assert.deepEqual(preview.otherParticipantPlayerIds, ["p2"]);
  const result = applyPlayerDeletion(snapshot, ["p1"]);
  assert.deepEqual(result.snapshot.players.map((player) => player.id), ["p2", "p3"]);
  assert.equal(result.snapshot.matches.length, 0);
  assert.equal(result.snapshot.payments.length, 0);
  assert.equal(result.snapshot.queuePlayers.find((player) => player.id === "qp2")?.matchesPlayed, 0);
  assert.equal(result.snapshot.queuePlayers.find((player) => player.id === "qp2")?.amountDueMinor, 100);
});

test("blocks deletion of queued or playing players", () => {
  const snapshot = { schemaVersion: 2, queueMasterId: "a", settings: null, workspace: { startedAt: "2025-01-01", lateArrivalCutoffAt: null, matchmakingAlgorithm: "v2", matchmakingRevision: 1, version: 1 }, players: [{ id: "p", displayName: "Busy", gender: "MALE", skillLevel: "NEWBIE", skillWeight: 1, status: "ACTIVE" }], queuePlayers: [{ id: "qp", playerId: "p", displayName: "Busy", gender: "MALE", skillLevel: "NEWBIE", skillWeight: 1, status: "PLAYING", matchesPlayed: 0, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, version: 1 }], courts: [], matches: [], feeConfig: null, payments: [], audits: [] } as CloudSnapshotV2;
  assert.equal(previewPlayerDeletion(snapshot, ["p"]).busyPlayers.length, 1);
  assert.throws(() => applyPlayerDeletion(snapshot, ["p"]), /Busy players/);
});
