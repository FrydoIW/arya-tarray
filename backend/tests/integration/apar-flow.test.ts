import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { prisma } from "../../src/lib/prisma.js";
import { aparScenario, AparFixture } from "./apar-fixture.js";
import { cancelSource, controlReconciliation, createDocument, createSettlement, getDocument, getSettlement,
  matchSettlement, outstandingReport, postSource, requestArAdjustment, requestSourceReversal,
  submitSource, updateDocument, updateSettlement } from "../../src/modules/accounting/apar/apar.service.js";
import { decideApproval, postApprovedJournal, postApprovedJournalInTransaction, submitApproval } from "../../src/modules/accounting/approval/approval.service.js";
import { postLedgerJournalInTransaction } from "../../src/modules/accounting/ledger/ledger.service.js";
import { decideSignApprovalAtomic } from "../../src/modules/approval/sign-approval/sign-approval.repository.js";
import type { DocumentKind } from "../../src/modules/accounting/apar/apar.schema.js";

const query = (counterpartyId: string, asOf = "2026-11-30", pageSize = 25) => ({ counterpartyId, asOf, page: 1, pageSize });
async function balance(f: AparFixture, kind: DocumentKind, id: string, amount: string) {
  assert.equal((await getDocument(f.actor, kind, id)).outstanding, amount);
}
async function reconciled(f: AparFixture, kind: DocumentKind, cp: string, asOf = "2026-11-30") {
  const result = await controlReconciliation(f.actor, kind, query(cp, asOf));
  assert.equal(result.reconciled, true, JSON.stringify(result));
}
async function reverse(f: AparFixture, kind: DocumentKind, type: "DOCUMENT" | "SETTLEMENT", id: string, date = "2026-11-04") {
  return f.applyReversal(await requestSourceReversal(f.actor, kind, type, id,
    { accountingDate: date, remark: "Synthetic TEST correction authorized independently" }));
}

test("AP exact 8m recognition, 3m partial and 5m full payment reconcile to one GL", async () => aparScenario(async f => {
  const cp = await f.counterparty(), doc = await f.document("PAYABLE", cp);
  assert.ok(doc.journal);
  assert.equal(doc.journal.lines.find(row => row.accountId === f.expense)?.debit.toFixed(2), "8000000.00");
  assert.equal(doc.journal.lines.find(row => row.accountId === f.apControl)?.credit.toFixed(2), "8000000.00");
  const input = f.settlementInput(cp, [{ accountingDocumentId: doc.document.id, allocatedAmount: "3000000.00" }], "3000000.00");
  const partial = await f.settlement("PAYABLE", input, false);
  await balance(f, "PAYABLE", doc.document.id, "8000000.00");
  const journal = await postSource(f.poster, "PAYABLE", "SETTLEMENT", partial.settlement.id, partial.request.id);
  assert.equal(journal.lines.find(row => row.accountId === f.apControl)?.debit.toFixed(2), "3000000.00");
  assert.equal(journal.lines.find(row => row.accountId === f.bankGl)?.credit.toFixed(2), "3000000.00");
  await balance(f, "PAYABLE", doc.document.id, "5000000.00");
  await reconciled(f, "PAYABLE", cp);
  assert.equal((await getSettlement(f.actor, "PAYABLE", partial.settlement.id)).reconciliationState, "AWAITING_STATEMENT");
  await f.settlement("PAYABLE", f.settlementInput(cp, [{ accountingDocumentId: doc.document.id, allocatedAmount: "5000000.00" }], "5000000.00"));
  await balance(f, "PAYABLE", doc.document.id, "0.00"); await reconciled(f, "PAYABLE", cp);
  await assert.rejects(postSource(f.poster, "PAYABLE", "DOCUMENT", doc.document.id, doc.request.id));
  assert.equal(await prisma.accountingJournal.count({ where: { sourceKind: "AP_DOCUMENT", sourceReference: doc.document.id } }), 1);
  await assert.rejects(updateDocument(f.actor, "PAYABLE", doc.document.id, { ...doc.input, expectedRevision: 1 }));
}));

test("AR exact earned recognition, partial/full receipts and explicit evidence requirements", async () => aparScenario(async f => {
  const cp = await f.counterparty("RECEIVABLE"), input = f.documentInput("RECEIVABLE", cp, "10000000.00");
  await assert.rejects(createDocument(f.actor, "RECEIVABLE", { ...input, recognitionBasis: "" }));
  assert.equal(await prisma.accountingDocument.count({ where: { createdById: f.actor } }), 0);
  const doc = await f.document("RECEIVABLE", cp, "10000000.00"); assert.ok(doc.journal);
  assert.equal(doc.journal.lines.find(row => row.accountId === f.arControl)?.debit.toFixed(2), "10000000.00");
  assert.equal(doc.journal.lines.find(row => row.accountId === f.revenue)?.credit.toFixed(2), "10000000.00");
  await f.settlement("RECEIVABLE", f.settlementInput(cp, [{ accountingDocumentId: doc.document.id, allocatedAmount: "4000000.00" }], "4000000.00"));
  await balance(f, "RECEIVABLE", doc.document.id, "6000000.00"); await reconciled(f, "RECEIVABLE", cp);
  await f.settlement("RECEIVABLE", f.settlementInput(cp, [{ accountingDocumentId: doc.document.id, allocatedAmount: "6000000.00" }], "6000000.00"));
  await balance(f, "RECEIVABLE", doc.document.id, "0.00"); await reconciled(f, "RECEIVABLE", cp);
}));

for (const kind of ["PAYABLE", "RECEIVABLE"] as const) test(`${kind} many-to-many allocations and unpaginated aging totals`, async () => aparScenario(async f => {
  const cp = await f.counterparty(kind), a = await f.document(kind, cp), b = await f.document(kind, cp, "5000000.00");
  await f.settlement(kind, f.settlementInput(cp, [{ accountingDocumentId: a.document.id, allocatedAmount: "8000000.00" },
    { accountingDocumentId: b.document.id, allocatedAmount: "2000000.00" }], "10000000.00"));
  await balance(f, kind, a.document.id, "0.00"); await balance(f, kind, b.document.id, "3000000.00");
  const report = await outstandingReport(f.actor, kind, query(cp, "2026-12-31", 1));
  assert.equal(report.outstanding, "3000000.00"); assert.equal(report.aging.days31To60, "3000000.00");
  const historical = await outstandingReport(f.actor, kind, query(cp, "2026-11-02", 1));
  assert.equal(historical.total, 2); assert.equal(historical.rows.length, 1); assert.equal(historical.outstanding, "13000000.00");
  await reconciled(f, kind, cp); await reconciled(f, kind, cp, "2026-11-02");
}));

test("AP allocations reject overpayment, mismatched totals, duplicate documents and wrong counterparties atomically", async () => aparScenario(async f => {
  const cp = await f.counterparty(), other = await f.counterparty(), doc = await f.document("PAYABLE", cp);
  for (const input of [
    f.settlementInput(cp, [{ accountingDocumentId: doc.document.id, allocatedAmount: "8000000.01" }], "8000000.01"),
    f.settlementInput(cp, [{ accountingDocumentId: doc.document.id, allocatedAmount: "1.00" }], "2.00"),
    f.settlementInput(cp, [{ accountingDocumentId: doc.document.id, allocatedAmount: "1.00" }, { accountingDocumentId: doc.document.id, allocatedAmount: "1.00" }], "2.00"),
    f.settlementInput(other, [{ accountingDocumentId: doc.document.id, allocatedAmount: "1.00" }], "1.00")
  ]) await assert.rejects(createSettlement(f.actor, "PAYABLE", input));
  assert.equal(await prisma.accountingSettlement.count({ where: { createdById: f.actor } }), 0);
  await balance(f, "PAYABLE", doc.document.id, "8000000.00"); await reconciled(f, "PAYABLE", cp);
}));

test("Concurrent approved payments cannot over-allocate the same invoice", async () => aparScenario(async f => {
  const cp = await f.counterparty(), doc = await f.document("PAYABLE", cp);
  const make = () => f.settlement("PAYABLE", f.settlementInput(cp, [{ accountingDocumentId: doc.document.id, allocatedAmount: "6000000.00" }], "6000000.00"), false);
  const a = await make(), b = await make();
  const results = await Promise.allSettled([postSource(f.poster, "PAYABLE", "SETTLEMENT", a.settlement.id, a.request.id),
    postSource(f.poster, "PAYABLE", "SETTLEMENT", b.settlement.id, b.request.id)]);
  assert.equal(results.filter(row => row.status === "fulfilled").length, 1);
  await balance(f, "PAYABLE", doc.document.id, "2000000.00"); await reconciled(f, "PAYABLE", cp);
  assert.equal(await prisma.accountingSettlement.count({ where: { createdById: f.actor, status: "POSTED" } }), 1);
}));

test("AP/AR permissions, self-approval prevention and centralized-engine bypass rejection", async () => aparScenario(async f => {
  const cp = await f.counterparty(), input = f.documentInput("PAYABLE", cp);
  await assert.rejects(createDocument(f.approval.outsiderId, "PAYABLE", input), { status: 403 });
  const doc = await createDocument(f.actor, "PAYABLE", input);
  const req = await submitSource(f.actor, "PAYABLE", "DOCUMENT", doc.id, 1);
  await assert.rejects(decideApproval(f.actor, req.id, "APPROVED", null), { status: 403 });
  await f.approve(req.id);
  await assert.rejects(postSource(f.actor, "PAYABLE", "DOCUMENT", doc.id, req.id), { status: 403 });
  await assert.rejects(prisma.$transaction(tx => postLedgerJournalInTransaction(tx, { journalType: "RECOGNITION",
    sourceKind: "AP_DOCUMENT", sourceReference: doc.id, accountingDate: new Date(input.accountingDate), postedById: f.poster, descriptionSnapshot: "TEST bypass attempt",
    lines: [{ accountId: f.expense, debit: "8000000.00", credit: "0.00" }, { accountId: f.apControl, debit: "0.00", credit: "8000000.00" }] })), /persisted Accounting approval/);
  await postSource(f.poster, "PAYABLE", "DOCUMENT", doc.id, req.id);
}));

test("Document and settlement revisions supersede stale approval and require current independent approval", async () => aparScenario(async f => {
  const cp = await f.counterparty(), doc = await f.document("PAYABLE", cp, "8000000.00", false);
  const revised = await updateDocument(f.actor, "PAYABLE", doc.document.id, { ...doc.input, expectedRevision: 1, recognitionBasis: "TEST revised executed contract evidence approved by reviewer." });
  await assert.rejects(postSource(f.poster, "PAYABLE", "DOCUMENT", revised.id, doc.request.id));
  assert.equal((await prisma.accountingApprovalRequest.findUniqueOrThrow({ where: { id: doc.request.id } })).status, "SUPERSEDED");
  const req = await submitSource(f.actor, "PAYABLE", "DOCUMENT", revised.id, 2); await f.approve(req.id);
  await postSource(f.poster, "PAYABLE", "DOCUMENT", revised.id, req.id);
  const s = await f.settlement("PAYABLE", f.settlementInput(cp, [{ accountingDocumentId: revised.id, allocatedAmount: "3000000.00" }], "3000000.00"), false);
  await updateSettlement(f.actor, "PAYABLE", s.settlement.id, { ...s.input, expectedRevision: 1, sourceReference: "TEST revised bank payment evidence" });
  await assert.rejects(postSource(f.poster, "PAYABLE", "SETTLEMENT", s.settlement.id, s.request.id));
  const next = await submitSource(f.actor, "PAYABLE", "SETTLEMENT", s.settlement.id, 2); await f.approve(next.id);
  await postSource(f.poster, "PAYABLE", "SETTLEMENT", s.settlement.id, next.id);
  await balance(f, "PAYABLE", revised.id, "5000000.00");
}));

test("Closed period and injected posting failure retain approved source without partial GL/application", async () => aparScenario(async f => {
  const cp = await f.counterparty(), doc = await f.document("PAYABLE", cp, "8000000.00", false);
  const period = await prisma.accountingPeriod.findUniqueOrThrow({ where: { periodCode: "2026-11" } });
  try {
    await prisma.accountingPeriod.update({ where: { id: period.id }, data: { status: "CLOSED", closedAt: new Date() } });
    await assert.rejects(postSource(f.poster, "PAYABLE", "DOCUMENT", doc.document.id, doc.request.id), /open accounting period/);
  } finally { await prisma.accountingPeriod.update({ where: { id: period.id }, data: { status: period.status, closedAt: period.closedAt } }); }
  const abort = new Error("APAR injected rollback");
  await assert.rejects(prisma.$transaction(async tx => { await postApprovedJournalInTransaction(tx, f.poster, doc.request.id); throw abort; }), error => error === abort);
  assert.equal((await prisma.accountingDocument.findUniqueOrThrow({ where: { id: doc.document.id } })).status, "DRAFT");
  assert.equal((await prisma.accountingApprovalRequest.findUniqueOrThrow({ where: { id: doc.request.id } })).status, "APPROVED");
  assert.equal(await prisma.accountingApprovalHistory.count({ where: { approvalRequestId: doc.request.id, action: "APPLY" } }), 0);
  assert.equal(await prisma.accountingJournal.count({ where: { postedById: f.poster } }), 0);
  await postSource(f.poster, "PAYABLE", "DOCUMENT", doc.document.id, doc.request.id);
  const s = await f.settlement("PAYABLE", f.settlementInput(cp, [{ accountingDocumentId: doc.document.id, allocatedAmount: "3000000.00" }], "3000000.00"), false);
  await assert.rejects(prisma.$transaction(async tx => { await postApprovedJournalInTransaction(tx, f.poster, s.request.id); throw abort; }), error => error === abort);
  assert.equal((await prisma.accountingSettlement.findUniqueOrThrow({ where: { id: s.settlement.id } })).status, "DRAFT");
  await balance(f, "PAYABLE", doc.document.id, "8000000.00"); await reconciled(f, "PAYABLE", cp);
}));

test("Approved payment then invoice reversal preserves journals and historical as-of balances", async () => aparScenario(async f => {
  const cp = await f.counterparty(), doc = await f.document("PAYABLE", cp);
  const s = await f.settlement("PAYABLE", f.settlementInput(cp, [{ accountingDocumentId: doc.document.id, allocatedAmount: "3000000.00" }], "3000000.00"));
  await assert.rejects(requestSourceReversal(f.actor, "PAYABLE", "DOCUMENT", doc.document.id, { accountingDate: "2026-11-04", remark: "TEST" }));
  const reversedPayment = await reverse(f, "PAYABLE", "SETTLEMENT", s.settlement.id);
  assert.equal(reversedPayment.reversalOfJournalId, s.journal?.id);
  await balance(f, "PAYABLE", doc.document.id, "8000000.00");
  await reverse(f, "PAYABLE", "DOCUMENT", doc.document.id, "2026-11-05");
  await balance(f, "PAYABLE", doc.document.id, "0.00");
  for (const [date, amount] of [["2026-11-03", "5000000.00"], ["2026-11-04", "8000000.00"], ["2026-11-05", "0.00"]]) {
    assert.equal((await outstandingReport(f.actor, "PAYABLE", query(cp, date))).outstanding, amount);
    await reconciled(f, "PAYABLE", cp, date);
  }
  assert.ok(await prisma.accountingJournal.findUnique({ where: { id: doc.journal?.id } }));
  assert.ok(await prisma.accountingJournal.findUnique({ where: { id: s.journal?.id } }));
}));

test("AR adjustments, over-adjustment protection and reversal reconcile with the original ledger", async () => aparScenario(async f => {
  const cp = await f.counterparty("RECEIVABLE"), doc = await f.document("RECEIVABLE", cp);
  const adjustment = (kind: "INCREASE" | "DECREASE", amount: string) => requestArAdjustment(f.actor, doc.document.id,
    { adjustmentReference: `TEST-${randomUUID()}`, accountingDate: "2026-11-03", adjustmentKind: kind, amount,
      offsetAccountId: f.revenue, reason: "Synthetic TEST approved earned-amount correction" });
  await assert.rejects(adjustment("DECREASE", "8000000.01"));
  const down = await adjustment("DECREASE", "1000000.00"); await f.approve(down.id); await postApprovedJournal(f.poster, down.id);
  await balance(f, "RECEIVABLE", doc.document.id, "7000000.00");
  const up = await adjustment("INCREASE", "2000000.00"); await f.approve(up.id); const upJournal = await postApprovedJournal(f.poster, up.id);
  await balance(f, "RECEIVABLE", doc.document.id, "9000000.00"); await reconciled(f, "RECEIVABLE", cp);
  const s = await f.settlement("RECEIVABLE", f.settlementInput(cp, [{ accountingDocumentId: doc.document.id, allocatedAmount: "8000000.00" }], "8000000.00"));
  await assert.rejects(submitApproval(f.actor, { kind: "JOURNAL_REVERSAL", sourceDocumentId: upJournal.id, accountingDate: "2026-11-04", remark: "TEST invalid negative reversal" }));
  await reverse(f, "RECEIVABLE", "SETTLEMENT", s.settlement.id);
  await f.applyReversal(await submitApproval(f.actor, { kind: "JOURNAL_REVERSAL", sourceDocumentId: upJournal.id, accountingDate: "2026-11-04", remark: "TEST valid adjustment reversal" }));
  await balance(f, "RECEIVABLE", doc.document.id, "7000000.00"); await reconciled(f, "RECEIVABLE", cp);
}));

test("AP matches an actual debit after payment without a second expense or bank journal", async () => aparScenario(async f => {
  const cp = await f.counterparty(), doc = await f.document("PAYABLE", cp);
  const s = await f.settlement("PAYABLE", f.settlementInput(cp, [{ accountingDocumentId: doc.document.id, allocatedAmount: "3000000.00" }], "3000000.00"));
  const bank = await f.bankEvidence("PAYABLE", "3000000.00"); assert.ok(bank.approvalId);
  await decideSignApprovalAtomic({ approvalId: bank.approvalId, userId: f.actor, decision: "APPROVED" });
  const before = await prisma.accountingJournal.count();
  const matched = await matchSettlement(f.actor, "PAYABLE", s.settlement.id, bank.transactionId, "TEST bank statement verified");
  assert.equal(matched.reconciliationState, "RECONCILED");
  await matchSettlement(f.actor, "PAYABLE", s.settlement.id, bank.transactionId, "Idempotent rematch");
  assert.equal(await prisma.accountingJournal.count(), before);
  assert.equal(await prisma.bankTransactionHistory.count({ where: { bankTransactionId: bank.transactionId, fieldName: "accounting_settlement_active" } }), 1);
  await balance(f, "PAYABLE", doc.document.id, "5000000.00"); await reconciled(f, "PAYABLE", cp);
}));

test("AR bank draft reservation blocks finalization atomically; posted receipt suppresses duplicate Phase1 revenue", async () => aparScenario(async f => {
  const cp = await f.counterparty("RECEIVABLE"), doc = await f.document("RECEIVABLE", cp);
  const bank = await f.bankEvidence("RECEIVABLE", "3000000.00"); assert.ok(bank.approvalId);
  const s = await f.settlement("RECEIVABLE", f.settlementInput(cp, [{ accountingDocumentId: doc.document.id, allocatedAmount: "3000000.00" }], "3000000.00", bank.transactionId), false);
  const decision = { approvalId: bank.approvalId, userId: f.actor, decision: "APPROVED" as const };
  await assert.rejects(decideSignApprovalAtomic(decision));
  assert.equal((await prisma.bankTransaction.findUniqueOrThrow({ where: { id: bank.transactionId } })).status, "CHECK");
  assert.equal((await prisma.reconciliationApproval.findUniqueOrThrow({ where: { id: bank.approvalId } })).status, "PENDING");
  await postSource(f.poster, "RECEIVABLE", "SETTLEMENT", s.settlement.id, s.request.id);
  assert.equal((await getSettlement(f.actor, "RECEIVABLE", s.settlement.id)).reconciliationState, "MATCHED_PENDING_FINALIZATION");
  const before = await prisma.accountingJournal.count(); await decideSignApprovalAtomic(decision);
  assert.equal(await prisma.accountingJournal.count(), before);
  assert.equal(await prisma.accountingJournal.count({ where: { sourceEventKey: `FINALIZED_BANK_TRANSACTION:${bank.transactionId}` } }), 0);
  assert.equal((await getSettlement(f.actor, "RECEIVABLE", s.settlement.id)).reconciliationState, "RECONCILED");
  await balance(f, "RECEIVABLE", doc.document.id, "5000000.00"); await reconciled(f, "RECEIVABLE", cp);
}));

test("Bank matching rejects wrong amounts/direction and already-recognized receipts", async () => aparScenario(async f => {
  const cp = await f.counterparty("RECEIVABLE"), doc = await f.document("RECEIVABLE", cp);
  const input = f.settlementInput(cp, [{ accountingDocumentId: doc.document.id, allocatedAmount: "3000000.00" }], "3000000.00");
  const wrongAmount = await f.bankEvidence("RECEIVABLE", "3000000.01"), wrongDirection = await f.bankEvidence("PAYABLE", "3000000.00");
  for (const row of [wrongAmount, wrongDirection]) await assert.rejects(createSettlement(f.actor, "RECEIVABLE", { ...input, bankTransactionId: row.transactionId }));
  const recognized = await f.bankEvidence("RECEIVABLE", "3000000.00"); assert.ok(recognized.approvalId);
  await decideSignApprovalAtomic({ approvalId: recognized.approvalId, userId: f.actor, decision: "APPROVED" });
  await assert.rejects(createSettlement(f.actor, "RECEIVABLE", { ...input, bankTransactionId: recognized.transactionId }), /active Phase 1 recognition/);
  const first = await f.settlement("RECEIVABLE", input);
  await assert.rejects(matchSettlement(f.actor, "RECEIVABLE", first.settlement.id, recognized.transactionId, "TEST"), /active Phase 1 recognition/);
  const clean = await f.bankEvidence("RECEIVABLE", "3000000.00");
  await matchSettlement(f.actor, "RECEIVABLE", first.settlement.id, clean.transactionId, "TEST verified");
  const next = await f.settlement("RECEIVABLE", { ...input, settlementReference: `TEST-${randomUUID()}` });
  await assert.rejects(matchSettlement(f.actor, "RECEIVABLE", next.settlement.id, clean.transactionId, "TEST double match"), /another posted settlement/);
}));

test("Unposted cancellation and rejection preserve independent approval/audit without financial entries", async () => aparScenario(async f => {
  const cp = await f.counterparty(), doc = await createDocument(f.actor, "PAYABLE", f.documentInput("PAYABLE", cp));
  await cancelSource(f.actor, "PAYABLE", "DOCUMENT", doc.id, 1, "TEST duplicate invoice withdrawn");
  const audit = await prisma.accountingApprovalRequest.findFirstOrThrow({ where: { accountingDocumentId: doc.id }, include: { history: true } });
  assert.equal(audit.status, "CANCELLED"); assert.ok(audit.history.some(row => row.action === "CANCEL" && row.remark === "TEST duplicate invoice withdrawn"));
  const next = await createDocument(f.actor, "PAYABLE", f.documentInput("PAYABLE", cp));
  const req = await submitSource(f.actor, "PAYABLE", "DOCUMENT", next.id, 1);
  await decideApproval(f.reviewer, req.id, "REJECTED", "TEST evidence incomplete");
  await assert.rejects(postSource(f.poster, "PAYABLE", "DOCUMENT", next.id, req.id));
  assert.equal(await prisma.accountingJournal.count({ where: { postedById: f.poster } }), 0);
}));

test("Backdated allocations, adjustments and reversals cannot create invalid historical outstanding", async () => aparScenario(async f => {
  const cp = await f.counterparty("RECEIVABLE"), doc = await f.document("RECEIVABLE", cp);
  const req = await requestArAdjustment(f.actor, doc.document.id, { adjustmentReference: `TEST-${randomUUID()}`,
    accountingDate: "2026-11-10", adjustmentKind: "INCREASE", amount: "2000000.00", offsetAccountId: f.revenue,
    reason: "Synthetic TEST later earned-amount evidence" });
  await f.approve(req.id); const adjustmentJournal = await postApprovedJournal(f.poster, req.id);
  await assert.rejects(createSettlement(f.actor, "RECEIVABLE", f.settlementInput(cp,
    [{ accountingDocumentId: doc.document.id, allocatedAmount: "10000000.00" }], "10000000.00")), /cannot predate/);
  await assert.rejects(requestArAdjustment(f.actor, doc.document.id, { adjustmentReference: `TEST-${randomUUID()}`,
    accountingDate: "2026-11-03", adjustmentKind: "DECREASE", amount: "9000000.00", offsetAccountId: f.revenue,
    reason: "Synthetic TEST invalid backdated credit" }), /cannot predate/);
  await balance(f, "RECEIVABLE", doc.document.id, "10000000.00");
  assert.equal((await outstandingReport(f.actor, "RECEIVABLE", query(cp, "2026-11-03"))).outstanding, "8000000.00");
  await reconciled(f, "RECEIVABLE", cp, "2026-11-03");
  await f.applyReversal(await submitApproval(f.actor, { kind: "JOURNAL_REVERSAL", sourceDocumentId: adjustmentJournal.id,
    accountingDate: "2026-11-11", remark: "TEST authorized later reversal" }));
  await assert.rejects(requestSourceReversal(f.actor, "RECEIVABLE", "DOCUMENT", doc.document.id,
    { accountingDate: "2026-11-10", remark: "TEST invalid reversal before dependency reversal" }), /cannot predate/);
  await reverse(f, "RECEIVABLE", "DOCUMENT", doc.document.id, "2026-11-12");
  await reconciled(f, "RECEIVABLE", cp, "2026-11-12");
}));

test("MySQL AP/AR preserves decimal cents beyond JavaScript integer precision", async () => aparScenario(async f => {
  const cp = await f.counterparty(), doc = await f.document("PAYABLE", cp, "9007199254740993.01");
  const s = await f.settlement("PAYABLE", f.settlementInput(cp,
    [{ accountingDocumentId: doc.document.id, allocatedAmount: "0.09" }], "0.09"));
  await balance(f, "PAYABLE", doc.document.id, "9007199254740992.92"); await reconciled(f, "PAYABLE", cp);
  await assert.rejects(postSource(f.poster, "PAYABLE", "SETTLEMENT", s.settlement.id, s.request.id));
  assert.equal(await prisma.accountingJournal.count({ where: { sourceKind: "AP_SETTLEMENT", sourceReference: s.settlement.id } }), 1);
}));

test("AP/AR material source tampering cannot reuse a signed digest", async () => aparScenario(async f => {
  const cp = await f.counterparty(), doc = await f.document("PAYABLE", cp, "8000000.00", false);
  await prisma.accountingDocumentLine.updateMany({ where: { accountingDocumentId: doc.document.id }, data: { amount: "8000000.01" } });
  await assert.rejects(postSource(f.poster, "PAYABLE", "DOCUMENT", doc.document.id, doc.request.id), /no longer matches/);
  assert.equal(await prisma.accountingJournal.count({ where: { sourceReference: doc.document.id } }), 0);
  assert.equal((await prisma.accountingApprovalRequest.findUniqueOrThrow({ where: { id: doc.request.id } })).status, "APPROVED");
}));

test("Bank-linked receipt rollback restores source, approval, match audit and GL together", async () => aparScenario(async f => {
  const cp = await f.counterparty("RECEIVABLE"), doc = await f.document("RECEIVABLE", cp);
  const bank = await f.bankEvidence("RECEIVABLE", "3000000.00");
  const s = await f.settlement("RECEIVABLE", f.settlementInput(cp,
    [{ accountingDocumentId: doc.document.id, allocatedAmount: "3000000.00" }], "3000000.00", bank.transactionId), false);
  const abort = new Error("TEST abort after receipt bank matching");
  await assert.rejects(prisma.$transaction(async tx => {
    await postApprovedJournalInTransaction(tx, f.poster, s.request.id); throw abort;
  }), error => error === abort);
  assert.equal((await getSettlement(f.actor, "RECEIVABLE", s.settlement.id)).status, "DRAFT");
  assert.equal(await prisma.accountingJournal.count({ where: { sourceReference: s.settlement.id } }), 0);
  assert.equal(await prisma.bankTransactionHistory.count({ where: { bankTransactionId: bank.transactionId, fieldName: "accounting_settlement_active" } }), 0);
  assert.equal((await prisma.accountingApprovalRequest.findUniqueOrThrow({ where: { id: s.request.id } })).status, "APPROVED");
  await balance(f, "RECEIVABLE", doc.document.id, "8000000.00"); await reconciled(f, "RECEIVABLE", cp);
}));

test("Control reconciliation exposes manual GL variance rather than hiding non-subledger entries", async () => aparScenario(async f => {
  const cp = await f.counterparty(), doc = await f.document("PAYABLE", cp);
  const { createDraft } = await import("../../src/modules/accounting/approval/approval.service.js");
  const roleId = f.approval.roleIds[0]; assert.ok(roleId);
  const permission = await prisma.menu.findFirstOrThrow({ where: { menuCode: "ACCOUNTING_JOURNAL_MANAGE" } });
  await prisma.roleMenu.create({ data: { roleId, menuId: permission.id } });
  const draft = await createDraft(f.actor, { journalType: "MANUAL", sourceReference: `TEST-${randomUUID()}`,
    accountingDate: "2026-11-03", description: "Synthetic TEST deliberate control variance",
    lines: [{ accountId: f.expense, debit: "1.00", credit: "0.00", counterpartyId: cp },
      { accountId: f.apControl, debit: "0.00", credit: "1.00", counterpartyId: cp }] });
  const req = await submitApproval(f.actor, { kind: "MANUAL_JOURNAL", sourceDocumentId: draft.id, expectedRevision: 1 });
  await f.approve(req.id); await postApprovedJournal(f.poster, req.id);
  const result = await controlReconciliation(f.actor, "PAYABLE", query(cp));
  assert.equal(result.reconciled, false); assert.equal(result.rows[0]?.variance, "-1.00");
  await balance(f, "PAYABLE", doc.document.id, "8000000.00");
}));

test("AP/AR HTTP routes retain auth/permission/input conventions and expose posting, details, allocation and reports", async () => aparScenario(async f => {
  const { app } = await import("../../src/app.js"), { env } = await import("../../src/config/env.js");
  const server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/api/accounting`;
  const call = (actor: string, route: string, body?: unknown, method = "POST") => fetch(url + route, { method,
    headers: { Authorization: `Bearer ${jwt.sign({ sub: actor }, env.jwtSecret)}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  try {
    const cp = await f.counterparty(), input = f.documentInput("PAYABLE", cp);
    assert.equal((await fetch(url + "/ap/documents")).status, 401);
    assert.equal((await call(f.approval.outsiderId, "/ap/documents", input)).status, 403);
    assert.equal((await call(f.actor, "/ap/documents", { ...input, lines: [{ ...input.lines[0], amount: "1.001" }] })).status, 400);
    const created = await call(f.actor, "/ap/documents", input); assert.equal(created.status, 201); const doc = await created.json();
    const submitted = await call(f.actor, `/ap/documents/${doc.id}/submit`, { expectedRevision: 1 }); assert.equal(submitted.status, 201); const req = await submitted.json();
    assert.equal((await call(f.actor, `/approvals/${req.id}/decision`, { decision: "APPROVED" })).status, 403);
    assert.equal((await call(f.reviewer, `/approvals/${req.id}/decision`, { decision: "APPROVED" })).status, 200);
    assert.equal((await call(f.poster, `/ap/documents/${doc.id}/post`, { approvalRequestId: req.id })).status, 201);
    const detail = await call(f.actor, `/ap/documents/${doc.id}`, undefined, "GET"); assert.equal(detail.status, 200); assert.equal((await detail.json()).outstanding, "8000000.00");
    for (const route of ["outstanding", "aging", "control-reconciliation"]) assert.equal((await call(f.actor,
      `/ap/${route}?asOf=2026-11-30&counterpartyId=${cp}`, undefined, "GET")).status, 200);
    assert.equal((await call(f.actor, "/ar/documents", undefined, "GET")).status, 200);
    assert.equal((await call(f.actor, "/counterparties", undefined, "GET")).status, 200);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}));
