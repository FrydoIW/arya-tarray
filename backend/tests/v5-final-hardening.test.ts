import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Edit Income keeps historical inactive Event Codes readable but only permits active new selections", () => {
  const repository = readFileSync(new URL("../src/modules/reconciliation/edit-income/edit-income.repository.ts", import.meta.url), "utf8");
  const service = readFileSync(new URL("../src/modules/reconciliation/edit-income/edit-income.service.ts", import.meta.url), "utf8");
  const component = readFileSync(new URL("../../frontend/src/features/reconciliation/edit-income/components/EditIncomeCorrectionWorkspace.tsx", import.meta.url), "utf8");

  assert.match(repository, /suggestedTransactions:\s*\{\s*some:\s*\{\s*statementUploadId:\s*statementId/);
  assert.match(repository, /transactions:\s*\{\s*some:\s*\{\s*statementUploadId:\s*statementId/);
  assert.match(repository, /current && current\.eventCodeId !== change\.eventCodeId/);
  assert.match(repository, /newly selected Final Events are inactive/);
  assert.match(service, /activeFlag:\s*item\.activeFlag/);
  assert.match(component, /\(Inactive\)/);
  assert.match(component, /disabled=\{!eventCode\.activeFlag && eventCode\.id !== originalEventCodeId\}/);
  assert.match(component, /eventCodes=\{detail\.eventCodes\.filter\(\(eventCode\) => eventCode\.activeFlag && eventCode\.eventType !== "TIME_BASED"\)\}/);
});

test("Transaction Inquiry exposes relevant inactive historical events and clamps server pagination", () => {
  const repository = readFileSync(new URL("../src/modules/reconciliation/transaction-inquiry/transaction-inquiry.repository.ts", import.meta.url), "utf8");
  const service = readFileSync(new URL("../src/modules/reconciliation/transaction-inquiry/transaction-inquiry.service.ts", import.meta.url), "utf8");
  const hook = readFileSync(new URL("../../frontend/src/features/reconciliation/transaction-inquiry/hooks/useTransactionInquiry.ts", import.meta.url), "utf8");
  const table = readFileSync(new URL("../../frontend/src/features/reconciliation/transaction-inquiry/components/TransactionInquiryTable.tsx", import.meta.url), "utf8");

  assert.match(repository, /activeFlag:\s*true/);
  assert.match(repository, /historicalEventWhere/);
  assert.match(repository, /reconciliationExcludedAt:\s*null/);
  assert.match(repository, /const page = Math\.min\(input\.page, totalPages\)/);
  assert.match(service, /page:\s*records\.page/);
  assert.match(hook, /next\.pagination\.page/);
  assert.match(table, /\(Inactive\)/);
});

test("Donatur workspace, donation, registration, and ownership-history hooks sync client page to the server-clamped page", () => {
  const memberData = readFileSync(new URL("../../frontend/src/features/member/data/hooks/useMemberData.ts", import.meta.url), "utf8");
  const donations = readFileSync(new URL("../../frontend/src/features/member/data/hooks/useMemberDonations.ts", import.meta.url), "utf8");
  const registration = readFileSync(new URL("../../frontend/src/features/member/registration/hooks/useMemberRegistration.ts", import.meta.url), "utf8");
  const history = readFileSync(new URL("../../frontend/src/features/member/data/hooks/useMemberIdentityHistory.ts", import.meta.url), "utf8");

  assert.match(memberData, /current\.page === data\.pagination\.page/);
  assert.match(donations, /current\.page === data\.pagination\.page/);
  assert.match(registration, /current\.page === data\.pagination\.page/);
  assert.match(history, /current === data\.pagination\.page/);
});
