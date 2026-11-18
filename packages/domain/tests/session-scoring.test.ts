import test from "node:test";
import assert from "node:assert/strict";
import {
  scoringState,
  sessionScoring,
  validateScoringTarget,
  validateScores,
} from "../src/index.js";

test("session targets derive a single capped game and reject invalid values", () => {
  const defaults = { pointsToWin: 31, winBy: 1, scoreCap: null, bestOf: 1 as const };
  for (const target of [1, 15, 21, 31, 47, 99]) {
    assert.equal(validateScoringTarget(target), target);
    assert.deepEqual(sessionScoring(target, defaults), {
      pointsToWin: target,
      winBy: 1,
      scoreCap: target,
      bestOf: 1,
    });
  }
  for (const invalid of [0, 100, -1, 1.5, NaN, "21", null, undefined])
    assert.throws(() => validateScoringTarget(invalid));
  assert.deepEqual(sessionScoring(null, defaults), defaults);
});

test("only empty active unconfigured sessions require setup; any match locks scoring", () => {
  assert.equal(scoringState(null, 0).scoringSetupRequired, true);
  assert.equal(scoringState(21, 0).scoringLocked, false);
  assert.deepEqual(scoringState(undefined, 1), {
    scoringTarget: null,
    scoringSetupRequired: false,
    scoringLocked: true,
  });
  assert.equal(scoringState(null, 0, true).scoringSetupRequired, false);
});

test("race to 21 accepts either winner at the target and rejects unfinished or excessive scores", () => {
  const rules = { pointsToWin: 21, winBy: 1, scoreCap: 21, bestOf: 1 as const };
  for (const [teamAScore, teamBScore] of [
    [21, 0],
    [21, 20],
    [0, 21],
    [20, 21],
  ])
    assert.equal(
      validateScores([{ teamAScore: teamAScore!, teamBScore: teamBScore! }], rules).length,
      1,
    );
  for (const [teamAScore, teamBScore] of [
    [21, 21],
    [20, 19],
    [22, 20],
    [-1, 21],
    [21, 1.5],
  ])
    assert.throws(() =>
      validateScores([{ teamAScore: teamAScore!, teamBScore: teamBScore! }], rules),
    );
});
