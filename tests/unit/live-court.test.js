import assert from "node:assert/strict";
import test from "node:test";
import { liveCourtStatusLabel, participantMetadata, playerInitials } from "../../src/lib/live-court.ts";

test("live court initials handle one-word, multi-word, and missing names", () => {
  assert.equal(playerInitials("King"), "K");
  assert.equal(playerInitials("King Arthur"), "KA");
  assert.equal(playerInitials(""), "P");
});

test("live court metadata formats gender and skill with safe fallbacks", () => {
  assert.equal(participantMetadata("MALE", "UPPER_BEGINNER"), "Male · Upper Beginner");
  assert.equal(participantMetadata(undefined, undefined), "Gender unavailable · Skill unavailable");
});

test("occupied courts use the readable Playing status label", () => {
  assert.equal(liveCourtStatusLabel("OCCUPIED"), "Playing");
  assert.equal(liveCourtStatusLabel("AVAILABLE"), "Available");
});
