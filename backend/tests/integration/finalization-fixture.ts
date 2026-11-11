import assert from "node:assert/strict";
import { prisma } from "../../src/lib/prisma.js";
import { FundFixture } from "./fund-fixture.js";
import { createReportingPolicy, submitFinalSource, requestClosing } from "../../src/modules/accounting/finalization/finalization.workflow.js";
import { applyApprovedAction, submitApproval } from "../../src/modules/accounting/approval/approval.service.js";
import { createBankReconciliation, matchBank } from "../../src/modules/accounting/finalization/bank-reconciliation.service.js";
import { bankReconInputSchema, type ReportingPolicy } from "../../src/modules/accounting/finalization/finalization.schema.js";
import { requireSafeTestDatabaseUrl, assertConnectedTestDatabase } from "./test-database.js";
import { randomUUID } from "node:crypto";
import { createCategory, createAsset, createRun } from "../../src/modules/accounting/assets/asset.service.js";
import { createDocument, submitSource, postSource } from "../../src/modules/accounting/apar/apar.service.js";
export class FinalizationFixture extends FundFixture {
  fiscalYearId = ""; unrestrictedNA = ""; restrictedNA = "";
  periodBaseline: Awaited<ReturnType<typeof prisma.accountingPeriod.findMany>> = [];
  yearBaseline: Awaited<ReturnType<typeof prisma.accountingFiscalYear.findMany>> = [];
  async setup() {
    await super.setup(); this.yearBaseline = await prisma.accountingFiscalYear.findMany(); this.periodBaseline = await prisma.accountingPeriod.findMany();
    this.fiscalYearId = this.yearBaseline.find(y => y.startDate.toISOString().slice(0, 10) === "2026-01-01" && y.endDate.toISOString().slice(0, 10) === "2026-12-31")?.id ?? ""; assert.ok(this.fiscalYearId);
    this.unrestrictedNA = await this.account("NET_ASSET", "CREDIT"); this.restrictedNA = await this.account("NET_ASSET", "CREDIT");
  }
  query(from = "2026-11-01", to = "2026-11-30") { return { fiscalYearId: this.fiscalYearId, from, to }; }
  async policy(change?: (p: ReportingPolicy) => void) {
    const accounts = await prisma.accountingAccount.findMany({ where: { postingFlag: true } });
    const p: ReportingPolicy = { policyReference: "Synthetic TEST formally reviewed reporting policy", frameworkReference: "Synthetic TEST nonprofit framework decision only", cashFlowMethod: "DIRECT", materiality: "STRICT_ZERO", cutoverCoverageEvidence: "Synthetic TEST October cutover scope and prior history reviewed", openingBalanceEvidence: "Synthetic TEST verified initial zero opening balances; no invented opening",
      mappings: accounts.map(a => ({ accountId: a.id, section: a.accountType === "ASSET" ? "CURRENT_ASSETS" : a.accountType === "LIABILITY" ? "CURRENT_LIABILITIES" : a.accountType === "NET_ASSET" ? "NET_ASSETS" : a.accountType === "REVENUE" ? "INCOME" : "EXPENSES", statementLine: a.name,
        incomeClass: a.accountType === "REVENUE" ? "CONTRIBUTIONS" : a.accountType === "EXPENSE" ? "PROGRAM" : null, netAssetClass: a.id === this.restrictedNA ? "RESTRICTED" : ["NET_ASSET", "REVENUE", "EXPENSE"].includes(a.accountType) ? "UNRESTRICTED" : null,
        cashEquivalent: a.id === this.bankGl, cashFlowActivity: a.id === this.bankGl || a.accountType === "NET_ASSET" ? null : "OPERATING" })),
      bankAccounts: [{ bankAccountId: this.approval.base.bankAccountId, glAccountId: this.bankGl, openingEvidence: "Synthetic TEST actual selected bank opening zero evidence" }], controls: { payable: [this.apControl], receivable: [this.arControl] },
      annual: { policyReference: "Synthetic TEST approved annual temporary-account transfer", unrestrictedAccountId: this.unrestrictedNA, restrictedAccountId: this.restrictedNA } };
    change?.(p); const d = await createReportingPolicy(this.actor, this.fiscalYearId, p), req = await submitFinalSource(this.actor, d.id, 1); await this.approve(req.id); await applyApprovedAction(this.poster, req.id); return { p, d, req };
  }
  async signBank(closing: string, periodCode = "2026-11", pairs: { bankId: string; lineId: string; amount: string }[] = [], opening = "0.00", timingItems: { kind: "OUTSTANDING_PAYMENT" | "DEPOSIT_IN_TRANSIT"; journalLineId: string; amount: string; evidence: string }[] = []) {
    const period = await prisma.accountingPeriod.findUniqueOrThrow({ where: { periodCode } }), root = await createBankReconciliation(this.actor, bankReconInputSchema.parse({ bankAccountId: this.approval.base.bankAccountId, bankGlAccountId: this.bankGl, accountingPeriodId: period.id, reconciliationReference: randomUUID(), statementOpeningBalance: opening, statementClosingBalance: closing, openingEvidence: "Synthetic TEST reviewed real opening statement evidence", statementEvidence: "Synthetic TEST complete external statement evidence", timingItems }));
    for (const p of pairs) await matchBank(this.actor, root.id, { bankTransactionId: p.bankId, journalLineId: p.lineId, amount: p.amount, evidence: "Synthetic TEST bank and GL statement match proof" });
    const latest = await prisma.accountingBankReconciliation.findUniqueOrThrow({ where: { id: root.id } }), req = await submitApproval(this.actor, { kind: "BANK_RECONCILIATION", sourceDocumentId: root.id, expectedRevision: latest.revision }); await this.approve(req.id); await applyApprovedAction(this.poster, req.id); return { root, req };
  }
  async close(periodCode = "2026-11", apply = true) {
    const period = await prisma.accountingPeriod.findUniqueOrThrow({ where: { periodCode } }), result = await requestClosing(this.actor, "PERIOD", period.id, false, "Synthetic TEST month-end checklist reviewed", "Synthetic TEST independent closing evidence"); await this.approve(result.approval.id); if (apply) await applyApprovedAction(this.poster, result.approval.id); return result;
  }
  async donation(amount = "20000000.00") {
    const bank = await this.bankSource("STANDARD", amount); assert.ok(bank.journal && bank.line); const fund = await this.fund(); await this.classify(fund.row.id, bank.line.id, amount); const bankLine = bank.journal.lines.find(l => l.accountId === this.bankGl); assert.ok(bankLine); return { bank, fund, bankLine };
  }
  async assetEvidence(amount = "12000000.00") {
    const cost = await this.extraAccount("ASSET"), accum = await this.account("ASSET", "CREDIT", true), expense = randomUUID(); this.accountIds.push(expense);
    await prisma.accountingAccount.create({ data: { id: expense, code: `T${expense.replaceAll("-", "").slice(0, 8)}`, name: "TEST dedicated depreciation", accountType: "EXPENSE", normalBalance: "DEBIT" } });
    const category = await createCategory(this.actor, { categoryCode: randomUUID(), categoryName: "Synthetic TEST finalization asset", assetAccountId: cost, accumulatedDepreciationAccountId: accum, depreciationExpenseAccountId: expense,
      gainAccountId: this.revenue, lossAccountId: this.expense, impairmentExpenseAccountId: null, impairmentAllowanceAccountId: null, disposalClearingAccountId: this.apControl, defaultUsefulLifeMonths: 2, defaultMethod: "STRAIGHT_LINE", activeFlag: true,
      policy: { policyReference: "Synthetic TEST approved capitalization policy", capitalizationThreshold: "0.00", partialMonthPolicy: "FULL_MONTH", impairmentEnabled: false, impairmentPolicyReference: null } }); this.categoryIds.push(category.id);
    const cp = await this.counterparty(), input = this.documentInput("PAYABLE", cp, amount); input.lines[0].accountingAccountId = cost;
    const doc = await createDocument(this.actor, "PAYABLE", input), req = await submitSource(this.actor, "PAYABLE", "DOCUMENT", doc.id, 1); await this.approve(req.id); const journal = await postSource(this.poster, "PAYABLE", "DOCUMENT", doc.id, req.id), line = journal.lines.find(l => l.accountId === cost); assert.ok(line);
    const asset = await createAsset(this.actor, { assetNumber: randomUUID(), assetName: "Synthetic TEST equipment", assetCategoryId: category.id, acquisitionJournalLineId: line.id, acquiredOn: "2026-11-01", inServiceOn: "2026-11-01", depreciationStartOn: "2026-11-01", usefulLifeMonths: 2, residualValue: "0.00", description: null, location: null, custodianId: null, supportingEvidence: "Synthetic TEST executed AP equipment acquisition evidence" });
    const activate = await submitApproval(this.actor, { kind: "ASSET_ACTIVATE", sourceDocumentId: asset.id, expectedRevision: 1 }); await this.approve(activate.id); await applyApprovedAction(this.poster, activate.id); return { cost, accum, expense, category, doc, cp, journal, asset };
  }
  async cleanup() {
    requireSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL, { aryaEnv: process.env.ARYA_ENV, allowWrites: process.env.ALLOW_TEST_INTEGRATION_WRITES });
    const selected = await prisma.$queryRaw<{ name: string }[]>`SELECT DATABASE() AS name`; assertConnectedTestDatabase(selected[0]?.name);
    const actors = { in: this.approval.actorIds };
    await prisma.$transaction(async tx => {
      await tx.accountingApprovalHistory.deleteMany({ where: { request: { requestedById: actors } } }); await tx.accountingApprovalApprover.deleteMany({ where: { request: { requestedById: actors } } }); await tx.accountingApprovalRequest.deleteMany({ where: { requestedById: actors } });
      await tx.accountingDepreciationRunAsset.deleteMany({ where: { relFkAccDepRunAssetRun: { createdById: actors } } }); await tx.accountingDepreciationRun.deleteMany({ where: { createdById: actors } });
      await tx.accountingJournalDraft.deleteMany({ where: { createdById: actors, fixedAssetId: { not: null } } });
      await tx.accountingPeriod.updateMany({ data: { closingDraftId: null } }); await tx.accountingFiscalYear.updateMany({ data: { closingDraftId: null, reportingPolicyDraftId: null } });
      await tx.accountingBankReconciliationMatch.deleteMany({ where: { relFkAccBankMatchRecon: { createdById: actors } } });
      await tx.accountingJournalDraft.deleteMany({ where: { createdById: actors, sourceKind: { in: ["REPORTING_POLICY", "REPORT_SNAPSHOT", "PERIOD_CLOSE", "PERIOD_REOPEN", "YEAR_CLOSE", "YEAR_REOPEN", "FINALIZATION_AUDIT"] } } });
      await tx.accountingJournalDraft.updateMany({ where: { createdById: actors, bankReconciliationId: { not: null } }, data: { bankReconciliationId: null } });
      await tx.accountingBankReconciliation.deleteMany({ where: { createdById: actors } });
      await tx.accountingSchedulePeriod.deleteMany({ where: { relFkAccSchedulePeriodParent: { createdById: actors } } });
      await tx.accountingSchedule.deleteMany({ where: { createdById: actors } });
      for (const p of this.periodBaseline) await tx.accountingPeriod.update({ where: { id: p.id }, data: { status: p.status, revision: p.revision, closedAt: p.closedAt, closedById: p.closedById, closingJournalId: p.closingJournalId, closingDraftId: p.closingDraftId } });
      for (const y of this.yearBaseline) await tx.accountingFiscalYear.update({ where: { id: y.id }, data: { status: y.status, revision: y.revision, closedAt: y.closedAt, closedById: y.closedById, closingDraftId: y.closingDraftId, reportingPolicyDraftId: y.reportingPolicyDraftId } });
      await tx.accountingPeriod.deleteMany({ where: { id: { notIn: this.periodBaseline.map(p => p.id) } } }); await tx.accountingFiscalYear.deleteMany({ where: { id: { notIn: this.yearBaseline.map(y => y.id) } } });
    });
    await super.cleanup();
  }
}
export async function finalScenario(work: (f: FinalizationFixture) => Promise<void>) { const f = new FinalizationFixture(); try { await f.setup(); await work(f); } finally { await f.cleanup(); } }
