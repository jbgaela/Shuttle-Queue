import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import test from "node:test";
import rankingVisitor from "../../netlify/edge-functions/ranking-visitor.ts";

test("Netlify forwards signed context and strips client credentials and forged metadata", async (context) => {
  const secret = "test-edge-secret-with-at-least-32-characters";
  const env = { PUBLIC_RANKING_EDGE_SECRET: secret, BACKEND_API_BASE_URL: "https://api.example.test/api/v2" };
  const globals = globalThis as typeof globalThis & { Netlify?: unknown };
  const previous = globals.Netlify;
  globals.Netlify = { env: { get: (name: keyof typeof env) => env[name] } };
  context.after(() => { globals.Netlify = previous; });
  const visitor = { ip: "2001:db8::1", requestId: "edge-id", geo: { city: "Manila", country: { name: "Philippines" }, subdivision: { name: "Metro Manila" } } };
  const body = JSON.stringify({ status: "DENIED" });
  let upstreamCalls = 0;
  context.mock.method(globalThis, "fetch", async (url: URL, init: RequestInit) => {
    upstreamCalls += 1;
    assert.equal(url.href, "https://api.example.test/api/v2/public/rankings/token/visits/location");
    const headers = new Headers(init.headers);
    assert.equal(headers.get("cookie"), null); assert.equal(headers.get("authorization"), null); assert.equal(headers.get("x-forwarded-for"), null);
    assert.equal(headers.get("x-ranking-visit-key"), "a".repeat(64));
    const metadata = headers.get("x-ranking-edge-metadata")!;
    const decoded = JSON.parse(Buffer.from(metadata, "base64url").toString());
    assert.equal(decoded.ip, visitor.ip); assert.equal(decoded.city, "Manila"); assert.equal(decoded.userAgent, "Test Browser");
    const digest = createHash("sha256").update(body).digest("hex");
    const expected = createHmac("sha256", secret).update(["PATCH", url.pathname, digest, metadata].join("\n")).digest("hex");
    assert.equal(headers.get("x-ranking-edge-signature"), expected);
    return Response.json({ data: {} }, { headers: { "set-cookie": "unwanted=value", "ratelimit": "remaining=3" } });
  });
  const response = await rankingVisitor(new Request("https://site.example.test/api/v2/public/rankings/token/visits/location", { method: "PATCH", headers: { "content-type": "application/json", "cookie": "session=secret", "authorization": "Bearer forged", "user-agent": "Test Browser", "x-ranking-edge-metadata": "forged", "x-forwarded-for": "127.0.0.1", "x-ranking-visit-key": "a".repeat(64) }, body }), visitor);
  assert.equal(upstreamCalls, 1); assert.equal(response.status, 200); assert.equal(response.headers.get("set-cookie"), null); assert.equal(response.headers.get("cache-control"), "no-store"); assert.equal(response.headers.get("ratelimit"), "remaining=3");
  const oversized = await rankingVisitor(new Request("https://site.example.test/api/v2/public/rankings/token/visits", { method: "POST", body: "x".repeat(4097) }), visitor);
  assert.equal(oversized.status, 413); assert.equal(upstreamCalls, 1);
});
