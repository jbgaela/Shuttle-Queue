import type { ScoreSettings } from "./index.js";

export function validateScoringTarget(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 99)
    throw new Error("Choose a whole-number target from 1 to 99.");
  return value;
}

export function sessionScoring(
  target: number | null | undefined,
  defaults: ScoreSettings,
): ScoreSettings {
  return target == null
    ? defaults
    : {
        pointsToWin: validateScoringTarget(target),
        winBy: 1,
        scoreCap: target,
        bestOf: 1,
      };
}

export function scoringState(target: number | null | undefined, matchCount: number, ended = false) {
  return {
    scoringTarget: target ?? null,
    scoringSetupRequired: !ended && target == null && matchCount === 0,
    scoringLocked: ended || matchCount > 0,
  };
}
