import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../src/lib/prisma.js";
import { ScheduleFixture } from "./schedule-fixture.js";
import { createDraft, submitApproval, applyApprovedAction, postApprovedJournal } from "../../src/modules/accounting/approval/approval.service.js";
import { decideSignApprovalAtomic } from "../../src/modules/approval/sign-approval/sign-approval.repository.js";
import { createFund, createRestriction, createFundMovement } from "../../src/modules/accounting/funds/fund.service.js";
import { fundInputSchema, restrictionInputSchema, releaseInputSchema, type FundInput, type RestrictionInput, type ReleaseInput } from "../../src/modules/accounting/funds/fund.schema.js";
import { assertConnectedTestDatabase, requireSafeTestDatabaseUrl } from "./test-database.js";
export class FundFixture extends ScheduleFixture {
  readonly categoryIds: string[] = [];
  async account(type: "ASSET" | "NET_ASSET", balance: "DEBIT" | "CREDIT", contraFlag = false) {
    const id = randomUUID(); this.accountIds.push(id); await prisma.accountingAccount.create({ data: { id, code: `T${id.replaceAll("-", "").slice(0, 8)}`, name: `TEST fund ${type}`, accountType: type, normalBalance: balance, contraFlag } }); return id;
  }
  async fund(kind: FundInput["fundClass"] = "UNRESTRICTED", active = true, change?: (v: FundInput) => void) {
    const input = fundInputSchema.parse({ fundCode: `T-${randomUUID()}`, fundName: "Synthetic TEST fund", fundClass: kind, effectiveOn: "2026-11-01", sourceReference: "Synthetic TEST donor policy evidence",
      policy: { policyReference: "Synthetic TEST adopted accounting policy", contributionAccountId: kind === "CONDITIONAL_LIABILITY" ? this.apControl : this.revenue,
        conditionalObligationEvidence: kind === "CONDITIONAL_LIABILITY" ? "Synthetic TEST substantive obligation and enforceable refund evidence" : null,
        release: kind === "DONOR_RESTRICTED" ? { mode: "REVENUE_RECLASSIFICATION", debitAccountId: this.revenue, creditAccountId: this.revenue } : null } });
    if (kind === "CONDITIONAL_REVIEW") input.policy = null; change?.(input);
    const row = await createFund(this.actor, input);
    if (active) { const req = await submitApproval(this.actor, { kind: "FUND_SETUP", sourceDocumentId: row.id, expectedRevision: 1 }); await this.approve(req.id); await applyApprovedAction(this.poster, req.id); }
    return { row, input };
  }
  async manual(amount = "20000000.00", creditAccount = this.revenue, fundId: string | null = null, expense = false, date = "2026-11-03") {
    const input = await this.approval.input(randomUUID(), amount); input.accountingDate = date;
    const draft = await createDraft(this.actor, { ...input, lines: expense ? [{ accountId: this.expense, debit: amount, credit: "0.00", accountingFundId: fundId }, { accountId: this.apControl, debit: "0.00", credit: amount }]
      : [{ accountId: this.bankGl, debit: amount, credit: "0.00", bankAccountId: this.approval.base.bankAccountId }, { accountId: creditAccount, debit: "0.00", credit: amount }] });
    const req = await submitApproval(this.actor, { kind: "MANUAL_JOURNAL", sourceDocumentId: draft.id, expectedRevision: 1 }); await this.approve(req.id);
    const journal = await postApprovedJournal(this.poster, req.id), line = journal.lines.find(l => expense ? l.accountId === this.expense : l.accountId === creditAccount && l.credit.gt(0)); assert.ok(line);
    return { journal, line };
  }
  async bankSource(type = "STANDARD", amount = "20000000.00", post = true) {
    const bank = await this.bankEvidence("RECEIVABLE", amount), record = await prisma.bankTransaction.findUniqueOrThrow({ where: { id: bank.transactionId } }); assert.ok(record.eventCodeId);
    await prisma.eventCode.update({ where: { id: record.eventCodeId }, data: { eventType: type } });
    if (type === "TIME_BASED") await prisma.eventTimeRule.create({ data: { eventCodeId: record.eventCodeId, unitAmount: "1000000.00", durationMonths: 1 } });
    if (type === "CAMPAIGN") { const campaign = this.approval.base.campaignIds.at(-1); assert.ok(campaign); await prisma.bankTransaction.update({ where: { id: bank.transactionId }, data: { eventCampaignId: campaign } }); }
    if (post) { assert.ok(bank.approvalId); await decideSignApprovalAtomic({ approvalId: bank.approvalId, userId: this.actor, decision: "APPROVED" }); }
    const journal = post ? await prisma.accountingJournal.findUniqueOrThrow({ where: { sourceEventKey: `FINALIZED_BANK_TRANSACTION:${bank.transactionId}` }, include: { lines: true } }) : null;
    const line = journal?.lines.find(l => l.credit.gt(0)) ?? null; return { ...bank, journal, line };
  }
  async classify(fundId: string, source: string, amount = "20000000.00", post = true) {
    const d = await createFundMovement(this.actor, fundId, { action: "CLASSIFY", sourceJournalLineId: source, amount, accountingDate: "2026-11-03", sourceReference: randomUUID(), reason: "Synthetic TEST explicit unrestricted contribution evidence" });
    const req = await submitApproval(this.actor, { kind: "FUND_JOURNAL", sourceDocumentId: d.id, expectedRevision: d.revision }); await this.approve(req.id);
    return { d, req, journal: post ? await postApprovedJournal(this.poster, req.id) : null };
  }
  restrictionInput(source: string, amount = "20000000.00"): RestrictionInput { return restrictionInputSchema.parse({ sourceJournalLineId: source, originalAmount: amount, restrictionKind: "PURPOSE", purposeText: "Synthetic TEST education only donor terms", effectiveOn: "2026-11-03", supportingReference: randomUUID(), termsEvidence: "Synthetic TEST signed donor education terms",
    criteria: { purposeCriterion: "EXPENSE_INCURRED", eligibilityTerms: "Synthetic TEST actual education expense incurred" } }); }
  async restrict(fundId: string, source: string, amount = "20000000.00", change?: (v: RestrictionInput) => void, post = true) {
    const input = this.restrictionInput(source, amount); change?.(input); const r = await createRestriction(this.actor, fundId, input);
    const req = await submitApproval(this.actor, { kind: "FUND_RESTRICTION", sourceDocumentId: r.id, expectedRevision: 1 }); await this.approve(req.id);
    return { r, req, journal: post ? await postApprovedJournal(this.poster, req.id) : null, input };
  }
  releaseInput(targetFundId: string, lineId: string | null, amount = "7000000.00"): ReleaseInput { return releaseInputSchema.parse({ amount, releaseReference: randomUUID(), accountingDate: "2026-11-04", satisfactionDate: "2026-11-04", targetFundId,
    releaseReason: "Synthetic TEST donor terms fulfilled", eligibilityEvidence: "Synthetic TEST reviewed actual eligible education expense", evidenceReference: `TEST-${randomUUID()}`, evidenceJournalLineId: lineId }); }
  async release(restrictionId: string, input: ReleaseInput, post = true, revision = 1) {
    const req = await submitApproval(this.actor, { kind: "FUND_RELEASE", sourceDocumentId: restrictionId, expectedRevision: revision, release: input }); await this.approve(req.id);
    return { req, journal: post ? await postApprovedJournal(this.poster, req.id) : null };
  }
  async reverse(id: string) { const req = await submitApproval(this.actor, { kind: "JOURNAL_REVERSAL", sourceDocumentId: id, accountingDate: "2026-11-05", remark: "Synthetic TEST reviewed error correction" }); await this.approve(req.id); return postApprovedJournal(this.poster, req.id); }
  async cleanup() {
    requireSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL, { aryaEnv: process.env.ARYA_ENV, allowWrites: process.env.ALLOW_TEST_INTEGRATION_WRITES });
    const selected = await prisma.$queryRaw<{ name: string }[]>`SELECT DATABASE() AS name`; assertConnectedTestDatabase(selected[0]?.name);
    const actors = { in: this.approval.actorIds };
    await prisma.$transaction(async tx => {
      await tx.accountingApprovalHistory.deleteMany({ where: { request: { requestedById: actors } } });
      await tx.accountingApprovalApprover.deleteMany({ where: { request: { requestedById: actors } } });
      await tx.accountingApprovalRequest.deleteMany({ where: { requestedById: actors } });
      const drafts = await tx.accountingJournalDraft.findMany({ where: { createdById: actors, sourceKind: { in: ["FUND_COMMAND", "FUND_JOURNAL", "FUND_AUDIT", "FINALIZATION_AUDIT"] } }, select: { id: true, fundParentId: true } });
      const pending = new Map(drafts.map(d => [d.id, d]));
      while (pending.size) { const parents = new Set([...pending.values()].flatMap(d => d.fundParentId ? [d.fundParentId] : [])), leaves = [...pending.keys()].filter(id => !parents.has(id)); if (!leaves.length) throw Error("Fixture fund command cycle"); await tx.accountingJournalDraft.deleteMany({ where: { id: { in: leaves } } }); for (const id of leaves) pending.delete(id); }
      await tx.accountingFundRelease.deleteMany({ where: { createdById: actors } });
      await tx.accountingFixedAsset.deleteMany({ where: { createdById: actors } });
      await tx.accountingAssetCategory.deleteMany({ where: { id: { in: this.categoryIds } } });
      await tx.accountingJournalDraftLine.deleteMany({ where: { draft: { createdById: actors } } });
      await tx.accountingJournalLine.deleteMany({ where: { journal: { postedById: actors }, accountingFundId: { not: null } } });
      await tx.accountingFundRestriction.deleteMany({ where: { createdById: actors } });
      await tx.accountingFundDesignation.deleteMany({ where: { createdById: actors } });
      await tx.accountingJournalLine.deleteMany({ where: { journal: { postedById: actors } } });
      await tx.accountingFund.deleteMany({ where: { createdById: actors } });
      const journals = await tx.accountingJournal.findMany({ where: { postedById: actors }, select: { id: true, sourceKind: true, relatedJournalId: true, reversalOfJournalId: true } });
      const fundIds = new Set(journals.filter(j => j.sourceKind?.startsWith("FUND_")).map(j => j.id));
      for (const j of journals) if (j.reversalOfJournalId && fundIds.has(j.reversalOfJournalId)) fundIds.add(j.id);
      while (fundIds.size) {
        const referenced = new Set(journals.filter(j => fundIds.has(j.id)).flatMap(j => [j.relatedJournalId, j.reversalOfJournalId].flatMap(v => v ? [v] : [])));
        const leaves = [...fundIds].filter(id => !referenced.has(id)); if (!leaves.length) throw Error("Fixture fund journal cycle");
        await tx.accountingJournal.deleteMany({ where: { id: { in: leaves } } }); for (const id of leaves) fundIds.delete(id);
      }
    });
    await super.cleanup();
    assert.equal(await prisma.accountingFund.count({ where: { createdById: actors } }), 0);
  }
}
export async function fundScenario(work: (f: FundFixture) => Promise<void>) { const f = new FundFixture(); try { await f.setup(); await work(f); } finally { await f.cleanup(); } }
