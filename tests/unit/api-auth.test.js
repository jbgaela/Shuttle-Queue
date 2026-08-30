import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, onAuthRequired, request } from "../../src/lib/api.ts";

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("preserves API authentication error details and notifies the auth boundary", async () => {
  let notified = 0;
  let requestedUrl = "";
  const unsubscribe = onAuthRequired(() => { notified += 1; });
  globalThis.fetch = async (input) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify({ error: { code: "AUTH_REQUIRED", message: "Authentication is required.", details: { reason: "missing-cookie" } }, requestId: "request-1" }), { status: 401, headers: { "content-type": "application/json" } });
  };

  await assert.rejects(() => request("/workspace"), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 401);
    assert.equal(error.code, "AUTH_REQUIRED");
    assert.equal(error.message, "Authentication is required.");
    assert.deepEqual(error.details, { reason: "missing-cookie" });
    assert.equal(error.requestId, "request-1");
    return true;
  });
  assert.equal(requestedUrl, "/api/v2/workspace");
  assert.equal(notified, 1);
  unsubscribe();
});

test("does not treat invalid login credentials as an expired app session", async () => {
  let notified = 0;
  const unsubscribe = onAuthRequired(() => { notified += 1; });
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: "AUTH_REQUIRED", message: "Invalid username or password." } }), { status: 401, headers: { "content-type": "application/json" } });

  await assert.rejects(() => request("/auth/login", { method: "POST", body: "{}" }), ApiError);
  assert.equal(notified, 0);
  unsubscribe();
});
