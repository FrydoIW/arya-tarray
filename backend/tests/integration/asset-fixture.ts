import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../../src/lib/prisma.js";
import { ScheduleFixture } from "./schedule-fixture.js";
import { createAsset, createCategory, createRun } from "../../src/modules/accounting/assets/asset.service.js";
import { createAssetChange } from "../../src/modules/accounting/assets/asset-change.service.js";
import { submitAssetSource } from "../../src/modules/accounting/assets/asset.workflow.js";
import { applyApprovedAction, createDraft, postApprovedJournal, submitApproval } from "../../src/modules/accounting/approval/approval.service.js";
import { createDocument, postSource, submitSource } from "../../src/modules/accounting/apar/apar.service.js";
import { day, depreciationStart, dateText } from "../../src/modules/accounting/assets/asset.domain.js";
import type { AssetInput, AssetPolicy, AssetChange, CategoryInput } from "../../src/modules/accounting/assets/asset.schema.js";
import { requireSafeTestDatabaseUrl, assertConnectedTestDatabase } from "./test-database.js";
export class AssetFixture extends ScheduleFixture {
  categories: string[] = [];
  cost = ""; accum = ""; depExpense = ""; gain = ""; loss = ""; impairExpense = ""; allowance = ""; clearing = ""; categoryId = "";
  async account(type: string, balance: string, contra = false) {
    const id = randomUUID(); this.accountIds.push(id);
    await prisma.accountingAccount.create({ data: { id, code: `T${id.replaceAll("-", "").slice(0, 8)}`, name: `TEST asset ${type}`, accountType: type,
      normalBalance: balance, contraFlag: contra, activeFlag: true, postingFlag: true } }); return id;
  }
  policy(partialMonthPolicy: AssetPolicy["partialMonthPolicy"] = "FULL_MONTH"): AssetPolicy {
    return { policyReference: "Synthetic TEST adopted capitalization/depreciation policy", capitalizationThreshold: "0.00", partialMonthPolicy,
      impairmentEnabled: true, impairmentPolicyReference: "Synthetic TEST approved impairment assessment policy" };
  }
  categoryInput(policy: AssetPolicy | null = this.policy()): CategoryInput {
    return { categoryCode: `T-${randomUUID()}`, categoryName: "Synthetic TEST equipment", assetAccountId: this.cost,
      accumulatedDepreciationAccountId: this.accum, depreciationExpenseAccountId: this.depExpense, gainAccountId: this.gain,
      lossAccountId: this.loss, impairmentExpenseAccountId: this.impairExpense, impairmentAllowanceAccountId: this.allowance,
      disposalClearingAccountId: this.clearing, defaultUsefulLifeMonths: 2, defaultMethod: "STRAIGHT_LINE", activeFlag: true, policy };
  }
  async category(input = this.categoryInput()) { const c = await createCategory(this.actor, input); this.categories.push(c.id); return c; }
  async setup() {
    await super.setup();
    this.cost = await this.account("ASSET", "DEBIT"); this.accum = await this.account("ASSET", "CREDIT", true);
    this.depExpense = await this.account("EXPENSE", "DEBIT"); this.gain = await this.account("REVENUE", "CREDIT"); this.loss = await this.account("EXPENSE", "DEBIT");
    this.impairExpense = await this.account("EXPENSE", "DEBIT"); this.allowance = await this.account("ASSET", "CREDIT", true); this.clearing = await this.account("LIABILITY", "CREDIT");
    this.categoryId = (await this.category()).id;
  }
  async invoice(amount = "12000000.00", accountId = this.cost, side: "PAYABLE" | "RECEIVABLE" = "PAYABLE") {
    const cp = await this.counterparty(side), input = this.documentInput(side, cp, amount); input.lines[0].accountingAccountId = accountId;
    const doc = await createDocument(this.actor, side, input), req = await submitSource(this.actor, side, "DOCUMENT", doc.id, 1);
    await this.approve(req.id); const journal = await postSource(this.poster, side, "DOCUMENT", doc.id, req.id);
    const line = journal.lines.find(l => l.accountId === accountId); assert.ok(line); return { cp, doc, journal, line };
  }
  input(sourceId: string, partial: AssetPolicy["partialMonthPolicy"] = "FULL_MONTH", inServiceOn = "2026-11-01"): AssetInput {
    return { assetNumber: `TEST-${randomUUID()}`, assetName: "Synthetic TEST computer", assetCategoryId: this.categoryId, acquisitionJournalLineId: sourceId,
      description: "Synthetic TEST fixture only", location: "TEST storage", acquiredOn: "2026-11-01", inServiceOn,
      depreciationStartOn: dateText(depreciationStart(day(inServiceOn), partial)), usefulLifeMonths: 2, residualValue: "0.00", custodianId: this.actor,
      supportingEvidence: "Synthetic TEST actual invoice and capitalization evidence" };
  }
  async asset(amount = "12000000.00", active = true, customize?: (input: AssetInput) => void) {
    const source = await this.invoice(amount), input = this.input(source.line.id); customize?.(input);
    const asset = await createAsset(this.actor, input);
    const req = active ? await submitAssetSource(this.actor, "ASSET", asset.id, 1) : null;
    if (req) { await this.approve(req.id); await applyApprovedAction(this.poster, req.id); }
    return { source, asset, input, request: req };
  }
  async run(assetIds: string[], code = "2026-11", post = true) {
    const period = await prisma.accountingPeriod.findUniqueOrThrow({ where: { periodCode: code } });
    const input = { runReference: `TEST-${randomUUID()}`, accountingPeriodId: period.id, assetIds };
    const run = await createRun(this.actor, input), req = await submitAssetSource(this.actor, "RUN", run.id, run.revision);
    await this.approve(req.id); const journal = post ? await postApprovedJournal(this.poster, req.id) : null;
    return { run, req, journal, input };
  }
  async change(assetId: string, command: AssetChange, apply = true) {
    const draft = await createAssetChange(this.actor, assetId, command), req = await submitAssetSource(this.actor, "CHANGE", draft.id, 1);
    await this.approve(req.id); const result = apply ? await applyApprovedAction(this.poster, req.id) : null; return { draft, req, result };
  }
  async manual(amount: string, debitAccountId: string, creditAccountId: string) {
    const draft = await createDraft(this.actor, { journalType: "MANUAL", sourceReference: `TEST-${randomUUID()}`, accountingDate: "2026-11-02",
      description: "Synthetic TEST actual acquisition/cash supporting evidence", lines: [
        { accountId: debitAccountId, debit: amount, credit: "0.00", bankAccountId: debitAccountId === this.bankGl ? this.approval.base.bankAccountId : null },
        { accountId: creditAccountId, debit: "0.00", credit: amount, bankAccountId: creditAccountId === this.bankGl ? this.approval.base.bankAccountId : null }] });
    const req = await submitApproval(this.actor, { kind: "MANUAL_JOURNAL", sourceDocumentId: draft.id, expectedRevision: 1 }); await this.approve(req.id);
    return postApprovedJournal(this.poster, req.id);
  }
  async cleanup() {
    requireSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL, { aryaEnv: process.env.ARYA_ENV, allowWrites: process.env.ALLOW_TEST_INTEGRATION_WRITES });
    const selected = await prisma.$queryRaw<Array<{ name: string }>>`SELECT DATABASE() AS name`; assertConnectedTestDatabase(selected[0]?.name);
    const actors = { in: this.approval.actorIds };
    await prisma.$transaction(async tx => {
      await tx.accountingApprovalHistory.deleteMany({ where: { request: { is: { requestedById: actors } } } });
      await tx.accountingApprovalApprover.deleteMany({ where: { request: { is: { requestedById: actors } } } });
      await tx.accountingApprovalRequest.deleteMany({ where: { requestedById: actors } });
      await tx.accountingDepreciationRunAsset.deleteMany({ where: { relFkAccDepRunAssetRun: { is: { createdById: actors } } } });
      await tx.accountingDepreciationRun.deleteMany({ where: { createdById: actors } });
      await tx.accountingJournalDraft.deleteMany({ where: { createdById: actors, fixedAssetId: { not: null } } });
      await tx.accountingFixedAsset.deleteMany({ where: { createdById: actors } });
      await tx.accountingAssetCategory.deleteMany({ where: { id: { in: this.categories } } });
    });
    await super.cleanup();
    assert.equal(await prisma.accountingFixedAsset.count({ where: { createdById: actors } }), 0);
  }
}
export async function assetScenario(work: (f: AssetFixture) => Promise<void>) { const f = new AssetFixture(); try { await f.setup(); await work(f); } finally { await f.cleanup(); } }
