import assert from "node:assert/strict";
import test from "node:test";
import { operationIdForRevision } from "../../src/lib/offline/sync-operation.ts";

test("reuses an operation for an unchanged local revision and rotates after mutation", () => {
  let created = 1;
  const createId = () => `operation-${++created}`;
  assert.equal(operationIdForRevision("operation-1", 3, 3, createId), "operation-1");
  assert.equal(operationIdForRevision("operation-1", 3, 4, createId), "operation-2");
  assert.equal(created, 2);
});
