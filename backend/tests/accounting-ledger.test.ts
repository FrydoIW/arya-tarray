import assert from "node:assert/strict";
import test from "node:test";
import { validateLedgerLines } from "../src/modules/accounting/ledger/ledger.domain.js";

const debit = { accountId: "asset", debit: "8000000.00", credit: "0.00" };
const credit = { accountId: "liability", debit: "0.00", credit: "8000000.00" };

test("central ledger accepts exact balanced double entry", () => {
  assert.doesNotThrow(() => validateLedgerLines([debit, credit]));
});

test("central ledger rejects unequal, two-sided, zero and imprecise lines", () => {
  for (const lines of [
    [debit, { ...credit, credit: "7999999.99" }],
    [{ ...debit, credit: "1.00" }, credit],
    [{ ...debit, debit: "0.00" }, credit],
    [{ ...debit, debit: "8000000.001" }, credit],
    [debit]
  ]) assert.throws(() => validateLedgerLines(lines));
});
