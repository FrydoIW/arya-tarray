import assert from "node:assert/strict";
import test from "node:test";
import {
  directionFromStoredTransactionType,
  isEligibleIncomingTransaction,
  storedTransactionRequiresClassification
} from "../src/modules/reconciliation/reconciliation-classification.js";
import {
  classifyParsedTransaction,
  suffixCodeFromCents
} from "../src/modules/reconciliation/statement-upload/statement-upload.classifier.js";

test("eligible incoming credits require classification while debit and bank-generated credits do not", () => {
  assert.equal(isEligibleIncomingTransaction({ direction: "CR", transactionType: "TRSF E-BANKING CR", amountCents: 10_801_700n }), true);
  assert.equal(isEligibleIncomingTransaction({ direction: "DB", transactionType: "TRSF E-BANKING DB", amountCents: -5_000_000n }), false);
  assert.equal(isEligibleIncomingTransaction({ direction: "CR", transactionType: "BUNGA", amountCents: 50_000n }), false);
  assert.equal(isEligibleIncomingTransaction({ direction: "CR", transactionType: "CR KOREKSI BUNGA", amountCents: 50_000n }), false);
});

test("stored transaction direction and needs-review semantics remain stable", () => {
  assert.equal(directionFromStoredTransactionType("TRSF E-BANKING DB"), "DB");
  assert.equal(directionFromStoredTransactionType("BUNGA"), "CR");
  assert.equal(storedTransactionRequiresClassification({ transactionType: "TRSF E-BANKING CR", originalAmount: { toString: () => "108017.00" } }), true);
  assert.equal(storedTransactionRequiresClassification({ transactionType: "BUNGA", originalAmount: { toString: () => "1000.00" } }), false);
});

test("suffix matching preserves accepted base-amount examples", () => {
  const eventCodes = new Map([
    ["017", { id: "event-017", code: "017" }],
    ["058", { id: "event-058", code: "058" }],
    ["075", { id: "event-075", code: "075" }]
  ]);

  const cases = [
    { rupiah: 108_017n, suffix: "017", base: "108000.00", eventId: "event-017" },
    { rupiah: 100_058n, suffix: "058", base: "100000.00", eventId: "event-058" },
    { rupiah: 100_075n, suffix: "075", base: "100000.00", eventId: "event-075" }
  ];

  for (const item of cases) {
    const amountCents = item.rupiah * 100n;
    assert.equal(suffixCodeFromCents(amountCents), item.suffix);
    const result = classifyParsedTransaction(
      { direction: "CR", transactionType: "TRSF E-BANKING CR", amountCents },
      eventCodes
    );
    assert.equal(result.suffixCode, item.suffix);
    assert.equal(result.eventCodeId, item.eventId);
    assert.equal(result.suggestedEventCodeId, item.eventId);
    assert.equal(result.baseAmount, item.base);
  }
});
