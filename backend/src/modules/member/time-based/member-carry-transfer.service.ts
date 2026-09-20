import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { currentBusinessDayValue } from "../../../lib/business-time.js";
import { HttpError } from "../../../lib/http.js";
import { prisma } from "../../../lib/prisma.js";
import { decimalStringToCents } from "../../reconciliation/reconciliation-classification.js";
import { centsToDecimal } from "../data/member-donation.domain.js";
import { memberTransaction } from "../member-identity/member-transaction.js";
import { allocatePostingSequences, lockSubscriptionsForPosting } from "./member-carry-transfer.foundation.js";
import { loadMemberCarryTransfers } from "./member-carry-transfer.repository.js";
import { addCalendarMonthsInclusive, refreshSubscriptionValidity } from "./member-time-based.service.js";

type Tx = Prisma.TransactionClient;

const transferHeaderSelect = {
  id: true, memberId: true, sourceSubscriptionId: true, destinationSubscriptionId: true,
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
  destinationSubscriptionId: string;
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
  status: string;
  memberId: string;
  sourceSubscriptionId: string;
  destinationSubscriptionId: string;
  amount: string;
  effectiveDate: string;
  reason: string;
  destinationRule: { unitAmount: string; durationMonths: number };
  reversalOfTransferId: string | null;
  createdAt: string;
  reversedAt: string | null;
};

export type CarryTransferBalanceView = {
  subscriptionId: string;
  carryBefore: string | null;
  carryAfter: string;
};

export type CarryTransferAllocationView = {
  units: number;
  amountApplied: string;
  unitAmount: string;
  durationMonths: number;
  coverage: { coverageId: string; coverageFrom: string; coverageTo: string } | null;
};

export type CarryTransferResult = {
  replayed: boolean;
  transfer: CarryTransferView;
  source: CarryTransferBalanceView;
  destination: CarryTransferBalanceView & { allocation: CarryTransferAllocationView | null };
};

export type CarryTransferReversalResult = {
  replayed: boolean;
  original: CarryTransferView;
  reversal: CarryTransferView;
  restoringDestination: CarryTransferBalanceView;
  reversingSource: CarryTransferBalanceView;
};

type TransferHeader = {
  id: string; memberId: string; sourceSubscriptionId: string; destinationSubscriptionId: string;
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
  destinationSubscriptionId?: string;
  amount?: string;
  transferId?: string;
  reason: string;
}) {
  const canonical = payload.kind === "CARRY_TRANSFER"
    ? JSON.stringify({ v: 1, kind: payload.kind, memberId: payload.memberId,
      sourceSubscriptionId: payload.sourceSubscriptionId, destinationSubscriptionId: payload.destinationSubscriptionId,
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
    status: row.status,
    memberId: row.memberId,
    sourceSubscriptionId: row.sourceSubscriptionId,
    destinationSubscriptionId: row.destinationSubscriptionId,
    amount: row.amount.toFixed(2),
    effectiveDate: dateOnly(row.effectiveDate),
    reason: row.reason,
    destinationRule: { unitAmount: row.destinationUnitAmountSnapshot.toFixed(2), durationMonths: row.destinationDurationMonthsSnapshot },
    reversalOfTransferId: row.reversalOfTransferId,
    createdAt: row.createdAt.toISOString(),
    reversedAt: row.reversedAt?.toISOString() ?? null
  };
}

async function activeCarryCents(tx: Tx, subscriptionId: string) {
  const row = await tx.memberEventBalanceLedger.aggregate({
    where: { subscriptionId, entryStatus: "ACTIVE" },
    _sum: { amountDelta: true }
  });
  return decimalStringToCents(row._sum.amountDelta?.toString() ?? "0");
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
  if (!source.activeFlag) throw new HttpError(409, "The source subscription is not active.");
  if (!destination.activeFlag) throw new HttpError(409, "The destination subscription is not active.");
  return { source, destination };
}

async function requireTimeBasedEvent(tx: Tx, eventCodeId: string, label: string) {
  const event = await tx.eventCode.findUnique({ where: { id: eventCodeId }, select: eventSelect });
  if (!event || event.eventType !== "TIME_BASED") throw new HttpError(409, `${label} must be a TIME_BASED Event Code.`);
  if (!event.activeFlag) throw new HttpError(409, `${label} Event Code is not active.`);
  return event;
}

async function replayForwardTransfer(tx: Tx, row: TransferHeader,
  command: { memberId: string; requestHash: string }): Promise<CarryTransferResult> {
  if (row.requestHash !== command.requestHash || row.memberId !== command.memberId)
    throw new HttpError(409, "This idempotency key was already used for a different Carry Transfer request.");
  const [sourceCarry, destinationCarry] = await Promise.all([
    activeCarryCents(tx, row.sourceSubscriptionId), activeCarryCents(tx, row.destinationSubscriptionId)
  ]);
  return {
    replayed: true,
    transfer: toTransferView(row),
    source: { subscriptionId: row.sourceSubscriptionId, carryBefore: null, carryAfter: centsToDecimal(sourceCarry) },
    destination: { subscriptionId: row.destinationSubscriptionId, carryBefore: null, carryAfter: centsToDecimal(destinationCarry), allocation: null }
  };
}

/** Core forward transfer. Must run inside the caller's serializable transaction. */
export async function forwardCarryTransferRecord(tx: Tx, input: {
  memberId: string; sourceSubscriptionId: string; destinationSubscriptionId: string;
  amount: string; reason: string; idempotencyKey: string; userId: string;
}): Promise<CarryTransferResult> {
  const reason = input.reason.trim();
  if (!reason) throw new HttpError(400, "A Carry Transfer reason is required.");
  if (reason.length > 1000) throw new HttpError(400, "Carry Transfer reason must not exceed 1000 characters.");
  const idempotencyKey = input.idempotencyKey.trim();
  if (!idempotencyKey) throw new HttpError(400, "An idempotency key is required.");
  const amountCents = decimalStringToCents(input.amount);
  if (amountCents <= 0n) throw new HttpError(400, "Carry Transfer amount must be greater than zero.");
  const requestHash = carryTransferRequestHash({ kind: "CARRY_TRANSFER", memberId: input.memberId,
    sourceSubscriptionId: input.sourceSubscriptionId, destinationSubscriptionId: input.destinationSubscriptionId,
    amount: centsToDecimal(amountCents), reason });

  const existing = await tx.memberEventCarryTransfer.findUnique({ where: { idempotencyKey }, select: transferHeaderSelect });
  if (existing) return replayForwardTransfer(tx, existing, { memberId: input.memberId, requestHash });

  await lockSubscriptionsForPosting(tx, [input.sourceSubscriptionId, input.destinationSubscriptionId]);

  const member = await tx.member.findUnique({ where: { id: input.memberId }, select: { id: true } });
  if (!member) throw new HttpError(404, "Donatur tidak ditemukan.");
  const { source, destination } = await loadOwnedSubscriptions(tx, input.memberId, input.sourceSubscriptionId, input.destinationSubscriptionId);
  await requireTimeBasedEvent(tx, source.eventCodeId, "The source");
  const destinationEvent = await tx.eventCode.findUnique({ where: { id: destination.eventCodeId }, select: destinationEventSelect });
  if (!destinationEvent || destinationEvent.eventType !== "TIME_BASED")
    throw new HttpError(409, "The destination must be a TIME_BASED Event Code.");
  if (!destinationEvent.activeFlag) throw new HttpError(409, "The destination Event Code is not active.");
  const rule = destinationEvent.timeRule;
  if (!rule || !rule.activeFlag) throw new HttpError(409, "The destination program requires an active Time Rule.");
  const unitCents = decimalStringToCents(rule.unitAmount.toString());
  if (unitCents <= 0n || rule.durationMonths <= 0) throw new HttpError(409, "The destination Time Rule is invalid.");

  const sourceCarryBefore = await activeCarryCents(tx, source.id);
  if (amountCents > sourceCarryBefore)
    throw new HttpError(409, "The source subscription does not have enough unused carry for this transfer.");
  const destinationCarryBefore = await activeCarryCents(tx, destination.id);
  const availableCents = destinationCarryBefore + amountCents;
  const unitsBig = availableCents / unitCents;
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
        sourceSubscriptionId: source.id,
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

  const [sourceSequence] = await allocatePostingSequences(tx, source.id, 1);
  await tx.memberEventBalanceLedger.create({ data: {
    subscriptionId: source.id, carryTransferId: created.id, entryType: "TRANSFER_OUT", entryStatus: "ACTIVE",
    amountDelta: centsToDecimal(-amountCents), effectiveDate, postingSequence: sourceSequence, createdById: input.userId
  } });

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
      subscriptionId: destination.id, coverageId: coverage.id, entryType: "COVERAGE_USE", entryStatus: "ACTIVE",
      amountDelta: centsToDecimal(-amountConsumedCents), effectiveDate,
      unitAmountSnapshot: rule.unitAmount.toString(), durationMonthsSnapshot: rule.durationMonths,
      postingSequence: destinationSequences[1], createdById: input.userId
    } });
  }

  await refreshSubscriptionValidity(tx, destination.id);

  return {
    replayed: false,
    transfer: toTransferView(created),
    source: { subscriptionId: source.id, carryBefore: centsToDecimal(sourceCarryBefore), carryAfter: centsToDecimal(sourceCarryBefore - amountCents) },
    destination: {
      subscriptionId: destination.id,
      carryBefore: centsToDecimal(destinationCarryBefore),
      carryAfter: centsToDecimal(availableCents - amountConsumedCents),
      allocation: {
        units,
        amountApplied: centsToDecimal(amountConsumedCents),
        unitAmount: rule.unitAmount.toFixed(2),
        durationMonths: rule.durationMonths,
        coverage: coverage ? { coverageId: coverage.id, coverageFrom: dateOnly(coverage.coverageFrom), coverageTo: dateOnly(coverage.coverageTo) } : null
      }
    }
  };
}

async function replayReversal(tx: Tx, existing: TransferHeader,
  command: { memberId: string; transferId: string; requestHash: string }): Promise<CarryTransferReversalResult> {
  if (existing.requestHash !== command.requestHash || existing.memberId !== command.memberId || existing.reversalOfTransferId !== command.transferId)
    throw new HttpError(409, "This idempotency key was already used for a different Carry Transfer reversal request.");
  const original = await tx.memberEventCarryTransfer.findUnique({ where: { id: command.transferId }, select: transferHeaderSelect });
  if (!original) throw new HttpError(404, "Carry Transfer was not found for this Member.");
  const [restoringCarry, reversingCarry] = await Promise.all([
    activeCarryCents(tx, original.sourceSubscriptionId), activeCarryCents(tx, original.destinationSubscriptionId)
  ]);
  return {
    replayed: true,
    original: toTransferView(original),
    reversal: toTransferView(existing),
    restoringDestination: { subscriptionId: original.sourceSubscriptionId, carryBefore: null, carryAfter: centsToDecimal(restoringCarry) },
    reversingSource: { subscriptionId: original.destinationSubscriptionId, carryBefore: null, carryAfter: centsToDecimal(reversingCarry) }
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
  await lockSubscriptionsForPosting(tx, [found.sourceSubscriptionId, found.destinationSubscriptionId]);

  const original = await tx.memberEventCarryTransfer.findUnique({ where: { id: found.id }, select: transferHeaderSelect });
  if (!original || original.memberId !== input.memberId) throw new HttpError(404, "Carry Transfer was not found for this Member.");
  const alreadyReversed = await tx.memberEventCarryTransfer.findFirst({ where: { reversalOfTransferId: original.id }, select: { id: true } });
  if (alreadyReversed) throw new HttpError(409, "This Carry Transfer already has a reversal.");
  if (original.status !== "ACTIVE") throw new HttpError(409, "Only an active Carry Transfer can be reversed.");

  const { source: reversingSource, destination: restoringDestination } = await loadOwnedSubscriptions(
    tx, input.memberId, original.destinationSubscriptionId, original.sourceSubscriptionId);
  await requireTimeBasedEvent(tx, reversingSource.eventCodeId, "The reversing source");
  await requireTimeBasedEvent(tx, restoringDestination.eventCodeId, "The restoring destination");
  const restoringEvent = await tx.eventCode.findUnique({ where: { id: restoringDestination.eventCodeId }, select: destinationEventSelect });
  if (!restoringEvent || restoringEvent.eventType !== "TIME_BASED")
    throw new HttpError(409, "The restoring destination must be a TIME_BASED Event Code.");

  const amountCents = decimalStringToCents(original.amount.toString());
  const inbound = await tx.memberEventBalanceLedger.findFirst({
    where: { carryTransferId: original.id, entryType: "TRANSFER_IN", entryStatus: "ACTIVE" },
    select: { id: true, subscriptionId: true, postingSequence: true }
  });
  if (!inbound) throw new HttpError(409, "Carry Transfer ledger evidence is incomplete.");
  const laterNegatives = await tx.memberEventBalanceLedger.findMany({
    where: { subscriptionId: inbound.subscriptionId, entryStatus: "ACTIVE", postingSequence: { gt: inbound.postingSequence }, amountDelta: { lt: 0 } },
    orderBy: { postingSequence: "asc" },
    select: { id: true, entryType: true, carryTransferId: true, postingSequence: true }
  });
  if (laterNegatives.length) {
    const downstreamIds = [...new Set(laterNegatives.flatMap(row => row.carryTransferId ? [row.carryTransferId] : []))];
    const downstream = downstreamIds.length
      ? await tx.memberEventCarryTransfer.findMany({ where: { id: { in: downstreamIds } }, select: { id: true, status: true } })
      : [];
    const statusById = new Map(downstream.map(row => [row.id, row.status]));
    const unresolved = laterNegatives.some(row => row.entryType !== "TRANSFER_OUT" || !row.carryTransferId || statusById.get(row.carryTransferId) !== "REVERSED");
    if (unresolved)
      throw new HttpError(409, "Later balance actions depend on this Carry Transfer. Unwind the downstream transfers first.");
  }

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

  return {
    replayed: false,
    original: toTransferView(reversedOriginal),
    reversal: toTransferView(reversal),
    restoringDestination: { subscriptionId: restoringDestination.id, carryBefore: centsToDecimal(restoringCarryBefore), carryAfter: centsToDecimal(restoringCarryBefore + amountCents) },
    reversingSource: { subscriptionId: reversingSource.id, carryBefore: centsToDecimal(reversingCarryBefore), carryAfter: centsToDecimal(reversingCarryBefore - amountCents) }
  };
}

export async function createCarryTransfer(memberId: string, sourceSubscriptionId: string, input: CarryTransferCreateInput, userId: string) {
  return memberTransaction(tx => forwardCarryTransferRecord(tx, { memberId, sourceSubscriptionId, ...input, userId }));
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

function subscriptionView(row: CarryTransferReadRow["sourceSubscription"]): CarryTransferSubscriptionView | null {
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
    source: subscriptionView(row.sourceSubscription),
    destination: subscriptionView(row.destinationSubscription),
    reversalOf: row.reversalOf ? { transferId: row.reversalOf.id, status: row.reversalOf.status, effectiveDate: dateOnly(row.reversalOf.effectiveDate) } : null,
    reversal: row.reversal ? { transferId: row.reversal.id, status: row.reversal.status, effectiveDate: dateOnly(row.reversal.effectiveDate) } : null
  };
}
