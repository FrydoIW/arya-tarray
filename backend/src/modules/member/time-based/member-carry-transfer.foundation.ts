import { Prisma } from "@prisma/client";
import { HttpError } from "../../../lib/http.js";

type Tx = Prisma.TransactionClient;

export const TRANSFER_ENTRY_TYPES = ["TRANSFER_OUT", "TRANSFER_IN"] as const;
export type TransferEntryType = (typeof TRANSFER_ENTRY_TYPES)[number];

export type CarryTransferRecord = {
  id: string;
  memberId: string;
  sourceSubscriptionId: string | null;
  sourceCampaignId?: string | null;
  destinationSubscriptionId: string | null;
  destinationCampaignId?: string | null;
  amount: { toString(): string };
  status: string;
  idempotencyKey: string;
  requestHash: string;
  reversalOfTransferId: string | null;
};

export type CarryTransferLedgerEntry = {
  id: string;
  subscriptionId: string;
  carryTransferId: string | null;
  entryType: string;
  entryStatus: string;
  amountDelta: { toString(): string };
  postingSequence: bigint;
};

export type TransferIntegrityViolation = { code: string; transferId?: string; ledgerId?: string; detail: string };
export type TransferDependency = { kind: "COVERAGE_USE" | "TRANSFER_OUT" | "NEGATIVE_LEDGER"; ledgerId: string; transferId: string | null; postingSequence: bigint; resolved: boolean };

const cents = (value: { toString(): string }) => {
  const text = value.toString().trim();
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw new Error(`Invalid decimal ${text}`);
  return (match[1] === "-" ? -1n : 1n) * (BigInt(match[2]) * 100n + BigInt((match[3] ?? "").padEnd(2, "0")));
};

export function postingSequenceCompare(a: Pick<CarryTransferLedgerEntry, "postingSequence" | "id">, b: Pick<CarryTransferLedgerEntry, "postingSequence" | "id">) {
  if (a.postingSequence !== b.postingSequence) return a.postingSequence < b.postingSequence ? -1 : 1;
  return a.id.localeCompare(b.id);
}

export function validateCarryTransferIntegrity(input: {
  transfers: CarryTransferRecord[];
  entries: CarryTransferLedgerEntry[];
  subscriptions: Array<{ id: string; memberId: string }>;
}) {
  const violations: TransferIntegrityViolation[] = [];
  const transferById = new Map(input.transfers.map(row => [row.id, row]));
  const subscriptionById = new Map(input.subscriptions.map(row => [row.id, row]));
  const entriesByTransfer = new Map<string, CarryTransferLedgerEntry[]>();
  const sequenceBySubscription = new Map<string, Set<string>>();
  for (const entry of input.entries) {
    const sequences = sequenceBySubscription.get(entry.subscriptionId) ?? new Set<string>();
    const sequence = entry.postingSequence.toString();
    if (sequences.has(sequence)) violations.push({ code: "duplicate_posting_sequence", ledgerId: entry.id, detail: "Posting sequence must be unique within a subscription." });
    sequences.add(sequence); sequenceBySubscription.set(entry.subscriptionId, sequences);
    if (!entry.carryTransferId) continue;
    const list = entriesByTransfer.get(entry.carryTransferId) ?? [];
    list.push(entry); entriesByTransfer.set(entry.carryTransferId, list);
    if (!transferById.has(entry.carryTransferId)) violations.push({ code: "orphan_transfer_ledger_leg", ledgerId: entry.id, detail: "Ledger leg references a missing Carry Transfer." });
  }
  const idempotency = new Map<string, CarryTransferRecord>();
  for (const transfer of input.transfers) {
    if (transfer.destinationSubscriptionId !== null && transfer.sourceSubscriptionId === transfer.destinationSubscriptionId)
      violations.push({ code: "same_subscription_transfer", transferId: transfer.id, detail: "Source and destination subscriptions must differ." });
    if (cents(transfer.amount) <= 0n)
      violations.push({ code: "non_positive_transfer_amount", transferId: transfer.id, detail: "Transfer amount must be positive." });
    const source = transfer.sourceSubscriptionId ? subscriptionById.get(transfer.sourceSubscriptionId) : null;
    const destination = transfer.destinationSubscriptionId ? subscriptionById.get(transfer.destinationSubscriptionId) : null;
    const sourceOwned = transfer.sourceCampaignId ? true : Boolean(source && source.memberId === transfer.memberId);
    const destinationOwned = transfer.destinationCampaignId ? true : Boolean(destination && destination.memberId === transfer.memberId);
    if (!sourceOwned || !destinationOwned
      || (!transfer.sourceCampaignId && !source) || (!transfer.destinationCampaignId && !destination))
      violations.push({ code: "transfer_member_subscription_mismatch", transferId: transfer.id, detail: "Transfer endpoints must belong to the transfer Member." });
    const prior = idempotency.get(transfer.idempotencyKey);
    if (prior) {
      const sameRequest = prior.requestHash === transfer.requestHash;
      violations.push({ code: sameRequest ? "duplicate_idempotency_key" : "conflicting_idempotency_key", transferId: transfer.id, detail: "Idempotency key must identify exactly one request payload." });
    } else idempotency.set(transfer.idempotencyKey, transfer);

    const legs = (entriesByTransfer.get(transfer.id) ?? []).filter(entry => entry.entryStatus === "ACTIVE");
    const out = legs.filter(entry => entry.entryType === "TRANSFER_OUT");
    const incoming = legs.filter(entry => entry.entryType === "TRANSFER_IN");
    // Subscription-side legs live in the balance ledger; Campaign wallet legs live in
    // the Campaign wallet ledger and are verified separately. A header describes the
    // real money direction, including for reversals.
    const expectedOut = transfer.sourceSubscriptionId ? 1 : 0;
    const expectedIn = transfer.destinationSubscriptionId ? 1 : 0;
    if (out.length !== expectedOut || incoming.length !== expectedIn) {
      violations.push({ code: "transfer_leg_pair_invalid", transferId: transfer.id, detail: "An active transfer requires exactly one leg per subscription endpoint." });
    } else {
      if ((expectedOut && out[0].subscriptionId !== transfer.sourceSubscriptionId)
        || (expectedIn && incoming[0].subscriptionId !== transfer.destinationSubscriptionId))
        violations.push({ code: "transfer_leg_subscription_mismatch", transferId: transfer.id, detail: "Transfer legs do not match header subscriptions." });
      const expected = cents(transfer.amount);
      if ((expectedOut && cents(out[0].amountDelta) !== -expected)
        || (expectedIn && cents(incoming[0].amountDelta) !== expected)
        || (out[0] && incoming[0] && cents(out[0].amountDelta) + cents(incoming[0].amountDelta) !== 0n))
        violations.push({ code: "transfer_leg_amount_mismatch", transferId: transfer.id, detail: "Transfer legs must be equal, opposite, and match the header amount." });
    }
    if (transfer.reversalOfTransferId) {
      const original = transferById.get(transfer.reversalOfTransferId);
      // Reversal endpoints are the original endpoints swapped.
      const swapped = Boolean(original)
        && transfer.sourceSubscriptionId === (original!.destinationSubscriptionId ?? null)
        && (transfer.sourceCampaignId ?? null) === (original!.destinationCampaignId ?? null)
        && transfer.destinationSubscriptionId === (original!.sourceSubscriptionId ?? null)
        && (transfer.destinationCampaignId ?? null) === (original!.sourceCampaignId ?? null);
      if (!original || cents(original.amount) !== cents(transfer.amount) || !swapped)
        violations.push({ code: "transfer_reversal_mismatch", transferId: transfer.id, detail: "Reversal must swap endpoints and preserve amount." });
    }
  }
  return violations;
}

export function carryTransferDependencies(input: {
  transfer: CarryTransferRecord;
  entries: CarryTransferLedgerEntry[];
  transfers: CarryTransferRecord[];
}) {
  const transferById = new Map(input.transfers.map(row => [row.id, row]));
  if (input.transfer.destinationSubscriptionId === null) return [];
  const inbound = input.entries.find(entry => entry.carryTransferId === input.transfer.id && entry.entryStatus === "ACTIVE"
    && entry.entryType === "TRANSFER_IN" && entry.subscriptionId === input.transfer.destinationSubscriptionId);
  if (!inbound) return [{ kind: "NEGATIVE_LEDGER", ledgerId: "", transferId: null, postingSequence: 0n, resolved: false, missingInbound: true } as TransferDependency & { missingInbound: true }];
  return input.entries
    .filter(entry => entry.subscriptionId === inbound.subscriptionId && entry.entryStatus === "ACTIVE"
      && entry.postingSequence > inbound.postingSequence && cents(entry.amountDelta) < 0n)
    .sort(postingSequenceCompare)
    .map(entry => {
      if (entry.entryType === "COVERAGE_USE") return { kind: "COVERAGE_USE" as const, ledgerId: entry.id, transferId: entry.carryTransferId, postingSequence: entry.postingSequence, resolved: false };
      if (entry.entryType === "TRANSFER_OUT") {
        const downstream = entry.carryTransferId ? transferById.get(entry.carryTransferId) : null;
        return { kind: "TRANSFER_OUT" as const, ledgerId: entry.id, transferId: entry.carryTransferId, postingSequence: entry.postingSequence, resolved: downstream?.status === "REVERSED" };
      }
      return { kind: "NEGATIVE_LEDGER" as const, ledgerId: entry.id, transferId: entry.carryTransferId, postingSequence: entry.postingSequence, resolved: false };
    });
}

export function carryTransferReversalPreflight(input: Parameters<typeof carryTransferDependencies>[0]) {
  if (input.transfer.status !== "ACTIVE") return { reversible: false, reason: "Transfer is not active", dependencies: [] as TransferDependency[] };
  const dependencies = carryTransferDependencies(input);
  const unresolved = dependencies.filter(item => !item.resolved);
  return unresolved.length ? { reversible: false, reason: "Later pooled-balance consumption or transfer dependencies must be unwound first", dependencies }
    : { reversible: true, reason: null, dependencies };
}

/** Locks subscriptions in lexical UUID order before per-subscription sequence allocation. */
export async function lockSubscriptionsForPosting(tx: Tx, subscriptionIds: string[]) {
  const ids = [...new Set(subscriptionIds)].sort();
  if (!ids.length) return;
  const raw = tx as Tx & { $queryRaw?: <T = unknown>(query: Prisma.Sql) => Promise<T> };
  if (typeof raw.$queryRaw === "function") {
    await raw.$queryRaw(Prisma.sql`SELECT member_event_subscription_id FROM arya_member_event_subscription WHERE member_event_subscription_id IN (${Prisma.join(ids)}) ORDER BY member_event_subscription_id FOR UPDATE`);
    return;
  }
  // Unit-test fallback; production TransactionClient always uses the FOR UPDATE query above.
  await Promise.all(ids.map(id => tx.memberEventSubscription.findUnique({ where: { id }, select: { id: true } })));
}

/** Caller must lock the subscription first with lockSubscriptionsForPosting. */
export async function allocatePostingSequences(tx: Tx, subscriptionId: string, count: number) {
  if (!Number.isInteger(count) || count < 1) throw new Error("Posting sequence count must be a positive integer");
  const row = await tx.memberEventBalanceLedger.aggregate({ where: { subscriptionId }, _max: { postingSequence: true } });
  const start = (row._max.postingSequence ?? 0n) + 1n;
  return Array.from({ length: count }, (_, index) => start + BigInt(index));
}

/**
 * Broad rebuild stays safe only when transfer history is net-zero for the subscription.
 * An ACTIVE forward transfer carries live pooled economics that a bank-payment rebuild
 * cannot replay, so it must be reversed first. An ACTIVE reversal is allowed only when
 * its original is REVERSED, i.e. the original/reversal pair nets to zero and can never
 * generate transfer-owned coverage. Transfer legs themselves are always preserved by
 * rebuild regardless of this guard.
 */
export async function assertRebuildHasNoActiveTransferRelation(tx: Tx, subscriptionId: string) {
  const client = tx as Tx & { memberEventCarryTransfer?: {
    findFirst: (args: unknown) => Promise<{ id: string; reversalOf?: { status: string } | null } | null>;
  } };
  if (!client.memberEventCarryTransfer) return;
  const scope = { status: "ACTIVE", OR: [{ sourceSubscriptionId: subscriptionId }, { destinationSubscriptionId: subscriptionId }] };
  const liveForward = await client.memberEventCarryTransfer.findFirst({ where: { ...scope, reversalOfTransferId: null }, select: { id: true } });
  if (liveForward) throw new HttpError(409, "TIME_BASED rebuild is blocked because active Carry Transfer dependencies must be unwound first.");
  const liveReversal = await client.memberEventCarryTransfer.findFirst({
    where: { ...scope, reversalOfTransferId: { not: null } },
    select: { id: true, reversalOfTransferId: true, reversalOf: { select: { status: true } } }
  });
  if (liveReversal && liveReversal.reversalOf?.status !== "REVERSED")
    throw new HttpError(409, "TIME_BASED rebuild is blocked because active Carry Transfer dependencies must be unwound first.");
}

type LaterDependency = { id: string; entryType: string; carryTransferId: string | null; postingSequence: bigint; resolved: boolean };

/**
 * Later ACTIVE negative ledger rows that depend on a transfer-in posting. A later
 * TRANSFER_OUT is resolved only when its downstream transfer is REVERSED; every other
 * negative action stays unresolved.
 */
export async function laterSubscriptionDependencies(tx: Tx, subscriptionId: string, afterPostingSequence: bigint): Promise<LaterDependency[]> {
  const laterNegatives = await tx.memberEventBalanceLedger.findMany({
    where: { subscriptionId, entryStatus: "ACTIVE", postingSequence: { gt: afterPostingSequence }, amountDelta: { lt: 0 } },
    orderBy: { postingSequence: "asc" },
    select: { id: true, entryType: true, carryTransferId: true, postingSequence: true }
  });
  if (!laterNegatives.length) return [];
  const downstreamIds = [...new Set(laterNegatives.flatMap(row => row.carryTransferId ? [row.carryTransferId] : []))];
  const downstream = downstreamIds.length
    ? await tx.memberEventCarryTransfer.findMany({ where: { id: { in: downstreamIds } }, select: { id: true, status: true } })
    : [];
  const statusById = new Map(downstream.map(row => [row.id, row.status]));
  return laterNegatives.map(row => ({ ...row,
    resolved: row.entryType === "TRANSFER_OUT" && Boolean(row.carryTransferId) && statusById.get(row.carryTransferId!) === "REVERSED" }));
}

export function assertNoUnresolvedDependencies(dependencies: Array<{ resolved: boolean }>) {
  if (dependencies.some(row => !row.resolved))
    throw new HttpError(409, "Later balance actions depend on this Carry Transfer. Unwind the downstream transfers first.");
}

export type TransferReversibilityInput = {
  status: string;
  hasReversal: boolean;
  isReversal: boolean;
  destinationSubscriptionId: string | null;
  destinationCampaignId: string | null;
  amountCents: bigint;
  inbound: { postingSequence: bigint } | null;
  laterNegativeEntries?: Array<{ entryType: string; carryTransferId: string | null; postingSequence: bigint }>;
  downstreamStatusById?: Map<string, string>;
  destinationCarryCents?: bigint | null;
  destinationAllocationStatus?: string | null;
};

/**
 * Single source of truth for whether reversal is actually permitted. The history read
 * model and the reversal command must agree on this decision.
 */
export function resolveTransferReversibility(input: TransferReversibilityInput): { reversible: boolean; reversalBlockedReason: string | null } {
  const blocked = (reversalBlockedReason: string) => ({ reversible: false, reversalBlockedReason });
  if (input.status !== "ACTIVE") return blocked("Transfer is not active.");
  if (input.hasReversal) return blocked("This Carry Transfer already has a reversal.");
  if (input.isReversal) return blocked("A reversal transfer cannot be reversed again.");
  if (input.destinationCampaignId) {
    if (input.destinationAllocationStatus !== "ACTIVE") return blocked("Campaign allocation evidence is incomplete.");
    return { reversible: true, reversalBlockedReason: null };
  }
  if (!input.destinationSubscriptionId) return blocked("Carry Transfer destination evidence is incomplete.");
  if (!input.inbound) return blocked("Carry Transfer ledger evidence is incomplete.");
  const inbound = input.inbound;
  const unresolved = (input.laterNegativeEntries ?? []).some(row => row.postingSequence > inbound.postingSequence
    && (row.entryType !== "TRANSFER_OUT" || !row.carryTransferId || input.downstreamStatusById?.get(row.carryTransferId) !== "REVERSED"));
  if (unresolved) return blocked("Later balance actions depend on this Carry Transfer. Unwind the downstream transfers first.");
  if (input.destinationCarryCents !== null && input.destinationCarryCents !== undefined && input.amountCents > input.destinationCarryCents)
    return blocked("The subscription that received the transfer no longer has enough carry to reverse it.");
  return { reversible: true, reversalBlockedReason: null };
}
