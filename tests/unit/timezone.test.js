import assert from "node:assert/strict";
import test from "node:test";
import { currentDateTimeForTimezone, dateTimeInputForTimezone, instantForLocalDateTime } from "../../src/lib/timezone.ts";

test("account-local datetime fields use the account timezone", () => {
  const instant = new Date("2026-08-14T17:05:00.000Z");
  assert.equal(dateTimeInputForTimezone(instant, "Asia/Manila"), "2026-08-15T01:05");
  assert.equal(currentDateTimeForTimezone("Asia/Manila", instant), "2026-08-15T01:05");
  assert.equal(instantForLocalDateTime("2026-08-15T01:05", "Asia/Manila"), "2026-08-14T17:05:00.000Z");
});
