import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { prisma } from "../../src/lib/prisma.js";
import { decideSignApprovalAtomic } from "../../src/modules/approval/sign-approval/sign-approval.repository.js";
import { linkMember, registerMember } from "../../src/modules/member/registration/member-registration.repository.js";
import { detachIdentity, moveIdentity } from "../../src/modules/member/data/member-data.repository.js";
import { memberInputSchema } from "../../src/modules/member/registration/member-registration.schema.js";
import { synchronizeCampaignContribution } from "../../src/modules/member/campaign/member-campaign-wallet.service.js";
import { createCampaignWalletTransfer, reverseCarryTransfer } from "../../src/modules/member/time-based/member-carry-transfer.service.js";
import { FinancialFixture } from "./financial-fixture.js";

async function withFixture(work: (fixture: FinancialFixture) => Promise<void>) {
  const fixture = new FinancialFixture();
  try {
    await fixture.setup();
    await work(fixture);
  } finally {
    await fixture.cleanup();
  }
}

/** Test-only fault after a real downstream INSERT inside the production transaction. */
async function failAfterCampaignInsert(work: () => Promise<unknown>) {
  type InteractiveTransaction = (fn: (tx: Prisma.TransactionClient) => Promise<unknown>,
    options?: { isolationLevel?: Prisma.TransactionIsolationLevel; timeout?: number; maxWait?: number }) => Promise<unknown>;
  const client = prisma as unknown as { $transaction: InteractiveTransaction };
  const originalMethod = client.$transaction;
  const original = originalMethod.bind(prisma);
  client.$transaction = (fn, options) => original(async tx => {
    const faultedTx = new Proxy(tx, {
      get(target, key) {
        if (key !== "memberEventCampaignAllocation") return Reflect.get(target, key, target);
        const delegate = target.memberEventCampaignAllocation;
        return new Proxy(delegate, {
          get(model, operation) {
            if (operation !== "create") return Reflect.get(model, operation, model);
            return async (args: unknown) => {
              await Reflect.apply(Reflect.get(model, "create", model), model, [args]);
              throw new Error("Injected failure after Campaign posting INSERT");
            };
          }
        });
      }
    });
    return fn(faultedTx);
  }, options);
  try {
    await work();
  } finally {
    client.$transaction = originalMethod;
  }
}

/** Simulate one retryable abort after the callback wrote to real MySQL. */
async function abortFirstTransactionAsSerializationConflict(work: () => Promise<unknown>) {
  type InteractiveTransaction = (fn: (tx: Prisma.TransactionClient) => Promise<unknown>,
    options?: { isolationLevel?: Prisma.TransactionIsolationLevel; timeout?: number; maxWait?: number }) => Promise<unknown>;
  const client = prisma as unknown as { $transaction: InteractiveTransaction };
  const originalMethod = client.$transaction;
  const original = originalMethod.bind(prisma);
  let first = true;
  client.$transaction = (fn, options) => original(async tx => {
    const result = await fn(tx);
    if (first) {
      first = false;
      throw new Prisma.PrismaClientKnownRequestError("Injected serialization abort", { code: "P2034", clientVersion: "test" });
    }
    return result;
  }, options);
  try {
    await work();
  } finally {
    client.$transaction = originalMethod;
  }
}

test("approval commits FINALIZED, Campaign allocation, overflow, and approver history exactly once", async () => {
  await withFixture(async fixture => {
    const memberId = await fixture.member("Approval Test Donor");
    const identityId = await fixture.identity(memberId);
    const campaign = await fixture.campaign("Approval Success");
    const { statementId, transactionId, approvalId } = await fixture.transaction({ identityId, ...campaign, approval: true });
    assert.ok(approvalId);

    const decision = await decideSignApprovalAtomic({ approvalId, userId: fixture.userId, decision: "APPROVED" });
    assert.equal(decision.status, "APPROVED");
    assert.equal((await prisma.bankStatementUpload.findUniqueOrThrow({ where: { id: statementId } })).status, "FINALIZED");
    assert.equal((await prisma.bankTransaction.findUniqueOrThrow({ where: { id: transactionId } })).status, "FINALIZED");
    const allocation = await prisma.memberEventCampaignAllocation.findMany({ where: { bankTransactionId: transactionId } });
    const wallet = await prisma.memberEventCampaignWalletLedger.findMany({ where: { bankTransactionId: transactionId } });
    assert.equal(allocation.length, 1);
    assert.equal(allocation[0]!.amountDelta.toFixed(2), "100.00");
    assert.equal(wallet.length, 1);
    assert.equal(wallet[0]!.amountDelta.toFixed(2), "50.00");
    assert.equal(await prisma.reconciliationApprovalApprover.count({ where: { approvalId } }), 1);
    assert.equal(await prisma.reconciliationApprovalHistory.count({ where: { approvalId, action: "APPROVED" } }), 1);

    await assert.rejects(decideSignApprovalAtomic({ approvalId, userId: fixture.userId, decision: "APPROVED" }));
    assert.equal(await prisma.memberEventCampaignAllocation.count({ where: { bankTransactionId: transactionId } }), 1);
    assert.equal(await prisma.reconciliationApprovalHistory.count({ where: { approvalId, action: "APPROVED" } }), 1);
  });
});

test("downstream Campaign failure rolls approval, statement, transaction, posting, and history back together", async () => {
  await withFixture(async fixture => {
    const memberId = await fixture.member("Rollback Test Donor");
    const identityId = await fixture.identity(memberId);
    const campaign = await fixture.campaign("Approval Rollback");
    const { statementId, transactionId, approvalId } = await fixture.transaction({ identityId, ...campaign, approval: true });
    assert.ok(approvalId);

    await assert.rejects(failAfterCampaignInsert(() => decideSignApprovalAtomic({ approvalId, userId: fixture.userId, decision: "APPROVED" })),
      /Injected failure after Campaign posting INSERT/);
    assert.equal((await prisma.reconciliationApproval.findUniqueOrThrow({ where: { id: approvalId } })).status, "PENDING");
    assert.equal((await prisma.bankStatementUpload.findUniqueOrThrow({ where: { id: statementId } })).status, "CHECK");
    assert.equal((await prisma.bankTransaction.findUniqueOrThrow({ where: { id: transactionId } })).status, "CHECK");
    assert.equal(await prisma.memberEventCampaignAllocation.count({ where: { bankTransactionId: transactionId } }), 0);
    assert.equal(await prisma.memberEventCampaignWalletLedger.count({ where: { bankTransactionId: transactionId } }), 0);
    assert.equal(await prisma.reconciliationApprovalHistory.count({ where: { approvalId } }), 0);
  });
});

test("concurrent approval decisions preserve one CAS winner and one financial posting", async () => {
  await withFixture(async fixture => {
    const memberId = await fixture.member("Concurrent Approval Donor");
    const identityId = await fixture.identity(memberId);
    const campaign = await fixture.campaign("Concurrent Approval", "1000.00");
    const { transactionId, approvalId } = await fixture.transaction({ identityId, ...campaign, approval: true });
    assert.ok(approvalId);
    const command = { approvalId, userId: fixture.userId, decision: "APPROVED" as const };
    const attempts = await Promise.allSettled([decideSignApprovalAtomic(command), decideSignApprovalAtomic(command)]);
    assert.equal(attempts.filter(result => result.status === "fulfilled").length, 1);
    assert.equal((await prisma.reconciliationApproval.findUniqueOrThrow({ where: { id: approvalId } })).status, "APPROVED");
    assert.equal(await prisma.reconciliationApprovalHistory.count({ where: { approvalId, action: "APPROVED" } }), 1);
    assert.equal(await prisma.memberEventCampaignAllocation.count({ where: { bankTransactionId: transactionId, allocationStatus: "ACTIVE" } }), 1);
  });
});

test("FINALIZED bank evidence links to a Member, replays once, moves, and detaches canonically", async () => {
  await withFixture(async fixture => {
    const firstMemberId = await fixture.member("First Test Donor");
    const secondMemberId = await fixture.member("Second Test Donor");
    const identityId = await fixture.identity();
    const campaign = await fixture.campaign("Ownership Flow", "1000.00");
    const { transactionId, approvalId } = await fixture.transaction({ identityId, ...campaign, approval: true });
    assert.ok(approvalId);
    await decideSignApprovalAtomic({ approvalId, userId: fixture.userId, decision: "APPROVED" });
    assert.equal(await prisma.memberEventCampaignAllocation.count({ where: { bankTransactionId: transactionId } }), 0);

    await linkMember(identityId, firstMemberId, fixture.userId);
    let owner = await prisma.memberIdentity.findUniqueOrThrow({ where: { id: identityId } });
    assert.equal(owner.memberId, firstMemberId);
    assert.equal(owner.verificationStatus, "VERIFIED");
    await prisma.$transaction(tx => synchronizeCampaignContribution(tx, transactionId, fixture.userId));
    await prisma.$transaction(tx => synchronizeCampaignContribution(tx, transactionId, fixture.userId));
    assert.equal(await prisma.memberEventCampaignAllocation.count({ where: { bankTransactionId: transactionId, allocationStatus: "ACTIVE" } }), 1);

    await moveIdentity(firstMemberId, identityId, secondMemberId, "Integration move", fixture.userId);
    owner = await prisma.memberIdentity.findUniqueOrThrow({ where: { id: identityId } });
    assert.equal(owner.memberId, secondMemberId);
    const movedAllocation = await prisma.memberEventCampaignAllocation.findFirstOrThrow({ where: {
      bankTransactionId: transactionId, memberId: secondMemberId, allocationStatus: "ACTIVE"
    } });
    assert.equal(movedAllocation.memberId, secondMemberId);
    assert.equal(await prisma.memberEventCampaignAllocation.count({ where: { bankTransactionId: transactionId, memberId: firstMemberId, allocationStatus: "ACTIVE" } }), 0);

    await detachIdentity(secondMemberId, identityId, "Integration detach", fixture.userId);
    owner = await prisma.memberIdentity.findUniqueOrThrow({ where: { id: identityId } });
    assert.equal(owner.memberId, null);
    assert.equal(owner.verificationStatus, "UNVERIFIED");
    assert.equal(await prisma.memberEventCampaignAllocation.count({ where: { bankTransactionId: transactionId, allocationStatus: "ACTIVE" } }), 0);
    assert.equal(await prisma.memberIdentityHistory.count({ where: { memberIdentityId: identityId } }), 3);
  });
});

test("registration creates canonical Member ownership and derived Campaign evidence", async () => {
  await withFixture(async fixture => {
    const identityId = await fixture.identity();
    const campaign = await fixture.campaign("Registration Flow", "1000.00");
    const { transactionId } = await fixture.transaction({ identityId, ...campaign, status: "FINALIZED", approval: false });
    const member = await registerMember(memberInputSchema.parse({ memberName: "Registered Test Donor" }), fixture.userId, identityId);
    fixture.memberIds.push(member.id);
    assert.equal((await prisma.memberIdentity.findUniqueOrThrow({ where: { id: identityId } })).memberId, member.id);
    assert.equal(await prisma.memberIdentityHistory.count({ where: { memberIdentityId: identityId, action: "REGISTER" } }), 1);
    assert.equal(await prisma.memberEventCampaignAllocation.count({ where: { bankTransactionId: transactionId, memberId: member.id, allocationStatus: "ACTIVE" } }), 1);
  });
});

test("failure during identity posting rolls ownership, history, and Campaign allocation back", async () => {
  await withFixture(async fixture => {
    const memberId = await fixture.member("Identity Rollback Donor");
    const identityId = await fixture.identity();
    const campaign = await fixture.campaign("Identity Rollback", "1000.00");
    const { transactionId } = await fixture.transaction({ identityId, ...campaign, status: "FINALIZED", approval: false });
    await assert.rejects(failAfterCampaignInsert(() => linkMember(identityId, memberId, fixture.userId)),
      /Injected failure after Campaign posting INSERT/);
    const identity = await prisma.memberIdentity.findUniqueOrThrow({ where: { id: identityId } });
    assert.equal(identity.memberId, null);
    assert.equal(identity.verificationStatus, "UNVERIFIED");
    assert.equal(await prisma.memberIdentityHistory.count({ where: { memberIdentityId: identityId } }), 0);
    assert.equal(await prisma.memberEventCampaignAllocation.count({ where: { bankTransactionId: transactionId } }), 0);
  });
});

test("memberTransaction retries the whole transaction after a serialization abort without duplicate evidence", async () => {
  await withFixture(async fixture => {
    const memberId = await fixture.member("Retry Test Donor");
    const identityId = await fixture.identity();
    const campaign = await fixture.campaign("Retry Flow", "1000.00");
    const { transactionId } = await fixture.transaction({ identityId, ...campaign, status: "FINALIZED", approval: false });
    await abortFirstTransactionAsSerializationConflict(() => linkMember(identityId, memberId, fixture.userId));
    assert.equal((await prisma.memberIdentity.findUniqueOrThrow({ where: { id: identityId } })).memberId, memberId);
    assert.equal(await prisma.memberIdentityHistory.count({ where: { memberIdentityId: identityId, action: "LINK" } }), 1);
    assert.equal(await prisma.memberEventCampaignAllocation.count({ where: { bankTransactionId: transactionId, allocationStatus: "ACTIVE" } }), 1);
  });
});

test("approved correction preserves proposal, remark evidence, snapshot, and FINALIZED state", async () => {
  await withFixture(async fixture => {
    const memberId = await fixture.member("Correction Test Donor");
    const identityId = await fixture.identity(memberId);
    const campaign = await fixture.campaign("Correction Evidence", "1000.00");
    const { statementId, transactionId, approvalId } = await fixture.transaction({ identityId, ...campaign, approval: true });
    assert.ok(approvalId);
    // An Edit Income correction reopens a statement; its original transaction remains FINALIZED.
    await prisma.bankTransaction.update({ where: { id: transactionId }, data: { status: "FINALIZED" } });
    const proposal = await prisma.reconciliationCorrectionProposal.create({ data: {
      approvalId, statementUploadId: statementId, status: "PENDING", proposedById: fixture.userId,
      approvers: { create: { userId: fixture.userId } },
      items: { create: {
        action: "MODIFIED", bankTransactionId: transactionId,
        beforeEventCodeId: campaign.eventCodeId, proposedEventCodeId: campaign.eventCodeId,
        beforeEventCampaignId: campaign.campaignId, proposedEventCampaignId: campaign.campaignId,
        beforeRemark: null, proposedRemark: "Reviewed integration note", correctionReason: "Integration correction"
      } }
    } });

    await decideSignApprovalAtomic({ approvalId, userId: fixture.userId, decision: "APPROVED" });
    const transaction = await prisma.bankTransaction.findUniqueOrThrow({ where: { id: transactionId } });
    assert.equal(transaction.status, "FINALIZED");
    assert.equal(transaction.remark, "Reviewed integration note");
    assert.equal((await prisma.reconciliationCorrectionProposal.findUniqueOrThrow({ where: { id: proposal.id } })).status, "APPROVED");
    assert.equal(await prisma.bankTransactionHistory.count({ where: { bankTransactionId: transactionId, fieldName: "remark" } }), 1);
    assert.equal(await prisma.reconciliationCorrectionApprover.count({ where: { proposalId: proposal.id, userId: fixture.userId } }), 1);
    assert.equal(await prisma.reconciliationApprovalHistory.count({ where: { approvalId, action: "APPROVED" } }), 1);
    assert.equal(await prisma.memberEventCampaignAllocation.count({ where: { bankTransactionId: transactionId, allocationStatus: "ACTIVE" } }), 1);
  });
});

test("shared DEV cleanup preserves other ownership scopes and seeded configuration", async () => {
  const first = new FinancialFixture();
  const retained = new FinancialFixture();
  try {
    await first.setup();
    await retained.setup();
    const memberId = await retained.member("Unrelated synthetic DEV ownership scope");
    const identityId = await retained.identity(memberId);
    const campaign = await retained.campaign("Retained synthetic DEV evidence");
    const row = await retained.transaction({ identityId, ...campaign });
    const before = await prisma.bankTransaction.findUniqueOrThrow({ where: { id: row.transactionId } });
    const accounts = await prisma.accountingAccount.findMany({ orderBy: { code: "asc" } });
    const menu = await prisma.menu.findFirstOrThrow({ where: { menuCode: "ACCOUNTING_REPORT" } });
    await first.cleanup();
    assert.deepEqual(await prisma.bankTransaction.findUniqueOrThrow({ where: { id: row.transactionId } }), before);
    assert.equal(await prisma.member.count({ where: { id: memberId } }), 1);
    assert.equal(await prisma.user.count({ where: { id: retained.userId } }), 1);
    assert.equal(await prisma.bankAccount.count({ where: { id: retained.bankAccountId } }), 1);
    assert.deepEqual(await prisma.accountingAccount.findMany({ orderBy: { code: "asc" } }), accounts);
    assert.deepEqual(await prisma.menu.findUniqueOrThrow({ where: { id: menu.id } }), menu);
  } finally {
    await first.cleanup();
    await retained.cleanup();
  }
});

test("concurrent carry request, replay, and reversal preserve one transfer and compensating evidence", async () => {
  await withFixture(async fixture => {
    const memberId = await fixture.member("Carry Test Donor");
    const identityId = await fixture.identity(memberId);
    const source = await fixture.campaign("Carry Source", "50.00");
    const destination = await fixture.campaign("Carry Destination", "1000.00");
    const { transactionId } = await fixture.transaction({ identityId, ...source, status: "FINALIZED", approval: false });
    await prisma.$transaction(tx => synchronizeCampaignContribution(tx, transactionId, fixture.userId));
    assert.equal((await prisma.memberEventCampaignWalletLedger.findFirstOrThrow({ where: { bankTransactionId: transactionId } }))
      .amountDelta.toFixed(2), "100.00");
    const command = { destinationCampaignId: destination.campaignId, amount: "40.00", reason: "Integration carry",
      idempotencyKey: `integration-forward-${fixture.userId}` };
    const attempts = await Promise.allSettled([
      createCampaignWalletTransfer(memberId, source.campaignId, command, fixture.userId),
      createCampaignWalletTransfer(memberId, source.campaignId, command, fixture.userId)
    ]);
    assert.ok(attempts.some(result => result.status === "fulfilled"));
    const replay = await createCampaignWalletTransfer(memberId, source.campaignId, command, fixture.userId);
    assert.equal(await prisma.memberEventCarryTransfer.count({ where: { memberId, reversalOfTransferId: null } }), 1);
    assert.equal(replay.transfer.transferId, (attempts.find(result => result.status === "fulfilled") as PromiseFulfilledResult<typeof replay>).value.transfer.transferId);
    const transferId = replay.transfer.transferId;
    assert.equal(await prisma.memberEventCampaignWalletLedger.count({ where: { carryTransferId: transferId, entryType: "TRANSFER_OUT" } }), 1);
    assert.equal(await prisma.memberEventCampaignAllocation.count({ where: { carryTransferId: transferId, allocationType: "CARRY_TRANSFER" } }), 1);

    const reversalCommand = { reason: "Integration reversal", idempotencyKey: `integration-reverse-${fixture.userId}` };
    const reversed = await reverseCarryTransfer(memberId, transferId, reversalCommand, fixture.userId);
    const reversedReplay = await reverseCarryTransfer(memberId, transferId, reversalCommand, fixture.userId);
    assert.equal(reversed.reversal.transferId, reversedReplay.reversal.transferId);
    assert.equal(await prisma.memberEventCarryTransfer.count({ where: { memberId } }), 2);
    assert.equal(await prisma.memberEventCampaignWalletLedger.count({ where: { carryTransferId: reversed.reversal.transferId, entryType: "TRANSFER_IN" } }), 1);
    assert.equal(await prisma.memberEventCampaignAllocation.count({ where: { carryTransferId: reversed.reversal.transferId, allocationType: "CARRY_REVERSAL" } }), 1);
    assert.equal((await prisma.memberEventCarryTransfer.findUniqueOrThrow({ where: { id: transferId } })).status, "REVERSED");
  });
});
