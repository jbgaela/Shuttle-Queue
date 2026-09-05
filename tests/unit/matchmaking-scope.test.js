import assert from "node:assert/strict";
import test from "node:test";
import { isQueuePlayerReady, matchmakingWaitingFingerprint, queuePlayerReadiness } from "../../src/lib/matchmaking-scope.ts";

const player = (overrides = {}) => ({
  id: "p1",
  status: "WAITING",
  gender: "MALE",
  skillLevel: "INTERMEDIATE",
  matchesPlayed: 2,
  wins: 1,
  losses: 1,
  manualPriority: 0,
  queueEnteredAt: "2026-08-30T10:00:00.000Z",
  lastMatchEndedAt: null,
  latePenaltyState: null,
  latePenaltyAppliedAt: null,
  restEligibleAt: "2026-08-30T10:00:00.000Z",
  ...overrides,
});

test("ready-player timestamps do not invalidate a suggestion during polling", () => {
  const first = { serverTime: "2026-08-30T10:00:00.000Z", lateArrivalCutoffAt: null, waiting: [player({ restEligibleAt: "2026-08-30T10:00:00.000Z" })] };
  const second = { serverTime: "2026-08-30T10:00:08.000Z", lateArrivalCutoffAt: null, waiting: [player({ restEligibleAt: "2026-08-30T10:00:08.000Z" })] };
  assert.equal(matchmakingWaitingFingerprint(first), matchmakingWaitingFingerprint(second));
  assert.equal(isQueuePlayerReady(second.waiting[0], second.serverTime), true);
});

test("a millisecond rest timestamp drift cannot invalidate a no-rest suggestion", () => {
  const first = { serverTime: "2026-08-30T10:00:00.000Z", minimumRestMinutes: 0, lateArrivalCutoffAt: null, waiting: [player({ lastMatchEndedAt: null, restEligibleAt: "2026-08-30T10:00:00.001Z" })] };
  const second = { serverTime: "2026-08-30T10:00:08.000Z", minimumRestMinutes: 0, lateArrivalCutoffAt: null, waiting: [player({ lastMatchEndedAt: null, restEligibleAt: "2026-08-30T10:00:08.001Z" })] };
  assert.equal(queuePlayerReadiness(first.waiting[0], first.serverTime, first.minimumRestMinutes), "READY");
  assert.equal(matchmakingWaitingFingerprint(first), matchmakingWaitingFingerprint(second));
});

test("future rest deadlines stay stable until the player becomes ready", () => {
  const deadline = "2026-08-30T10:15:00.000Z";
  const before = { serverTime: "2026-08-30T10:00:08.000Z", minimumRestMinutes: 15, lateArrivalCutoffAt: null, waiting: [player({ lastMatchEndedAt: "2026-08-30T10:00:00.000Z", restEligibleAt: deadline })] };
  const later = { serverTime: "2026-08-30T10:10:00.000Z", minimumRestMinutes: 15, lateArrivalCutoffAt: null, waiting: [player({ lastMatchEndedAt: "2026-08-30T10:00:00.000Z", restEligibleAt: deadline })] };
  const after = { serverTime: "2026-08-30T10:15:00.000Z", minimumRestMinutes: 15, lateArrivalCutoffAt: null, waiting: [player({ lastMatchEndedAt: "2026-08-30T10:00:00.000Z", restEligibleAt: deadline })] };
  assert.equal(queuePlayerReadiness(before.waiting[0], before.serverTime, before.minimumRestMinutes), `RESTING:${deadline}`);
  assert.equal(matchmakingWaitingFingerprint(before), matchmakingWaitingFingerprint(later));
  assert.notEqual(matchmakingWaitingFingerprint(later), matchmakingWaitingFingerprint(after));
  assert.equal(isQueuePlayerReady(after.waiting[0], after.serverTime, after.minimumRestMinutes), true);
});

test("stored last-match time produces a stable rest deadline and transitions to ready", () => {
  const waiting = player({ lastMatchEndedAt: "2026-08-30T10:00:00.000Z", restEligibleAt: "2026-08-30T10:15:00.000Z" });
  const before = { serverTime: "2026-08-30T10:10:00.000Z", minimumRestMinutes: 15, lateArrivalCutoffAt: null, waiting: [waiting] };
  const after = { ...before, serverTime: "2026-08-30T10:15:00.000Z" };
  assert.equal(queuePlayerReadiness(waiting, before.serverTime, 15), "RESTING:2026-08-30T10:15:00.000Z");
  assert.equal(queuePlayerReadiness(waiting, after.serverTime, 15), "READY");
  assert.notEqual(matchmakingWaitingFingerprint(before), matchmakingWaitingFingerprint(after));
});

test("matchmaking-relevant player changes invalidate the scope", () => {
  const queue = { serverTime: "2026-08-30T10:00:00.000Z", lateArrivalCutoffAt: null, waiting: [player()] };
  assert.notEqual(matchmakingWaitingFingerprint(queue), matchmakingWaitingFingerprint({ ...queue, waiting: [player({ wins: 2 })] }));
  assert.notEqual(matchmakingWaitingFingerprint(queue), matchmakingWaitingFingerprint({ ...queue, waiting: [player({ latePenaltyState: "PENDING" })] }));
});
