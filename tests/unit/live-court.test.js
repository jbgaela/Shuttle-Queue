import assert from "node:assert/strict";
import test from "node:test";
import { liveCourtStatusLabel, participantSkillLabel, playerGenderKind, playerGenderLabel } from "../../src/lib/live-court.ts";

test("live court chooses the male silhouette and accessible label", () => {
  assert.equal(playerGenderKind("MALE"), "MALE");
  assert.equal(playerGenderLabel("MALE"), "Male player");
});

test("live court chooses the female silhouette and keeps skill text separate", () => {
  assert.equal(playerGenderKind("FEMALE"), "FEMALE");
  assert.equal(playerGenderLabel("FEMALE"), "Female player");
  assert.equal(participantSkillLabel("UPPER_INTERMEDIATE"), "Upper Intermediate");
});

test("live court uses the neutral silhouette when gender is unavailable", () => {
  assert.equal(playerGenderKind(undefined), "NEUTRAL");
  assert.equal(playerGenderKind("UNKNOWN"), "NEUTRAL");
  assert.equal(playerGenderKind("UNDISCLOSED"), "NEUTRAL");
  assert.equal(playerGenderLabel(undefined), "Player");
  assert.equal(participantSkillLabel(undefined), "Skill unavailable");
});

test("occupied courts use the readable Playing status label", () => {
  assert.equal(liveCourtStatusLabel("OCCUPIED"), "Playing");
  assert.equal(liveCourtStatusLabel("AVAILABLE"), "Available");
});
