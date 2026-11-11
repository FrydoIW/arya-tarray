import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../../src/lib/prisma.js";
import { AccountingApprovalFixture } from "./accounting-approval-fixture.js";
import { AP_MANAGE, AR_MANAGE, SETTLEMENT_MATCH } from "../../src/modules/accounting/apar/apar.domain.js";
import { createCounterparty, createDocument, createSettlement, postSource, submitSource } from "../../src/modules/accounting/apar/apar.service.js";
import { decideApproval, postApprovedJournal } from "../../src/modules/accounting/approval/approval.service.js";
import type { DocumentKind, DocumentInput, SettlementInput } from "../../src/modules/accounting/apar/apar.schema.js";
import { assertConnectedTestDatabase, requireSafeTestDatabaseUrl } from "./test-database.js";

export class AparFixture {
  readonly approval = new AccountingApprovalFixture();
  readonly accountIds: string[] = [];
  readonly counterpartyIds: string[] = [];
  apControl = ""; arControl = ""; expense = ""; bankGl = ""; revenue = "";
  get actor() { return this.approval.requesterId; }
  get reviewer() { return this.approval.reviewerId; }
  get poster() { return this.approval.posterId; }
  async setup() {
    await this.approval.setup();
    const roleId = this.approval.roleIds[0]; assert.ok(roleId);
    const manual = await prisma.menu.findFirstOrThrow({ where: { menuCode: "ACCOUNTING_JOURNAL_MANAGE" } });
    await prisma.roleMenu.deleteMany({ where: { roleId, menuId: manual.id } });
    for (const code of [AP_MANAGE, AR_MANAGE, SETTLEMENT_MATCH]) {
      const id = randomUUID(); this.approval.menuIds.push(id);
      await prisma.menu.create({ data: { id, menuCode: code, menuName: `TEST ${code}`, menuType: "PAGE", route: "/accounting", activeFlag: true } });
      await prisma.roleMenu.create({ data: { roleId, menuId: id } });
    }
    for (const [type, balance] of [["LIABILITY", "CREDIT"], ["ASSET", "DEBIT"], ["EXPENSE", "DEBIT"]]) {
      const id = randomUUID(); this.accountIds.push(id);
      await prisma.accountingAccount.create({ data: { id, code: `T${id.replaceAll("-", "").slice(0, 8)}`,
        name: `TEST ${type}`, accountType: type, normalBalance: balance, postingFlag: true, activeFlag: true } });
    }
    [this.apControl, this.arControl, this.expense] = this.accountIds;
    this.bankGl = (await prisma.accountingAccount.findUniqueOrThrow({ where: { code: "1110" } })).id;
    this.revenue = (await prisma.accountingAccount.findUniqueOrThrow({ where: { code: "4110" } })).id;
  }
  async counterparty(kind: DocumentKind = "PAYABLE") {
    const row = await createCounterparty(this.actor, { counterpartyCode: `T-${randomUUID()}`,
      displayName: `Synthetic TEST ${kind}`, counterpartyType: kind === "PAYABLE" ? "VENDOR" : "DEBTOR", memberId: null, activeFlag: true });
    this.counterpartyIds.push(row.id); return row.id;
  }
  documentInput(kind: DocumentKind, counterpartyId: string, amount = "8000000.00"): DocumentInput {
    return { counterpartyId, controlAccountId: kind === "PAYABLE" ? this.apControl : this.arControl,
      documentNumber: `T-${randomUUID()}`, sourceReference: `TEST evidence ${randomUUID()}`,
      recognitionBasis: "Synthetic TEST executed contract and earned/received evidence, independently reviewed.",
      documentDate: "2026-11-01", accountingDate: "2026-11-02", dueDate: "2026-11-30",
      lines: [{ accountingAccountId: kind === "PAYABLE" ? this.expense : this.revenue,
        description: "Synthetic TEST invoice line", amount, accountingFundId: null, eventCampaignId: null }] };
  }
  async approve(requestId: string) {
    await decideApproval(this.reviewer, requestId, "APPROVED", "Synthetic TEST evidence reviewed");
  }
  async document(kind: DocumentKind, counterpartyId: string, amount = "8000000.00", post = true) {
    const input = this.documentInput(kind, counterpartyId, amount);
    const document = await createDocument(this.actor, kind, input);
    const request = await submitSource(this.actor, kind, "DOCUMENT", document.id, document.revision);
    await this.approve(request.id);
    const journal = post ? await postSource(this.poster, kind, "DOCUMENT", document.id, request.id) : null;
    return { input, document, request, journal };
  }
  settlementInput(counterpartyId: string, allocations: Array<{ accountingDocumentId: string; allocatedAmount: string }>, amount: string,
    bankTransactionId: string | null = null): SettlementInput {
    return { counterpartyId, bankAccountId: this.approval.base.bankAccountId, bankGlAccountId: this.bankGl,
      settlementReference: `T-${randomUUID()}`, sourceReference: `Synthetic TEST payment proof ${randomUUID()}`,
      settlementDate: "2026-11-03", amount, bankTransactionId, allocations };
  }
  async settlement(kind: DocumentKind, input: SettlementInput, post = true) {
    const settlement = await createSettlement(this.actor, kind, input);
    const request = await submitSource(this.actor, kind, "SETTLEMENT", settlement.id, settlement.revision);
    await this.approve(request.id);
    const journal = post ? await postSource(this.poster, kind, "SETTLEMENT", settlement.id, request.id) : null;
    return { settlement, request, journal, input };
  }
  async applyReversal(request: { id: string }) { await this.approve(request.id); return postApprovedJournal(this.poster, request.id); }
  async bankEvidence(kind: DocumentKind, amount: string) {
    const base = this.approval.base, identityId = await base.identity(), campaign = await base.campaign("APAR bank evidence");
    await prisma.eventCode.update({ where: { id: campaign.eventCodeId }, data: { eventType: "STANDARD" } });
    const row = await base.transaction({ identityId, ...campaign, amount, approval: true });
    await prisma.bankTransaction.update({ where: { id: row.transactionId }, data: {
      transactionDate: new Date("2026-11-03"), originalAmount: kind === "PAYABLE" ? `-${amount}` : amount,
      eventCampaignId: null, transactionType: kind === "PAYABLE" ? "TRSF E-BANKING DB" : "TRSF E-BANKING CR" } });
    if (kind === "PAYABLE") await prisma.bankStatementUpload.update({ where: { id: row.statementId }, data: { totalCredit: "0.00", totalDebit: amount } });
    return row;
  }
  async cleanup() {
    requireSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL,
      { aryaEnv: process.env.ARYA_ENV, allowWrites: process.env.ALLOW_TEST_INTEGRATION_WRITES });
    const selected = await prisma.$queryRaw<Array<{ name: string }>>`SELECT DATABASE() AS name`;
    assertConnectedTestDatabase(selected[0]?.name);
    const actor = { in: this.approval.actorIds };
    await prisma.$transaction(async tx => {
      await tx.accountingApprovalHistory.deleteMany({ where: { request: { is: { requestedById: actor } } } });
      await tx.accountingApprovalApprover.deleteMany({ where: { request: { is: { requestedById: actor } } } });
      await tx.accountingApprovalRequest.deleteMany({ where: { requestedById: actor } });
      await tx.accountingSettlementAllocation.deleteMany({ where: { relFkAccAllocationSettlement: { is: { createdById: actor } } } });
      await tx.accountingDocumentAdjustment.deleteMany({ where: { relFkAccDocAdjustDoc: { is: { createdById: actor } } } });
      await tx.accountingSettlement.deleteMany({ where: { createdById: actor } });
      await tx.accountingDocumentLine.deleteMany({ where: { relFkAccDocLineDoc: { is: { createdById: actor } } } });
      await tx.accountingDocument.deleteMany({ where: { createdById: actor } });
      await tx.bankTransactionHistory.deleteMany({ where: { changedById: actor,
        bankTransactionId: { in: this.approval.base.transactionIds } } });
    });
    await this.approval.cleanup();
    await prisma.accountingCounterparty.deleteMany({ where: { id: { in: this.counterpartyIds } } });
    await prisma.accountingAccount.deleteMany({ where: { id: { in: this.accountIds } } });
    assert.equal(await prisma.accountingDocument.count({ where: { createdById: actor } }), 0);
    assert.equal(await prisma.accountingSettlement.count({ where: { createdById: actor } }), 0);
    assert.equal(await prisma.accountingCounterparty.count({ where: { id: { in: this.counterpartyIds } } }), 0);
    assert.equal(await prisma.accountingAccount.count({ where: { id: { in: this.accountIds } } }), 0);
  }
}
export async function aparScenario(work: (fixture: AparFixture) => Promise<void>) {
  const fixture = new AparFixture();
  try { await fixture.setup(); await work(fixture); } finally { await fixture.cleanup(); }
}
