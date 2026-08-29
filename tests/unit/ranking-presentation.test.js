import assert from "node:assert/strict";
import test from "node:test";
import { partitionPublicRankingRows, partitionRankingRows } from "../../src/lib/ranking-presentation.ts";

const row = (player, matchesPlayed, rank = 99) => ({ rank, player, matchesPlayed });
const publicRow = (player, matchesPlayed, wins, playerKey = player) => ({ rank: null, player, playerKey, matchesPlayed, wins });

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

test("public ranking includes every player who has played and sorts by visible win rate", () => {
  const result = partitionPublicRankingRows([
    publicRow("Two of four", 4, 2),
    publicRow("Perfect", 3, 3),
    publicRow("Qualified", 5, 3),
    publicRow("No games", 0, 0),
  ]);
  assert.deepEqual(result.ranked.map(({ player, rank }) => ({ player, rank })), [
    { player: "Perfect", rank: 1 },
    { player: "Qualified", rank: 2 },
    { player: "Two of four", rank: 3 },
  ]);
  assert.deepEqual(result.didNotPlay.map(({ player }) => player), ["No games"]);
});

test("public ranking uses more games and then stable identity to break ties", () => {
  const result = partitionPublicRankingRows([
    publicRow("alpha", 2, 1, "alpha-key"),
    publicRow("Bravo", 4, 2, "bravo-key"),
    publicRow("Alpha", 2, 1, "alpha-second-key"),
  ]);
  assert.deepEqual(result.ranked.map(({ player, rank }) => ({ player, rank })), [
    { player: "Bravo", rank: 1 },
    { player: "alpha", rank: 2 },
    { player: "Alpha", rank: 3 },
  ]);
});
