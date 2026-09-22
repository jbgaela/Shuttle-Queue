import assert from "node:assert/strict";
import test from "node:test";
import { rankingTrackingLinksSchema, rankingTrackingVisitsSchema, rankingVisitAccessSchema, validatedTracking } from "../../src/lib/ranking-tracking-validation.ts";

test("tracking rejects malformed payloads with a safe retryable message", () => {
  for (const input of [undefined, null, {}, { items: "invalid", nextCursor: null }]) assert.throws(() => validatedTracking(rankingTrackingLinksSchema, input), /Please refresh/);
  assert.throws(() => validatedTracking(rankingTrackingVisitsSchema, { link: null, items: [], nextCursor: null }), /Please refresh/);
  assert.throws(() => validatedTracking(rankingVisitAccessSchema, { visitId: "visit", status: "INVENTED" }), /Please refresh/);
});

test("tracking normalizes absent nullable values without inventing location", () => {
  assert.deepEqual(validatedTracking(rankingVisitAccessSchema, { visitId: "visit", status: "PENDING" }), { visitId: "visit", status: "PENDING", accessExpiresAt: null });
  const page = validatedTracking(rankingTrackingLinksSchema, { items: [{ id: "link", queueMasterId: "owner", issuedAt: "2026-09-22T07:00:00Z", publication: { id: "publication", sessionStartedAt: "2026-09-22T07:00:00Z" } }], nextCursor: null });
  assert.equal(page.items[0]?.revokedAt, null);
  assert.equal(page.items[0]?.publication.finalizedAt, null);
});
