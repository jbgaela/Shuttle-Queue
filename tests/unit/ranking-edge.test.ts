import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import test, { type TestContext } from "node:test";
import rankingVisitor from "../../netlify/edge-functions/ranking-visitor.ts";

const secret = "test-edge-secret-with-at-least-32-characters";
const visitor = {
  ip: "2001:db8::1",
  requestId: "edge-request-id",
  geo: {
    city: "Manila",
    country: { name: "Philippines" },
    subdivision: { name: "Metro Manila" },
  },
};

function installEnvironment(
  context: TestContext,
  initial: Record<string, string | undefined>,
) {
  let environment = initial;
  const globals = globalThis as typeof globalThis & { Netlify?: unknown };
  const previous = globals.Netlify;
  globals.Netlify = {
    env: { get: (name: string) => environment[name] },
  };
  context.after(() => {
    globals.Netlify = previous;
  });
  return (next: Record<string, string | undefined>) => {
    environment = next;
  };
}

test("configuration failures are bounded, identified, and never forwarded", async (context) => {
  const setEnvironment = installEnvironment(context, {});
  const logMessages: string[] = [];
  context.mock.method(console, "error", (message: string) => {
    logMessages.push(message);
  });
  let upstreamCalls = 0;
  context.mock.method(globalThis, "fetch", async () => {
    upstreamCalls += 1;
    return Response.json({});
  });

  const cases = [
    {
      name: "missing secret",
      reason: "missing_secret",
      environment: { BACKEND_API_BASE_URL: "https://api.example.test/api/v2" },
    },
    {
      name: "short secret",
      reason: "short_secret",
      environment: {
        PUBLIC_RANKING_EDGE_SECRET: "too-short",
        BACKEND_API_BASE_URL: "https://api.example.test/api/v2",
      },
    },
    {
      name: "missing backend URL",
      reason: "missing_backend_url",
      environment: { PUBLIC_RANKING_EDGE_SECRET: secret },
    },
    ...[
      "not a URL",
      "http://api.example.test/api/v2",
      "https://user:password@api.example.test/api/v2",
      "https://api.example.test/api/v2?unsafe=true",
      "https://api.example.test/api/v2#fragment",
      "https://api.example.test/api",
    ].map((backendUrl) => ({
      name: `invalid backend URL ${backendUrl}`,
      reason: "invalid_backend_url",
      environment: {
        PUBLIC_RANKING_EDGE_SECRET: secret,
        BACKEND_API_BASE_URL: backendUrl,
      },
    })),
  ];

  for (const testCase of cases) {
    setEnvironment(testCase.environment);
    const response = await rankingVisitor(
      new Request(
        "https://site.example.test/api/v2/public/rankings/token/visits",
        { method: "POST", body: "{}" },
      ),
      visitor,
    );
    assert.equal(response.status, 503, testCase.name);
    assert.deepEqual(await response.json(), {
      error: {
        code: "EDGE_CONFIGURATION_ERROR",
        message:
          "Shared rankings are temporarily unavailable. Please try again later.",
      },
      requestId: visitor.requestId,
    });
    assert.match(logMessages.at(-1) ?? "", new RegExp(testCase.reason));
  }

  assert.equal(upstreamCalls, 0);
});

test("valid configuration forwards signed context and strips untrusted headers", async (context) => {
  installEnvironment(context, {
    PUBLIC_RANKING_EDGE_SECRET: secret,
    BACKEND_API_BASE_URL: "https://api.example.test/api/v2/",
  });
  const body = JSON.stringify({ status: "DENIED" });
  let upstreamCalls = 0;
  context.mock.method(
    globalThis,
    "fetch",
    async (url: URL, init: RequestInit) => {
      upstreamCalls += 1;
      assert.equal(
        url.href,
        "https://api.example.test/api/v2/public/rankings/token/visits/location",
      );
      const headers = new Headers(init.headers);
      assert.equal(headers.get("cookie"), null);
      assert.equal(headers.get("authorization"), null);
      assert.equal(headers.get("x-forwarded-for"), null);
      assert.equal(headers.get("x-ranking-visit-key"), "a".repeat(64));
      const metadata = headers.get("x-ranking-edge-metadata")!;
      const decoded = JSON.parse(
        Buffer.from(metadata, "base64url").toString(),
      );
      assert.equal(decoded.ip, visitor.ip);
      assert.equal(decoded.city, "Manila");
      assert.equal(decoded.userAgent, "Test Browser");
      const digest = createHash("sha256").update(body).digest("hex");
      const expected = createHmac("sha256", secret)
        .update(["PATCH", url.pathname, digest, metadata].join("\n"))
        .digest("hex");
      assert.equal(headers.get("x-ranking-edge-signature"), expected);
      return Response.json(
        { data: {} },
        {
          headers: {
            "set-cookie": "unwanted=value",
            ratelimit: "remaining=3",
          },
        },
      );
    },
  );

  const response = await rankingVisitor(
    new Request(
      "https://site.example.test/api/v2/public/rankings/token/visits/location",
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          cookie: "session=secret",
          authorization: "Bearer forged",
          "user-agent": "Test Browser",
          "x-ranking-edge-metadata": "forged",
          "x-forwarded-for": "127.0.0.1",
          "x-ranking-visit-key": "a".repeat(64),
        },
        body,
      },
    ),
    visitor,
  );

  assert.equal(upstreamCalls, 1);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("ratelimit"), "remaining=3");

  const oversized = await rankingVisitor(
    new Request(
      "https://site.example.test/api/v2/public/rankings/token/visits",
      { method: "POST", body: "x".repeat(4097) },
    ),
    visitor,
  );
  assert.equal(oversized.status, 413);
  assert.equal(upstreamCalls, 1);
});

test("upstream connection failures return a retryable identified error", async (context) => {
  installEnvironment(context, {
    PUBLIC_RANKING_EDGE_SECRET: secret,
    BACKEND_API_BASE_URL: "https://api.example.test/api/v2",
  });
  context.mock.method(console, "error", () => {});
  context.mock.method(globalThis, "fetch", async () => {
    throw new TypeError("connection failed");
  });

  const response = await rankingVisitor(
    new Request(
      "https://site.example.test/api/v2/public/rankings/token/visits",
      { method: "POST", body: "{}" },
    ),
    visitor,
  );

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: {
      code: "UPSTREAM_UNAVAILABLE",
      message: "Unable to connect to shared rankings. Please try again.",
    },
    requestId: visitor.requestId,
  });
});

test("upstream statuses and error envelopes pass through unchanged", async (context) => {
  installEnvironment(context, {
    PUBLIC_RANKING_EDGE_SECRET: secret,
    BACKEND_API_BASE_URL: "https://api.example.test/api/v2",
  });
  const upstreamPayload = {
    error: {
      code: "PUBLIC_RANKINGS_DISABLED",
      message: "Public rankings are disabled.",
    },
    requestId: "render-request-id",
  };
  context.mock.method(globalThis, "fetch", async () =>
    Response.json(upstreamPayload, { status: 403 }),
  );

  const response = await rankingVisitor(
    new Request(
      "https://site.example.test/api/v2/public/rankings/token/visits",
      { method: "POST", body: "{}" },
    ),
    visitor,
  );

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), upstreamPayload);
});
