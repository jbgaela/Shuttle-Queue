import assert from "node:assert/strict";
import test from "node:test";
import { prizeRankingRows, wilsonLowerBound } from "../src/rankings.js";

const player = (id: string, matchesPlayed: number, wins: number, pointsFor = wins * 21, pointsAgainst = (matchesPlayed - wins) * 21) => ({ id, displayName: id, matchesPlayed, wins, losses: matchesPlayed - wins, pointsFor, pointsAgainst });

for (const eligibleCount of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12]) {
  test(`reserves the top ten with ${eligibleCount} eligible players`, () => {
    const eligible = Array.from({ length: eligibleCount }, (_, index) => player(`eligible-${index}`, 5, 0));
    const rows = prizeRankingRows([
      player("provisional", 4, 4),
      player("zoe", 0, 0),
      ...eligible,
      player("Alice", 0, 0),
    ], "2026-08-30T10:00:00.000Z");
    assert.equal(rows.length, eligibleCount + 3);
    assert.deepEqual(rows.slice(0, eligibleCount).map((row) => row.rank), Array.from({ length: eligibleCount }, (_, index) => index + 1));
    const provisional = rows[eligibleCount]!;
    assert.equal(provisional.id, "provisional");
    assert.equal(provisional.rank, eligibleCount <= 10 ? 11 : 13);
    assert.equal(provisional.eligible, false);
    assert.equal(provisional.isPrizePosition, false);
    assert.equal(rows.filter((row) => row.isPrizePosition).length, Math.min(3, eligibleCount));
    assert.deepEqual(rows.slice(-2).map(({ id, rank }) => ({ id, rank })), [{ id: "Alice", rank: null }, { id: "zoe", rank: null }]);
  });
}

test("performance and seeded draws stay deterministic within each eligibility cohort", () => {
  const input = [
    player("provisional-alpha", 4, 4),
    player("eligible-alpha", 5, 1),
    player("provisional-bravo", 4, 4),
    player("eligible-bravo", 5, 1),
    player("provisional-lower", 4, 0),
    player("eligible-lower", 5, 0),
  ];
  const first = prizeRankingRows(input, "2026-08-30T10:00:00.000Z");
  assert.deepEqual(first, prizeRankingRows(input.slice().reverse(), "2026-08-30T10:00:00.000Z"));
  assert.deepEqual(first.map((row) => row.rank), [1, 2, 3, 11, 12, 13]);
  assert.deepEqual(first.map((row) => row.seededDrawUsed), [true, true, false, true, true, false]);
  assert.equal(first[2]?.id, "eligible-lower");
  assert.equal(first[5]?.id, "provisional-lower");
});


test("puts prize-eligible players ahead of provisional players", () => {
  const rows = prizeRankingRows([player("four", 4, 4), player("five", 5, 3)], "2026-08-30T10:00:00.000Z");
  assert.equal(rows[0]?.id, "five");
  assert.equal(rows[0]?.rank, 1);
  assert.equal(rows[0]?.eligible, true);
  assert.equal(rows[0]?.isPrizePosition, true);
  assert.equal(rows[1]?.id, "four");
  assert.equal(rows[1]?.rank, 11);
  assert.equal(rows[1]?.eligible, false);
  assert.equal(rows[1]?.gamesNeeded, 1);
  assert.notEqual(rows[1]?.rankingScoreBasisPoints, null);
  assert.equal(rows[1]?.isPrizePosition, false);
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
  assert.deepEqual(rows.filter((row) => row.rank !== null).map((row) => row.id), ["eligible-one", "eligible-two", "eligible-three", "eligible-four", "provisional"]);
  assert.deepEqual(rows.filter((row) => row.rank !== null).map((row) => row.rank), [1, 2, 3, 4, 11]);
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

test("reserves the top ten ranks when only one player is eligible", () => {
  const rows = prizeRankingRows([
    player("provisional-one", 4, 4),
    player("provisional-two", 2, 2),
    player("eligible", 5, 1),
  ], "2026-08-30T10:00:00.000Z");
  assert.deepEqual(rows.filter((row) => row.rank !== null).map((row) => ({ id: row.id, rank: row.rank, eligible: row.eligible })), [
    { id: "eligible", rank: 1, eligible: true },
    { id: "provisional-one", rank: 11, eligible: false },
    { id: "provisional-two", rank: 12, eligible: false },
  ]);
  assert.equal(rows.filter((row) => row.isPrizePosition).length, 1);
});

test("starts provisional ranks at eleven when no players are eligible", () => {
  const rows = prizeRankingRows([player("provisional-one", 4, 4), player("provisional-two", 2, 2)], "2026-08-30T10:00:00.000Z");
  assert.deepEqual(rows.filter((row) => row.rank !== null).map((row) => row.rank), [11, 12]);
  assert.equal(rows.some((row) => row.isPrizePosition), false);
});

test("reserves unused top ten ranks when exactly two players are eligible", () => {
  const rows = prizeRankingRows([
    player("provisional", 4, 4),
    player("eligible-one", 5, 3),
    player("eligible-two", 5, 2),
  ], "2026-08-30T10:00:00.000Z");
  assert.deepEqual(rows.filter((row) => row.rank !== null).map((row) => row.rank), [1, 2, 11]);
  assert.equal(rows.filter((row) => row.isPrizePosition).length, 2);
});
