import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_QUEUE_SORT, sortQueuePlayers, waitAttention, waitMinutes, type QueueSort } from "../../src/lib/queue-sorting.ts";
import type { QueuePlayer } from "../../src/lib/api.ts";

const player = (id: string, overrides: Partial<QueuePlayer> = {}): QueuePlayer => ({
  id,
  displayName: id,
  gender: "MALE",
  skillLevel: "BEGINNER",
  skillWeight: 2,
  status: "WAITING",
  matchesPlayed: 0,
  wins: 0,
  losses: 0,
  latePenaltyState: null,
  queueEnteredAt: "2026-01-01T00:00:00.000Z",
  lastMatchEndedAt: null,
  currentMatchId: null,
  ...overrides,
});

const ids = (values: QueuePlayer[]) => values.map((value) => value.id);

test("queue sorting uses the requested direction and stable natural-name ties", () => {
  const players = [player("p10", { displayName: "Alice 10" }), player("p2", { displayName: "Alice 2" }), player("p1", { displayName: "Bob" }), player("missing", { displayName: "" })];
  assert.deepEqual(ids(sortQueuePlayers(players, { key: "PLAYER", direction: "asc" }, "2026-01-01T00:00:00Z", 0)), ["p2", "p10", "p1", "missing"]);
  assert.deepEqual(ids(sortQueuePlayers(players, { key: "PLAYER", direction: "desc" }, "2026-01-01T00:00:00Z", 0)), ["p1", "p10", "p2", "missing"]);
  assert.equal(ids(sortQueuePlayers(players, { key: "PLAYER", direction: "asc" }, "2026-01-01T00:00:00Z", 0)).at(-1), "missing");
  assert.deepEqual(DEFAULT_QUEUE_SORT, { key: "WAIT", direction: "desc" });
});

test("skill, games, and record sorting keep unknown values last", () => {
  const players = [
    player("advanced", { skillLevel: "ADVANCED", matchesPlayed: 2, wins: 3, losses: 2 }),
    player("newbie", { skillLevel: "NEWBIE", matchesPlayed: 5, wins: 3, losses: 1 }),
    player("unknown", { skillLevel: "UNKNOWN", matchesPlayed: Number.NaN, wins: Number.NaN, losses: Number.NaN }),
  ];
  assert.deepEqual(ids(sortQueuePlayers(players, { key: "SKILL", direction: "asc" }, "2026-01-01T00:00:00Z", 0)), ["newbie", "advanced", "unknown"]);
  assert.deepEqual(ids(sortQueuePlayers(players, { key: "GAMES", direction: "desc" }, "2026-01-01T00:00:00Z", 0)), ["newbie", "advanced", "unknown"]);
  assert.deepEqual(ids(sortQueuePlayers(players, { key: "RECORD", direction: "desc" }, "2026-01-01T00:00:00Z", 0)), ["newbie", "advanced", "unknown"]);
  assert.deepEqual(ids(sortQueuePlayers(players, { key: "RECORD", direction: "asc" }, "2026-01-01T00:00:00Z", 0)), ["advanced", "newbie", "unknown"]);
});

test("eligible wait excludes required rest and classifies exact thresholds", () => {
  const serverTime = "2026-01-01T00:30:00.000Z";
  const under = player("under", { queueEnteredAt: "2026-01-01T00:10:01.000Z" });
  const long = player("long", { queueEnteredAt: "2026-01-01T00:10:00.000Z" });
  const veryLong = player("very-long", { queueEnteredAt: "2026-01-01T00:00:00.000Z" });
  assert.equal(waitMinutes(under, serverTime, 0), 19);
  assert.equal(waitMinutes(long, serverTime, 0), 20);
  assert.equal(waitMinutes(veryLong, serverTime, 0), 30);
  assert.equal(waitAttention(19), null);
  assert.equal(waitAttention(20), "LONG");
  assert.equal(waitAttention(29), "LONG");
  assert.equal(waitAttention(30), "VERY_LONG");
  const resting = player("resting", { queueEnteredAt: "2026-01-01T00:00:00.000Z", lastMatchEndedAt: "2026-01-01T00:20:01.000Z" });
  assert.equal(waitMinutes(resting, serverTime, 15), 0);
  assert.equal(waitMinutes(player("playing", { status: "PLAYING" }), serverTime, 0), null);
  assert.equal(waitMinutes(player("invalid", { queueEnteredAt: "not-a-date" }), serverTime, 0), null);
  assert.equal(waitMinutes(player("invalid-rest", { lastMatchEndedAt: "not-a-date" }), serverTime, 0), null);
  assert.equal(waitMinutes(player("future", { queueEnteredAt: "2026-01-01T00:45:00.000Z" }), serverTime, 0), 0);
});

test("wait sorting uses exact eligible elapsed time before name tie-breaks", () => {
  const serverTime = "2026-01-01T01:00:00.000Z";
  const players = [player("short", { queueEnteredAt: "2026-01-01T00:45:00.000Z" }), player("long", { queueEnteredAt: "2026-01-01T00:10:00.000Z" })];
  const sort: QueueSort = { key: "WAIT", direction: "desc" };
  assert.deepEqual(ids(sortQueuePlayers(players, sort, serverTime, 0)), ["long", "short"]);
  assert.deepEqual(ids(sortQueuePlayers(players, { ...sort, direction: "asc" }, serverTime, 0)), ["short", "long"]);
});
