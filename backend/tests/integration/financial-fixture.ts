import { randomUUID } from "node:crypto";
import { prisma } from "../../src/lib/prisma.js";

const testDate = new Date("2026-09-01T00:00:00.000Z");

/** Every created row is isolated by UUID and removed by its recorded owner/ID only. */
export class FinancialFixture {
  readonly userId = randomUUID();
  readonly bankAccountId = randomUUID();
  readonly memberIds: string[] = [];
  readonly identityIds: string[] = [];
  readonly eventCodeIds: string[] = [];
  readonly campaignIds: string[] = [];
  readonly statementIds: string[] = [];
  readonly transactionIds: string[] = [];
  readonly approvalIds: string[] = [];

  async setup() {
    await prisma.user.create({ data: {
      id: this.userId, fullName: "Integration Test Actor", email: `integration-${this.userId}@example.invalid`,
      passwordHash: "not-a-login-account", status: "ACTIVE"
    } });
    await prisma.bankAccount.create({ data: {
      id: this.bankAccountId, bankCode: "TEST", bankName: "Integration Test Bank",
      accountNo: this.bankAccountId, accountName: "Integration Test", currencyCode: "IDR"
    } });
  }

  async member(name: string) {
    const id = randomUUID();
    this.memberIds.push(id);
    await prisma.member.create({ data: {
      id, memberCode: `T-${id.replace(/-/g, "").slice(0, 24)}`, memberName: name,
      registrationSource: "MANUAL", registeredById: this.userId, createdById: this.userId, updatedById: this.userId
    } });
    return id;
  }

  async identity(memberId: string | null = null) {
    const id = randomUUID();
    this.identityIds.push(id);
    await prisma.memberIdentity.create({ data: {
      id, identityKey: `integration:${id}`, accountName: `Integration ${id}`, normalizedName: id,
      sourceType: "STATEMENT", memberId, verificationStatus: memberId ? "VERIFIED" : "UNVERIFIED",
      ...(memberId ? { verifiedAt: new Date(), verifiedById: this.userId } : {}),
      createdById: this.userId, updatedById: this.userId
    } });
    return id;
  }

  async campaign(name: string, targetAmount = "100.00") {
    const eventCodeId = randomUUID();
    const campaignId = randomUUID();
    this.eventCodeIds.push(eventCodeId);
    this.campaignIds.push(campaignId);
    await prisma.eventCode.create({ data: {
      id: eventCodeId, code: "901", eventName: `Integration ${name}`, eventType: "CAMPAIGN", activeFlag: true
    } });
    await prisma.eventCampaign.create({ data: {
      id: campaignId, eventCodeId, campaignName: `Integration ${name}`, targetAmount, activeFlag: true
    } });
    return { eventCodeId, campaignId };
  }

  async transaction(input: { identityId: string; eventCodeId: string; campaignId: string; amount?: string; status?: "CHECK" | "FINALIZED"; approval?: boolean }) {
    const statementId = randomUUID();
    const transactionId = randomUUID();
    this.statementIds.push(statementId);
    this.transactionIds.push(transactionId);
    const status = input.status ?? "CHECK";
    const amount = input.amount ?? "150.00";
    await prisma.bankStatementUpload.create({ data: {
      id: statementId, bankAccountId: this.bankAccountId, fileName: `integration-${statementId}.xlsx`,
      periodFrom: testDate, periodTo: testDate, totalTransaction: 1, totalCredit: amount, status,
      uploadedById: this.userId, executedAt: new Date(), executedById: this.userId
    } });
    await prisma.bankTransaction.create({ data: {
      id: transactionId, statementUploadId: statementId, rowNo: 1, transactionDate: testDate,
      transactionType: "TRSF E-BANKING CR", senderName: "INTEGRATION TEST", originalAmount: amount,
      baseAmount: amount, eventCodeId: input.eventCodeId, eventCampaignId: input.campaignId,
      memberIdentityId: input.identityId, status
    } });
    let approvalId: string | null = null;
    if (input.approval) {
      approvalId = randomUUID();
      this.approvalIds.push(approvalId);
      await prisma.reconciliationApproval.create({ data: {
        id: approvalId, statementUploadId: statementId, submittedById: this.userId, status: "PENDING",
        approvers: { create: { userId: this.userId } }
      } });
    }
    return { statementId, transactionId, approvalId };
  }

  async cleanup() {
    const memberId = { in: this.memberIds };
    const identityId = { in: this.identityIds };
    const statementId = { in: this.statementIds };
    const transactionId = { in: this.transactionIds };
    const approvalId = { in: this.approvalIds };
    const campaignId = { in: this.campaignIds };

    // Test-only, fixture-scoped cleanup; Accounting has no application deletion API.
    const accountingSource = { bankTransaction: { is: { statementUploadId: statementId } } };
    await prisma.accountingJournalLine.deleteMany({ where: { journal: { is: accountingSource } } });
    await prisma.accountingJournal.deleteMany({ where: { ...accountingSource, relatedJournalId: { not: null } } });
    await prisma.accountingJournal.deleteMany({ where: accountingSource });

    await prisma.memberEventCampaignWalletLedger.deleteMany({ where: { memberId } });
    await prisma.memberEventCampaignAllocation.deleteMany({ where: { memberId, reversalOfAllocationId: { not: null } } });
    await prisma.memberEventCampaignAllocation.deleteMany({ where: { memberId } });
    await prisma.memberEventBalanceLedger.deleteMany({ where: { subscription: { is: { memberId } } } });
    await prisma.memberEventCoverage.deleteMany({ where: { subscription: { is: { memberId } } } });
    await prisma.memberEventCarryTransfer.deleteMany({ where: { memberId, reversalOfTransferId: { not: null } } });
    await prisma.memberEventCarryTransfer.deleteMany({ where: { memberId } });
    await prisma.memberEventCampaignParticipation.deleteMany({ where: { memberId } });
    await prisma.memberEventSubscription.deleteMany({ where: { memberId } });
    await prisma.bankTransactionHistory.deleteMany({ where: { bankTransactionId: transactionId } });
    await prisma.reconciliationCorrectionItem.deleteMany({ where: { proposal: { is: { statementUploadId: statementId } } } });
    await prisma.reconciliationCorrectionApprover.deleteMany({ where: { proposal: { is: { statementUploadId: statementId } } } });
    await prisma.reconciliationCorrectionProposal.deleteMany({ where: { statementUploadId: statementId } });
    await prisma.reconciliationApprovalHistory.deleteMany({ where: { approvalId } });
    await prisma.reconciliationApprovalApprover.deleteMany({ where: { approvalId } });
    await prisma.reconciliationApproval.deleteMany({ where: { id: approvalId } });
    await prisma.bankTransaction.deleteMany({ where: { id: transactionId } });
    await prisma.memberIdentityHistory.deleteMany({ where: { memberIdentityId: identityId } });
    await prisma.memberIdentity.deleteMany({ where: { id: identityId } });
    await prisma.bankStatementUpload.deleteMany({ where: { id: statementId } });
    await prisma.member.deleteMany({ where: { id: memberId } });
    await prisma.eventCampaign.deleteMany({ where: { id: campaignId } });
    await prisma.eventTimeRule.deleteMany({ where: { eventCodeId: { in: this.eventCodeIds } } });
    await prisma.eventCode.deleteMany({ where: { id: { in: this.eventCodeIds } } });
    await prisma.bankAccount.deleteMany({ where: { id: this.bankAccountId } });
    await prisma.user.deleteMany({ where: { id: this.userId } });
  }
}
