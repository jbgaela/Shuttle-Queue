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

test("players below five games stay in the numbered leaderboard", () => {
  const result = partitionRankingRows([row("Almost", 4), row("Qualified", 5)]);
  assert.deepEqual(result.ranked.map(({ player, rank }) => ({ player, rank })), [{ player: "Almost", rank: 1 }, { player: "Qualified", rank: 2 }]);
});

test("empty rankings produce empty sections", () => {
  assert.deepEqual(partitionRankingRows([]), { ranked: [], didNotPlay: [] });
});

test("public ranking includes every player who has played in the server-provided order", () => {
  const result = partitionPublicRankingRows([
    { ...publicRow("Qualified", 5, 3), rank: 1 },
    { ...publicRow("Two of four", 4, 2), rank: 2 },
    { ...publicRow("Perfect", 3, 3), rank: 3 },
    publicRow("No games", 0, 0),
  ]);
  assert.deepEqual(result.ranked.map(({ player, rank }) => ({ player, rank })), [
    { player: "Qualified", rank: 1 },
    { player: "Two of four", rank: 2 },
    { player: "Perfect", rank: 3 },
  ]);
  assert.deepEqual(result.didNotPlay.map(({ player }) => player), ["No games"]);
});

test("public ranking preserves server order for equal visible records", () => {
  const result = partitionPublicRankingRows([
    publicRow("alpha", 2, 1, "alpha-key"),
    publicRow("Bravo", 4, 2, "bravo-key"),
    publicRow("Alpha", 2, 1, "alpha-second-key"),
  ]);
  assert.deepEqual(result.ranked.map(({ player, rank }) => ({ player, rank })), [
    { player: "alpha", rank: 1 },
    { player: "Bravo", rank: 2 },
    { player: "Alpha", rank: 3 },
  ]);
});
