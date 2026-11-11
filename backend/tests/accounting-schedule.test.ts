import assert from "node:assert/strict";
import test from "node:test";
import { day, generateSchedulePlan } from "../src/modules/accounting/schedules/schedule.domain.js";
import { accountingCents } from "../src/modules/accounting/accounting.domain.js";
const periods = [
  { id: "oct", startDate: day("2026-10-01"), endDate: day("2026-10-31") },
  { id: "nov", startDate: day("2026-11-01"), endDate: day("2026-11-30") },
  { id: "dec", startDate: day("2026-12-01"), endDate: day("2026-12-31") }
];
test("Schedule equal allocation preserves exact original cents with stable chronological residual", () => {
  const rows = generateSchedulePlan({ amount: "100.00", startDate: "2026-10-01", endDate: "2026-12-31", allocationMethod: "MONTHLY_EQUAL" }, periods);
  assert.deepEqual(rows.map(r => r.plannedAmount), ["33.34", "33.33", "33.33"]);
  assert.equal(rows.reduce((sum, row) => sum + accountingCents(row.plannedAmount), 0n), 10000n);
});
test("Schedule actual days explicitly prorates partial periods and leap days", () => {
  const rows = generateSchedulePlan({ amount: "47.00", startDate: "2026-11-15", endDate: "2026-12-31", allocationMethod: "ACTUAL_DAYS" }, periods);
  assert.deepEqual(rows.map(r => r.plannedAmount), ["16.00", "31.00"]);
  const leap = generateSchedulePlan({ amount: "60.00", startDate: "2028-02-01", endDate: "2028-03-31", allocationMethod: "ACTUAL_DAYS" },
    [{ id: "feb", startDate: day("2028-02-01"), endDate: day("2028-02-29") }, { id: "mar", startDate: day("2028-03-01"), endDate: day("2028-03-31") }]);
  assert.deepEqual(leap.map(r => r.plannedAmount), ["29.00", "31.00"]);
});
test("Schedule generation rejects missing/overlapping periods, zero installments and mismatched custom allocations", () => {
  assert.throws(() => generateSchedulePlan({ amount: "1.00", startDate: "2026-11-01", endDate: "2027-01-31", allocationMethod: "MONTHLY_EQUAL" }, periods));
  assert.throws(() => generateSchedulePlan({ amount: "0.01", startDate: "2026-11-01", endDate: "2026-12-31", allocationMethod: "MONTHLY_EQUAL" }, periods));
  assert.throws(() => generateSchedulePlan({ amount: "1.00", startDate: "2026-11-01", endDate: "2026-12-31", allocationMethod: "MONTHLY_EQUAL" }, [periods[1], periods[1], periods[2]]));
  assert.throws(() => generateSchedulePlan({ amount: "1.00", startDate: "2026-11-01", endDate: "2026-12-31", allocationMethod: "CUSTOM",
    customPeriods: [{ accountingPeriodId: "nov", recognitionDate: "2026-11-30", plannedAmount: "0.99" }] }, periods));
});
test("Schedule custom dates and amounts remain explicit and deterministic beyond Number precision", () => {
  const input = { amount: "9007199254740993.01", startDate: "2026-11-01", endDate: "2026-12-31", allocationMethod: "ACTUAL_DAYS" as const };
  const a = generateSchedulePlan(input, periods), b = generateSchedulePlan(input, [...periods].reverse());
  assert.deepEqual(a, b); assert.equal(a.reduce((sum, row) => sum + accountingCents(row.plannedAmount), 0n), 900719925474099301n);
});
