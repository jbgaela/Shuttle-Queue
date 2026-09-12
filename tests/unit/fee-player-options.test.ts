import assert from "node:assert/strict";
import test from "node:test";
import { filterFeePlayerOptions, sortFeePlayerOptions, type FeePlayerSearchOption } from "../../src/lib/fee-player-options.ts";

const option = (id: string, displayName: string): FeePlayerSearchOption => ({ id, displayName, outstandingMinor: 500 });

test("fee player sorting is alphabetical, deterministic, and non-mutating", () => {
  const source = [option("z", "zoe"), option("a", "Álex 10"), option("b", "Alex 2"), option("c", "Bea")];
  const sorted = sortFeePlayerOptions(source);
  assert.deepEqual(sorted.map((player) => player.id), ["b", "a", "c", "z"]);
  assert.deepEqual(source.map((player) => player.id), ["z", "a", "b", "c"]);
});

test("fee player search matches name fragments without case or accents", () => {
  const players = [option("1", "Émile Stone"), option("2", "Alexandra"), option("3", "Beatrice")];
  assert.deepEqual(filterFeePlayerOptions(players, "emile").map((player) => player.id), ["1"]);
  assert.deepEqual(filterFeePlayerOptions(players, "LEX").map((player) => player.id), ["2"]);
  assert.deepEqual(filterFeePlayerOptions(players, "").map((player) => player.id), ["1", "2", "3"]);
  assert.deepEqual(filterFeePlayerOptions(players, "nobody"), []);
});
