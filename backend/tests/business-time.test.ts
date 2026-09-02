import assert from "node:assert/strict";
import test from "node:test";
import {
  BUSINESS_TIME_ZONE,
  businessDayUtcRange,
  currentBusinessMonthValue
} from "../src/lib/business-time.js";

test("business timezone is fixed to Asia/Jakarta", () => {
  assert.equal(BUSINESS_TIME_ZONE, "Asia/Jakarta");
});

test("current business month switches at Jakarta midnight, not server midnight", () => {
  assert.equal(currentBusinessMonthValue(new Date("2026-08-31T16:59:59.000Z")), "2026-08");
  assert.equal(currentBusinessMonthValue(new Date("2026-08-31T17:00:00.000Z")), "2026-09");
});

test("business day UTC range represents 00:00-24:00 Asia/Jakarta", () => {
  const range = businessDayUtcRange(new Date("2026-08-28T18:00:00.000Z"));
  assert.equal(range.start.toISOString(), "2026-08-28T17:00:00.000Z");
  assert.equal(range.end.toISOString(), "2026-08-29T17:00:00.000Z");
});
