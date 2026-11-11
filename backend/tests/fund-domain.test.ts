import assert from "node:assert/strict";
import test from "node:test";
import { assertCapacity, restrictionAmounts, eligibilityDates, day } from "../src/modules/accounting/funds/fund.domain.js";
test("Fund restriction 20m less eligible 7m keeps exact 13m, including large cents", () => {
  assert.deepEqual(restrictionAmounts(2000000000n, 700000000n), { original: "20000000.00", released: "7000000.00", remaining: "13000000.00" });
  assert.equal(restrictionAmounts(900719925474099301n, 1n).remaining, "9007199254740993.00");
});
test("Fund source splits cannot exceed one nominal, and release never accepts zero/overrun", () => {
  assertCapacity(200n, 130n, 70n); for (const proposed of [0n, -1n, 71n]) assert.throws(() => assertCapacity(200n, 130n, proposed));
  assert.throws(() => restrictionAmounts(100n, 101n));
});
test("Combined donor criteria require both purpose and elapsed time, with no future satisfaction", () => {
  const input = { kind: "BOTH", effectiveOn: day("2026-11-01"), releaseOn: day("2026-11-15"), satisfactionDate: day("2026-11-15"), accountingDate: day("2026-11-16"), criterion: "MILESTONE" };
  eligibilityDates(input); assert.throws(() => eligibilityDates({ ...input, satisfactionDate: day("2026-11-14") }));
  assert.throws(() => eligibilityDates({ ...input, criterion: "TIME_ONLY" }));
  assert.throws(() => eligibilityDates({ ...input, satisfactionDate: day("2026-11-17") }));
});
