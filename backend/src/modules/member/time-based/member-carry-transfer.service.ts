import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { currentBusinessDayValue } from "../../../lib/business-time.js";
import { HttpError } from "../../../lib/http.js";
import { prisma } from "../../../lib/prisma.js";
import { decimalStringToCents } from "../../reconciliation/reconciliation-classification.js";
import { centsToDecimal } from "../data/member-donation.domain.js";
import { memberTransaction } from "../member-identity/member-transaction.js";
import { allocatePostingSequences, assertNoUnresolvedDependencies, laterSubscriptionDependencies, lockSubscriptionsForPosting } from "./member-carry-transfer.foundation.js";
import { loadMemberCarryTransfers } from "./member-carry-transfer.repository.js";
import { addCalendarMonthsInclusive, refreshSubscriptionStartDate, refreshSubscriptionValidity } from "./member-time-based.service.js";
import { allocateCampaignWalletPostingSequences, campaignTransferAmountIsAllowed, campaignWalletCents,
  lockCampaignsForPosting, requireCampaignCarryDestination } from "../campaign/member-campaign-wallet.service.js";

type Tx = Prisma.TransactionClient;

const transferHeaderSelect = {
  id: true, memberId: true, sourceSubscriptionId: true, sourceCampaignId: true, destinationSubscriptionId: true, destinationCampaignId: true,
  amount: true, effectiveDate: true, reason: true, status: true, idempotencyKey: true,
  requestHash: true, reversalOfTransferId: true, destinationUnitAmountSnapshot: true,
  destinationDurationMonthsSnapshot: true, createdAt: true, createdById: true,
  reversedAt: true, reversedById: true
} as const;

const subscriptionSelect = {
  id: true, memberId: true, eventCodeId: true, activeFlag: true
} as const;

const eventSelect = {
  id: true, code: true, eventName: true, eventType: true, activeFlag: true
} as const;

const destinationEventSelect = {
  ...eventSelect,
  timeRule: { select: { unitAmount: true, durationMonths: true, activeFlag: true } }
} as const;

export type CarryTransferCreateInput = {
  destinationSubscriptionId?: string;
  destinationCampaignId?: string;
  amount: string;
  reason: string;
  idempotencyKey: string;
};

export type CarryTransferReverseInput = {
  reason: string;
  idempotencyKey: string;
};

export type CarryTransferView = {
  transferId: string;
  memberId: string;
  sourceType: "TIME_BASED" | "CAMPAIGN";
  sourceSubscriptionId: string | null;
  sourceCampaignId: string | null;
  destinationType: "TIME_BASED" | "CAMPAIGN";
  destinationSubscriptionId: string | null;
  destinationCampaignId: string | null;
  amount: string;
  effectiveDate: string;
  reason: string;
  destinationRule: { unitAmount: string; durationMonths: number };
  reversalOfTransferId: string | null;
  createdAt: string;
};

export type CarryTransferWalletBalanceView = { type: "TIME_BASED"; subscriptionId: string; carryBefore: string; carryAfter: string };
export type CarryTransferCampaignWalletBalanceView = { type: "CAMPAIGN"; campaignId: string; carryBefore: string; carryAfter: string };
export type CarryTransferCampaignAllocationView = { type: "CAMPAIGN"; campaignId: string;
  allocation: { allocationId: string; amountDelta: string; allocationType: string } };
export type CarryTransferDestinationView = CarryTransferWalletBalanceView & { allocation: CarryTransferAllocationView | null }
  | CarryTransferCampaignAllocationView;

export type CarryTransferAllocationView = {
  units: number;
  amountApplied: string;
  unitAmount: string;
  durationMonths: number;
  coverage: { coverageId: string; coverageFrom: string; coverageTo: string } | null;
};

export type CarryTransferResult = {
  transfer: CarryTransferView;
  source: CarryTransferWalletBalanceView | CarryTransferCampaignWalletBalanceView;
  destination: CarryTransferDestinationView;
};

export type CarryTransferReversalResult = {
  original: CarryTransferView;
  reversal: CarryTransferView;
  restoringDestination: CarryTransferWalletBalanceView | CarryTransferCampaignWalletBalanceView;
  reversingSource: CarryTransferWalletBalanceView | CarryTransferCampaignWalletBalanceView | CarryTransferCampaignAllocationView;
};

type TransferHeader = {
  id: string; memberId: string; sourceSubscriptionId: string | null; sourceCampaignId: string | null; destinationSubscriptionId: string | null; destinationCampaignId: string | null;
  amount: Prisma.Decimal; effectiveDate: Date; reason: string; status: string; idempotencyKey: string;
  requestHash: string; reversalOfTransferId: string | null; destinationUnitAmountSnapshot: Prisma.Decimal;
  destinationDurationMonthsSnapshot: number; createdAt: Date; createdById: string;
  reversedAt: Date | null; reversedById: string | null;
};

const dateOnly = (value: Date) => value.toISOString().slice(0, 10);
export const businessDayDateValue = () => new Date(`${currentBusinessDayValue()}T00:00:00.000Z`);

export function resolveTransferCoverageStart(input: { latestCoverageTo: Date | null; effectiveDate: Date }) {
  if (input.latestCoverageTo && input.latestCoverageTo.getTime() >= input.effectiveDate.getTime()) {
    const next = new Date(input.latestCoverageTo);
    next.setUTCDate(next.getUTCDate() + 1);
    return next;
  }
  return new Date(input.effectiveDate);
}

export function carryTransferRequestHash(payload: {
  kind: "CARRY_TRANSFER" | "CARRY_TRANSFER_REVERSAL";
  memberId: string;
  sourceSubscriptionId?: string;
  sourceCampaignId?: string;
  destinationSubscriptionId?: string;
  amount?: string;
  transferId?: string;
  reason: string;
  destinationCampaignId?: string;
}) {
  const canonical = payload.kind === "CARRY_TRANSFER"
    ? JSON.stringify({ v: 1, kind: payload.kind, memberId: payload.memberId,
      sourceSubscriptionId: payload.sourceSubscriptionId, sourceCampaignId: payload.sourceCampaignId,
      destinationSubscriptionId: payload.destinationSubscriptionId,
      destinationCampaignId: payload.destinationCampaignId,
      amount: payload.amount, reason: payload.reason })
    : JSON.stringify({ v: 1, kind: payload.kind, memberId: payload.memberId, transferId: payload.transferId, reason: payload.reason });
  return createHash("sha256").update(canonical).digest("hex");
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function toTransferView(row: TransferHeader): CarryTransferView {
  return {
    transferId: row.id,
    memberId: row.memberId,
    sourceType: row.sourceCampaignId ? "CAMPAIGN" : "TIME_BASED",
    sourceSubscriptionId: row.sourceSubscriptionId,
    sourceCampaignId: row.sourceCampaignId,
    destinationType: row.destinationCampaignId ? "CAMPAIGN" : "TIME_BASED",
    destinationSubscriptionId: row.destinationSubscriptionId,
    destinationCampaignId: row.destinationCampaignId,
    amount: row.amount.toFixed(2),
    effectiveDate: dateOnly(row.effectiveDate),
    reason: row.reason,
    destinationRule: { unitAmount: row.destinationUnitAmountSnapshot.toFixed(2), durationMonths: row.destinationDurationMonthsSnapshot },
    reversalOfTransferId: row.reversalOfTransferId,
    createdAt: row.createdAt.toISOString()
  };
}

async function activeCarryCents(tx: Tx, subscriptionId: string) {
  const row = await tx.memberEventBalanceLedger.aggregate({
    where: { subscriptionId, entryStatus: "ACTIVE" },
    _sum: { amountDelta: true }
  });
  return decimalStringToCents(row._sum.amountDelta?.toString() ?? "0");
}

/** Stable ledger snapshot for an idempotent response, even after later postings. */
async function walletSnapshot(tx: Tx, subscriptionId: string, transferId: string,
  allocationRule?: { unitAmount: string; durationMonths: number }) {
  const legs = await tx.memberEventBalanceLedger.findMany({
    where: { subscriptionId, carryTransferId: transferId },
    select: { entryType: true, postingSequence: true, coverageId: true },
    orderBy: { postingSequence: "asc" }
  });
  if (!legs.length) throw new HttpError(409, "Carry Transfer ledger evidence is incomplete.");
  const firstSequence = legs[0].postingSequence;
  const lastSequence = legs[legs.length - 1].postingSequence;
  const [beforeRow, afterRow] = await Promise.all([
    // Reconstruct the ledger as it stood at posting time. A later void marks
    // its original row VOIDED and appends a compensating row with a later
    // sequence; filtering current status here would rewrite this response.
    tx.memberEventBalanceLedger.aggregate({ where: { subscriptionId, postingSequence: { lt: firstSequence } }, _sum: { amountDelta: true } }),
    tx.memberEventBalanceLedger.aggregate({ where: { subscriptionId, postingSequence: { lte: lastSequence } }, _sum: { amountDelta: true } })
  ]);
  const coverageId = legs.find(row => row.entryType === "COVERAGE_USE")?.coverageId;
  const coverage = coverageId ? await tx.memberEventCoverage.findUnique({ where: { id: coverageId },
    select: { id: true, coverageFrom: true, coverageTo: true, grantedUnits: true, amountApplied: true,
      unitAmountSnapshot: true, durationMonthsSnapshot: true } }) : null;
  const allocation = coverage ? {
    units: coverage.grantedUnits ?? 0,
    amountApplied: centsToDecimal(decimalStringToCents(coverage.amountApplied?.toString() ?? "0")),
    unitAmount: centsToDecimal(decimalStringToCents(coverage.unitAmountSnapshot?.toString() ?? "0")),
    durationMonths: coverage.durationMonthsSnapshot ?? 0,
    coverage: { coverageId: coverage.id, coverageFrom: dateOnly(coverage.coverageFrom), coverageTo: dateOnly(coverage.coverageTo) }
  } : allocationRule ? { units: 0, amountApplied: "0.00", ...allocationRule, coverage: null } : null;
  return {
    carryBefore: centsToDecimal(decimalStringToCents(beforeRow._sum.amountDelta?.toString() ?? "0")),
    carryAfter: centsToDecimal(decimalStringToCents(afterRow._sum.amountDelta?.toString() ?? "0")),
    allocation
  };
}

async function campaignAllocationSnapshot(tx: Tx, transferId: string): Promise<CarryTransferCampaignAllocationView["allocation"]> {
  const row = await tx.memberEventCampaignAllocation.findUnique({ where: { carryTransferId: transferId },
    select: { id: true, amountDelta: true, allocationType: true } });
  if (!row) throw new HttpError(409, "Campaign allocation evidence is incomplete.");
  return { allocationId: row.id, amountDelta: centsToDecimal(decimalStringToCents(row.amountDelta.toString())), allocationType: row.allocationType };
}

async function campaignWalletSnapshot(tx: Tx, memberId: string, campaignId: string, transferId: string) {
  const entry = await tx.memberEventCampaignWalletLedger.findFirst({ where: { memberId, eventCampaignId: campaignId, carryTransferId: transferId },
    orderBy: { postingSequence: "asc" }, select: { postingSequence: true } });
  if (!entry) throw new HttpError(409, "Campaign wallet transfer evidence is incomplete.");
  // Reconstruct the ledger as it stood at posting time from the deterministic posting
  // sequence. Later reconciliation may VOID the original row, but the historical
  // snapshot must stay stable for idempotent replay.
  const [before, after] = await Promise.all([
    tx.memberEventCampaignWalletLedger.aggregate({ where: { memberId, eventCampaignId: campaignId,
      postingSequence: { lt: entry.postingSequence } }, _sum: { amountDelta: true } }),
    tx.memberEventCampaignWalletLedger.aggregate({ where: { memberId, eventCampaignId: campaignId,
      postingSequence: { lte: entry.postingSequence } }, _sum: { amountDelta: true } })
  ]);
  return { type: "CAMPAIGN" as const, campaignId,
    carryBefore: centsToDecimal(decimalStringToCents(before._sum.amountDelta?.toString() ?? "0")),
    carryAfter: centsToDecimal(decimalStringToCents(after._sum.amountDelta?.toString() ?? "0")) };
}

async function postCampaignWalletEntry(tx: Tx, input: { memberId: string; eventCampaignId: string; carryTransferId: string;
  amountDelta: bigint; entryType: "TRANSFER_IN" | "TRANSFER_OUT"; effectiveDate: Date; reason: string; userId: string }) {
  const [postingSequence] = await allocateCampaignWalletPostingSequences(tx, input.memberId, input.eventCampaignId, 1);
  return tx.memberEventCampaignWalletLedger.create({ data: {
    memberId: input.memberId, eventCampaignId: input.eventCampaignId, carryTransferId: input.carryTransferId,
    entryType: input.entryType, entryStatus: "ACTIVE", amountDelta: centsToDecimal(input.amountDelta), effectiveDate: input.effectiveDate,
    postingSequence, remark: input.reason, createdById: input.userId
  } });
}

type SubscriptionRow = { id: string; memberId: string; eventCodeId: string; activeFlag: boolean };

async function loadOwnedSubscriptions(tx: Tx, memberId: string, sourceId: string, destinationId: string) {
  const [source, destination] = await Promise.all([
    tx.memberEventSubscription.findUnique({ where: { id: sourceId }, select: subscriptionSelect }),
    tx.memberEventSubscription.findUnique({ where: { id: destinationId }, select: subscriptionSelect })
  ]);
  if (!source || source.memberId !== memberId) throw new HttpError(404, "Source subscription was not found for this Member.");
  if (!destination || destination.memberId !== memberId) throw new HttpError(404, "Destination subscription was not found for this Member.");
  if (source.id === destination.id) throw new HttpError(400, "Source and destination subscriptions must differ.");
  return { source, destination };
}

async function requireTimeBasedEvent(tx: Tx, eventCodeId: string, label: string) {
  const event = await tx.eventCode.findUnique({ where: { id: eventCodeId }, select: eventSelect });
  if (!event || event.eventType !== "TIME_BASED") throw new HttpError(409, `${label} must be a TIME_BASED Event Code.`);
  if (!event.activeFlag) throw new HttpError(409, `${label} Event Code is not active.`);
  return event;
}

/**
 * Source-side rule: releasing existing donor money must not require the program to
 * still be active or to have a current Time Rule. Only destination eligibility does.
 */
async function requireTimeBasedProgram(tx: Tx, eventCodeId: string, label: string) {
  const event = await tx.eventCode.findUnique({ where: { id: eventCodeId }, select: eventSelect });
  if (!event || event.eventType !== "TIME_BASED") throw new HttpError(409, `${label} must be a TIME_BASED Event Code.`);
  return event;
}

async function replayForwardTransfer(tx: Tx, row: TransferHeader,
  command: { memberId: string; requestHash: string }): Promise<CarryTransferResult> {
  if (row.requestHash !== command.requestHash || row.memberId !== command.memberId)
    throw new HttpError(409, "This idempotency key was already used for a different Carry Transfer request.");
  const source = row.sourceCampaignId
    ? await campaignWalletSnapshot(tx, row.memberId, row.sourceCampaignId, row.id)
    : row.sourceSubscriptionId
      ? { type: "TIME_BASED" as const, subscriptionId: row.sourceSubscriptionId, ...(await walletSnapshot(tx, row.sourceSubscriptionId, row.id)) }
      : null;
  if (!source) throw new HttpError(409, "Carry Transfer source evidence is incomplete.");
  let resultDestination: CarryTransferDestinationView;
  if (row.destinationCampaignId) {
    resultDestination = { type: "CAMPAIGN", campaignId: row.destinationCampaignId,
      allocation: await campaignAllocationSnapshot(tx, row.id) };
  } else if (row.destinationSubscriptionId) {
    const destination = await walletSnapshot(tx, row.destinationSubscriptionId, row.id,
      { unitAmount: row.destinationUnitAmountSnapshot.toFixed(2), durationMonths: row.destinationDurationMonthsSnapshot });
    resultDestination = { type: "TIME_BASED", subscriptionId: row.destinationSubscriptionId, ...destination };
  } else throw new HttpError(409, "Carry Transfer destination evidence is incomplete.");
  return {
    transfer: toTransferView(row),
    source,
    destination: resultDestination
  };
}

/** Core forward transfer. Must run inside the caller's serializable transaction. */
export async function forwardCarryTransferRecord(tx: Tx, input: {
  memberId: string; sourceSubscriptionId?: string; sourceCampaignId?: string; destinationSubscriptionId?: string; destinationCampaignId?: string;
  amount: string; reason: string; idempotencyKey: string; userId: string;
}): Promise<CarryTransferResult> {
  const reason = input.reason.trim();
  if (!reason) throw new HttpError(400, "A Carry Transfer reason is required.");
  if (reason.length > 1000) throw new HttpError(400, "Carry Transfer reason must not exceed 1000 characters.");
  const idempotencyKey = input.idempotencyKey.trim();
  if (!idempotencyKey) throw new HttpError(400, "An idempotency key is required.");
  const amountCents = decimalStringToCents(input.amount);
  if (amountCents <= 0n) throw new HttpError(400, "Carry Transfer amount must be greater than zero.");
  if (Boolean(input.sourceSubscriptionId) === Boolean(input.sourceCampaignId))
    throw new HttpError(400, "Choose exactly one source subscription or Campaign wallet.");
  if (Boolean(input.destinationSubscriptionId) === Boolean(input.destinationCampaignId))
    throw new HttpError(400, "Choose exactly one destination subscription or Campaign.");
  if (input.sourceCampaignId && input.destinationCampaignId && input.sourceCampaignId === input.destinationCampaignId)
    throw new HttpError(400, "Campaign wallet source and destination must differ.");
  const requestHash = carryTransferRequestHash({ kind: "CARRY_TRANSFER", memberId: input.memberId,
    sourceSubscriptionId: input.sourceSubscriptionId, sourceCampaignId: input.sourceCampaignId,
    destinationSubscriptionId: input.destinationSubscriptionId,
    destinationCampaignId: input.destinationCampaignId,
    amount: centsToDecimal(amountCents), reason });

  const existing = await tx.memberEventCarryTransfer.findUnique({ where: { idempotencyKey }, select: transferHeaderSelect });
  if (existing) return replayForwardTransfer(tx, existing, { memberId: input.memberId, requestHash });

  await lockSubscriptionsForPosting(tx, [...(input.sourceSubscriptionId ? [input.sourceSubscriptionId] : []), ...(input.destinationSubscriptionId ? [input.destinationSubscriptionId] : [])]);
  await lockCampaignsForPosting(tx, [input.sourceCampaignId, input.destinationCampaignId]
    .filter((id): id is string => Boolean(id)));

  const member = await tx.member.findUnique({ where: { id: input.memberId }, select: { id: true } });
  if (!member) throw new HttpError(404, "Donatur tidak ditemukan.");
  const source = input.sourceSubscriptionId ? await tx.memberEventSubscription.findUnique({ where: { id: input.sourceSubscriptionId }, select: subscriptionSelect }) : null;
  const sourceCampaign = input.sourceCampaignId ? await tx.eventCampaign.findUnique({ where: { id: input.sourceCampaignId }, select: {
    id: true, activeFlag: true, eventCode: { select: { eventType: true, activeFlag: true } }
  } }) : null;
  if (input.sourceSubscriptionId) {
    if (!source || source.memberId !== input.memberId) throw new HttpError(404, "Source subscription was not found for this Member.");
    // Source-side release never requires an active Event or a current Time Rule.
    await requireTimeBasedProgram(tx, source.eventCodeId, "The source");
  } else {
    if (!sourceCampaign || sourceCampaign.eventCode.eventType !== "CAMPAIGN") throw new HttpError(404, "Campaign wallet source was not found.");
  }
  const sourceCarryBefore = source ? await activeCarryCents(tx, source.id) : await campaignWalletCents(tx, input.memberId, sourceCampaign!.id);
  if (amountCents > sourceCarryBefore)
    throw new HttpError(409, "Sumber wallet tidak memiliki saldo carry yang cukup untuk transfer ini.");

  if (input.destinationCampaignId) {
    const target = await requireCampaignCarryDestination(tx, input.destinationCampaignId);
    const campaign = target.campaign;
    if (!campaignTransferAmountIsAllowed(amountCents, target.remaining))
      throw new HttpError(409, `Dana melebihi sisa target Campaign ${centsToDecimal(target.remaining!)}.`);
    const effectiveDate = businessDayDateValue();
    let created;
    try {
      created = await tx.memberEventCarryTransfer.create({ data: {
        memberId: input.memberId, sourceSubscriptionId: source?.id ?? null, sourceCampaignId: sourceCampaign?.id ?? null, destinationCampaignId: campaign.id,
        amount: centsToDecimal(amountCents), effectiveDate, reason, status: "ACTIVE", idempotencyKey, requestHash,
        destinationUnitAmountSnapshot: "0.00", destinationDurationMonthsSnapshot: 0, createdById: input.userId
      }, select: transferHeaderSelect });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const raced = await tx.memberEventCarryTransfer.findUnique({ where: { idempotencyKey }, select: transferHeaderSelect });
        if (raced) return replayForwardTransfer(tx, raced, { memberId: input.memberId, requestHash });
      }
      throw error;
    }
    if (source) {
      const [sourceSequence] = await allocatePostingSequences(tx, source.id, 1);
      await tx.memberEventBalanceLedger.create({ data: { subscriptionId: source.id, carryTransferId: created.id, entryType: "TRANSFER_OUT", entryStatus: "ACTIVE", amountDelta: centsToDecimal(-amountCents), effectiveDate, postingSequence: sourceSequence, createdById: input.userId } });
    } else await postCampaignWalletEntry(tx, { memberId: input.memberId, eventCampaignId: sourceCampaign!.id, carryTransferId: created.id,
      amountDelta: -amountCents, entryType: "TRANSFER_OUT", effectiveDate, reason, userId: input.userId });
    await tx.memberEventCampaignAllocation.create({ data: {
      memberId: input.memberId, eventCampaignId: campaign.id, carryTransferId: created.id,
      amountDelta: centsToDecimal(amountCents), allocationType: "CARRY_TRANSFER", allocationStatus: "ACTIVE",
      effectiveDate, reason, createdById: input.userId
    } });
    const sourceSnapshot = source
      ? { type: "TIME_BASED" as const, subscriptionId: source.id, ...(await walletSnapshot(tx, source.id, created.id)) }
      : await campaignWalletSnapshot(tx, input.memberId, sourceCampaign!.id, created.id);
    return { transfer: toTransferView(created),
      source: sourceSnapshot,
      destination: { type: "CAMPAIGN", campaignId: campaign.id, allocation: await campaignAllocationSnapshot(tx, created.id) } };
  }

  const destination = await tx.memberEventSubscription.findUnique({ where: { id: input.destinationSubscriptionId! }, select: subscriptionSelect });
  if (!destination || destination.memberId !== input.memberId) throw new HttpError(404, "Destination subscription was not found for this Member.");
  if (source && source.id === destination.id) throw new HttpError(400, "Source and destination subscriptions must differ.");
  if (!destination.activeFlag) throw new HttpError(409, "The destination subscription is not active.");
  const destinationEvent = await tx.eventCode.findUnique({ where: { id: destination.eventCodeId }, select: destinationEventSelect });
  if (!destinationEvent || destinationEvent.eventType !== "TIME_BASED")
    throw new HttpError(409, "The destination must be a TIME_BASED Event Code.");
  if (!destinationEvent.activeFlag) throw new HttpError(409, "The destination Event Code is not active.");
  const rule = destinationEvent.timeRule;
  if (!rule || !rule.activeFlag) throw new HttpError(409, "The destination program requires an active Time Rule.");
  const unitCents = decimalStringToCents(rule.unitAmount.toString());
  if (unitCents <= 0n || rule.durationMonths <= 0) throw new HttpError(409, "The destination Time Rule is invalid.");

  const destinationCarryBefore = await activeCarryCents(tx, destination.id);
  const availableCents = destinationCarryBefore + amountCents;
  const unitsBig = availableCents / unitCents;
  if (unitsBig < 1n)
    throw new HttpError(409, `Dana belum cukup untuk membentuk 1 unit coverage. Minimal saldo yang dibutuhkan ${centsToDecimal(unitCents)}.`);
  if (unitsBig > BigInt(2_147_483_647)) throw new HttpError(400, "The destination balance resolves to too many units.");
  const units = Number(unitsBig);
  const amountConsumedCents = unitsBig * unitCents;
  const durationMonths = units * rule.durationMonths;
  if (!Number.isSafeInteger(durationMonths)) throw new HttpError(400, "The destination coverage duration is too large.");
  const effectiveDate = businessDayDateValue();

  let created;
  try {
    created = await tx.memberEventCarryTransfer.create({
      data: {
        memberId: input.memberId,
        sourceSubscriptionId: source?.id ?? null,
        sourceCampaignId: sourceCampaign?.id ?? null,
        destinationSubscriptionId: destination.id,
        amount: centsToDecimal(amountCents),
        effectiveDate,
        reason,
        status: "ACTIVE",
        idempotencyKey,
        requestHash,
        destinationUnitAmountSnapshot: rule.unitAmount.toString(),
        destinationDurationMonthsSnapshot: rule.durationMonths,
        createdById: input.userId
      },
      select: transferHeaderSelect
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const raced = await tx.memberEventCarryTransfer.findUnique({ where: { idempotencyKey }, select: transferHeaderSelect });
      if (raced) return replayForwardTransfer(tx, raced, { memberId: input.memberId, requestHash });
    }
    throw error;
  }

  if (source) {
    const [sourceSequence] = await allocatePostingSequences(tx, source.id, 1);
    await tx.memberEventBalanceLedger.create({ data: {
      subscriptionId: source.id, carryTransferId: created.id, entryType: "TRANSFER_OUT", entryStatus: "ACTIVE",
      amountDelta: centsToDecimal(-amountCents), effectiveDate, postingSequence: sourceSequence, createdById: input.userId
    } });
  } else await postCampaignWalletEntry(tx, { memberId: input.memberId, eventCampaignId: sourceCampaign!.id, carryTransferId: created.id,
    amountDelta: -amountCents, entryType: "TRANSFER_OUT", effectiveDate, reason, userId: input.userId });

  const destinationSequences = await allocatePostingSequences(tx, destination.id, units > 0 ? 2 : 1);
  await tx.memberEventBalanceLedger.create({ data: {
    subscriptionId: destination.id, carryTransferId: created.id, entryType: "TRANSFER_IN", entryStatus: "ACTIVE",
    amountDelta: centsToDecimal(amountCents), effectiveDate, postingSequence: destinationSequences[0], createdById: input.userId
  } });

  let coverage: { id: string; coverageFrom: Date; coverageTo: Date } | null = null;
  if (units > 0) {
    const latest = await tx.memberEventCoverage.findFirst({
      where: { subscriptionId: destination.id, coverageStatus: "ACTIVE" },
      orderBy: [{ coverageTo: "desc" }, { id: "desc" }],
      select: { coverageTo: true }
    });
    const coverageFrom = resolveTransferCoverageStart({ latestCoverageTo: latest?.coverageTo ?? null, effectiveDate });
    const coverageTo = addCalendarMonthsInclusive(coverageFrom, durationMonths);
    coverage = await tx.memberEventCoverage.create({
      data: {
        subscriptionId: destination.id, coverageSource: "TRANSFER", coverageStatus: "ACTIVE",
        unitAmountSnapshot: rule.unitAmount.toString(), durationMonthsSnapshot: rule.durationMonths,
        grantedUnits: units, amountApplied: centsToDecimal(amountConsumedCents),
        coverageFrom, coverageTo, remark: "Destination allocation from Carry Transfer", createdById: input.userId
      },
      select: { id: true, coverageFrom: true, coverageTo: true }
    });
    await tx.memberEventBalanceLedger.create({ data: {
      subscriptionId: destination.id, coverageId: coverage.id, carryTransferId: created.id, entryType: "COVERAGE_USE", entryStatus: "ACTIVE",
      amountDelta: centsToDecimal(-amountConsumedCents), effectiveDate,
      unitAmountSnapshot: rule.unitAmount.toString(), durationMonthsSnapshot: rule.durationMonths,
      postingSequence: destinationSequences[1], createdById: input.userId
    } });
  }

  await refreshSubscriptionValidity(tx, destination.id);
  await refreshSubscriptionStartDate(tx, destination.id);

  const sourceSubscriptionId = source?.id;
  const [sourceSnapshot, destinationSnapshot] = await Promise.all([
    sourceSubscriptionId
      ? (async () => ({ type: "TIME_BASED" as const, subscriptionId: sourceSubscriptionId,
        ...(await walletSnapshot(tx, sourceSubscriptionId, created.id)) }))()
      : campaignWalletSnapshot(tx, input.memberId, sourceCampaign!.id, created.id), walletSnapshot(tx, destination.id, created.id,
      { unitAmount: centsToDecimal(decimalStringToCents(rule.unitAmount.toString())), durationMonths: rule.durationMonths })
  ]);
  return {
    transfer: toTransferView(created),
    source: sourceSnapshot,
    destination: { type: "TIME_BASED", subscriptionId: destination.id, ...destinationSnapshot }
  };
}

async function replayReversal(tx: Tx, existing: TransferHeader,
  command: { memberId: string; transferId: string; requestHash: string }): Promise<CarryTransferReversalResult> {
  if (existing.requestHash !== command.requestHash || existing.memberId !== command.memberId || existing.reversalOfTransferId !== command.transferId)
    throw new HttpError(409, "This idempotency key was already used for a different Carry Transfer reversal request.");
  const original = await tx.memberEventCarryTransfer.findUnique({ where: { id: command.transferId }, select: transferHeaderSelect });
  if (!original || original.memberId !== command.memberId) throw new HttpError(404, "Carry Transfer was not found for this Member.");
  let restoring: CarryTransferReversalResult["restoringDestination"] | null;
  if (original.sourceCampaignId) {
    restoring = await campaignWalletSnapshot(tx, original.memberId, original.sourceCampaignId, existing.id);
  } else if (original.sourceSubscriptionId) {
    const snapshot = await walletSnapshot(tx, original.sourceSubscriptionId, existing.id);
    restoring = { type: "TIME_BASED", subscriptionId: original.sourceSubscriptionId,
      carryBefore: snapshot.carryBefore, carryAfter: snapshot.carryAfter };
  } else restoring = null;
  if (!restoring) throw new HttpError(409, "Carry Transfer source evidence is incomplete.");
  let reversingSource: CarryTransferReversalResult["reversingSource"];
  if (original.destinationCampaignId) {
    reversingSource = { type: "CAMPAIGN", campaignId: original.destinationCampaignId,
      allocation: await campaignAllocationSnapshot(tx, existing.id) };
  } else if (original.destinationSubscriptionId) {
    const reversing = await walletSnapshot(tx, original.destinationSubscriptionId, existing.id);
    reversingSource = { type: "TIME_BASED", subscriptionId: original.destinationSubscriptionId,
      carryBefore: reversing.carryBefore, carryAfter: reversing.carryAfter };
  } else throw new HttpError(409, "Carry Transfer destination evidence is incomplete.");
  return {
    original: toTransferView(original),
    reversal: toTransferView(existing),
    restoringDestination: restoring,
    reversingSource
  };
}

/** Core reversal. Must run inside the caller's serializable transaction. Restores carry only. */
export async function reverseCarryTransferRecord(tx: Tx, input: {
  memberId: string; transferId: string; reason: string; idempotencyKey: string; userId: string;
}): Promise<CarryTransferReversalResult> {
  const reason = input.reason.trim();
  if (!reason) throw new HttpError(400, "A Carry Transfer reversal reason is required.");
  if (reason.length > 1000) throw new HttpError(400, "Carry Transfer reversal reason must not exceed 1000 characters.");
  const idempotencyKey = input.idempotencyKey.trim();
  if (!idempotencyKey) throw new HttpError(400, "An idempotency key is required.");
  const requestHash = carryTransferRequestHash({ kind: "CARRY_TRANSFER_REVERSAL", memberId: input.memberId, transferId: input.transferId, reason });

  const existing = await tx.memberEventCarryTransfer.findUnique({ where: { idempotencyKey }, select: transferHeaderSelect });
  if (existing) return replayReversal(tx, existing, { memberId: input.memberId, transferId: input.transferId, requestHash });

  const found = await tx.memberEventCarryTransfer.findUnique({ where: { id: input.transferId }, select: transferHeaderSelect });
  if (!found || found.memberId !== input.memberId) throw new HttpError(404, "Carry Transfer was not found for this Member.");
  await lockSubscriptionsForPosting(tx, [...(found.sourceSubscriptionId ? [found.sourceSubscriptionId] : []), ...(found.destinationSubscriptionId ? [found.destinationSubscriptionId] : [])]);
  await lockCampaignsForPosting(tx, [found.sourceCampaignId, found.destinationCampaignId]
    .filter((id): id is string => Boolean(id)));

  const original = await tx.memberEventCarryTransfer.findUnique({ where: { id: found.id }, select: transferHeaderSelect });
  if (!original || original.memberId !== input.memberId) throw new HttpError(404, "Carry Transfer was not found for this Member.");
  const alreadyReversed = await tx.memberEventCarryTransfer.findFirst({ where: { reversalOfTransferId: original.id }, select: { id: true } });
  if (alreadyReversed) throw new HttpError(409, "This Carry Transfer already has a reversal.");
  if (original.status !== "ACTIVE") throw new HttpError(409, "Only an active Carry Transfer can be reversed.");
  if (original.reversalOfTransferId) throw new HttpError(409, "A reversal transfer cannot be reversed again.");

  // A Campaign source is a donor wallet, not Campaign target capacity. Reversal
  // compensates that wallet and (where relevant) the destination application.
  if (original.sourceCampaignId) {
    const amountCents = decimalStringToCents(original.amount.toString());
    const effectiveDate = businessDayDateValue();
    if (original.destinationCampaignId) {
      const allocation = await tx.memberEventCampaignAllocation.findUnique({ where: { carryTransferId: original.id },
        select: { id: true, eventCampaignId: true, allocationStatus: true } });
      if (!allocation || allocation.allocationStatus !== "ACTIVE") throw new HttpError(409, "Campaign allocation evidence is incomplete.");
      // Reversal headers describe the reverse movement: original destination becomes
      // the reversing source and the original source becomes the restoring destination.
      const reversal = await tx.memberEventCarryTransfer.create({ data: {
        memberId: input.memberId, sourceCampaignId: original.destinationCampaignId, destinationCampaignId: original.sourceCampaignId,
        amount: centsToDecimal(amountCents), effectiveDate, reason, status: "ACTIVE", idempotencyKey, requestHash,
        reversalOfTransferId: original.id, destinationUnitAmountSnapshot: "0.00", destinationDurationMonthsSnapshot: 0, createdById: input.userId
      }, select: transferHeaderSelect });
      await postCampaignWalletEntry(tx, { memberId: input.memberId, eventCampaignId: original.sourceCampaignId, carryTransferId: reversal.id,
        amountDelta: amountCents, entryType: "TRANSFER_IN", effectiveDate, reason, userId: input.userId });
      await tx.memberEventCampaignAllocation.create({ data: {
        memberId: input.memberId, eventCampaignId: allocation.eventCampaignId, carryTransferId: reversal.id,
        amountDelta: centsToDecimal(-amountCents), allocationType: "CARRY_REVERSAL", allocationStatus: "ACTIVE",
        effectiveDate, reason, createdById: input.userId, reversalOfAllocationId: allocation.id
      } });
      const reversedOriginal = await tx.memberEventCarryTransfer.update({ where: { id: original.id },
        data: { status: "REVERSED", reversedAt: new Date(), reversedById: input.userId }, select: transferHeaderSelect });
      return { original: toTransferView(reversedOriginal), reversal: toTransferView(reversal),
        restoringDestination: await campaignWalletSnapshot(tx, input.memberId, original.sourceCampaignId, reversal.id),
        reversingSource: { type: "CAMPAIGN", campaignId: original.destinationCampaignId,
          allocation: await campaignAllocationSnapshot(tx, reversal.id) } };
    }
    if (!original.destinationSubscriptionId) throw new HttpError(409, "Carry Transfer destination evidence is incomplete.");
    const inbound = await tx.memberEventBalanceLedger.findFirst({ where: { carryTransferId: original.id, entryType: "TRANSFER_IN", entryStatus: "ACTIVE" },
      select: { subscriptionId: true, postingSequence: true } });
    if (!inbound) throw new HttpError(409, "Carry Transfer ledger evidence is incomplete.");
    assertNoUnresolvedDependencies(await laterSubscriptionDependencies(tx, inbound.subscriptionId, inbound.postingSequence));
    if (amountCents > await activeCarryCents(tx, inbound.subscriptionId))
      throw new HttpError(409, "The subscription that received the transfer no longer has enough carry to reverse it.");
    const reversal = await tx.memberEventCarryTransfer.create({ data: {
      memberId: input.memberId, sourceSubscriptionId: original.destinationSubscriptionId, destinationCampaignId: original.sourceCampaignId,
      amount: centsToDecimal(amountCents), effectiveDate, reason, status: "ACTIVE", idempotencyKey, requestHash,
      reversalOfTransferId: original.id, destinationUnitAmountSnapshot: original.destinationUnitAmountSnapshot,
      destinationDurationMonthsSnapshot: original.destinationDurationMonthsSnapshot, createdById: input.userId
    }, select: transferHeaderSelect });
    const [sequence] = await allocatePostingSequences(tx, inbound.subscriptionId, 1);
    await tx.memberEventBalanceLedger.create({ data: { subscriptionId: inbound.subscriptionId, carryTransferId: reversal.id,
      entryType: "TRANSFER_OUT", entryStatus: "ACTIVE", amountDelta: centsToDecimal(-amountCents), effectiveDate, postingSequence: sequence, createdById: input.userId } });
    await postCampaignWalletEntry(tx, { memberId: input.memberId, eventCampaignId: original.sourceCampaignId, carryTransferId: reversal.id,
      amountDelta: amountCents, entryType: "TRANSFER_IN", effectiveDate, reason, userId: input.userId });
    const reversedOriginal = await tx.memberEventCarryTransfer.update({ where: { id: original.id },
      data: { status: "REVERSED", reversedAt: new Date(), reversedById: input.userId }, select: transferHeaderSelect });
    await refreshSubscriptionStartDate(tx, inbound.subscriptionId);
    return { original: toTransferView(reversedOriginal), reversal: toTransferView(reversal),
      restoringDestination: await campaignWalletSnapshot(tx, input.memberId, original.sourceCampaignId, reversal.id),
      reversingSource: { type: "TIME_BASED", subscriptionId: inbound.subscriptionId,
        ...(await walletSnapshot(tx, inbound.subscriptionId, reversal.id)) } };
  }

  if (original.destinationCampaignId) {
    if (!original.sourceSubscriptionId) throw new HttpError(409, "Carry Transfer source evidence is incomplete.");
    const allocation = await tx.memberEventCampaignAllocation.findUnique({ where: { carryTransferId: original.id }, select: { id: true, eventCampaignId: true, amountDelta: true, allocationStatus: true } });
    if (!allocation || allocation.allocationStatus !== "ACTIVE") throw new HttpError(409, "Campaign allocation evidence is incomplete.");
    const amountCents = decimalStringToCents(original.amount.toString());
    const restoringCarryBefore = await activeCarryCents(tx, original.sourceSubscriptionId);
    const effectiveDate = businessDayDateValue();
    let reversal;
    try {
      reversal = await tx.memberEventCarryTransfer.create({ data: {
        memberId: input.memberId, sourceCampaignId: original.destinationCampaignId, destinationSubscriptionId: original.sourceSubscriptionId,
        amount: centsToDecimal(amountCents), effectiveDate, reason, status: "ACTIVE", idempotencyKey, requestHash,
        reversalOfTransferId: original.id, destinationUnitAmountSnapshot: "0.00", destinationDurationMonthsSnapshot: 0, createdById: input.userId
      }, select: transferHeaderSelect });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const raced = await tx.memberEventCarryTransfer.findUnique({ where: { idempotencyKey }, select: transferHeaderSelect });
        if (raced) return replayReversal(tx, raced, { memberId: input.memberId, transferId: input.transferId, requestHash });
      }
      throw error;
    }
    const [sequence] = await allocatePostingSequences(tx, original.sourceSubscriptionId, 1);
    await tx.memberEventBalanceLedger.create({ data: { subscriptionId: original.sourceSubscriptionId, carryTransferId: reversal.id, entryType: "TRANSFER_IN", entryStatus: "ACTIVE", amountDelta: centsToDecimal(amountCents), effectiveDate, postingSequence: sequence, createdById: input.userId } });
    await tx.memberEventCampaignAllocation.create({ data: {
      memberId: input.memberId, eventCampaignId: allocation.eventCampaignId, carryTransferId: reversal.id,
      amountDelta: centsToDecimal(-amountCents), allocationType: "CARRY_REVERSAL", allocationStatus: "ACTIVE",
      effectiveDate, reason, createdById: input.userId, reversalOfAllocationId: allocation.id
    } });
    const reversedOriginal = await tx.memberEventCarryTransfer.update({ where: { id: original.id }, data: { status: "REVERSED", reversedAt: new Date(), reversedById: input.userId }, select: transferHeaderSelect });
    await refreshSubscriptionStartDate(tx, original.sourceSubscriptionId);
    const restored = await walletSnapshot(tx, original.sourceSubscriptionId, reversal.id);
    return { original: toTransferView(reversedOriginal), reversal: toTransferView(reversal),
      restoringDestination: { type: "TIME_BASED", subscriptionId: original.sourceSubscriptionId,
        carryBefore: restored.carryBefore, carryAfter: restored.carryAfter },
      reversingSource: { type: "CAMPAIGN", campaignId: original.destinationCampaignId,
        allocation: await campaignAllocationSnapshot(tx, reversal.id) } };
  }

  if (!original.sourceSubscriptionId) throw new HttpError(409, "Carry Transfer source evidence is incomplete.");
  const { source: reversingSource, destination: restoringDestination } = await loadOwnedSubscriptions(
    tx, input.memberId, original.destinationSubscriptionId!, original.sourceSubscriptionId);
  // Reversal restores carry only and never creates coverage, so inactive programs on
  // either side must still be able to unwind and release donor money.
  await requireTimeBasedProgram(tx, reversingSource.eventCodeId, "The reversing source");
  await requireTimeBasedProgram(tx, restoringDestination.eventCodeId, "The restoring destination");
  const restoringEvent = await tx.eventCode.findUnique({ where: { id: restoringDestination.eventCodeId }, select: destinationEventSelect });
  if (!restoringEvent || restoringEvent.eventType !== "TIME_BASED")
    throw new HttpError(409, "The restoring destination must be a TIME_BASED Event Code.");

  const amountCents = decimalStringToCents(original.amount.toString());
  const inbound = await tx.memberEventBalanceLedger.findFirst({
    where: { carryTransferId: original.id, entryType: "TRANSFER_IN", entryStatus: "ACTIVE" },
    select: { id: true, subscriptionId: true, postingSequence: true }
  });
  if (!inbound) throw new HttpError(409, "Carry Transfer ledger evidence is incomplete.");
  assertNoUnresolvedDependencies(await laterSubscriptionDependencies(tx, inbound.subscriptionId, inbound.postingSequence));

  const reversingCarryBefore = await activeCarryCents(tx, reversingSource.id);
  if (amountCents > reversingCarryBefore)
    throw new HttpError(409, "The subscription that received the transfer no longer has enough carry to reverse it.");
  const restoringCarryBefore = await activeCarryCents(tx, restoringDestination.id);
  const effectiveDate = businessDayDateValue();

  let reversal;
  try {
    reversal = await tx.memberEventCarryTransfer.create({
      data: {
        memberId: input.memberId,
        sourceSubscriptionId: reversingSource.id,
        destinationSubscriptionId: restoringDestination.id,
        amount: centsToDecimal(amountCents),
        effectiveDate,
        reason,
        status: "ACTIVE",
        idempotencyKey,
        requestHash,
        reversalOfTransferId: original.id,
        destinationUnitAmountSnapshot: restoringEvent.timeRule?.unitAmount?.toString() ?? "0.00",
        destinationDurationMonthsSnapshot: restoringEvent.timeRule?.durationMonths ?? 0,
        createdById: input.userId
      },
      select: transferHeaderSelect
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const raced = await tx.memberEventCarryTransfer.findUnique({ where: { idempotencyKey }, select: transferHeaderSelect });
      if (raced) return replayReversal(tx, raced, { memberId: input.memberId, transferId: input.transferId, requestHash });
      throw new HttpError(409, "This Carry Transfer already has a reversal.");
    }
    throw error;
  }

  const [reversingSequence] = await allocatePostingSequences(tx, reversingSource.id, 1);
  await tx.memberEventBalanceLedger.create({ data: {
    subscriptionId: reversingSource.id, carryTransferId: reversal.id, entryType: "TRANSFER_OUT", entryStatus: "ACTIVE",
    amountDelta: centsToDecimal(-amountCents), effectiveDate, postingSequence: reversingSequence, createdById: input.userId
  } });
  const [restoringSequence] = await allocatePostingSequences(tx, restoringDestination.id, 1);
  await tx.memberEventBalanceLedger.create({ data: {
    subscriptionId: restoringDestination.id, carryTransferId: reversal.id, entryType: "TRANSFER_IN", entryStatus: "ACTIVE",
    amountDelta: centsToDecimal(amountCents), effectiveDate, postingSequence: restoringSequence, createdById: input.userId
  } });

  const reversedAt = new Date();
  const reversedOriginal = await tx.memberEventCarryTransfer.update({
    where: { id: original.id },
    data: { status: "REVERSED", reversedAt, reversedById: input.userId },
    select: transferHeaderSelect
  });
  // Both wallets changed economically: the restored destination gained carry and the
  // reversing source lost it, so both system-managed start dates are re-resolved.
  await Promise.all([
    refreshSubscriptionStartDate(tx, restoringDestination.id),
    refreshSubscriptionStartDate(tx, reversingSource.id)
  ]);

  const [restored, reversed] = await Promise.all([
    walletSnapshot(tx, restoringDestination.id, reversal.id), walletSnapshot(tx, reversingSource.id, reversal.id)
  ]);
  return {
    original: toTransferView(reversedOriginal),
    reversal: toTransferView(reversal),
    restoringDestination: { type: "TIME_BASED", subscriptionId: restoringDestination.id,
      carryBefore: restored.carryBefore, carryAfter: restored.carryAfter },
    reversingSource: { type: "TIME_BASED", subscriptionId: reversingSource.id,
      carryBefore: reversed.carryBefore, carryAfter: reversed.carryAfter }
  };
}

export async function createCarryTransfer(memberId: string, sourceSubscriptionId: string, input: CarryTransferCreateInput, userId: string) {
  return memberTransaction(tx => forwardCarryTransferRecord(tx, { memberId, sourceSubscriptionId, ...input, userId }));
}

export async function createCampaignWalletTransfer(memberId: string, sourceCampaignId: string, input: CarryTransferCreateInput, userId: string) {
  return memberTransaction(tx => forwardCarryTransferRecord(tx, { memberId, sourceCampaignId, ...input, userId }));
}

export async function reverseCarryTransfer(memberId: string, transferId: string, input: CarryTransferReverseInput, userId: string) {
  return memberTransaction(tx => reverseCarryTransferRecord(tx, { memberId, transferId, ...input, userId }));
}

export async function getCarryTransfers(memberId: string, query: { page: number; pageSize: number }) {
  const result = await prisma.$transaction(tx => loadMemberCarryTransfers(tx, memberId, query.page, query.pageSize));
  if (!result.member) throw new HttpError(404, "Donatur tidak ditemukan.");
  return {
    rows: result.rows.map(mapCarryTransferRow),
    pagination: { page: result.page, pageSize: query.pageSize, total: result.total, totalPages: Math.max(1, Math.ceil(result.total / query.pageSize)) }
  };
}

type CarryTransferReadRow = Awaited<ReturnType<typeof loadMemberCarryTransfers>>["rows"][number];
type CarryTransferSubscriptionView = { subscriptionId: string; referenceNo: string | null; displayName: string | null; eventCodeId: string; eventCode: string; eventName: string };

function subscriptionView(row: CarryTransferReadRow["sourceSubscription"] | CarryTransferReadRow["destinationSubscription"]): CarryTransferSubscriptionView | null {
  if (!row) return null;
  return { subscriptionId: row.id, referenceNo: row.referenceNo, displayName: row.displayName,
    eventCodeId: row.eventCode.id, eventCode: row.eventCode.code, eventName: row.eventCode.eventName };
}

export function mapCarryTransferRow(row: CarryTransferReadRow) {
  return {
    transferId: row.id,
    status: row.status,
    amount: row.amount.toFixed(2),
    effectiveDate: dateOnly(row.effectiveDate),
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
    destinationRule: { unitAmount: row.destinationUnitAmountSnapshot.toFixed(2), durationMonths: row.destinationDurationMonthsSnapshot },
    createdBy: row.createdBy ? { userId: row.createdBy.id, fullName: row.createdBy.fullName } : null,
    reversedAt: row.reversedAt?.toISOString() ?? null,
    reversedBy: row.reversedBy ? { userId: row.reversedBy.id, fullName: row.reversedBy.fullName } : null,
    sourceType: row.sourceCampaignId ? "CAMPAIGN" : "TIME_BASED",
    source: subscriptionView(row.sourceSubscription),
    sourceCampaign: row.sourceCampaign ? { campaignId: row.sourceCampaign.id, campaignName: row.sourceCampaign.campaignName,
      eventCodeId: row.sourceCampaign.eventCode.id, eventCode: row.sourceCampaign.eventCode.code, eventName: row.sourceCampaign.eventCode.eventName } : null,
    destination: subscriptionView(row.destinationSubscription),
    destinationCampaign: row.destinationCampaign ? { campaignId: row.destinationCampaign.id, campaignName: row.destinationCampaign.campaignName,
      eventCodeId: row.destinationCampaign.eventCode.id, eventCode: row.destinationCampaign.eventCode.code, eventName: row.destinationCampaign.eventCode.eventName } : null,
    reversalOf: row.reversalOf ? { transferId: row.reversalOf.id, status: row.reversalOf.status, effectiveDate: dateOnly(row.reversalOf.effectiveDate) } : null,
    reversal: row.reversal ? { transferId: row.reversal.id, status: row.reversal.status, effectiveDate: dateOnly(row.reversal.effectiveDate) } : null,
    isReversible: row.isReversible,
    reversalBlockedReason: row.reversalBlockedReason
  };
}
