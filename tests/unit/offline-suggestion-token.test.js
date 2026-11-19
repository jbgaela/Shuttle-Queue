import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeLocalSuggestion,
  persistedSuggestionKey,
} from "../../src/lib/offline/suggestion-token.ts";

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
  assert.throws(() =>
    decodeLocalSuggestion(encode({ ...payload, teamB: ["a", "d"], key: "a,b|a,d" })),
  );
  assert.equal(persistedSuggestionKey(null, "encoded-token"), "encoded-token");
});

test("offline Auto Create tokens require Open mode, a priority player, and a supported skill range", () => {
  const autoCreate = {
    ...payload,
    mode: "OPEN",
    strategy: "AUTO_CREATE",
    priorityPlayerId: "a",
    skillRange: 3,
  };
  const decoded = decodeLocalSuggestion(encode(autoCreate));
  assert.equal(decoded.strategy, "AUTO_CREATE");
  assert.equal(decoded.priorityPlayerId, "a");
  assert.equal(decoded.skillRange, 3);
  assert.throws(() => decodeLocalSuggestion(encode({ ...autoCreate, mode: "BALANCED" })));
  assert.throws(() => decodeLocalSuggestion(encode({ ...autoCreate, priorityPlayerId: "" })));
  assert.throws(() => decodeLocalSuggestion(encode({ ...autoCreate, skillRange: 6 })));
});
