import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { postStatementRecognition } from "../src/modules/accounting/accounting.posting.js";

test("approved bank donation retains source snapshots and uses the shared period/idempotency gate", async () => {
  const previousCutover = process.env.ACCOUNTING_CUTOVER_DATE;
  process.env.ACCOUNTING_CUTOVER_DATE = "2026-11-01";
  const saved: Array<Record<string, unknown>> = [];
  let periodStatus = "OPEN";
  const row = {
    id: "bank-transaction-1", status: "FINALIZED", sourceType: "BANK",
    transactionDate: new Date("2026-11-02T00:00:00.000Z"), originalAmount: "100.25",
    eventCodeId: "event-1", eventCampaignId: null, reconciliationExcludedAt: null,
    description: "Donasi", senderName: "Donor evidence", memberIdentity: null,
    eventCode: { code: "001", eventName: "Donasi", eventType: "STANDARD" }, eventCampaign: null,
    statementUpload: { bankAccount: { id: "bank-account-1", bankName: "BCA",
      accountNo: "SOURCE-EVIDENCE", accountName: "Yayasan Arya Tarray" } }
  };
  const fake = {
    accountingJournalDraft: { findMany: async () => [], create: async () => ({}) },
    accountingSettlement: { findMany: async () => [] },
    bankTransaction: { findMany: async () => [row] },
    accountingAccount: { findMany: async () => [
      { id: "account-bank", code: "1110", name: "Bank", accountType: "ASSET",
        normalBalance: "DEBIT", activeFlag: true, postingFlag: true },
      { id: "account-revenue", code: "4110", name: "Contribution Revenue", accountType: "REVENUE",
        normalBalance: "CREDIT", activeFlag: true, postingFlag: true }
    ] },
    accountingPeriod: { findMany: async () => [
      { id: "period-1", status: periodStatus, relFkAccPeriodFy: { status: "OPEN" } }
    ] },
    accountingJournal: {
      findMany: async () => saved.map(data => ({ sourceEventKey: data.sourceEventKey })),
      findUnique: async ({ select }: { select?: { lines?: unknown } }) => select?.lines ? saved.at(-1) : null,
      create: async ({ data }: { data: Record<string, unknown> }) => { saved.push(data); return data; }
    }
  };
  try {
    const tx = fake as unknown as Prisma.TransactionClient;
    await postStatementRecognition(tx, "statement-1", "approver-1", new Date("2026-11-04"));
    assert.equal(saved.length, 1);
    assert.equal(saved[0]?.accountingPeriodId, "period-1");
    assert.equal(saved[0]?.sourceEventKey, "FINALIZED_BANK_TRANSACTION:bank-transaction-1");
    assert.equal(saved[0]?.sourceKind, "FINALIZED_BANK_TRANSACTION");
    assert.equal(saved[0]?.sourceReference, "bank-transaction-1");
    const lines = (saved[0]?.lines as { create: Array<Record<string, unknown>> }).create;
    assert.equal(lines[0]?.debit, "100.25");
    assert.equal(lines[0]?.bankAccountNoSnapshot, "SOURCE-EVIDENCE");
    assert.equal(lines[1]?.credit, "100.25");
    assert.equal(lines[1]?.eventCodeSnapshot, "001");
    await postStatementRecognition(tx, "statement-1", "approver-1", new Date("2026-11-04"));
    assert.equal(saved.length, 1);
    saved.length = 0;
    periodStatus = "CLOSED";
    await assert.rejects(postStatementRecognition(tx, "statement-1", "approver-1", new Date("2026-11-04")),
      /open accounting period/);
    assert.equal(saved.length, 0);
    delete process.env.ACCOUNTING_CUTOVER_DATE;
    await assert.rejects(postStatementRecognition(tx, "statement-1", "approver-1", new Date("2026-11-04")),
      /ACCOUNTING_CUTOVER_DATE/);
  } finally {
    if (previousCutover === undefined) delete process.env.ACCOUNTING_CUTOVER_DATE;
    else process.env.ACCOUNTING_CUTOVER_DATE = previousCutover;
  }
});
