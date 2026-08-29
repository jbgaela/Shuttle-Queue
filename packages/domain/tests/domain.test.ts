import test from "node:test";
import assert from "node:assert/strict";
import { applyPlayerDeletion, isProhibitedGeneratedNewbieMatch, previewPlayerDeletion, skillWeight, suggestMatch, undefeatedChallengePlayers, validateBalancedLineup, validateMixedDoublesLineup, validateScores, type CloudSnapshotV2, type MatchHistory, type MatchPlayer } from "../src/index.js";

const skillLevelForWeight = (weight: number): MatchPlayer["skillLevel"] => (["NEWBIE", "BEGINNER", "UPPER_BEGINNER", "INTERMEDIATE", "UPPER_INTERMEDIATE", "ADVANCED"] as const)[weight - 1] ?? "ADVANCED";

test("validates the default race-to-31 scoring rule", () => {
  const result = validateScores([{ teamAScore: 31, teamBScore: 29 }], { pointsToWin: 31, winBy: 1, scoreCap: 31, bestOf: 1 });
  assert.equal(result[0]?.winnerTeam, "A");
  assert.equal(validateScores([{ teamAScore: 31, teamBScore: 29 }], { pointsToWin: 31, winBy: 1, scoreCap: null, bestOf: 1 })[0]?.winnerTeam, "A");
  assert.throws(() => validateScores([{ teamAScore: 31, teamBScore: 31 }], { pointsToWin: 31, winBy: 1, scoreCap: 31, bestOf: 1 }));
  assert.throws(() => validateScores([{ teamAScore: 32, teamBScore: 30 }], { pointsToWin: 31, winBy: 1, scoreCap: null, bestOf: 1 }));
});

test("suggests a deterministic eligible group", () => {
  const players: MatchPlayer[] = ["a", "b", "c", "d"].map((id, index) => ({ id, displayName: id, gender: index % 2 ? "FEMALE" : "MALE", skillWeight: index + 1, skillLevel: skillLevelForWeight(index + 1), status: "WAITING", gamesPlayed: 0, queueEnteredAt: new Date(index).toISOString(), lastMatchEndedAt: null, manualPriority: 0 }));
  const history: MatchHistory = { partners: new Map(), opponents: new Map(), quartets: new Map() };
  const suggestion = suggestMatch(players, "OPEN", history);
  assert.ok(suggestion);
  assert.equal(new Set([...suggestion.teamA, ...suggestion.teamB].map((player) => player.id)).size, 4);
});

test("generated matches require Newbies to partner with Beginner or Upper Beginner", () => {
  const history: MatchHistory = { partners: new Map(), opponents: new Map(), quartets: new Map() };
  const make = (id: string, skillLevel: MatchPlayer["skillLevel"], skillWeight: number): MatchPlayer => ({ id, displayName: id, gender: "MALE", skillWeight, skillLevel, status: "WAITING", gamesPlayed: 0, queueEnteredAt: new Date(Number(id.replace(/\D/g, "")) || 0).toISOString(), lastMatchEndedAt: null, manualPriority: 0 });
  assert.equal(suggestMatch([make("n1", "NEWBIE", 1), make("n2", "NEWBIE", 1), make("n3", "NEWBIE", 1), make("n4", "NEWBIE", 1)], "OPEN", history), null);
  assert.equal(suggestMatch([make("n1", "NEWBIE", 1), make("n2", "NEWBIE", 1), make("n3", "NEWBIE", 1), make("n4", "NEWBIE", 1)], "SAME_SKILL", history), null);
  assert.equal(suggestMatch([make("n1", "NEWBIE", 1), make("n2", "NEWBIE", 1), make("n3", "NEWBIE", 1), make("b1", "BEGINNER", 2)], "OPEN", history), null);
  const valid = suggestMatch([make("n1", "NEWBIE", 1), make("n2", "NEWBIE", 1), make("b1", "BEGINNER", 2), make("u1", "UPPER_BEGINNER", 3)], "OPEN", history);
  assert.ok(valid);
  assert.equal(isProhibitedGeneratedNewbieMatch(valid.teamA, valid.teamB), false);
  assert.equal(suggestMatch([make("n1", "NEWBIE", 1), make("i1", "INTERMEDIATE", 4), make("i2", "INTERMEDIATE", 4), make("i3", "INTERMEDIATE", 4)], "OPEN", history), null);
  const undefeated = ["n1", "n2", "n3", "n4"].map((id) => ({ ...make(id, "NEWBIE", 1), gamesPlayed: 4, wins: 4 }));
  assert.equal(suggestMatch(undefeated, "UNDEFEATED_CHALLENGE", history), null);
});

test("handicap suggestions require an exact team-total difference", () => {
  const history: MatchHistory = { partners: new Map(), opponents: new Map(), quartets: new Map() };
  const players = (weights: number[]): MatchPlayer[] => weights.map((skillWeight, index) => ({ id: String.fromCharCode(97 + index), displayName: String(index), gender: "MALE", skillWeight, skillLevel: skillLevelForWeight(skillWeight), status: "WAITING", gamesPlayed: 0, queueEnteredAt: new Date(index).toISOString(), lastMatchEndedAt: null, manualPriority: 0 }));
  const valid = suggestMatch(players([2, 2, 2, 3]), "BALANCED", history);
  assert.ok(valid);
  assert.equal(valid.difference, 1);
  assert.equal(Math.max(...[...valid.teamA, ...valid.teamB].map((player) => player.skillWeight)) - Math.min(...[...valid.teamA, ...valid.teamB].map((player) => player.skillWeight)), 1);
  assert.equal(suggestMatch(players([2, 2, 2, 2]), "BALANCED", history), null);
  assert.equal(suggestMatch(players([1, 1, 3, 3]), "BALANCED", history), null);
  assert.equal(suggestMatch(players([1, 1, 5, 5]), "BALANCED", history), null);
  assert.ok(suggestMatch(players([1, 1, 3, 3]), "OPEN", history));
});

test("upper beginner fills the new adjacent skill band", () => {
  assert.equal(skillWeight("BEGINNER"), 2);
  assert.equal(skillWeight("UPPER_BEGINNER"), 3);
  assert.equal(skillWeight("INTERMEDIATE"), 4);
  const history: MatchHistory = { partners: new Map(), opponents: new Map(), quartets: new Map() };
  const make = (weights: number[]): MatchPlayer[] => weights.map((skillWeight, index) => ({ id: String.fromCharCode(97 + index), displayName: String(index), gender: "MALE", skillWeight, skillLevel: "UPPER_BEGINNER", status: "WAITING", gamesPlayed: 0, queueEnteredAt: new Date(index).toISOString(), lastMatchEndedAt: null, manualPriority: 0 }));
  assert.ok(suggestMatch(make([2, 2, 2, 3]), "BALANCED", history));
  assert.equal(suggestMatch(make([2, 2, 4, 4]), "BALANCED", history), null);
});

test("generated doubles never place two female players against two male players", () => {
  const history: MatchHistory = { partners: new Map(), opponents: new Map(), quartets: new Map() };
  const players: MatchPlayer[] = ["f1", "f2", "m1", "m2"].map((id, index) => ({ id, displayName: id, gender: index < 2 ? "FEMALE" : "MALE", skillWeight: 2, skillLevel: "BEGINNER", status: "WAITING", gamesPlayed: 0, queueEnteredAt: new Date(index).toISOString(), lastMatchEndedAt: null, manualPriority: 0 }));
  const result = suggestMatch(players, "OPEN", history);
  assert.ok(result);
  assert.equal(result.teamA.every((player) => player.gender === "FEMALE") || result.teamA.every((player) => player.gender === "MALE"), false);
  assert.equal(validateBalancedLineup(result.teamA, result.teamB, 0), null);
});

test("handicap strength variants require exact team totals and capped player spread", () => {
  const history: MatchHistory = { partners: new Map(), opponents: new Map(), quartets: new Map() };
  const make = (weights: number[]): MatchPlayer[] => weights.map((skillWeight, index) => ({ id: String.fromCharCode(97 + index), displayName: String(index), gender: "MALE", skillWeight, skillLevel: skillLevelForWeight(skillWeight), status: "WAITING", gamesPlayed: 0, queueEnteredAt: new Date(index).toISOString(), lastMatchEndedAt: null, manualPriority: 0 }));
  assert.equal(suggestMatch(make([1, 1, 3, 3]), "BALANCED", history), null);
  assert.equal(suggestMatch(make([1, 1, 1, 1]), "BALANCED", history, [], { strengthGap: 1 }), null);
  const plusOne = suggestMatch(make([1, 2, 2, 2]), "BALANCED", history, [], { strengthGap: 1 });
  assert.ok(plusOne);
  assert.equal(suggestMatch(make([1, 2, 2, 2]), "BALANCED", history, [], { strengthGap: 2 }), null);
  const plusTwo = suggestMatch(make([1, 3, 3, 3]), "BALANCED", history, [], { strengthGap: 2 });
  assert.ok(plusTwo);
  assert.equal(plusTwo.difference, 2);
  assert.equal(Math.max(...[...plusTwo.teamA, ...plusTwo.teamB].map((player) => player.skillWeight)) - Math.min(...[...plusTwo.teamA, ...plusTwo.teamB].map((player) => player.skillWeight)), 2);
  const plusThree = suggestMatch(make([2, 5, 5, 5]), "BALANCED", history, [], { strengthGap: 3 });
  assert.ok(plusThree);
  assert.equal(suggestMatch(make([1, 3, 3, 3]), "BALANCED", history, [], { strengthGap: 3 }), null);
  assert.equal(plusThree.difference, 3);
});

test("handicap validation enforces both the spread cap and exact team difference", () => {
  const make = (weights: number[]): MatchPlayer[] => weights.map((skillWeight, index) => ({ id: String.fromCharCode(97 + index), displayName: String(index), gender: "MALE", skillWeight, skillLevel: skillLevelForWeight(skillWeight), status: "WAITING", gamesPlayed: 0, queueEnteredAt: new Date(index).toISOString(), lastMatchEndedAt: null, manualPriority: 0 }));
  const exact = make([1, 1, 1, 2]);
  assert.equal(validateBalancedLineup(exact.slice(0, 2), exact.slice(2), 1), null);
  const equalTotals = make([1, 1, 3, 3]);
  assert.match(validateBalancedLineup([equalTotals[0]!, equalTotals[2]!], [equalTotals[1]!, equalTotals[3]!], 2) ?? "", /differ by exactly 2/);
  assert.match(validateBalancedLineup(equalTotals.slice(0, 2), equalTotals.slice(2), 1) ?? "", /spread of at most 1/);
});

test("handicap lineups keep the exact team total before partner rotation", () => {
  const recentPartners = new Map<string, Map<string, number>>([
    ["a", new Map([["d", 1]])],
    ["b", new Map([["c", 1]])],
  ]);
  const history: MatchHistory = { partners: new Map(), opponents: new Map(), quartets: new Map(), recentPartners };
  const players: MatchPlayer[] = [1, 2, 2, 3].map((skillWeight, index) => ({ id: String.fromCharCode(97 + index), displayName: String(index), gender: "MALE", skillWeight, skillLevel: skillLevelForWeight(skillWeight), status: "WAITING", gamesPlayed: 0, queueEnteredAt: new Date(index).toISOString(), lastMatchEndedAt: null, manualPriority: 0 }));
  const result = suggestMatch(players, "BALANCED", history, [], { strengthGap: 2 });
  assert.ok(result);
  assert.equal(result.difference, 2);
});

test("rest eligibility is enforced at the exact boundary", () => {
  const history: MatchHistory = { partners: new Map(), opponents: new Map(), quartets: new Map() };
  const now = new Date("2026-01-01T10:00:00.000Z");
  const players: MatchPlayer[] = ["a", "b", "c", "d"].map((id, index) => ({ id, displayName: id, gender: "MALE", skillWeight: 2, skillLevel: "BEGINNER", status: "WAITING", gamesPlayed: 0, queueEnteredAt: new Date(index).toISOString(), lastMatchEndedAt: id === "a" ? "2026-01-01T09:30:00.000Z" : null, manualPriority: 0 }));
  assert.equal(suggestMatch(players, "OPEN", history, [], { minimumRestMinutes: 30, now: new Date(now.getTime() - 1) }), null);
  assert.ok(suggestMatch(players, "OPEN", history, [], { minimumRestMinutes: 30, now }));
  assert.ok(suggestMatch(players, "OPEN", history, [], { minimumRestMinutes: 30, now: new Date(now.getTime() + 1) }));
  assert.ok(suggestMatch(players, "OPEN", history, [], { minimumRestMinutes: 0, now: new Date("2026-01-01T09:31:00.000Z") }));
});

test("balanced suggestions prioritize players skipped by the previous lineup", () => {
  const players: MatchPlayer[] = ["a", "b", "c", "d", "e", "f"].map((id, index) => ({ id, displayName: id, gender: "MALE", skillWeight: index < 3 ? 1 : 2, skillLevel: "BEGINNER", status: "WAITING", gamesPlayed: 0, queueEnteredAt: new Date(index).toISOString(), lastMatchEndedAt: null, manualPriority: 0 }));
  const history: MatchHistory = { partners: new Map(), opponents: new Map(), quartets: new Map() };
  const first = suggestMatch(players, "BALANCED", history);
  assert.ok(first);
  const firstIds = new Set([...first.teamA, ...first.teamB].map((player) => player.id));
  const skippedIds = players.filter((player) => !firstIds.has(player.id)).map((player) => player.id);

  const next = suggestMatch(players, "BALANCED", history, [first.key]);
  assert.ok(next);
  const nextIds = new Set([...next.teamA, ...next.teamB].map((player) => player.id));
  assert.equal(skippedIds.every((id) => nextIds.has(id)), true);
  assert.equal((next.explanation.fairness as { previouslySkippedCount: number }).previouslySkippedCount, skippedIds.length);
});

test("pending late penalties disable skipped-player priority for balanced suggestions", () => {
  const players: MatchPlayer[] = ["a", "b", "c", "d", "e", "f"].map((id, index) => ({ id, displayName: id, gender: "MALE", skillWeight: index < 3 ? 1 : 2, skillLevel: "BEGINNER", status: "WAITING", gamesPlayed: 0, queueEnteredAt: new Date(index).toISOString(), lastMatchEndedAt: null, manualPriority: 0, latePenaltyState: id === "f" ? "PENDING" : null }));
  const history: MatchHistory = { partners: new Map(), opponents: new Map(), quartets: new Map() };
  const result = suggestMatch(players, "BALANCED", history, ["a,b|c,d"]);
  assert.ok(result);
  assert.deepEqual([...result.teamA, ...result.teamB].map((player) => player.id).sort(), ["a", "b", "c", "d"]);
  assert.equal((result.explanation.fairness as { previouslySkippedCount: number }).previouslySkippedCount, 0);
});

test("prefers lineups with fewer pending late penalties without blocking a valid match", () => {
  const players: MatchPlayer[] = ["a", "b", "c", "d", "e"].map((id, index) => ({ id, displayName: id, gender: "MALE", skillWeight: 2, skillLevel: "BEGINNER", status: "WAITING", gamesPlayed: 0, queueEnteredAt: new Date(index).toISOString(), lastMatchEndedAt: null, manualPriority: 0, latePenaltyState: id === "e" ? "PENDING" : null }));
  const history: MatchHistory = { partners: new Map(), opponents: new Map(), quartets: new Map() };
  const preferred = suggestMatch(players, "OPEN", history);
  assert.ok(preferred);
  assert.equal([...preferred.teamA, ...preferred.teamB].some((player) => player.id === "e"), false);
  const required = suggestMatch(players.filter((player) => player.id !== "d"), "OPEN", history);
  assert.ok(required);
  assert.equal([...required.teamA, ...required.teamB].some((player) => player.id === "e"), true);
});

test("games-played fairness outranks pending late preference", () => {
  const players: MatchPlayer[] = ["a", "b", "c", "d"].map((id) => ({ id, displayName: id, gender: "MALE", skillWeight: 2, skillLevel: "BEGINNER", status: "WAITING", gamesPlayed: 1, queueEnteredAt: new Date(0).toISOString(), lastMatchEndedAt: null, manualPriority: 0 }));
  players.push({ ...players[0]!, id: "e", gamesPlayed: 0, latePenaltyState: "PENDING" });
  const history: MatchHistory = { partners: new Map(), opponents: new Map(), quartets: new Map() };
  const result = suggestMatch(players, "OPEN", history);
  assert.ok(result);
  assert.equal([...result.teamA, ...result.teamB].some((player) => player.id === "e"), true);
  assert.equal((result.explanation.fairness as { minimumGames: number }).minimumGames, 0);
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

test("qualifies only current top-three undefeated players after four matches", () => {
  const players: MatchPlayer[] = [
    { id: "a", displayName: "Alpha", gender: "MALE", skillWeight: 2, skillLevel: "NEWBIE", status: "WAITING", gamesPlayed: 3, wins: 3, losses: 0, manualPriority: 0, queueEnteredAt: new Date(0).toISOString(), lastMatchEndedAt: null },
    { id: "b", displayName: "Bravo", gender: "MALE", skillWeight: 2, skillLevel: "NEWBIE", status: "WAITING", gamesPlayed: 4, wins: 4, losses: 0, manualPriority: 0, queueEnteredAt: new Date(0).toISOString(), lastMatchEndedAt: null },
    { id: "c", displayName: "Charlie", gender: "MALE", skillWeight: 2, skillLevel: "NEWBIE", status: "WAITING", gamesPlayed: 4, wins: 3, losses: 1, manualPriority: 0, queueEnteredAt: new Date(0).toISOString(), lastMatchEndedAt: null },
    { id: "d", displayName: "Delta", gender: "MALE", skillWeight: 2, skillLevel: "NEWBIE", status: "WAITING", gamesPlayed: 4, wins: 4, losses: 0, manualPriority: 0, queueEnteredAt: new Date(0).toISOString(), lastMatchEndedAt: null },
    { id: "e", displayName: "Echo", gender: "MALE", skillWeight: 2, skillLevel: "NEWBIE", status: "WAITING", gamesPlayed: 4, wins: 4, losses: 0, manualPriority: 0, queueEnteredAt: new Date(0).toISOString(), lastMatchEndedAt: null },
  ];
  assert.deepEqual(undefeatedChallengePlayers(players).map(({ player, rank }) => [player.id, rank]), [["b", 1], ["d", 2], ["e", 3]]);
  assert.equal(undefeatedChallengePlayers(players.map((player) => player.id === "b" ? { ...player, losses: 1 } : player)).length, 2);
});

test("challenge mode anchors qualified players and keeps qualified opponents apart", () => {
  const players: MatchPlayer[] = ["a", "b", "c", "d", "e", "f"].map((id, index) => ({ id, displayName: id, gender: "MALE", skillWeight: index + 1, skillLevel: "BEGINNER", status: "WAITING", gamesPlayed: id <= "c" ? 4 : 0, wins: id <= "c" ? 4 : 0, losses: 0, manualPriority: 0, queueEnteredAt: new Date(index).toISOString(), lastMatchEndedAt: null }));
  const history: MatchHistory = { partners: new Map(), opponents: new Map(), quartets: new Map() };
  const result = suggestMatch(players, "UNDEFEATED_CHALLENGE", history);
  assert.ok(result);
  const selected = new Set((result.explanation.challenge as { selectedPlayerIds: string[] }).selectedPlayerIds);
  assert.equal(selected.size, 2);
  assert.equal(result.teamA.some((player) => selected.has(player.id)), true);
  assert.equal(result.teamB.some((player) => selected.has(player.id)), true);
});

test("single-qualifier challenge alternates keep the qualifier disadvantaged", () => {
  const make = (id: string, skillWeight: number, gamesPlayed: number): MatchPlayer => ({ id, displayName: id, gender: "MALE", skillWeight, skillLevel: "BEGINNER", status: "WAITING", gamesPlayed, wins: gamesPlayed, losses: 0, manualPriority: 0, queueEnteredAt: new Date(0).toISOString(), lastMatchEndedAt: null });
  const history: MatchHistory = { partners: new Map(), opponents: new Map(), quartets: new Map() };
  const challengeAdvantage = (result: NonNullable<ReturnType<typeof suggestMatch>>) => {
    const selectedId = ((result.explanation.challenge as { selectedPlayerIds: string[] }).selectedPlayerIds[0]);
    const qualifierOnA = result.teamA.some((player) => player.id === selectedId);
    return qualifierOnA ? result.teamBTotal - result.teamATotal : result.teamATotal - result.teamBTotal;
  };
  const players = [make("q", 5, 4), make("s1", 3, 0), make("s2", 6, 0), make("s3", 5, 0)];
  const first = suggestMatch(players, "UNDEFEATED_CHALLENGE", history);
  assert.ok(first);
  assert.ok(challengeAdvantage(first) > 0);
  assert.equal(suggestMatch(players, "UNDEFEATED_CHALLENGE", history, [first.key]), null);

  const playersWithAlternate = [...players, make("s4", 7, 0)];
  const alternateFirst = suggestMatch(playersWithAlternate, "UNDEFEATED_CHALLENGE", history);
  assert.ok(alternateFirst);
  const alternate = suggestMatch(playersWithAlternate, "UNDEFEATED_CHALLENGE", history, [alternateFirst.key]);
  assert.ok(alternate);
  assert.notEqual(alternate.key, alternateFirst.key);
  assert.ok(challengeAdvantage(alternate) > 0);
});

test("mixed doubles requires exactly two players per gender while open keeps lone-female policy", () => {
  const history: MatchHistory = { partners: new Map(), opponents: new Map(), quartets: new Map() };
  const make = (id: string, gender: "MALE" | "FEMALE", skillWeight: number): MatchPlayer => ({ id, displayName: id, gender, skillWeight, skillLevel: skillWeight >= 4 ? "INTERMEDIATE" : "BEGINNER", status: "WAITING", gamesPlayed: 0, queueEnteredAt: new Date(Number(id.replace(/\D/g, "")) || 0).toISOString(), lastMatchEndedAt: null, manualPriority: 0 });
  assert.equal(suggestMatch([make("f", "FEMALE", 4), make("m1", "MALE", 1), make("m2", "MALE", 2), make("m3", "MALE", 3)], "MIXED_DOUBLES", history), null);
  assert.equal(suggestMatch([make("f", "FEMALE", 6), make("m1", "MALE", 1), make("m2", "MALE", 2), make("m3", "MALE", 3)], "MIXED_DOUBLES", history), null);
  assert.equal(suggestMatch([make("u", "FEMALE", 3), make("m1", "MALE", 1), make("m2", "MALE", 2), make("m3", "MALE", 3)], "MIXED_DOUBLES", history), null);
  const standard = suggestMatch([make("f1", "FEMALE", 4), make("f2", "FEMALE", 4), make("m1", "MALE", 1), make("m2", "MALE", 2), make("m3", "MALE", 3)], "MIXED_DOUBLES", history);
  assert.ok(standard);
  assert.equal([...standard.teamA, ...standard.teamB].filter((player) => player.gender === "FEMALE").length, 2);
});

test("mixed doubles validator enforces one player of each gender per team", () => {
  const make = (id: string, gender: "MALE" | "FEMALE"): MatchPlayer => ({ id, displayName: id, gender, skillWeight: 1, skillLevel: "BEGINNER", status: "WAITING", gamesPlayed: 0, queueEnteredAt: new Date(0).toISOString(), lastMatchEndedAt: null, manualPriority: 0 });
  const players = [make("m1", "MALE"), make("m2", "MALE"), make("f1", "FEMALE"), make("f2", "FEMALE")];
  assert.equal(validateMixedDoublesLineup([players[0]!, players[2]!], [players[1]!, players[3]!]), null);
  assert.match(validateMixedDoublesLineup([players[0]!, players[1]!], [players[2]!, players[3]!]!) ?? "", /one male and one female/);
  assert.match(validateMixedDoublesLineup([players[0]!, players[1]!], [players[2]!, make("m3", "MALE")]!) ?? "", /exactly two male and two female/);
});

test("qualified lone female is prioritized in open mode after fairness constraints", () => {
  const history: MatchHistory = { partners: new Map(), opponents: new Map(), quartets: new Map() };
  const make = (id: string, gender: "MALE" | "FEMALE", skillWeight: number): MatchPlayer => ({ id, displayName: id, gender, skillWeight, skillLevel: skillWeight >= 4 ? "INTERMEDIATE" : "BEGINNER", status: "WAITING", gamesPlayed: 0, queueEnteredAt: new Date(0).toISOString(), lastMatchEndedAt: null, manualPriority: 0 });
  const result = suggestMatch([make("f", "FEMALE", 4), make("m1", "MALE", 1), make("m2", "MALE", 2), make("m3", "MALE", 3), make("m4", "MALE", 4)], "OPEN", history);
  assert.ok(result);
  assert.equal([...result.teamA, ...result.teamB].some((player) => player.id === "f"), true);
  const policy = result.explanation.loneFemalePolicy as { applied: boolean; mixedDoublesFallback: boolean };
  assert.equal(policy.applied, true);
  assert.equal(policy.mixedDoublesFallback, false);
});

test("bounds large queues deterministically with independent gender and skill pools", () => {
  const history: MatchHistory = { partners: new Map(), opponents: new Map(), quartets: new Map() };
  const make = (id: string, gender: "MALE" | "FEMALE", skillLevel: MatchPlayer["skillLevel"], skillWeight: number): MatchPlayer => ({ id, displayName: id, gender, skillWeight, skillLevel, status: "WAITING", gamesPlayed: 0, queueEnteredAt: new Date(Number(id.replace(/\D/g, "")) || 0).toISOString(), lastMatchEndedAt: null, manualPriority: 0 });
  const mixedPlayers = Array.from({ length: 100 }, (_, index) => make(`mixed-${index}`, index % 2 ? "FEMALE" : "MALE", "BEGINNER", 2));
  const mixed = suggestMatch(mixedPlayers, "MIXED_DOUBLES", history);
  const mixedAgain = suggestMatch(mixedPlayers, "MIXED_DOUBLES", history);
  assert.ok(mixed);
  assert.ok(mixedAgain);
  assert.equal(mixed.key, mixedAgain.key);
  assert.deepEqual(mixed.explanation.searchStats, { eligibleCount: 100, evaluatedCount: 40, bounded: true });
  assert.equal(validateMixedDoublesLineup(mixed.teamA, mixed.teamB), null);

  const genderRare = [...Array.from({ length: 4 }, (_, index) => make(`female-${index}`, "FEMALE", "BEGINNER", 2)), ...Array.from({ length: 76 }, (_, index) => make(`male-${index}`, "MALE", "BEGINNER", 2))];
  const sameGender = suggestMatch(genderRare, "SAME_GENDER", history);
  assert.ok(sameGender);
  assert.equal(new Set([...sameGender.teamA, ...sameGender.teamB].map((player) => player.gender)).size, 1);
  assert.equal((sameGender.explanation.searchStats as { evaluatedCount: number }).evaluatedCount, 44);

  const skillPools = [...Array.from({ length: 50 }, (_, index) => make(`beginner-${index}`, index % 2 ? "FEMALE" : "MALE", "BEGINNER", 2)), ...Array.from({ length: 50 }, (_, index) => make(`intermediate-${index}`, index % 2 ? "FEMALE" : "MALE", "INTERMEDIATE", 4))];
  const sameSkill = suggestMatch(skillPools, "SAME_SKILL", history);
  assert.ok(sameSkill);
  assert.equal(new Set([...sameSkill.teamA, ...sameSkill.teamB].map((player) => player.skillLevel)).size, 1);
  assert.equal((sameSkill.explanation.searchStats as { evaluatedCount: number }).evaluatedCount, 80);
});
