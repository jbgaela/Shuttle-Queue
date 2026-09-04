import assert from "node:assert/strict";
import test from "node:test";
import { decodeLocalSuggestion, persistedSuggestionKey } from "../../src/lib/offline/suggestion-token.ts";

const payload = {
  algorithmVersion: "v11-guided-matchmaking-optimized-search",
  revision: 3,
  mode: "GUIDED",
  key: "a,b|c,d",
  teamA: ["a", "b"],
  teamB: ["c", "d"],
  expiresAt: Date.now() + 60_000,
};

const encode = (value) => `local:${btoa(JSON.stringify(value))}`;

test("offline Guided tokens decode with the canonical key and persisted key", () => {
  const decoded = decodeLocalSuggestion(encode(payload));
  assert.equal(decoded.mode, "GUIDED");
  assert.equal(decoded.key, "a,b|c,d");
  assert.equal(persistedSuggestionKey(decoded, "encoded-token"), "a,b|c,d");
});

test("offline token decoding rejects unknown fields, stale expiry, and invalid teams", () => {
  assert.throws(() => decodeLocalSuggestion(encode({ ...payload, extra: true })));
  assert.throws(() => decodeLocalSuggestion(encode({ ...payload, expiresAt: Date.now() - 1 })));
  assert.throws(() => decodeLocalSuggestion(encode({ ...payload, teamB: ["a", "d"], key: "a,b|a,d" })));
  assert.equal(persistedSuggestionKey(null, "encoded-token"), "encoded-token");
});

