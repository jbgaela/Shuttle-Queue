import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { ApiError, onAuthRequired, request } from "../../src/lib/api.ts";

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("preserves API authentication error details and notifies the auth boundary", async () => {
  let notified = 0;
  let requestedUrl = "";
  const unsubscribe = onAuthRequired(() => {
    notified += 1;
  });
  globalThis.fetch = async (input) => {
    requestedUrl = String(input);
    return new Response(
      JSON.stringify({
        error: {
          code: "AUTH_REQUIRED",
          message: "Authentication is required.",
          details: { reason: "missing-cookie" },
        },
        requestId: "request-1",
      }),
      { status: 401, headers: { "content-type": "application/json" } },
    );
  };

  await assert.rejects(
    () => request("/workspace"),
    (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 401);
      assert.equal(error.code, "AUTH_REQUIRED");
      assert.equal(error.message, "Authentication is required.");
      assert.deepEqual(error.details, { reason: "missing-cookie" });
      assert.equal(error.requestId, "request-1");
      return true;
    },
  );
  assert.equal(requestedUrl, "/api/v2/workspace");
  assert.equal(notified, 1);
  unsubscribe();
});

test("does not treat invalid login credentials as an expired app session", async () => {
  let notified = 0;
  const unsubscribe = onAuthRequired(() => {
    notified += 1;
  });
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        error: { code: "AUTH_REQUIRED", message: "Invalid username or password." },
      }),
      { status: 401, headers: { "content-type": "application/json" } },
    );

  await assert.rejects(() => request("/auth/login", { method: "POST", body: "{}" }), ApiError);
  assert.equal(notified, 0);
  unsubscribe();
});

test("aborts an unresponsive authenticated request at its deadline", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  let requestSignal;
  globalThis.fetch = async (_input, init) =>
    new Promise((_resolve, reject) => {
      requestSignal = init?.signal;
      requestSignal?.addEventListener(
        "abort",
        () => {
          const error = new Error("Request was aborted.");
          error.name = "AbortError";
          reject(error);
        },
        { once: true },
      );
    });

  try {
    const pending = request("/workspace");
    await Promise.resolve();
    await mock.timers.tick(15_000);
    await assert.rejects(pending, (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 503);
      assert.equal(error.code, "REQUEST_TIMEOUT");
      assert.match(error.message, /local work is saved/);
      return true;
    });
    assert.equal(requestSignal?.aborted, true);
  } finally {
    mock.timers.reset();
  }
});

test("gives the sync API a 60-second network deadline", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  let requestSignal;
  globalThis.fetch = async (_input, init) =>
    new Promise((_resolve, reject) => {
      requestSignal = init?.signal;
      requestSignal?.addEventListener(
        "abort",
        () => {
          const error = new Error("Request was aborted.");
          error.name = "AbortError";
          reject(error);
        },
        { once: true },
      );
    });

  try {
    const pending = request("/sync/snapshot");
    await Promise.resolve();
    await mock.timers.tick(59_999);
    assert.equal(requestSignal?.aborted, false);
    await mock.timers.tick(1);
    await assert.rejects(pending, (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 503);
      assert.equal(error.code, "REQUEST_TIMEOUT");
      return true;
    });
    assert.equal(requestSignal?.aborted, true);
  } finally {
    mock.timers.reset();
  }
});

test("preserves caller cancellation on an authenticated request", async () => {
  let requestSignal;
  globalThis.fetch = async (_input, init) =>
    new Promise((_resolve, reject) => {
      requestSignal = init?.signal;
      requestSignal?.addEventListener(
        "abort",
        () => reject(new DOMException("Caller cancelled request.", "AbortError")),
        { once: true },
      );
    });
  const controller = new AbortController();
  const pending = request("/workspace", { signal: controller.signal });
  await Promise.resolve();
  controller.abort();
  await assert.rejects(pending, (error) => error.name === "AbortError");
  assert.equal(requestSignal?.aborted, true);
});
