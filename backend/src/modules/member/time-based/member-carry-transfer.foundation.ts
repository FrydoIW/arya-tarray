import { Prisma } from "@prisma/client";
import { HttpError } from "../../../lib/http.js";

type Tx = Prisma.TransactionClient;

export const TRANSFER_ENTRY_TYPES = ["TRANSFER_OUT", "TRANSFER_IN"] as const;
export type TransferEntryType = (typeof TRANSFER_ENTRY_TYPES)[number];

export type CarryTransferRecord = {
  id: string;
  memberId: string;
  sourceSubscriptionId: string;
  destinationSubscriptionId: string;
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
    if (transfer.sourceSubscriptionId === transfer.destinationSubscriptionId)
      violations.push({ code: "same_subscription_transfer", transferId: transfer.id, detail: "Source and destination subscriptions must differ." });
    if (cents(transfer.amount) <= 0n)
      violations.push({ code: "non_positive_transfer_amount", transferId: transfer.id, detail: "Transfer amount must be positive." });
    const source = subscriptionById.get(transfer.sourceSubscriptionId);
    const destination = subscriptionById.get(transfer.destinationSubscriptionId);
    if (!source || !destination || source.memberId !== transfer.memberId || destination.memberId !== transfer.memberId)
      violations.push({ code: "transfer_member_subscription_mismatch", transferId: transfer.id, detail: "Transfer subscriptions must belong to the transfer Member." });
    const prior = idempotency.get(transfer.idempotencyKey);
    if (prior) {
      const sameRequest = prior.requestHash === transfer.requestHash;
      violations.push({ code: sameRequest ? "duplicate_idempotency_key" : "conflicting_idempotency_key", transferId: transfer.id, detail: "Idempotency key must identify exactly one request payload." });
    } else idempotency.set(transfer.idempotencyKey, transfer);

    const legs = (entriesByTransfer.get(transfer.id) ?? []).filter(entry => entry.entryStatus === "ACTIVE");
    const out = legs.filter(entry => entry.entryType === "TRANSFER_OUT");
    const incoming = legs.filter(entry => entry.entryType === "TRANSFER_IN");
    if (out.length !== 1 || incoming.length !== 1) {
      violations.push({ code: "transfer_leg_pair_invalid", transferId: transfer.id, detail: "An active transfer requires exactly one TRANSFER_OUT and one TRANSFER_IN leg." });
    } else {
      if (out[0].subscriptionId !== transfer.sourceSubscriptionId || incoming[0].subscriptionId !== transfer.destinationSubscriptionId)
        violations.push({ code: "transfer_leg_subscription_mismatch", transferId: transfer.id, detail: "Transfer legs do not match header subscriptions." });
      const expected = cents(transfer.amount);
      if (cents(out[0].amountDelta) !== -expected || cents(incoming[0].amountDelta) !== expected || cents(out[0].amountDelta) + cents(incoming[0].amountDelta) !== 0n)
        violations.push({ code: "transfer_leg_amount_mismatch", transferId: transfer.id, detail: "Transfer legs must be equal, opposite, and match the header amount." });
    }
    if (transfer.reversalOfTransferId) {
      const original = transferById.get(transfer.reversalOfTransferId);
      if (!original || cents(original.amount) !== cents(transfer.amount)
        || original.sourceSubscriptionId !== transfer.destinationSubscriptionId
        || original.destinationSubscriptionId !== transfer.sourceSubscriptionId)
        violations.push({ code: "transfer_reversal_mismatch", transferId: transfer.id, detail: "Reversal must swap subscriptions and preserve amount." });
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
