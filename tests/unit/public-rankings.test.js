import assert from "node:assert/strict";
import test from "node:test";
import { publishedPublicRankingState, revokedPublicRankingState, visiblePublicRankingPublication } from "../../src/lib/public-rankings.ts";

const publication = (id, sessionStartedAt = "2026-08-22T00:00:00.000Z") => ({ id, sessionStartedAt, state: "LIVE", publishedAt: "2026-08-22T00:01:00.000Z", version: 1, token: `${id}-token` });

test("publishing becomes current and removes duplicate archive entries", () => {
  const next = publishedPublicRankingState({ current: null, archives: [publication("published"), publication("other")] }, publication("published"));
  assert.equal(next.current?.id, "published");
  assert.deepEqual(next.archives.map((item) => item.id), ["other"]);
});

test("revoking clears current and preserves unrelated archives", () => {
  const next = revokedPublicRankingState({ current: publication("current"), archives: [publication("current"), publication("other")] }, publication("current"));
  assert.equal(next.current, null);
  assert.deepEqual(next.archives.map((item) => item.id), ["other"]);
});

test("optimistic publication remains visible while a refetch has no current result", () => {
  const optimistic = publication("published");
  assert.equal(visiblePublicRankingPublication({ current: null, archives: [] }, optimistic), optimistic);
  assert.equal(visiblePublicRankingPublication(undefined, optimistic), optimistic);
  assert.equal(visiblePublicRankingPublication({ current: publication("confirmed"), archives: [] }, optimistic)?.id, "confirmed");
});
