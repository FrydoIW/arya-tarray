import assert from "node:assert/strict";
import test from "node:test";
import { agingBucket, assertNoOverpayment, exactDocumentTotal, outstandingCents, validateAllocations } from "../src/modules/accounting/apar/apar.domain.js";
import { exactPositiveAmount, documentInputSchema } from "../src/modules/accounting/apar/apar.schema.js";

test("APAR exact amounts preserve cents beyond Number precision and reject overflow/rounding", () => {
  assert.equal(exactDocumentTotal([{ amount: "9007199254740993.01" }, { amount: "0.09" }]), "9007199254740993.10");
  assert.equal(outstandingCents("8000000.00", "-1000000.01", "3000000.00"), 399999999n);
  for (const amount of ["0", "-1", "1.001", "1e3", "1000000000000000000.00"]) assert.equal(exactPositiveAmount.safeParse(amount).success, false);
  assert.throws(() => exactDocumentTotal([{ amount: "999999999999999999.99" }, { amount: "0.01" }]));
});
test("APAR allocations require positive exact full allocation and unique document identity", () => {
  validateAllocations("0.30", [{ accountingDocumentId: "a", allocatedAmount: "0.10" }, { accountingDocumentId: "b", allocatedAmount: "0.20" }]);
  assert.throws(() => validateAllocations("0.31", [{ accountingDocumentId: "a", allocatedAmount: "0.30" }]));
  assert.throws(() => validateAllocations("2.00", [{ accountingDocumentId: "a", allocatedAmount: "1.00" }, { accountingDocumentId: "a", allocatedAmount: "1.00" }]));
  assert.throws(() => assertNoOverpayment("5000000.01", "5000000.00"));
  assertNoOverpayment("5000000.00", "5000000.00");
});
test("APAR aging boundaries use date-only days and recognition requires explicit evidence", () => {
  for (const [date, bucket] of [["2026-11-29", "CURRENT"], ["2026-11-30", "CURRENT"], ["2026-12-01", "DAYS_1_30"],
    ["2026-12-30", "DAYS_1_30"], ["2026-12-31", "DAYS_31_60"], ["2027-01-29", "DAYS_31_60"],
    ["2027-01-30", "DAYS_61_90"], ["2027-02-28", "DAYS_61_90"], ["2027-03-01", "DAYS_OVER_90"]]) assert.equal(agingBucket(date, "2026-11-30"), bucket);
  assert.equal(documentInputSchema.safeParse({ subscriptionId: "automatic-subscription-recognition" }).success, false);
});
