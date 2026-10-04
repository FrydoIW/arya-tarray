import assert from "node:assert/strict";
import test from "node:test";
import { centsToDecimal, decimalStringToCents } from "../src/lib/money.js";
import { decimalStringToCents as classificationCents } from "../src/modules/reconciliation/reconciliation-classification.js";
import { centsToDecimal as donationDecimal } from "../src/modules/member/data/member-donation.domain.js";
import { signedAmountCents } from "../src/modules/reconciliation/statement-upload/statement-upload.duplicate.js";
import { centsToDecimalString } from "../src/modules/reconciliation/statement-upload/statement-upload.classifier.js";
import { summarizeTimeBasedCarry } from "../src/modules/monitoring/time-based/time-based-monitoring.repository.js";

test("shared money primitives preserve signed, zero, and two-decimal values", () => {
  for (const [amount, cents, formatted] of [["123.45", 12345n, "123.45"], ["-123.45", -12345n, "-123.45"], ["0", 0n, "0.00"], ["0.01", 1n, "0.01"]] as const) {
    assert.equal(decimalStringToCents(amount), cents);
    assert.equal(centsToDecimal(cents), formatted);
  }
});

test("decimal parser retains existing whitespace, truncation, and malformed-input behavior", () => {
  assert.equal(decimalStringToCents("  -12.34  "), -1234n);
  assert.equal(decimalStringToCents("1.239"), 123n);
  assert.throws(() => decimalStringToCents("not-money"), SyntaxError);
  assert.equal(classificationCents("12.34"), decimalStringToCents("12.34"));
  assert.equal(donationDecimal(-1234n), centsToDecimal(-1234n));
  assert.equal(centsToDecimalString(-1234n), centsToDecimal(-1234n));
});

test("domain input wrappers keep object and nullable contracts", () => {
  assert.equal(signedAmountCents({ toString: () => "-12.34" }), -1234n);
  assert.deepEqual(summarizeTimeBasedCarry([{ _sum: { amountDelta: null } }]), {
    outstandingCarry: "0.00", carrySourceCount: 0
  });
});
