import assert from "node:assert/strict";
import test from "node:test";
import { selectOpenAccountingPeriodId } from "../src/modules/accounting/period/period-control.service.js";

const open = { id: "period-1", status: "OPEN", relFkAccPeriodFy: { status: "OPEN" } };

test("Accounting posting shares one open period and open fiscal year", () => {
  assert.equal(selectOpenAccountingPeriodId([open]), "period-1");
  for (const periods of [[], [open, { ...open, id: "period-2" }],
    [{ ...open, status: "CLOSING" }], [{ ...open, status: "CLOSED" }],
    [{ ...open, relFkAccPeriodFy: { status: "CLOSED" } }]]) {
    assert.throws(() => selectOpenAccountingPeriodId(periods), /open accounting period and fiscal year/);
  }
});
