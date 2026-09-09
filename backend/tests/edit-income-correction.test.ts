import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { executeEditIncomeSchema } from "../src/modules/reconciliation/edit-income/edit-income.schema.js";

const modified = {
  action: "MODIFIED" as const,
  transactionId: "10000000-0000-4000-8000-000000000001",
  eventCodeId: "20000000-0000-4000-8000-000000000001",
  remark: "Correction requested"
};

test("Edit Income accepts explicit modify/add/exclude proposals and requires adjustment reasons", () => {
  const valid = executeEditIncomeSchema.safeParse({ corrections: [
    modified,
    {
      action: "ADDED",
      clientId: "30000000-0000-4000-8000-000000000001",
      direction: "INCOMING",
      transactionDate: "2026-09-10",
      description: "Missing statement movement",
      amount: "500000.00",
      eventCodeId: "20000000-0000-4000-8000-000000000001",
      remark: null,
      reason: "Missing from imported statement"
    },
    {
      action: "EXCLUDED",
      transactionId: "10000000-0000-4000-8000-000000000002",
      reason: "Duplicate import"
    }
  ] });
  assert.equal(valid.success, true);
  assert.equal(executeEditIncomeSchema.safeParse({ corrections: [{
    action: "EXCLUDED", transactionId: modified.transactionId, reason: ""
  }] }).success, false);
  assert.equal(executeEditIncomeSchema.safeParse({ corrections: [{
    action: "ADDED", clientId: "30000000-0000-4000-8000-000000000001", direction: "INCOMING",
    transactionDate: "2026-09-10", description: "Adjustment", amount: "1.00", eventCodeId: null,
    remark: null, reason: "Required"
  }] }).success, false);
});

test("Edit Income rejects duplicate existing transaction actions and preserves outgoing Event rules", () => {
  assert.equal(executeEditIncomeSchema.safeParse({ corrections: [modified, {
    action: "EXCLUDED", transactionId: modified.transactionId, reason: "Duplicate"
  }] }).success, false);
  assert.equal(executeEditIncomeSchema.safeParse({ corrections: [{
    action: "ADDED", clientId: "30000000-0000-4000-8000-000000000001", direction: "OUTGOING",
    transactionDate: "2026-09-10", description: "Bank charge", amount: "925000", eventCodeId: null,
    remark: null, reason: "Missing charge"
  }] }).success, true);
  assert.equal(executeEditIncomeSchema.safeParse({ corrections: [{
    action: "ADDED", clientId: "30000000-0000-4000-8000-000000000001", direction: "OUTGOING",
    transactionDate: "2026-09-10", description: "Bank charge", amount: "925000",
    eventCodeId: "20000000-0000-4000-8000-000000000001", remark: null, reason: "Missing charge"
  }] }).success, false);
});

test("pending corrections are proposal-only and approval applies or rejects them atomically", () => {
  const editRepository = readFileSync(new URL("../src/modules/reconciliation/edit-income/edit-income.repository.ts", import.meta.url), "utf8");
  const approvalRepository = readFileSync(new URL("../src/modules/approval/sign-approval/sign-approval.repository.ts", import.meta.url), "utf8");
  assert.match(editRepository, /reconciliationCorrectionProposal\.create/);
  assert.match(editRepository, /approvers:[\s\S]*createMany/);
  assert.doesNotMatch(editRepository, /tx\.bankTransaction\.update\(/);
  assert.doesNotMatch(editRepository, /tx\.bankTransaction\.create\(/);
  assert.match(approvalRepository, /if \(input\.decision === "APPROVED"\)[\s\S]*tx\.bankTransaction\.update/);
  assert.match(approvalRepository, /status: input\.decision, decidedAt: now, decidedById: input\.userId/);
  assert.match(approvalRepository, /input\.decision === "APPROVED"[\s\S]*status: "FINALIZED"/);
  assert.match(approvalRepository, /isolationLevel: Prisma\.TransactionIsolationLevel\.Serializable/);
});

test("raw provenance, correction diff, inquiry gate, staged filters and statement isolation are wired", () => {
  const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
  const editRepository = readFileSync(new URL("../src/modules/reconciliation/edit-income/edit-income.repository.ts", import.meta.url), "utf8");
  const approvalService = readFileSync(new URL("../src/modules/approval/sign-approval/sign-approval.service.ts", import.meta.url), "utf8");
  const hook = readFileSync(new URL("../../frontend/src/features/reconciliation/edit-income/hooks/useEditIncomeWorkspace.ts", import.meta.url), "utf8");
  const workspace = readFileSync(new URL("../../frontend/src/features/reconciliation/edit-income/components/EditIncomeCorrectionWorkspace.tsx", import.meta.url), "utf8");
  assert.match(schema, /sourceType\s+String\s+@default\("BANK"\)/);
  assert.match(schema, /reconciliationExcludedAt/);
  assert.match(editRepository, /statementUploadId: statement\.id/);
  assert.match(approvalService, /originalStatementAmount/);
  assert.match(approvalService, /proposedCorrectedAmount/);
  assert.match(hook, /useState<EditIncomeMode>\("INQUIRY"\)/);
  assert.match(hook, /transaction\.eventCodeId === transactionEventCodeFilter/);
  assert.match(hook, /matchesStatus && matchesEventCode && matchesDirection && matchesSearch/);
  assert.match(workspace, /Add Adjustment/);
  assert.match(workspace, /Exclude from reconciliation/);
  assert.match(workspace, /Source MANUAL|Manual source/);
});
