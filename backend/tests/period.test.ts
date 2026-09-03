import assert from "node:assert/strict";
import test from "node:test";
import { isValidPeriodDate, resolvePeriod } from "../src/lib/period.js";

test("period helper rejects impossible calendar dates", () => {
  assert.equal(isValidPeriodDate("2026-02-29"), false);
  assert.equal(isValidPeriodDate("2028-02-29"), true);
});

test("period helper returns start-inclusive and end-exclusive day and month ranges", () => {
  const month = resolvePeriod("MONTH", "2026-09", "2026-09-01");
  assert.equal(month.start.toISOString(), "2026-09-01T00:00:00.000Z");
  assert.equal(month.end.toISOString(), "2026-10-01T00:00:00.000Z");

  const day = resolvePeriod("DAY", "2026-09", "2026-09-04");
  assert.equal(day.start.toISOString(), "2026-09-04T00:00:00.000Z");
  assert.equal(day.end.toISOString(), "2026-09-05T00:00:00.000Z");
});
