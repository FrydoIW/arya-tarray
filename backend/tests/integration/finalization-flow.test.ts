import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../../src/lib/prisma.js";
import { randomUUID } from "node:crypto";
import { finalScenario, type FinalizationFixture } from "./finalization-fixture.js";
import { financialStatements } from "../../src/modules/accounting/finalization/reporting.service.js";
import { requestClosing, requestReportSnapshot, getReportSnapshot, financialIntegrity, openingPreparation } from "../../src/modules/accounting/finalization/finalization.workflow.js";
import { previewClose } from "../../src/modules/accounting/finalization/closing.service.js";
import { subledgerReconciliations } from "../../src/modules/accounting/finalization/reconciliation.service.js";
import { applyApprovedAction, createDraft, submitApproval, postApprovedJournal, decideApproval, postApprovedJournalInTransaction } from "../../src/modules/accounting/approval/approval.service.js";
import { getGeneralLedger } from "../../src/modules/accounting/ledger/ledger-report.service.js";
import { createBankReconciliation, matchBank, voidBankMatch, getBankReconciliation, bankAdjustmentDraft } from "../../src/modules/accounting/finalization/bank-reconciliation.service.js";
import { bankReconInputSchema } from "../../src/modules/accounting/finalization/finalization.schema.js";
import { decideSignApprovalAtomic } from "../../src/modules/approval/sign-approval/sign-approval.repository.js";
import { createRun } from "../../src/modules/accounting/assets/asset.service.js";
import { createAssetChange } from "../../src/modules/accounting/assets/asset-change.service.js";
import { createDocument, submitSource, postSource } from "../../src/modules/accounting/apar/apar.service.js";
import { verifyPostedLedgerAudits } from "../../src/modules/accounting/ledger/ledger-audit.js";
import { day } from "../../src/modules/accounting/finalization/finalization.repository.js";
import { createFiscalYear, createPeriod } from "../../src/modules/accounting/period/period.service.js";
import { createDesignation, createFundCommand } from "../../src/modules/accounting/funds/fund.service.js";
import { fundCommandSchema } from "../../src/modules/accounting/funds/fund.schema.js";
import jwt from "jsonwebtoken";
async function readyDonation(f: FinalizationFixture) {
  await f.policy(); const d = await f.donation(); await f.signBank("20000000.00", "2026-11", [{ bankId: d.bank.transactionId, lineId: d.bankLine.id, amount: "20000000.00" }]); return d;
}
test("Stage26 A/H donation, source classification and bank reconciliation feed GL-only financial statements", async () => finalScenario(async f => {
  await readyDonation(f); const r = await financialStatements(f.actor, f.query()); assert.equal(r.status, "DRAFT_VERIFIED", JSON.stringify(r.exceptions));
  assert.equal(r.financialPosition.assets, "20000000.00"); assert.equal(r.financialPosition.totalNetAssets, "20000000.00"); assert.equal(r.financialPosition.difference, "0.00"); assert.equal(r.comprehensiveIncome.surplusDeficit, "20000000.00");
  assert.equal(r.cashFlows.netMovement, "20000000.00"); assert.equal(r.cashFlows.activities?.OPERATING, "20000000.00"); assert.equal(r.cashFlows.difference, "0.00"); assert.equal(r.changesInNetAssets.UNRESTRICTED?.closing, "20000000.00");
  assert.equal((await financialIntegrity(f.actor, f.query())).status, "VERIFIED");
}));
test("Stage26 missing policy/mappings stays UNVERIFIED and cannot close or publish FINAL", async () => finalScenario(async f => {
  const r = await financialStatements(f.actor, f.query()); assert.equal(r.status, "UNVERIFIED"); assert.ok(r.exceptions.some(e => e.includes("PENDING_POLICY"))); assert.ok(r.exceptions.some(e => e.includes("UNMAPPED")));
  const p = await prisma.accountingPeriod.findUniqueOrThrow({ where: { periodCode: "2026-11" } }); await assert.rejects(requestClosing(f.actor, "PERIOD", p.id, false, "Synthetic TEST invalid close", "Synthetic TEST missing policy evidence"), /not ready/);
  assert.equal((await prisma.accountingPeriod.findUniqueOrThrow({ where: { id: p.id } })).status, "OPEN"); await assert.rejects(requestReportSnapshot(f.actor, f.query()));
}));
test("Stage26 G closing freezes posting, requires independent review, snapshots reports and reopens with revisions", async () => finalScenario(async f => {
  await readyDonation(f); const p = await prisma.accountingPeriod.findUniqueOrThrow({ where: { periodCode: "2026-11" } }), close = await f.close("2026-11", false);
  assert.equal((await prisma.accountingPeriod.findUniqueOrThrow({ where: { id: p.id } })).status, "CLOSING"); await assert.rejects(f.manual("1.00"), /open/i);
  await assert.rejects(applyApprovedAction(f.approval.outsiderId, close.approval.id), /denied|permission/i); await applyApprovedAction(f.poster, close.approval.id); assert.equal((await prisma.accountingPeriod.findUniqueOrThrow({ where: { id: p.id } })).status, "CLOSED");
  await assert.rejects(f.manual("1.00"), /open/i); const snap = await requestReportSnapshot(f.actor, f.query()); await f.approve(snap.approval.id); await applyApprovedAction(f.poster, snap.approval.id);
  assert.equal((await getReportSnapshot(f.actor, snap.snapshot.id)).currentStatus, "CURRENT");
  const reopen = await requestClosing(f.actor, "PERIOD", p.id, true, "Synthetic TEST authorized period correction", "Synthetic TEST reopening evidence reviewed"); await f.approve(reopen.approval.id); await applyApprovedAction(f.poster, reopen.approval.id);
  assert.equal((await getReportSnapshot(f.actor, snap.snapshot.id)).currentStatus, "REVISED_SINCE_PUBLICATION"); const saved = await getReportSnapshot(f.actor, snap.snapshot.id); assert.equal(saved.immutableReport.financialPosition && typeof saved.immutableReport.financialPosition === "object" && !Array.isArray(saved.immutableReport.financialPosition) ? saved.immutableReport.financialPosition.assets : null, "20000000.00");
}));
test("Stage26 annual close moves actual temporary balances once and reopening reverses without changing total net assets", async () => finalScenario(async f => {
  await readyDonation(f); await f.signBank("0.00", "2026-10"); await f.close("2026-10"); await f.close("2026-11"); await f.signBank("20000000.00", "2026-12", [], "20000000.00"); await f.close("2026-12");
  const preview = await previewClose(f.actor, "YEAR", f.fiscalYearId); assert.equal(preview.status, "READY", JSON.stringify(preview.items.filter(i => i.status === "FAIL" || i.status === "PENDING_REVIEW")));
  const close = await requestClosing(f.actor, "YEAR", f.fiscalYearId, false, "Synthetic TEST full-year close reviewed", "Synthetic TEST adopted annual transfer evidence"); await f.approve(close.approval.id); const journal = await applyApprovedAction(f.poster, close.approval.id);
  assert.ok("journalType" in journal && journal.journalType === "CLOSING"); const r = await financialStatements(f.actor, f.query("2026-01-01", "2026-12-31")); assert.equal(r.financialPosition.permanentNetAssets, "20000000.00"); assert.equal(r.financialPosition.undistributedSurplusDeficit, "0.00"); assert.equal(r.comprehensiveIncome.surplusDeficit, "20000000.00"); assert.equal(r.financialPosition.totalNetAssets, "20000000.00");
  await assert.rejects(applyApprovedAction(f.poster, close.approval.id)); assert.equal(await prisma.accountingJournal.count({ where: { sourceKind: "YEAR_CLOSE" } }), 1);
  const prep = await openingPreparation(f.actor, f.fiscalYearId); assert.equal(prep.ready, true); assert.equal(prep.postingAutomatic, false);
  const reopen = await requestClosing(f.actor, "YEAR", f.fiscalYearId, true, "Synthetic TEST annual correction reason", "Synthetic TEST independently authorized reopening"); await f.approve(reopen.approval.id); await applyApprovedAction(f.poster, reopen.approval.id);
  const after = await financialStatements(f.actor, f.query("2026-01-01", "2026-12-31")); assert.equal(after.financialPosition.totalNetAssets, "20000000.00"); assert.equal(after.financialPosition.permanentNetAssets, "0.00"); assert.equal(after.comprehensiveIncome.surplusDeficit, "20000000.00"); assert.equal(await prisma.accountingJournal.count({ where: { sourceKind: "YEAR_REOPEN" } }), 1);
}));
test("Stage26 B/C AP partial payment and AR partial receipt reconcile at exact historical cut-off", async () => finalScenario(async f => {
  await f.policy(); const vendor = await f.counterparty("PAYABLE"), ap = await f.document("PAYABLE", vendor, "8000000.00");
  const bankPay = await f.bankEvidence("PAYABLE", "3000000.00"); await f.settlement("PAYABLE", f.settlementInput(vendor, [{ accountingDocumentId: ap.document.id, allocatedAmount: "3000000.00" }], "3000000.00", bankPay.transactionId));
  const debtor = await f.counterparty("RECEIVABLE"), ar = await f.document("RECEIVABLE", debtor, "10000000.00"), bankRec = await f.bankEvidence("RECEIVABLE", "4000000.00"); await f.settlement("RECEIVABLE", f.settlementInput(debtor, [{ accountingDocumentId: ar.document.id, allocatedAmount: "4000000.00" }], "4000000.00", bankRec.transactionId));
  const before = await subledgerReconciliations(f.actor, f.fiscalYearId, "2026-11-02"), after = await subledgerReconciliations(f.actor, f.fiscalYearId, "2026-11-03"); assert.equal(before.ap.subledgerTotal, "8000000.00"); assert.equal(after.ap.subledgerTotal, "5000000.00"); assert.equal(after.ar.subledgerTotal, "6000000.00"); assert.equal(after.ap.status, "BALANCED"); assert.equal(after.ar.status, "BALANCED");
  const reports = await financialStatements(f.actor, f.query()); assert.equal(reports.financialPosition.difference, "0.00"); assert.equal(reports.cashFlows.netMovement, "1000000.00"); assert.equal(reports.comprehensiveIncome.surplusDeficit, "2000000.00");
}));
test("Stage26 D prepaid expense reports and source schedule remain consistent before/after amortization", async () => finalScenario(async f => {
  const prepaid = await f.extraAccount("ASSET"), cp = await f.counterparty(), input = f.documentInput("PAYABLE", cp, "12000000.00"); input.lines[0].accountingAccountId = prepaid;
  const doc = await createDocument(f.actor, "PAYABLE", input), req = await submitSource(f.actor, "PAYABLE", "DOCUMENT", doc.id, doc.revision); await f.approve(req.id);
  const journal = await postSource(f.poster, "PAYABLE", "DOCUMENT", doc.id, req.id), line = journal.lines.find(l => l.accountId === prepaid); assert.ok(line);
  const schedule = await f.schedule(f.scheduleInput("PREPAYMENT", line.id)), period = await prisma.accountingSchedulePeriod.findFirstOrThrow({ where: { accountingScheduleId: schedule.id }, orderBy: { recognitionDate: "asc" } });
  await f.recognize(period.id); await f.policy(); const r = await financialStatements(f.actor, f.query()), subs = await subledgerReconciliations(f.actor, f.fiscalYearId, "2026-11-30");
  assert.equal(r.comprehensiveIncome.surplusDeficit, "-6000000.00"); assert.equal(subs.accruals.status, "BALANCED"); assert.equal(subs.accruals.subledgerTotal, "6000000.00");
  assert.equal(subs.ap.status, "BALANCED"); assert.equal(subs.ar.status, "BALANCED"); assert.equal(r.status, "DRAFT_VERIFIED");
  await f.signBank("0.00"); assert.equal((await financialIntegrity(f.actor, f.query())).status, "VERIFIED");
}));
test("Stage26 F restricted contribution, eligible expense and release preserve total resources in statements", async () => finalScenario(async f => {
  await f.policy(); const bank = await f.bankSource("STANDARD"); assert.ok(bank.line); const restricted = await f.fund("DONOR_RESTRICTED"), unrestricted = await f.fund(), rest = await f.restrict(restricted.row.id, bank.line.id);
  const expense = await f.manual("7000000.00", f.revenue, unrestricted.row.id, true); await f.release(rest.r.id, f.releaseInput(unrestricted.row.id, expense.line.id));
  const r = await financialStatements(f.actor, f.query()); assert.equal(r.changesInNetAssets.RESTRICTED?.closing, "13000000.00"); assert.equal(r.changesInNetAssets.UNRESTRICTED?.closing, "0.00"); assert.equal(r.financialPosition.totalNetAssets, "13000000.00"); assert.equal(r.comprehensiveIncome.surplusDeficit, "13000000.00"); assert.equal(r.cashFlows.netMovement, "20000000.00"); assert.equal((await subledgerReconciliations(f.actor, f.fiscalYearId, "2026-11-30")).funds.status, "BALANCED");
}));
test("Stage26 General Ledger running balance is independent of pagination and has opening/closing totals", async () => finalScenario(async f => {
  await f.manual("100.00", f.revenue, null, false, "2026-10-30"); await f.manual("30.00"); await f.manual("20.00");
  const q = { from: "2026-11-01", to: "2026-11-30", accountId: f.bankGl, page: 2, pageSize: 1 }, page = await getGeneralLedger(q);
  assert.equal(page.rows[0]?.runningBalance, "150.00"); assert.equal(page.openingBalances[0]?.balance, "100.00"); assert.equal(page.closingBalances[0]?.balance, "150.00");
}));
async function bankRoot(f: FinalizationFixture, closing = "20000000.00", periodCode = "2026-11", opening = "0.00", timingItems: { kind: "OUTSTANDING_PAYMENT" | "DEPOSIT_IN_TRANSIT"; journalLineId: string; amount: string; evidence: string }[] = []) {
  const p = await prisma.accountingPeriod.findUniqueOrThrow({ where: { periodCode } }); return createBankReconciliation(f.actor, bankReconInputSchema.parse({ bankAccountId: f.approval.base.bankAccountId, bankGlAccountId: f.bankGl, accountingPeriodId: p.id, reconciliationReference: randomUUID(), statementOpeningBalance: opening, statementClosingBalance: closing, openingEvidence: "Synthetic TEST reviewed statement opening evidence", statementEvidence: "Synthetic TEST complete statement closing evidence", timingItems }));
}
test("Stage26 E asset AP acquisition, partial payment, depreciation and write-off tie to GL and cash flows", async () => finalScenario(async f => {
  const a = await f.assetEvidence(); await f.policy(p => { const cost = p.mappings.find(m => m.accountId === a.cost), dep = p.mappings.find(m => m.accountId === a.expense); assert.ok(cost && dep); cost.section = "NONCURRENT_ASSETS"; cost.cashFlowActivity = "INVESTING"; dep.incomeClass = "DEPRECIATION"; });
  const bank = await f.bankEvidence("PAYABLE", "3000000.00"); assert.ok(bank.approvalId); await decideSignApprovalAtomic({ approvalId: bank.approvalId, userId: f.actor, decision: "APPROVED" });
  await f.settlement("PAYABLE", f.settlementInput(a.cp, [{ accountingDocumentId: a.doc.id, allocatedAmount: "3000000.00" }], "3000000.00", bank.transactionId));
  const p = await prisma.accountingPeriod.findUniqueOrThrow({ where: { periodCode: "2026-11" } }), run = await createRun(f.actor, { runReference: randomUUID(), accountingPeriodId: p.id, assetIds: [a.asset.id] }), req = await submitApproval(f.actor, { kind: "DEPRECIATION_RUN", sourceDocumentId: run.id, expectedRevision: 1 }); await f.approve(req.id); await postApprovedJournal(f.poster, req.id);
  let r = await financialStatements(f.actor, f.query()), subs = await subledgerReconciliations(f.actor, f.fiscalYearId, "2026-11-30"); assert.equal(r.comprehensiveIncome.recognizedExpenses, "6000000.00"); assert.equal(r.cashFlows.activities?.INVESTING, "-3000000.00"); assert.equal(r.cashFlows.netMovement, "-3000000.00"); assert.equal(subs.assets.status, "BALANCED"); assert.equal(subs.ap.subledgerTotal, "9000000.00");
  const change = await createAssetChange(f.actor, a.asset.id, { action: "WRITE_OFF", effectiveDate: "2026-11-30", reason: "Synthetic TEST reviewed asset write-off" }), cr = await submitApproval(f.actor, { kind: "ASSET_JOURNAL", sourceDocumentId: change.id, expectedRevision: 1 }); await f.approve(cr.id); await postApprovedJournal(f.poster, cr.id);
  r = await financialStatements(f.actor, f.query()); subs = await subledgerReconciliations(f.actor, f.fiscalYearId, "2026-11-30"); assert.equal(r.comprehensiveIncome.surplusDeficit, "-12000000.00"); assert.equal(r.financialPosition.difference, "0.00"); assert.equal(r.cashFlows.netMovement, "-3000000.00"); assert.equal(subs.assets.status, "BALANCED");
  const prior = await subledgerReconciliations(f.actor, f.fiscalYearId, "2026-11-02"); assert.equal(prior.assets.status, "BALANCED"); assert.ok(prior.assets.rows.some(x => x.accountId === a.cost && x.subledger === "12000000.00"));
}));
test("Stage26 partial one-to-many and many-to-one matching caps both real bank and GL amounts", async () => finalScenario(async f => {
  await f.policy(); const cp = await f.counterparty(), doc = await f.document("PAYABLE", cp, "30.00");
  const payments = []; for (const amount of ["8.00", "12.00", "10.00"]) { const s = await f.settlement("PAYABLE", f.settlementInput(cp, [{ accountingDocumentId: doc.document.id, allocatedAmount: amount }], amount)); assert.ok(s.journal); const l = s.journal.lines.find(l => l.accountId === f.bankGl); assert.ok(l); payments.push(l); }
  const banks = []; for (const amount of ["20.00", "4.00", "6.00"]) { const b = await f.bankEvidence("PAYABLE", amount); assert.ok(b.approvalId); await decideSignApprovalAtomic({ approvalId: b.approvalId, userId: f.actor, decision: "APPROVED" }); banks.push(b); }
  const root = await bankRoot(f, "-30.00"); for (const [bi, gi, amount] of [[0, 0, "8.00"], [0, 1, "12.00"], [1, 2, "4.00"], [2, 2, "6.00"]] as const) await matchBank(f.actor, root.id, { bankTransactionId: banks[bi].transactionId, journalLineId: payments[gi].id, amount, evidence: "Synthetic TEST bank payment batch source proof" });
  await assert.rejects(matchBank(f.actor, root.id, { bankTransactionId: banks[0].transactionId, journalLineId: payments[0].id, amount: "0.01", evidence: "Synthetic TEST duplicate overmatch attempt" }), /Duplicate|capacity/);
  const r = await getBankReconciliation(f.actor, root.id); assert.equal(r.status, "VERIFIED", JSON.stringify(r.exceptions)); assert.equal(r.difference, "0.00"); assert.equal(r.matchedTransactions.length, 4);
  assert.equal((await financialStatements(f.actor, f.query())).cashFlows.netMovement, "-30.00");
}));
test("Stage26 concurrent bank match has one winner and sign/direction mismatches fail", async () => finalScenario(async f => {
  await f.policy(); const d = await f.donation(), root = await bankRoot(f);
  const input = { bankTransactionId: d.bank.transactionId, journalLineId: d.bankLine.id, amount: "20000000.00", evidence: "Synthetic TEST exact concurrent bank match" };
  const results = await Promise.allSettled([matchBank(f.actor, root.id, input), matchBank(f.actor, root.id, input)]); assert.equal(results.filter(r => r.status === "fulfilled").length, 1); assert.equal(await prisma.accountingBankReconciliationMatch.count(), 1);
  const e = await f.manual("1.00", f.revenue, null, true); await assert.rejects(matchBank(f.actor, root.id, { ...input, journalLineId: e.line.id, amount: "1.00" }), /identity|evidence|direction/);
}));
test("Stage26 outstanding payment timing difference is evidenced and not posted as an error", async () => finalScenario(async f => {
  await f.policy(); const d = await createDraft(f.actor, { journalType: "MANUAL", accountingDate: "2026-10-30", sourceReference: randomUUID(), description: "Synthetic TEST issued payment not yet on bank statement", lines: [{ accountId: f.expense, debit: "50.00", credit: "0.00" }, { accountId: f.bankGl, debit: "0.00", credit: "50.00", bankAccountId: f.approval.base.bankAccountId }] }); const a = await submitApproval(f.actor, { kind: "MANUAL_JOURNAL", sourceDocumentId: d.id, expectedRevision: 1 }); await f.approve(a.id); const j = await postApprovedJournal(f.poster, a.id), line = j.lines.find(l => l.accountId === f.bankGl); assert.ok(line);
  const root = await bankRoot(f, "0.00", "2026-10", "0.00", [{ kind: "OUTSTANDING_PAYMENT", journalLineId: line.id, amount: "50.00", evidence: "Synthetic TEST actual issued bank payment timing proof" }]); const count = await prisma.accountingJournal.count(), r = await getBankReconciliation(f.actor, root.id); assert.equal(r.status, "VERIFIED"); assert.equal(r.adjustedBankBalance, "-50.00"); assert.equal(r.glClosing, "-50.00"); assert.equal(await prisma.accountingJournal.count(), count);
}));
test("Stage26 bank charge adjustment needs independent approval and never creates a second cash movement", async () => finalScenario(async f => {
  await f.policy(); const b = await f.bankEvidence("PAYABLE", "100.00"); assert.ok(b.approvalId); await decideSignApprovalAtomic({ approvalId: b.approvalId, userId: f.actor, decision: "APPROVED" }); const root = await bankRoot(f, "-100.00");
  const d = await bankAdjustmentDraft(f.actor, root.id, { bankTransactionId: b.transactionId, kind: "CHARGE", offsetAccountId: f.expense, evidence: "Synthetic TEST actual bank service charge evidence" }); assert.equal(await prisma.accountingJournal.count(), 0);
  const req = await submitApproval(f.actor, { kind: "ADJUSTING_JOURNAL", sourceDocumentId: d.id, expectedRevision: 1 }); await f.approve(req.id); const j = await postApprovedJournal(f.poster, req.id), line = j.lines.find(l => l.accountId === f.bankGl); assert.ok(line);
  await matchBank(f.actor, root.id, { bankTransactionId: b.transactionId, journalLineId: line.id, amount: "100.00", evidence: "Synthetic TEST charge matched to approved adjustment" });
  await assert.rejects(bankAdjustmentDraft(f.actor, root.id, { bankTransactionId: b.transactionId, kind: "CHARGE", offsetAccountId: f.expense, evidence: "Synthetic TEST repeated bank charge source" })); assert.equal(await prisma.accountingJournal.count(), 1); assert.equal((await getBankReconciliation(f.actor, root.id)).difference, "0.00");
}));
test("Stage26 closed bank reconciliation requires independent reopening before matches can be voided", async () => finalScenario(async f => {
  await f.policy(); const d = await f.donation(), signed = await f.signBank("20000000.00", "2026-11", [{ bankId: d.bank.transactionId, lineId: d.bankLine.id, amount: "20000000.00" }]), m = await prisma.accountingBankReconciliationMatch.findFirstOrThrow();
  await assert.rejects(voidBankMatch(f.actor, signed.root.id, m.id, "Synthetic TEST unauthorized historical void"));
  const root = await prisma.accountingBankReconciliation.findUniqueOrThrow({ where: { id: signed.root.id } }), req = await submitApproval(f.actor, { kind: "BANK_RECONCILIATION", sourceDocumentId: root.id, expectedRevision: root.revision, bankAction: "REOPEN", reason: "Synthetic TEST bank review correction", evidenceReference: "Synthetic TEST independent reopening evidence" }); await f.approve(req.id); await applyApprovedAction(f.poster, req.id);
  await voidBankMatch(f.actor, root.id, m.id, "Synthetic TEST approved evidence correction"); assert.equal((await getBankReconciliation(f.actor, root.id)).status, "UNVERIFIED");
  assert.equal(await prisma.accountingApprovalRequest.count({ where: { bankReconciliationId: root.id, status: "APPLIED" } }), 2);
}));
test("Stage26 concurrent closing has one request/application winner and a single close audit", async () => finalScenario(async f => {
  await readyDonation(f); const p = await prisma.accountingPeriod.findUniqueOrThrow({ where: { periodCode: "2026-11" } }), input = [f.actor, "PERIOD", p.id, false, "Synthetic TEST concurrent closing", "Synthetic TEST independently reviewed evidence"] as const;
  const requests = await Promise.allSettled([requestClosing(...input), requestClosing(...input)]), winners = requests.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof requestClosing>>> => r.status === "fulfilled"); assert.equal(winners.length, 1); const req = winners[0].value.approval; await f.approve(req.id);
  const result = await Promise.allSettled([applyApprovedAction(f.poster, req.id), applyApprovedAction(f.poster, req.id)]); assert.equal(result.filter(r => r.status === "fulfilled").length, 1); assert.equal(await prisma.accountingApprovalHistory.count({ where: { approvalRequestId: req.id, action: "APPLY" } }), 1); assert.equal((await prisma.accountingPeriod.findUniqueOrThrow({ where: { id: p.id } })).status, "CLOSED");
}));
test("Stage26 concurrent reopening preserves one independent command, one application and one OPEN transition", async () => finalScenario(async f => {
  await readyDonation(f); await f.close();
  const p = await prisma.accountingPeriod.findUniqueOrThrow({ where: { periodCode: "2026-11" } });
  const input = [f.actor, "PERIOD", p.id, true, "Synthetic TEST concurrent reopening", "Synthetic TEST independent correction evidence"] as const;
  const requested = await Promise.allSettled([requestClosing(...input), requestClosing(...input)]);
  const winners = requested.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof requestClosing>>> => r.status === "fulfilled");
  assert.equal(winners.length, 1); const req = winners[0].value.approval;
  await assert.rejects(f.manual("1.00"), /open/i); await f.approve(req.id);
  const applied = await Promise.allSettled([applyApprovedAction(f.poster, req.id), applyApprovedAction(f.poster, req.id)]);
  assert.equal(applied.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(await prisma.accountingApprovalHistory.count({ where: { approvalRequestId: req.id, action: "APPLY" } }), 1);
  assert.equal((await prisma.accountingPeriod.findUniqueOrThrow({ where: { id: p.id } })).status, "OPEN");
  assert.equal(await prisma.accountingJournal.count({ where: { sourceKind: "PERIOD_REOPEN" } }), 0);
}));
test("Stage26 final snapshot preserves published amounts but flags changed external evidence and prevents another publication", async () => finalScenario(async f => {
  const d = await readyDonation(f); await f.close();
  const snap = await requestReportSnapshot(f.actor, f.query()); await f.approve(snap.approval.id); await applyApprovedAction(f.poster, snap.approval.id);
  const before = await getReportSnapshot(f.actor, snap.snapshot.id);
  await prisma.bankTransaction.update({ where: { id: d.bank.transactionId }, data: { originalAmount: "20000001.00" } });
  const after = await getReportSnapshot(f.actor, snap.snapshot.id);
  assert.equal(after.currentStatus, "REVIEW_REQUIRED_SOURCE_EVIDENCE_CHANGED"); assert.deepEqual(after.immutableReport, before.immutableReport);
  assert.equal(after.currentReference.fingerprint, before.currentReference.fingerprint);
  const count = await prisma.accountingJournalDraft.count({ where: { sourceKind: "REPORT_SNAPSHOT" } });
  await assert.rejects(requestReportSnapshot(f.actor, f.query()), /integrity|reconciliation/i);
  assert.equal(await prisma.accountingJournalDraft.count({ where: { sourceKind: "REPORT_SNAPSHOT" } }), count);
}));
test("Stage26 deposit in transit carries actual GL evidence without inventing a bank transaction or adjustment", async () => finalScenario(async f => {
  await f.policy(); const d = await createDraft(f.actor, { journalType: "MANUAL", accountingDate: "2026-10-30", sourceReference: randomUUID(), description: "Synthetic TEST actual deposit awaiting bank statement", lines: [{ accountId: f.bankGl, debit: "75.00", credit: "0.00", bankAccountId: f.approval.base.bankAccountId }, { accountId: f.revenue, debit: "0.00", credit: "75.00" }] });
  const req = await submitApproval(f.actor, { kind: "MANUAL_JOURNAL", sourceDocumentId: d.id, expectedRevision: 1 }); await f.approve(req.id); const journal = await postApprovedJournal(f.poster, req.id), line = journal.lines.find(l => l.accountId === f.bankGl); assert.ok(line);
  const bankCount = await prisma.bankTransaction.count(), journalCount = await prisma.accountingJournal.count();
  const root = await bankRoot(f, "0.00", "2026-10", "0.00", [{ kind: "DEPOSIT_IN_TRANSIT", journalLineId: line.id, amount: "75.00", evidence: "Synthetic TEST issued deposit slip pending bank credit" }]);
  const preview = await getBankReconciliation(f.actor, root.id); assert.equal(preview.status, "VERIFIED"); assert.equal(preview.adjustedBankBalance, "75.00"); assert.equal(preview.glClosing, "75.00");
  assert.equal(await prisma.bankTransaction.count(), bankCount); assert.equal(await prisma.accountingJournal.count(), journalCount);
}));
test("Stage26 equal-net bank direction changes invalidate individual match evidence and signed review", async () => finalScenario(async f => {
  await f.policy(); const plus = await f.bankEvidence("RECEIVABLE", "100.00"), minus = await f.bankEvidence("PAYABLE", "100.00");
  assert.ok(plus.approvalId && minus.approvalId);
  for (const b of [plus, minus]) { assert.ok(b.approvalId); await decideSignApprovalAtomic({ approvalId: b.approvalId, userId: f.actor, decision: "APPROVED" }); }
  const incoming = await prisma.accountingJournal.findFirstOrThrow({ where: { bankTransactionId: plus.transactionId, sourceKind: "FINALIZED_BANK_TRANSACTION" }, include: { lines: true } }), draft = await createDraft(f.actor, { journalType: "MANUAL", accountingDate: "2026-11-03", sourceReference: randomUUID(), description: "Synthetic TEST independently reviewed actual cash expense", lines: [{ accountId: f.expense, debit: "100.00", credit: "0.00" }, { accountId: f.bankGl, debit: "0.00", credit: "100.00", bankAccountId: f.approval.base.bankAccountId }] });
  const req = await submitApproval(f.actor, { kind: "MANUAL_JOURNAL", sourceDocumentId: draft.id, expectedRevision: 1 }); await f.approve(req.id); const outgoing = await postApprovedJournal(f.poster, req.id);
  const inLine = incoming.lines.find(l => l.accountId === f.bankGl), outLine = outgoing.lines.find(l => l.accountId === f.bankGl); assert.ok(inLine && outLine);
  const signed = await f.signBank("0.00", "2026-11", [{ bankId: plus.transactionId, lineId: inLine.id, amount: "100.00" }, { bankId: minus.transactionId, lineId: outLine.id, amount: "100.00" }]);
  await prisma.bankTransaction.update({ where: { id: plus.transactionId }, data: { originalAmount: "-100.00" } });
  await prisma.bankTransaction.update({ where: { id: minus.transactionId }, data: { originalAmount: "100.00" } });
  const report = await getBankReconciliation(f.actor, signed.root.id);
  assert.equal(report.statementDifference, "0.00"); assert.equal(report.difference, "0.00"); assert.equal(report.status, "UNVERIFIED");
  assert.ok(report.exceptions.some(e => e.code === "INVALID_MATCH_SOURCE_EVIDENCE"));
  const integrity = await financialIntegrity(f.actor, f.query()); assert.equal(integrity.controls.find(c => c.control === "BANK_RECONCILIATION_REVIEW")?.pass, false);
}));
test("Stage26 posting and closing serialize without losing a posted invoice or frozen period", async () => finalScenario(async f => {
  await readyDonation(f); const cp = await f.counterparty(), invoice = await f.document("PAYABLE", cp, "1.00", false), p = await prisma.accountingPeriod.findUniqueOrThrow({ where: { periodCode: "2026-11" } });
  const results = await Promise.allSettled([postSource(f.poster, "PAYABLE", "DOCUMENT", invoice.document.id, invoice.request.id), requestClosing(f.actor, "PERIOD", p.id, false, "Synthetic TEST race close request", "Synthetic TEST checked invoice/posting cut-off")]);
  assert.equal(results[0].status, "fulfilled"); const state = await prisma.accountingPeriod.findUniqueOrThrow({ where: { id: p.id } }); assert.equal(state.status, results[1].status === "fulfilled" ? "CLOSING" : "OPEN"); assert.equal((await subledgerReconciliations(f.actor, f.fiscalYearId, "2026-11-30")).ap.subledgerTotal, "1.00");
}));
test("Stage26 rejection, cancellation and self/unauthorized approval restore controlled OPEN state", async () => finalScenario(async f => {
  await readyDonation(f); const p = await prisma.accountingPeriod.findUniqueOrThrow({ where: { periodCode: "2026-11" } }), r = await requestClosing(f.actor, "PERIOD", p.id, false, "Synthetic TEST close review request", "Synthetic TEST independent checker evidence");
  await assert.rejects(decideApproval(f.actor, r.approval.id, "APPROVED", null), /Requester|authorized/); await decideApproval(f.reviewer, r.approval.id, "REJECTED", "Synthetic TEST evidence rejected"); assert.equal((await prisma.accountingPeriod.findUniqueOrThrow({ where: { id: p.id } })).status, "OPEN"); await assert.rejects(applyApprovedAction(f.poster, r.approval.id));
}));
test("Stage26 stale close approval detects an altered external statement rather than forcing equality", async () => finalScenario(async f => {
  const d = await readyDonation(f), r = await f.close("2026-11", false); await prisma.bankTransaction.update({ where: { id: d.bank.transactionId }, data: { originalAmount: "20000001.00" } });
  await assert.rejects(applyApprovedAction(f.poster, r.approval.id), /match|version|ready/); assert.equal((await prisma.accountingApprovalRequest.findUniqueOrThrow({ where: { id: r.approval.id } })).status, "APPROVED");
}));
test("Stage26 year-end journal rollback leaves frozen year, approval and temporary balances intact", async () => finalScenario(async f => {
  await readyDonation(f); await f.signBank("0.00", "2026-10"); await f.close("2026-10"); await f.close(); await f.signBank("20000000.00", "2026-12", [], "20000000.00"); await f.close("2026-12");
  const r = await requestClosing(f.actor, "YEAR", f.fiscalYearId, false, "Synthetic TEST year-end rollback", "Synthetic TEST approved annual evidence"); await f.approve(r.approval.id);
  await assert.rejects(prisma.$transaction(async tx => { await postApprovedJournalInTransaction(tx, f.poster, r.approval.id); throw Error("Synthetic failure after closing journal"); }, { isolationLevel: "Serializable", timeout: 30000 }), /Synthetic failure/);
  assert.equal(await prisma.accountingJournal.count({ where: { sourceKind: "YEAR_CLOSE" } }), 0); assert.equal((await prisma.accountingFiscalYear.findUniqueOrThrow({ where: { id: f.fiscalYearId } })).status, "CLOSING"); assert.equal((await prisma.accountingApprovalRequest.findUniqueOrThrow({ where: { id: r.approval.id } })).status, "APPROVED");
}));
test("Stage26 immutable GL seal detects balanced direct tampering in isolated synthetic TEST evidence", async () => finalScenario(async f => {
  await f.policy(); const j = await f.manual("100.00"), debit = j.journal.lines.find(l => l.debit.gt(0)), credit = j.journal.lines.find(l => l.credit.gt(0)); assert.ok(debit && credit);
  await prisma.accountingJournalLine.update({ where: { id: debit.id }, data: { debit: "101.00" } }); await prisma.accountingJournalLine.update({ where: { id: credit.id }, data: { credit: "101.00" } });
  const audit = await prisma.$transaction(tx => verifyPostedLedgerAudits(tx, day("2026-11-30"))); assert.equal(audit.valid, false); assert.ok(audit.exceptions.some(e => e.reason === "POSTED_JOURNAL_CONTENT_CHANGED")); const integrity = await financialIntegrity(f.actor, f.query()); assert.equal(integrity.controls.find(c => c.control === "TRIAL_BALANCE")?.pass, true); assert.equal(integrity.controls.find(c => c.control === "POSTED_JOURNAL_IMMUTABILITY_SEALS")?.pass, false);
}));
test("Stage26 internal bank transfer nets zero cash flow and does not create income or expense", async () => finalScenario(async f => {
  const otherCash = await f.extraAccount("ASSET"); await f.policy(p => { const m = p.mappings.find(m => m.accountId === otherCash); assert.ok(m); m.cashEquivalent = true; m.cashFlowActivity = null; });
  const d = await createDraft(f.actor, { journalType: "MANUAL", accountingDate: "2026-11-03", sourceReference: randomUUID(), description: "Synthetic TEST actual internal cash transfer", lines: [{ accountId: otherCash, debit: "100.00", credit: "0.00" }, { accountId: f.bankGl, debit: "0.00", credit: "100.00", bankAccountId: f.approval.base.bankAccountId }] }), r = await submitApproval(f.actor, { kind: "MANUAL_JOURNAL", sourceDocumentId: d.id, expectedRevision: 1 }); await f.approve(r.id); await postApprovedJournal(f.poster, r.id);
  const reports = await financialStatements(f.actor, f.query()); assert.equal(reports.cashFlows.netMovement, "0.00"); assert.equal(reports.cashFlows.activities?.OPERATING, "0.00"); assert.equal(reports.cashFlows.difference, "0.00"); assert.equal(reports.comprehensiveIncome.surplusDeficit, "0.00");
}));
test("Stage26 bank interest uses reviewed real bank evidence without Phase1 income duplication", async () => finalScenario(async f => {
  const interestAccount = randomUUID(); f.accountIds.push(interestAccount); await prisma.accountingAccount.create({ data: { id: interestAccount, code: `T${interestAccount.replaceAll("-", "").slice(0, 8)}`, name: "TEST bank interest", accountType: "REVENUE", normalBalance: "CREDIT" } });
  await f.policy(p => { const m = p.mappings.find(m => m.accountId === interestAccount); assert.ok(m); m.incomeClass = "OTHER_INCOME"; }); const b = await f.bankSource("STANDARD", "100.00", false); await prisma.bankTransaction.update({ where: { id: b.transactionId }, data: { transactionType: "BUNGA", eventCodeId: null, eventCampaignId: null } }); assert.ok(b.approvalId); await decideSignApprovalAtomic({ approvalId: b.approvalId, userId: f.actor, decision: "APPROVED" }); assert.equal(await prisma.accountingJournal.count(), 0);
  const root = await bankRoot(f, "100.00"), d = await bankAdjustmentDraft(f.actor, root.id, { bankTransactionId: b.transactionId, kind: "INTEREST", offsetAccountId: interestAccount, evidence: "Synthetic TEST actual bank interest evidence" }), req = await submitApproval(f.actor, { kind: "ADJUSTING_JOURNAL", sourceDocumentId: d.id, expectedRevision: 1 }); await f.approve(req.id); await postApprovedJournal(f.poster, req.id);
  const reports = await financialStatements(f.actor, f.query()); assert.equal(reports.comprehensiveIncome.recognizedIncome, "100.00"); assert.equal(reports.comprehensiveIncome.incomeCategories.OTHER_INCOME, "100.00"); assert.equal(reports.cashFlows.netMovement, "100.00"); assert.equal(await prisma.accountingJournal.count(), 1);
}));
test("Stage26 partial fund classification remains an unresolved pre-close exception", async () => finalScenario(async f => {
  await f.policy(); const bank = await f.bankSource(); assert.ok(bank.line && bank.journal); const fund = await f.fund(); await f.classify(fund.row.id, bank.line.id, "7000000.00"); const cash = bank.journal.lines.find(l => l.accountId === f.bankGl); assert.ok(cash); await f.signBank("20000000.00", "2026-11", [{ bankId: bank.transactionId, lineId: cash.id, amount: "20000000.00" }]);
  const p = await prisma.accountingPeriod.findUniqueOrThrow({ where: { periodCode: "2026-11" } }), preview = await previewClose(f.actor, "PERIOD", p.id); assert.equal(preview.items.find(i => i.control === "UNCLASSIFIED_BANK_CONTRIBUTIONS")?.status, "FAIL"); assert.equal(preview.status, "NOT_READY");
}));
test("Stage26 fund designations reconcile as-of without adding GL net assets", async () => finalScenario(async f => {
  await f.policy(); const d = await f.donation(), designation = await createDesignation(f.actor, d.fund.row.id, { designationReference: randomUUID(), purposeText: "Synthetic TEST board designation", amount: "10000000.00", effectiveOn: "2026-11-04" }), req = await submitApproval(f.actor, { kind: "FUND_DESIGNATION", sourceDocumentId: designation.id, expectedRevision: 1 }); await f.approve(req.id); await applyApprovedAction(f.poster, req.id);
  const command = await createFundCommand(f.actor, d.fund.row.id, fundCommandSchema.parse({ action: "DESIGNATION_ADJUST", accountingDate: "2026-11-06", sourceReference: randomUUID(), reason: "Synthetic TEST prospective board reduction", designationId: designation.id, amount: "6000000.00", purposeText: "Synthetic TEST revised board designation" })), r = await submitApproval(f.actor, { kind: "FUND_COMMAND", sourceDocumentId: command.id, expectedRevision: 1 }); await f.approve(r.id); await applyApprovedAction(f.poster, r.id);
  const earlier = await subledgerReconciliations(f.actor, f.fiscalYearId, "2026-11-05"), later = await subledgerReconciliations(f.actor, f.fiscalYearId, "2026-11-07"); assert.equal(earlier.funds.internalDesignations[0]?.designated, "10000000.00"); assert.equal(later.funds.internalDesignations[0]?.designated, "6000000.00"); assert.equal((await financialStatements(f.actor, f.query())).financialPosition.totalNetAssets, "20000000.00");
}));
test("Stage26 annual policy absence is PENDING_REVIEW and cannot generate guessed closing accounts", async () => finalScenario(async f => {
  await f.policy(p => { p.annual = null; }); const preview = await previewClose(f.actor, "YEAR", f.fiscalYearId); assert.equal(preview.items.find(i => i.control === "ANNUAL_CLOSING_POLICY")?.status, "PENDING_REVIEW");
  await assert.rejects(requestClosing(f.actor, "YEAR", f.fiscalYearId, false, "Synthetic TEST absent annual mapping", "Synthetic TEST must not invent closing accounts")); assert.equal(await prisma.accountingJournal.count({ where: { sourceKind: "YEAR_CLOSE" } }), 0);
}));
test("Stage26 prior-year comparatives and continuous opening carry forward do not duplicate balances", async () => finalScenario(async f => {
  const adopted = await f.policy(); await f.donation();
  const y = await createFiscalYear({ yearCode: `TEST2027-${randomUUID().slice(0, 8)}`, startDate: "2027-01-01", endDate: "2027-12-31" }); await createPeriod({ fiscalYearId: y.id, periodCode: `TEST2027-${randomUUID().slice(0, 8)}`, periodNo: 1, startDate: "2027-01-01", endDate: "2027-01-31" });
  const { createReportingPolicy, submitFinalSource } = await import("../../src/modules/accounting/finalization/finalization.workflow.js"); const d = await createReportingPolicy(f.actor, y.id, adopted.p), req = await submitFinalSource(f.actor, d.id, 1); await f.approve(req.id); await applyApprovedAction(f.poster, req.id);
  const count = await prisma.accountingJournal.count(), report = await financialStatements(f.actor, { fiscalYearId: y.id, from: "2027-01-01", to: "2027-01-31", comparativeFrom: "2026-11-01", comparativeTo: "2026-11-30" }); assert.equal(report.financialPosition.assets, "20000000.00"); assert.equal(report.cashFlows.opening, "20000000.00"); assert.equal(report.cashFlows.netMovement, "0.00"); assert.ok(report.comparative && "comprehensiveIncome" in report.comparative); assert.equal(report.comparative.comprehensiveIncome.surplusDeficit, "20000000.00"); assert.equal(await prisma.accountingJournal.count(), count);
}));
test("Stage26 HTTP reports, permissions, reconciliation and DRAFT exports preserve existing API conventions", async () => finalScenario(async f => {
  await readyDonation(f); const { app } = await import("../../src/app.js"), { env } = await import("../../src/config/env.js");
  const server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve)); const address = server.address(); assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/api/accounting`, query = new URLSearchParams(f.query()), headers = { Authorization: `Bearer ${jwt.sign({ sub: f.actor }, env.jwtSecret)}` };
  try {
    assert.equal((await fetch(`${url}/financial-statements?${query}`)).status, 401);
    for (const path of ["financial-statements", "financial-statements/position", "financial-statements/comprehensive-income", "financial-statements/net-assets", "financial-statements/cash-flows", "financial-statements/supporting-schedules", "financial-integrity"]) { const r = await fetch(`${url}/${path}?${query}`, { headers }); assert.equal(r.status, 200, await r.text()); }
    const report = await (await fetch(`${url}/financial-statements?${query}`, { headers })).json(); assert.equal(report.financialPosition.assets, "20000000.00"); const csv = await fetch(`${url}/financial-statements/export?${query}&format=csv`, { headers }); assert.equal(csv.status, 200); assert.match(await csv.text(), /DRAFT|20000000.00/); const xlsx = await fetch(`${url}/financial-statements/export?${query}&format=xlsx`, { headers }); assert.equal(xlsx.status, 200); assert.ok((await xlsx.arrayBuffer()).byteLength > 1000);
    const role = f.approval.roleIds[3]; assert.ok(role); await prisma.roleMenu.deleteMany({ where: { roleId: role } }); const denied = await fetch(`${url}/financial-statements?${query}`, { headers: { Authorization: `Bearer ${jwt.sign({ sub: f.approval.outsiderId }, env.jwtSecret)}` } }); assert.equal(denied.status, 403);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}));
