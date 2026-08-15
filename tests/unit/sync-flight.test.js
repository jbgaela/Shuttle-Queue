import assert from "node:assert/strict";
import test from "node:test";
import { singleFlightByKey } from "../../src/lib/offline/sync-flight.ts";

test("coalesces concurrent sync uploads per account and releases the flight", async () => {
  const flights = new Map();
  let calls = 0;
  let resolveTask;
  const task = () => { calls += 1; return new Promise((resolve) => { resolveTask = resolve; }); };
  const first = singleFlightByKey(flights, "account-1", task);
  const second = singleFlightByKey(flights, "account-1", task);
  assert.strictEqual(first, second);
  assert.equal(calls, 1);
  resolveTask("uploaded");
  assert.equal(await first, "uploaded");
  await Promise.resolve();
  const third = singleFlightByKey(flights, "account-1", async () => "next");
  assert.equal(await third, "next");
  assert.equal(calls, 1);
});
