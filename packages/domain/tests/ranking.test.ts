import assert from "node:assert/strict";
import test from "node:test";
import { prizeRankingRows, wilsonLowerBound } from "../src/rankings.js";

const player = (id: string, matchesPlayed: number, wins: number, pointsFor = wins * 21, pointsAgainst = (matchesPlayed - wins) * 21) => ({ id, displayName: id, matchesPlayed, wins, losses: matchesPlayed - wins, pointsFor, pointsAgainst });

test("ranks players after their first game while preserving prize eligibility", () => {
  const rows = prizeRankingRows([player("four", 4, 4), player("five", 5, 3)], "2026-08-30T10:00:00.000Z");
  assert.equal(rows[0]?.id, "four");
  assert.equal(rows[0]?.rank, 1);
  assert.equal(rows[0]?.eligible, false);
  assert.equal(rows[0]?.gamesNeeded, 1);
  assert.notEqual(rows[0]?.rankingScoreBasisPoints, null);
  assert.equal(rows[0]?.isPrizePosition, false);
  assert.equal(rows[1]?.rank, 2);
  assert.equal(rows[1]?.eligible, true);
  assert.equal(rows[1]?.isPrizePosition, true);
});

test("prize positions count only eligible players in the live order", () => {
  const rows = prizeRankingRows([
    player("provisional", 1, 1),
    player("eligible-one", 5, 3),
    player("eligible-two", 5, 2),
    player("eligible-three", 5, 1),
    player("eligible-four", 5, 0),
    player("zero", 0, 0),
  ], "2026-08-30T10:00:00.000Z");
  assert.deepEqual(rows.filter((row) => row.rank !== null).map((row) => row.id), ["eligible-one", "provisional", "eligible-two", "eligible-three", "eligible-four"]);
  assert.deepEqual(rows.filter((row) => row.isPrizePosition).map((row) => row.id), ["eligible-one", "eligible-two", "eligible-three"]);
  assert.equal(rows[rows.length - 1]?.id, "zero");
  assert.equal(rows[rows.length - 1]?.rank, null);
  assert.equal(rows[rows.length - 1]?.rankingScoreBasisPoints, null);
});

test("confidence-adjusted score can prefer a larger strong sample", () => {
  const rows = prizeRankingRows([player("perfect-five", 5, 5), player("nine-one", 10, 9)], "2026-08-30T10:00:00.000Z");
  assert.equal(rows[0]?.id, "nine-one");
  assert.ok((rows[0]?.rankingScoreBasisPoints ?? 0) > (rows[1]?.rankingScoreBasisPoints ?? 0));
  assert.ok(wilsonLowerBound(9, 10) > wilsonLowerBound(5, 5));
});

test("seeded draw is stable for identical sporting results", () => {
  const input = [player("alpha", 5, 3, 63, 63), player("bravo", 5, 3, 63, 63)];
  const first = prizeRankingRows(input, "2026-08-30T10:00:00.000Z");
  const second = prizeRankingRows(input.slice().reverse(), "2026-08-30T10:00:00.000Z");
  assert.deepEqual(first.map((row) => row.id), second.map((row) => row.id));
  assert.equal(first.every((row) => row.seededDrawUsed), true);
});
