import assert from "node:assert/strict";
import test from "node:test";
import { partitionRankingRows } from "../../src/lib/ranking-presentation.ts";

const row = (player, matchesPlayed, rank = 99) => ({ rank, player, matchesPlayed });

test("ranking presentation gives contiguous ranks to players who played", () => {
  const result = partitionRankingRows([
    row("Zero", 0, 3),
    row("Winner", 5, 1),
    row("Runner", 5, 2),
  ]);
  assert.deepEqual(result.ranked.map(({ player, rank }) => ({ player, rank })), [
    { player: "Winner", rank: 1 },
    { player: "Runner", rank: 2 },
  ]);
  assert.deepEqual(result.didNotPlay.map(({ player }) => player), ["Zero"]);
  assert.deepEqual(result.notYetEligible, []);
});

test("zero-game players are sorted alphabetically and retain no ranking", () => {
  const result = partitionRankingRows([
    row("zoe", 0, 2),
    row("Alice", 0, 1),
    row("bob", 0, 3),
  ]);
  assert.deepEqual(result.ranked, []);
  assert.deepEqual(result.didNotPlay.map(({ player }) => player), ["Alice", "bob", "zoe"]);
});

test("players below five games stay in the not-yet-eligible section", () => {
  const result = partitionRankingRows([row("Almost", 4), row("Qualified", 5)]);
  assert.deepEqual(result.ranked.map(({ player, rank }) => ({ player, rank })), [{ player: "Qualified", rank: 1 }]);
  assert.deepEqual(result.notYetEligible.map(({ player, matchesPlayed }) => ({ player, matchesPlayed })), [{ player: "Almost", matchesPlayed: 4 }]);
});

test("empty rankings produce empty sections", () => {
  assert.deepEqual(partitionRankingRows([]), { ranked: [], notYetEligible: [], didNotPlay: [] });
});
