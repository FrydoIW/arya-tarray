import { Prisma } from "@prisma/client";
import { currentBusinessDayValue } from "../../../lib/business-time.js";
import { HttpError } from "../../../lib/http.js";
import { decimalStringToCents } from "../../reconciliation/reconciliation-classification.js";
import { centsToDecimal } from "../data/member-donation.domain.js";
import { campaignDisplayStatus } from "../../configuration/event-code/event-campaign.service.js";

type Tx = Prisma.TransactionClient;

const day = () => new Date(`${currentBusinessDayValue()}T00:00:00.000Z`);
const cents = (value: { toString(): string } | null | undefined) => decimalStringToCents(value?.toString() ?? "0");

export function campaignAllocationDecision(input: { incoming: bigint; target: bigint | null; activeApplied: bigint }) {
  if (input.incoming <= 0n) throw new HttpError(400, "Campaign contribution must be greater than zero.");
  if (input.target === null) return { applied: input.incoming, overflow: 0n, remainingBefore: null };
  const remainingBefore = input.target > input.activeApplied ? input.target - input.activeApplied : 0n;
  const applied = input.incoming < remainingBefore ? input.incoming : remainingBefore;
  return { applied, overflow: input.incoming - applied, remainingBefore };
}

/** Locks the one global Campaign capacity row before reading its active allocations. */
export async function lockCampaignForWallet(tx: Tx, campaignId: string) {
  const raw = tx as Tx & { $queryRaw?: <T = unknown>(query: Prisma.Sql) => Promise<T> };
  if (typeof raw.$queryRaw === "function") {
    await raw.$queryRaw(Prisma.sql`SELECT event_campaign_id FROM arya_event_campaign
      WHERE event_campaign_id = ${campaignId} FOR UPDATE`);
  }
}

export async function campaignTargetState(tx: Tx, campaignId: string, options: { excludeBankTransactionId?: string } = {}) {
  await lockCampaignForWallet(tx, campaignId);
  const campaign = await tx.eventCampaign.findUnique({ where: { id: campaignId }, select: {
    id: true, targetAmount: true, activeFlag: true, startDate: true, endDate: true,
    eventCode: { select: { activeFlag: true, eventType: true } }
  } });
  if (!campaign || campaign.eventCode.eventType !== "CAMPAIGN") throw new HttpError(404, "Campaign tidak ditemukan.");
  const [applied, legacyDirect] = await Promise.all([
    tx.memberEventCampaignAllocation.aggregate({ where: { eventCampaignId: campaign.id, allocationStatus: "ACTIVE" }, _sum: { amountDelta: true } }),
    tx.bankTransaction.aggregate({ where: {
      eventCampaignId: campaign.id, status: "FINALIZED", reconciliationExcludedAt: null, originalAmount: { gt: 0 },
      ...(options.excludeBankTransactionId ? { id: { not: options.excludeBankTransactionId } } : {}),
      memberEventCampaignAllocations: { none: {} }
    }, _sum: { originalAmount: true } })
  ]);
  const activeApplied = cents(applied._sum.amountDelta) + cents(legacyDirect._sum.originalAmount);
  const target = campaign.targetAmount ? cents(campaign.targetAmount) : null;
  return { campaign, target, activeApplied, remaining: target === null ? null : (target > activeApplied ? target - activeApplied : 0n) };
}

export async function campaignWalletCents(tx: Tx, memberId: string, eventCampaignId: string) {
  const total = await tx.memberEventCampaignWalletLedger.aggregate({
    where: { memberId, eventCampaignId, entryStatus: "ACTIVE" }, _sum: { amountDelta: true }
  });
  return cents(total._sum.amountDelta);
}

export async function requireCampaignCarryDestination(tx: Tx, campaignId: string) {
  const state = await campaignTargetState(tx, campaignId);
  const status = campaignDisplayStatus({ ...state.campaign, activeFlag: state.campaign.activeFlag && state.campaign.eventCode.activeFlag });
  if (status !== "ACTIVE") throw new HttpError(409, "Campaign tujuan tidak aktif atau berada di luar periode valid.");
  if (state.target !== null && state.remaining === 0n) throw new HttpError(409, "Target Campaign sudah terpenuhi dan tidak dapat menerima alokasi carry.");
  return state;
}

/**
 * Posts a real finalized Campaign contribution once. The raw BankTransaction remains
 * the contribution evidence; this service records only target consumption and overflow.
 */
export async function synchronizeCampaignContribution(tx: Tx, transactionId: string, userId: string) {
  const payment = await tx.bankTransaction.findUnique({ where: { id: transactionId }, select: {
    id: true, transactionDate: true, originalAmount: true, status: true, reconciliationExcludedAt: true,
    eventCampaignId: true, eventCode: { select: { eventType: true } },
    memberIdentity: { select: { memberId: true, verificationStatus: true } }
  } });
  if (!payment || payment.status !== "FINALIZED" || payment.reconciliationExcludedAt || !payment.transactionDate
    || !payment.eventCampaignId || payment.eventCode?.eventType !== "CAMPAIGN" || cents(payment.originalAmount) <= 0n)
    return { state: "NOT_CAMPAIGN" as const };
  const memberId = payment.memberIdentity?.verificationStatus === "VERIFIED" ? payment.memberIdentity.memberId : null;
  if (!memberId) return { state: "PENDING_MEMBER" as const };

  const existing = await tx.memberEventCampaignAllocation.findUnique({ where: { bankTransactionId: payment.id }, select: { id: true } });
  if (existing) return { state: "ALLOCATED" as const, allocationId: existing.id };

  const state = await campaignTargetState(tx, payment.eventCampaignId, { excludeBankTransactionId: payment.id });
  const decision = campaignAllocationDecision({ incoming: cents(payment.originalAmount), target: state.target, activeApplied: state.activeApplied });
  const allocation = await tx.memberEventCampaignAllocation.create({ data: {
    memberId, eventCampaignId: payment.eventCampaignId, bankTransactionId: payment.id,
    amountDelta: centsToDecimal(decision.applied), allocationType: "DIRECT_CONTRIBUTION", allocationStatus: "ACTIVE",
    effectiveDate: payment.transactionDate, reason: "Finalized direct Campaign contribution", createdById: userId
  }, select: { id: true } });
  if (decision.overflow > 0n) await tx.memberEventCampaignWalletLedger.create({ data: {
    memberId, eventCampaignId: payment.eventCampaignId, bankTransactionId: payment.id,
    entryType: "CAMPAIGN_OVERFLOW", entryStatus: "ACTIVE", amountDelta: centsToDecimal(decision.overflow),
    effectiveDate: payment.transactionDate, remark: "Campaign target overflow from finalized BankTransaction", createdById: userId
  } });
  return { state: "ALLOCATED" as const, allocationId: allocation.id, applied: centsToDecimal(decision.applied), overflow: centsToDecimal(decision.overflow) };
}

export async function synchronizePendingCampaignContributionsForMember(tx: Tx, memberId: string, userId: string) {
  const payments = await tx.bankTransaction.findMany({ where: {
    status: "FINALIZED", reconciliationExcludedAt: null, eventCode: { is: { eventType: "CAMPAIGN" } },
    memberIdentity: { is: { memberId, verificationStatus: "VERIFIED" } }
  }, select: { id: true }, orderBy: [{ transactionDate: "asc" }, { id: "asc" }] });
  for (const payment of payments) await synchronizeCampaignContribution(tx, payment.id, userId);
}

export function campaignTransferAmountIsAllowed(requested: bigint, remaining: bigint | null) {
  return requested > 0n && (remaining === null || requested <= remaining);
}

export { day as campaignWalletBusinessDay };
