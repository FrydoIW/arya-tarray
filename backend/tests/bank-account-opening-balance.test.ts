import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  calculateBankBalance,
  openingBalanceCanBeChanged
} from "../src/modules/configuration/bank-account/bank-account.balance.js";
import { bankAccountWorkspaceExecuteSchema } from "../src/modules/configuration/bank-account/bank-account.schema.js";
import { storedTransactionRequiresClassification } from "../src/modules/reconciliation/reconciliation-classification.js";

function createInput(openingBalance?: string | null, openingBalanceDate?: string | null) {
  return {
    creates: [{
      clientId: "draft-1",
      bankCode: "BCA",
      accountNo: "0849999127",
      accountName: "Arya Tarray",
      activeFlag: true,
      ...(openingBalance !== undefined ? { openingBalance } : {}),
      ...(openingBalanceDate !== undefined ? { openingBalanceDate } : {})
    }],
    updates: []
  };
}

test("Bank Account opening balance accepts omitted, configured, and zero baselines", () => {
  assert.equal(bankAccountWorkspaceExecuteSchema.safeParse(createInput()).success, true);
  assert.equal(bankAccountWorkspaceExecuteSchema.safeParse(createInput("12500000", "2026-04-30")).success, true);
  assert.equal(bankAccountWorkspaceExecuteSchema.safeParse(createInput("0", "2026-04-30")).success, true);
});

test("Bank Account opening balance requires the amount and date as a pair", () => {
  assert.equal(bankAccountWorkspaceExecuteSchema.safeParse(createInput("12500000", null)).success, false);
  assert.equal(bankAccountWorkspaceExecuteSchema.safeParse(createInput(null, "2026-04-30")).success, false);
  assert.equal(bankAccountWorkspaceExecuteSchema.safeParse(createInput("10.123", "2026-04-30")).success, false);
  assert.equal(bankAccountWorkspaceExecuteSchema.safeParse(createInput("10", "2026-02-30")).success, false);
});

test("derived balance uses exact decimal arithmetic and keeps pending movement separate", () => {
  assert.deepEqual(calculateBankBalance({
    openingBalance: "10000000.00",
    openingBalanceDate: "2026-04-30",
    finalizedIncoming: "2000000.00",
    finalizedOutgoing: "500000.00",
    pendingMovement: "750000.00"
  }), {
    configured: true,
    finalizedIncoming: "2000000.00",
    finalizedOutgoing: "500000.00",
    reconciledBalance: "11500000.00",
    pendingMovement: "750000.00"
  });

  assert.equal(calculateBankBalance({
    openingBalance: "9007199254740992.11",
    openingBalanceDate: "2026-04-30",
    finalizedIncoming: "0.10",
    finalizedOutgoing: "0.01",
    pendingMovement: "-0.02"
  }).reconciledBalance, "9007199254740992.20");
});

test("unconfigured baseline never produces a misleading zero official balance", () => {
  assert.deepEqual(calculateBankBalance({
    openingBalance: null,
    openingBalanceDate: null,
    finalizedIncoming: "2000000.00",
    finalizedOutgoing: "500000.00",
    pendingMovement: "750000.00"
  }), {
    configured: false,
    finalizedIncoming: null,
    finalizedOutgoing: null,
    reconciledBalance: null,
    pendingMovement: null
  });
});

test("opening baseline is editable only before lock and historical statement activity", () => {
  assert.equal(openingBalanceCanBeChanged({ openingBalanceLockedAt: null, statementCount: 0 }), true);
  assert.equal(openingBalanceCanBeChanged({ openingBalanceLockedAt: new Date(), statementCount: 0 }), false);
  assert.equal(openingBalanceCanBeChanged({ openingBalanceLockedAt: null, statementCount: 1 }), false);
});

test("balance repository isolates accounts, uses strict after-baseline dates, and lifecycle-specific movement", () => {
  const repository = readFileSync(new URL("../src/modules/configuration/bank-account/bank-account.repository.ts", import.meta.url), "utf8");
  assert.match(repository, /bt\.transaction_date > ba\.opening_balance_date/);
  assert.match(repository, /bt\.status = 'FINALIZED' AND bt\.reconciliation_excluded_at IS NULL AND bt\.original_amount > 0/);
  assert.match(repository, /bt\.status = 'FINALIZED' AND bt\.reconciliation_excluded_at IS NULL AND bt\.original_amount < 0/);
  assert.match(repository, /bt\.status IN \('RAW', 'CHECK'\)/);
  assert.match(repository, /GROUP BY ba\.bank_account_id/);
  assert.match(repository, /statements: \{ none: \{ status: \{ not: "WITHDRAWN" \} \} \}/);
});

test("successful RAW persistence sets the backend-controlled lock in the same transaction", () => {
  const repository = readFileSync(new URL("../src/modules/reconciliation/statement-upload/statement-upload.repository.ts", import.meta.url), "utf8");
  const persistStart = repository.indexOf("export async function persistParsedStatement");
  const transactionStart = repository.indexOf("prisma.$transaction", persistStart);
  const transactionCreate = repository.indexOf("bankTransaction.createMany", transactionStart);
  const lockUpdate = repository.indexOf("openingBalanceLockedAt: new Date()", transactionCreate);
  const transactionReturn = repository.indexOf("return statement", lockUpdate);
  assert.ok(persistStart >= 0 && transactionStart > persistStart);
  assert.ok(transactionCreate > transactionStart && lockUpdate > transactionCreate && transactionReturn > lockUpdate);
  assert.match(repository.slice(transactionStart, transactionReturn), /openingBalanceLockedAt: null/);
});

test("outgoing transactions remain Event Code exempt while eligible incoming transactions remain required", () => {
  assert.equal(storedTransactionRequiresClassification({
    transactionType: "TRSF E-BANKING DB",
    originalAmount: { toString: () => "-500000.00" }
  }), false);
  assert.equal(storedTransactionRequiresClassification({
    transactionType: "TRSF E-BANKING CR",
    originalAmount: { toString: () => "2000000.00" }
  }), true);

  const statementUi = readFileSync(new URL("../../frontend/src/features/reconciliation/statement-upload/components/DraftTransactionReview.tsx", import.meta.url), "utf8");
  const inquiryUi = readFileSync(new URL("../../frontend/src/features/reconciliation/transaction-inquiry/components/TransactionInquiryTable.tsx", import.meta.url), "utf8");
  assert.match(statementUi, /row\.direction === "DB" \? "Outgoing"/);
  assert.match(inquiryUi, /\? "Outgoing" : "Incoming"/);
});
