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

/** Locks the global Campaign row(s) in lexical id order so concurrent wallet work cannot interleave. */
export async function lockCampaignsForPosting(tx: Tx, campaignIds: string[]) {
  const ids = [...new Set(campaignIds)].sort();
  if (!ids.length) return;
  const raw = tx as Tx & { $queryRaw?: <T = unknown>(query: Prisma.Sql) => Promise<T> };
  if (typeof raw.$queryRaw !== "function") return;
  await raw.$queryRaw(Prisma.sql`SELECT event_campaign_id FROM arya_event_campaign
    WHERE event_campaign_id IN (${Prisma.join(ids)}) ORDER BY event_campaign_id FOR UPDATE`);
}

/** Locks the one global Campaign capacity row before reading its active allocations. */
export async function lockCampaignForWallet(tx: Tx, campaignId: string) {
  await lockCampaignsForPosting(tx, [campaignId]);
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

/** Caller must lock the Campaign row first with lockCampaignsForPosting. */
export async function allocateCampaignWalletPostingSequences(tx: Tx, memberId: string, campaignId: string, count: number) {
  if (!Number.isInteger(count) || count < 1) throw new Error("Campaign wallet posting sequence count must be a positive integer");
  const row = await tx.memberEventCampaignWalletLedger.aggregate({ where: { memberId, eventCampaignId: campaignId }, _max: { postingSequence: true } });
  const start = (row._max.postingSequence ?? 0n) + 1n;
  return Array.from({ length: count }, (_, index) => start + BigInt(index));
}

type CampaignWalletDependencyRow = { id: string; entryType: string; carryTransferId: string | null;
  postingSequence: bigint; amountDelta: { toString(): string } };

/**
 * A later ACTIVE negative wallet entry is a dependency. A TRANSFER_OUT is resolved
 * only when its downstream Carry Transfer is REVERSED; every other negative action
 * stays unresolved.
 */
export function resolveCampaignWalletDependency(row: CampaignWalletDependencyRow, downstreamStatusById: Map<string, string>) {
  if (cents(row.amountDelta) >= 0n) return true;
  return row.entryType === "TRANSFER_OUT" && Boolean(row.carryTransferId)
    && downstreamStatusById.get(row.carryTransferId!) === "REVERSED";
}

export async function campaignWalletDependencies(tx: Tx, memberId: string, eventCampaignId: string, afterPostingSequence: bigint) {
  const later = await tx.memberEventCampaignWalletLedger.findMany({
    where: { memberId, eventCampaignId, entryStatus: "ACTIVE", postingSequence: { gt: afterPostingSequence } },
    orderBy: { postingSequence: "asc" },
    select: { id: true, entryType: true, carryTransferId: true, postingSequence: true, amountDelta: true }
  });
  const negatives = later.filter(row => cents(row.amountDelta) < 0n);
  const transferIds = [...new Set(negatives.flatMap(row => row.carryTransferId ? [row.carryTransferId] : []))];
  const downstream = transferIds.length
    ? await tx.memberEventCarryTransfer.findMany({ where: { id: { in: transferIds } }, select: { id: true, status: true } })
    : [];
  const statusById = new Map(downstream.map(row => [row.id, row.status]));
  return negatives.map(row => ({ id: row.id, entryType: row.entryType, carryTransferId: row.carryTransferId,
    postingSequence: row.postingSequence, amountDelta: row.amountDelta, resolved: resolveCampaignWalletDependency(row, statusById) }));
}

export function assertCampaignWalletCanBeReplaced(dependencies: Array<{ resolved: boolean }>) {
  if (dependencies.some(row => !row.resolved))
    throw new HttpError(409, "Saldo Campaign dari kontribusi ini sudah dialihkan. Balikkan transfer lanjutan terlebih dahulu sebelum mengoreksi transaksi.");
}

type ContributionEvidence = {
  allocations: Array<{ id: string; eventCampaignId: string; memberId: string; amountDelta: Prisma.Decimal; allocationStatus: string }>;
  overflow: Array<{ id: string; eventCampaignId: string; memberId: string; amountDelta: Prisma.Decimal; entryStatus: string; postingSequence: bigint }>;
};

async function loadContributionEvidence(tx: Tx, bankTransactionId: string): Promise<ContributionEvidence> {
  const [allocations, overflow] = await Promise.all([
    tx.memberEventCampaignAllocation.findMany({ where: { bankTransactionId, allocationStatus: "ACTIVE" },
      select: { id: true, eventCampaignId: true, memberId: true, amountDelta: true, allocationStatus: true } }),
    tx.memberEventCampaignWalletLedger.findMany({ where: { bankTransactionId, entryStatus: "ACTIVE" },
      select: { id: true, eventCampaignId: true, memberId: true, amountDelta: true, entryStatus: true, postingSequence: true } })
  ]);
  return { allocations, overflow };
}

async function assertContributionEvidenceReplaceable(tx: Tx, evidence: ContributionEvidence) {
  for (const entry of evidence.overflow) {
    const dependencies = await campaignWalletDependencies(tx, entry.memberId, entry.eventCampaignId, entry.postingSequence);
    assertCampaignWalletCanBeReplaced(dependencies);
    const balance = await campaignWalletCents(tx, entry.memberId, entry.eventCampaignId);
    if (cents(entry.amountDelta) > balance)
      throw new HttpError(409, "Saldo wallet Campaign tidak mencukupi untuk membatalkan overflow kontribusi ini. Balikkan transfer lanjutan terlebih dahulu.");
  }
}

async function voidContributionEvidence(tx: Tx, evidence: ContributionEvidence, reason: string, userId: string) {
  const now = new Date();
  for (const allocation of evidence.allocations) {
    await tx.memberEventCampaignAllocation.update({ where: { id: allocation.id },
      data: { allocationStatus: "VOIDED", voidedAt: now, voidedById: userId, voidReason: reason } });
  }
  for (const entry of evidence.overflow) {
    await tx.memberEventCampaignWalletLedger.update({ where: { id: entry.id },
      data: { entryStatus: "VOIDED", voidedAt: now, voidedById: userId, voidReason: reason } });
  }
}

/**
 * Reconciles the Campaign economics of one BankTransaction against its CURRENT
 * authoritative state. Evidence is never deleted: stale rows are voided with an
 * audit reason and new rows are appended when the transaction still contributes.
 */
export async function reconcileCampaignContribution(tx: Tx, transactionId: string, userId: string,
  options: { reason?: string } = {}) {
  const payment = await tx.bankTransaction.findUnique({ where: { id: transactionId }, select: {
    id: true, transactionDate: true, originalAmount: true, status: true, reconciliationExcludedAt: true,
    eventCampaignId: true, eventCode: { select: { eventType: true } },
    memberIdentity: { select: { memberId: true, verificationStatus: true } }
  } });
  if (!payment) return { state: "MISSING" as const };

  const memberId = payment.memberIdentity?.verificationStatus === "VERIFIED" ? payment.memberIdentity.memberId : null;
  const official = payment.status === "FINALIZED" && !payment.reconciliationExcludedAt
    && !!payment.transactionDate && cents(payment.originalAmount) > 0n;
  const campaignEligible = official && Boolean(payment.eventCampaignId) && payment.eventCode?.eventType === "CAMPAIGN";
  const reason = options.reason ?? "Campaign contribution reconciled from the current BankTransaction state";

  const preliminary = await loadContributionEvidence(tx, payment.id);
  await lockCampaignsForPosting(tx, [
    ...preliminary.allocations.map(row => row.eventCampaignId),
    ...preliminary.overflow.map(row => row.eventCampaignId),
    ...(campaignEligible && payment.eventCampaignId ? [payment.eventCampaignId] : [])
  ]);
  const evidence = await loadContributionEvidence(tx, payment.id);

  if (!campaignEligible || !memberId) {
    if (!evidence.allocations.length && !evidence.overflow.length)
      return { state: campaignEligible ? "PENDING_MEMBER" as const : "NOT_CAMPAIGN" as const };
    await assertContributionEvidenceReplaceable(tx, evidence);
    await voidContributionEvidence(tx, evidence, reason, userId);
    return { state: "REVOKED" as const };
  }

  const allocation = evidence.allocations[0] ?? null;
  const sameTarget = evidence.allocations.length === 1 && evidence.overflow.length <= 1
    && allocation!.eventCampaignId === payment.eventCampaignId && allocation!.memberId === memberId
    && evidence.overflow.every(row => row.eventCampaignId === payment.eventCampaignId && row.memberId === memberId);
  if (sameTarget) return { state: "ALLOCATED" as const, allocationId: allocation!.id, replayed: true };

  if (evidence.allocations.length || evidence.overflow.length) {
    await assertContributionEvidenceReplaceable(tx, evidence);
    await voidContributionEvidence(tx, evidence, reason, userId);
  }

  // Exclude this transaction from the legacy fallback so a transaction without
  // evidence yet is not double counted while it is being materialised.
  const state = await campaignTargetState(tx, payment.eventCampaignId!, { excludeBankTransactionId: payment.id });
  const decision = campaignAllocationDecision({ incoming: cents(payment.originalAmount), target: state.target, activeApplied: state.activeApplied });
  const created = await tx.memberEventCampaignAllocation.create({ data: {
    memberId, eventCampaignId: payment.eventCampaignId!, bankTransactionId: payment.id,
    amountDelta: centsToDecimal(decision.applied), allocationType: "DIRECT_CONTRIBUTION", allocationStatus: "ACTIVE",
    effectiveDate: payment.transactionDate!, reason: "Finalized direct Campaign contribution", createdById: userId
  }, select: { id: true } });
  if (decision.overflow > 0n) {
    const [postingSequence] = await allocateCampaignWalletPostingSequences(tx, memberId, payment.eventCampaignId!, 1);
    await tx.memberEventCampaignWalletLedger.create({ data: {
      memberId, eventCampaignId: payment.eventCampaignId!, bankTransactionId: payment.id,
      entryType: "CAMPAIGN_OVERFLOW", entryStatus: "ACTIVE", amountDelta: centsToDecimal(decision.overflow),
      effectiveDate: payment.transactionDate!, postingSequence,
      remark: "Campaign target overflow from finalized BankTransaction", createdById: userId
    } });
  }
  return { state: "ALLOCATED" as const, allocationId: created.id, applied: centsToDecimal(decision.applied), overflow: centsToDecimal(decision.overflow) };
}

/** Backwards-compatible entry point; all callers now get reconciliation semantics. */
export async function synchronizeCampaignContribution(tx: Tx, transactionId: string, userId: string) {
  return reconcileCampaignContribution(tx, transactionId, userId);
}

export async function synchronizePendingCampaignContributionsForMember(tx: Tx, memberId: string, userId: string) {
  const payments = await tx.bankTransaction.findMany({ where: {
    status: "FINALIZED", reconciliationExcludedAt: null, eventCode: { is: { eventType: "CAMPAIGN" } },
    memberIdentity: { is: { memberId, verificationStatus: "VERIFIED" } }
  }, select: { id: true }, orderBy: [{ transactionDate: "asc" }, { id: "asc" }] });
  for (const payment of payments) await reconcileCampaignContribution(tx, payment.id, userId);
}

/** Reconciles every Campaign transaction owned by an identity after Move/Detach decisions. */
export async function reconcileCampaignContributionsForIdentity(tx: Tx, identityId: string, userId: string) {
  const payments = await tx.bankTransaction.findMany({ where: {
    memberIdentityId: identityId,
    OR: [
      { eventCode: { is: { eventType: "CAMPAIGN" } } },
      { memberEventCampaignAllocations: { some: {} } },
      { memberEventCampaignWalletEntries: { some: {} } }
    ]
  }, select: { id: true }, orderBy: [{ transactionDate: "asc" }, { id: "asc" }] });
  for (const payment of payments) await reconcileCampaignContribution(tx, payment.id, userId,
    { reason: "Campaign ownership reconciled after an identity ownership change" });
}

export function campaignTransferAmountIsAllowed(requested: bigint, remaining: bigint | null) {
  return requested > 0n && (remaining === null || requested <= remaining);
}

/**
 * Legacy Campaign transactions have no direct allocation evidence and are currently
 * counted as fully applied. Materialising them is only safe when the current target
 * can absorb every legacy rupiah; otherwise a human must review before backfill.
 */
export function campaignBackfillVerdict(input: { target: bigint | null; explicitApplied: bigint; legacyTotal: bigint }) {
  if (input.target === null) return { safe: true, reason: "UNLIMITED" as const };
  const remaining = input.target > input.explicitApplied ? input.target - input.explicitApplied : 0n;
  return input.legacyTotal <= remaining
    ? { safe: true, reason: "FITS_REMAINING" as const }
    : { safe: false, reason: "TARGET_EXCEEDED_BY_LEGACY" as const };
}

export { day as campaignWalletBusinessDay };
