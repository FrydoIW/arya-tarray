import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { campaignAllocationDecision, campaignTargetState, campaignTransferAmountIsAllowed, campaignWalletCents,
  requireCampaignCarryDestination, synchronizeCampaignContribution } from "../src/modules/member/campaign/member-campaign-wallet.service.js";

const d = (value: string) => new Prisma.Decimal(value);

type Allocation = { id: string; bankTransactionId: string | null; carryTransferId: string | null; amountDelta: Prisma.Decimal;
  allocationType: string; allocationStatus: string; eventCampaignId: string; memberId: string };
type Wallet = { id: string; bankTransactionId: string | null; carryTransferId: string | null; amountDelta: Prisma.Decimal;
  entryType: string; entryStatus: string; eventCampaignId: string; memberId: string };

function campaignFixture(options: { target?: string | null; applied?: string; legacy?: string;
  payment?: { id: string; amount: string; status?: string; memberId?: string | null; campaignId?: string | null; type?: string } | null } = {}) {
  const allocations: Allocation[] = [];
  const walletEntries: Wallet[] = [];
  const lockQueries: string[] = [];
  const writes = { allocation: 0, wallet: 0, bank: 0, transfer: 0 };
  const payment = options.payment === null ? null : {
    id: options.payment?.id ?? "bank-1", transactionDate: new Date("2026-09-01T00:00:00.000Z"),
    originalAmount: d(options.payment?.amount ?? "300006.00"), status: options.payment?.status ?? "FINALIZED",
    reconciliationExcludedAt: null as Date | null, eventCampaignId: options.payment?.campaignId === undefined ? "campaign-1" : options.payment.campaignId,
    eventCode: { eventType: options.payment?.type ?? "CAMPAIGN" },
    memberIdentity: { memberId: options.payment?.memberId === undefined ? "member-a" : options.payment.memberId, verificationStatus: "VERIFIED" }
  };
  const tx = {
    $queryRaw: async (query: { sql?: string }) => { lockQueries.push(query?.sql ?? String(query)); return []; },
    eventCampaign: { findUnique: async ({ where }: { where: { id: string } }) => where.id === "campaign-1" ? {
      id: "campaign-1", targetAmount: options.target === undefined ? null : options.target ? d(options.target) : null,
      activeFlag: true, startDate: null, endDate: null, eventCode: { activeFlag: true, eventType: "CAMPAIGN" }
    } : null },
    memberEventCampaignAllocation: {
      aggregate: async () => ({ _sum: { amountDelta: d(options.applied ?? "0") } }),
      findUnique: async ({ where }: { where: { bankTransactionId?: string; carryTransferId?: string } }) =>
        allocations.find(row => (where.bankTransactionId !== undefined && row.bankTransactionId === where.bankTransactionId)
          || (where.carryTransferId !== undefined && row.carryTransferId === where.carryTransferId)) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        writes.allocation += 1;
        const row: Allocation = { id: `alloc-${allocations.length + 1}`, bankTransactionId: (data.bankTransactionId as string | null) ?? null,
          carryTransferId: (data.carryTransferId as string | null) ?? null, amountDelta: d(String(data.amountDelta)),
          allocationType: String(data.allocationType), allocationStatus: String(data.allocationStatus),
          eventCampaignId: String(data.eventCampaignId), memberId: String(data.memberId) };
        allocations.push(row); return { id: row.id };
      }
    },
    bankTransaction: {
      aggregate: async () => ({ _sum: { originalAmount: d(options.legacy ?? "0") } }),
      findUnique: async ({ where }: { where: { id: string } }) => payment && payment.id === where.id ? payment : null,
      create: async () => { writes.bank += 1; throw new Error("Campaign wallet must not create BankTransactions"); }
    },
    memberEventCampaignWalletLedger: {
      aggregate: async ({ where }: { where?: { entryStatus?: string } } = {}) =>
        ({ _sum: { amountDelta: walletEntries
          .filter(row => !where?.entryStatus || row.entryStatus === where.entryStatus)
          .reduce((sum, row) => sum.plus(row.amountDelta), d("0")) } }),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        writes.wallet += 1;
        const row: Wallet = { id: `wallet-${walletEntries.length + 1}`, bankTransactionId: (data.bankTransactionId as string | null) ?? null,
          carryTransferId: (data.carryTransferId as string | null) ?? null, amountDelta: d(String(data.amountDelta)),
          entryType: String(data.entryType), entryStatus: String(data.entryStatus), eventCampaignId: String(data.eventCampaignId),
          memberId: String(data.memberId) };
        walletEntries.push(row); return row;
      }
    },
    memberEventCarryTransfer: { create: async () => { writes.transfer += 1; throw new Error("Campaign wallet must not create transfers"); } }
  } as unknown as Prisma.TransactionClient;
  return { tx, allocations, walletEntries, lockQueries, writes, payment };
}

test("Campaign target decisions apply only the remaining capacity and overflow the rest to the donor wallet", () => {
  assert.deepEqual(campaignAllocationDecision({ incoming: 300_006n, target: 1_000_000n, activeApplied: 900_000n }),
    { applied: 100_000n, overflow: 200_006n, remainingBefore: 100_000n });
  assert.deepEqual(campaignAllocationDecision({ incoming: 100_000n, target: 1_000_000n, activeApplied: 900_000n }),
    { applied: 100_000n, overflow: 0n, remainingBefore: 100_000n });
  assert.deepEqual(campaignAllocationDecision({ incoming: 50_006n, target: 1_000_000n, activeApplied: 1_000_000n }),
    { applied: 0n, overflow: 50_006n, remainingBefore: 0n });
  assert.deepEqual(campaignAllocationDecision({ incoming: 250_000n, target: null, activeApplied: 0n }),
    { applied: 250_000n, overflow: 0n, remainingBefore: null });
  assert.throws(() => campaignAllocationDecision({ incoming: 0n, target: 1n, activeApplied: 0n }), /greater than zero/);
});

test("Campaign capacity always locks the campaign row before reading applied capacity", async () => {
  const f = campaignFixture({ target: "1000000.00", applied: "900000.00", legacy: "0.00" });
  const state = await campaignTargetState(f.tx, "campaign-1");
  assert.equal(f.lockQueries.length, 1);
  assert.match(f.lockQueries[0], /FOR UPDATE/);
  assert.equal(state.activeApplied, 90_000_000n);
  assert.equal(state.remaining, 10_000_000n);
});

test("direct Campaign contributions stay financial truth while only target application is recorded", async () => {
  const f = campaignFixture({ target: "1000000.00", applied: "900000.00" });
  const result = await synchronizeCampaignContribution(f.tx, "bank-1", "admin");
  assert.equal(result.state, "ALLOCATED");
  assert.equal(f.allocations.length, 1);
  assert.equal(f.allocations[0].amountDelta.toFixed(2), "100000.00");
  assert.equal(f.allocations[0].bankTransactionId, "bank-1");
  assert.equal(f.walletEntries.length, 1);
  assert.equal(f.walletEntries[0].amountDelta.toFixed(2), "200006.00");
  assert.equal(f.walletEntries[0].entryType, "CAMPAIGN_OVERFLOW");
  assert.deepEqual(f.writes, { allocation: 1, wallet: 1, bank: 0, transfer: 0 });
});

test("an already-full Campaign sends the entire contribution to the donor wallet", async () => {
  const f = campaignFixture({ target: "1000000.00", applied: "1000000.00",
    payment: { id: "bank-1", amount: "50006.00" } });
  const result = await synchronizeCampaignContribution(f.tx, "bank-1", "admin");
  assert.equal(result.state, "ALLOCATED");
  assert.equal(f.allocations.length, 1);
  assert.equal(f.allocations[0].amountDelta.toFixed(2), "0.00");
  assert.equal(f.walletEntries.length, 1);
  assert.equal(f.walletEntries[0].amountDelta.toFixed(2), "50006.00");
});

test("a contribution that exactly meets the remaining target has zero overflow", async () => {
  const f = campaignFixture({ target: "1000000.00", applied: "900000.00",
    payment: { id: "bank-1", amount: "100000.00" } });
  await synchronizeCampaignContribution(f.tx, "bank-1", "admin");
  assert.equal(f.allocations[0].amountDelta.toFixed(2), "100000.00");
  assert.equal(f.walletEntries.length, 0);
});

test("an unlimited Campaign preserves the existing fully-applied behavior", async () => {
  const f = campaignFixture({ target: null });
  await synchronizeCampaignContribution(f.tx, "bank-1", "admin");
  assert.equal(f.allocations[0].amountDelta.toFixed(2), "300006.00");
  assert.equal(f.walletEntries.length, 0);
});

test("Campaign contribution replay resolves the existing allocation without double posting", async () => {
  const f = campaignFixture({ target: "1000000.00", applied: "900000.00" });
  await synchronizeCampaignContribution(f.tx, "bank-1", "admin");
  const replay = await synchronizeCampaignContribution(f.tx, "bank-1", "admin");
  assert.equal(replay.state, "ALLOCATED");
  assert.equal(f.allocations.length, 1);
  assert.equal(f.walletEntries.length, 1);
  assert.deepEqual(f.writes, { allocation: 1, wallet: 1, bank: 0, transfer: 0 });
});

test("serialized Campaign contributions can never apply more than the target", () => {
  const target = 1_000_000n;
  let applied = 900_000n;
  const lockOrder: string[] = [];
  const contribute = (incoming: bigint) => {
    // Mirrors the service: the campaign row is locked before capacity is read.
    lockOrder.push("lock");
    const decision = campaignAllocationDecision({ incoming, target, activeApplied: applied });
    applied += decision.applied;
    return decision;
  };
  const first = contribute(300_006n);
  const second = contribute(300_006n);
  assert.equal(first.applied, 100_000n);
  assert.equal(first.overflow, 200_006n);
  assert.equal(second.applied, 0n);
  assert.equal(second.overflow, 300_006n);
  assert.equal(applied, target);
  assert.deepEqual(lockOrder, ["lock", "lock"]);
});

test("Campaign destinations require an active, in-period Campaign with remaining target", async () => {
  const valid = campaignFixture({ target: "1000000.00", applied: "900000.00" });
  assert.equal((await requireCampaignCarryDestination(valid.tx, "campaign-1")).remaining, 10_000_000n);
  const full = campaignFixture({ target: "1000000.00", applied: "1000000.00" });
  await assert.rejects(() => requireCampaignCarryDestination(full.tx, "campaign-1"), /Target Campaign sudah terpenuhi/);
  const missing = campaignFixture();
  await assert.rejects(() => requireCampaignCarryDestination(missing.tx, "campaign-x"), /tidak ditemukan/);
});

test("Campaign transfer amount must stay within the remaining target", () => {
  assert.equal(campaignTransferAmountIsAllowed(100_000n, 100_000n), true);
  assert.equal(campaignTransferAmountIsAllowed(100_001n, 100_000n), false);
  assert.equal(campaignTransferAmountIsAllowed(500_000n, null), true);
  assert.equal(campaignTransferAmountIsAllowed(0n, 100_000n), false);
});

test("Campaign wallet balance is the signed sum of ACTIVE wallet evidence", async () => {
  const f = campaignFixture();
  f.walletEntries.push(
    { id: "w1", bankTransactionId: "bank-1", carryTransferId: null, amountDelta: d("200006.00"), entryType: "CAMPAIGN_OVERFLOW", entryStatus: "ACTIVE", eventCampaignId: "campaign-1", memberId: "member-a" },
    { id: "w2", bankTransactionId: null, carryTransferId: "transfer-1", amountDelta: d("-50000.00"), entryType: "TRANSFER_OUT", entryStatus: "ACTIVE", eventCampaignId: "campaign-1", memberId: "member-a" },
    { id: "w3", bankTransactionId: null, carryTransferId: "transfer-2", amountDelta: d("900000.00"), entryType: "TRANSFER_IN", entryStatus: "VOIDED", eventCampaignId: "campaign-1", memberId: "member-a" }
  );
  assert.equal(await campaignWalletCents(f.tx, "member-a", "campaign-1"), 15_000_600n);
});

test("non-Campaign or unresolved payments never post Campaign wallet evidence", async () => {
  const timeBased = campaignFixture({ payment: { id: "bank-1", amount: "100000.00", type: "TIME_BASED" } });
  assert.deepEqual(await synchronizeCampaignContribution(timeBased.tx, "bank-1", "admin"), { state: "NOT_CAMPAIGN" });
  const pendingMember = campaignFixture({ payment: { id: "bank-1", amount: "100000.00", memberId: null } });
  assert.deepEqual(await synchronizeCampaignContribution(pendingMember.tx, "bank-1", "admin"), { state: "PENDING_MEMBER" });
  assert.deepEqual(timeBased.writes, { allocation: 0, wallet: 0, bank: 0, transfer: 0 });
});
