import assert from "node:assert/strict";
import test from "node:test";
import { day, depreciationStart, straightLinePortion, disposalAmounts, dateText } from "../src/modules/accounting/assets/asset.domain.js";
test("Asset straight-line allocation is exact with deterministic final residual cents", () => {
  const start = day("2026-10-01"), amounts = [["2026-10-01", "2026-10-31"], ["2026-11-01", "2026-11-30"], ["2026-12-01", "2026-12-31"]]
    .map(([from, to]) => straightLinePortion(10000n, start, 3, "FULL_MONTH", day(from), day(to)).amount);
  assert.deepEqual(amounts, [3333n, 3333n, 3334n]); assert.equal(amounts.reduce((a, b) => a + b, 0n), 10000n);
});
test("Asset available-for-use policies are explicit and actual days handle partial months", () => {
  const available = day("2026-11-15");
  assert.equal(dateText(depreciationStart(available, "FULL_MONTH")), "2026-11-01");
  assert.equal(dateText(depreciationStart(available, "NEXT_MONTH")), "2026-12-01");
  assert.equal(straightLinePortion(6100n, available, 2, "ACTUAL_DAYS", day("2026-11-01"), day("2026-11-30")).amount, 1600n);
  assert.equal(straightLinePortion(6100n, available, 2, "ACTUAL_DAYS", day("2026-12-01"), day("2026-12-31")).amount, 3100n);
  assert.equal(straightLinePortion(6100n, available, 2, "ACTUAL_DAYS", day("2027-01-01"), day("2027-01-31")).amount, 1400n);
});
test("Asset disposal uses actual carrying value and net costs with no floating point", () => {
  assert.deepEqual(disposalAmounts("12000000.00", "8000000.00", "0.00", "5000000.00", "200000.00"), { carrying: "4000000.00", gain: "800000.00", loss: "0.00" });
  assert.deepEqual(disposalAmounts("12000000.00", "8000000.00", "1000000.00", "2000000.00", "500000.00"), { carrying: "3000000.00", gain: "0.00", loss: "1500000.00" });
  const big = straightLinePortion(900719925474099301n, day("2026-11-01"), 1, "FULL_MONTH", day("2026-11-01"), day("2026-11-30"));
  assert.equal(big.amount, 900719925474099301n);
});
test("Asset depreciation rejects unsupported period shape and caps terminal allocation", () => {
  assert.throws(() => straightLinePortion(100n, day("2026-11-01"), 2, "FULL_MONTH", day("2026-11-01"), day("2026-12-31")));
  assert.equal(straightLinePortion(100n, day("2026-11-01"), 1, "FULL_MONTH", day("2026-12-01"), day("2026-12-31")).amount, 0n);
});
