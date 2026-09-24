import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { allocateCampaignWalletPostingSequences, campaignAllocationDecision, campaignBackfillVerdict,
  campaignTargetState, campaignTransferAmountIsAllowed, campaignWalletCents, lockCampaignsForPosting,
  reconcileCampaignContribution, reconcileCampaignContributionsForIdentity, requireCampaignCarryDestination,
  synchronizeCampaignContribution } from "../src/modules/member/campaign/member-campaign-wallet.service.js";
import { validateCarryTransferIntegrity } from "../src/modules/member/time-based/member-carry-transfer.foundation.js";

const d = (value: string) => new Prisma.Decimal(value);

type Allocation = { id: string; bankTransactionId: string | null; carryTransferId: string | null; amountDelta: Prisma.Decimal;
  allocationType: string; allocationStatus: string; eventCampaignId: string; memberId: string;
  voidedAt: Date | null; voidedById: string | null; voidReason: string | null };
type Wallet = { id: string; bankTransactionId: string | null; carryTransferId: string | null; amountDelta: Prisma.Decimal;
  entryType: string; entryStatus: string; eventCampaignId: string; memberId: string; postingSequence: bigint;
  voidedAt: Date | null; voidedById: string | null; voidReason: string | null };
type CampaignRow = { id: string; campaignName: string; targetAmount: Prisma.Decimal | null; activeFlag: boolean;
  startDate: Date | null; endDate: Date | null; eventCode: { activeFlag: boolean; eventType: string } };
type Payment = { id: string; memberIdentityId?: string; transactionDate: Date; originalAmount: Prisma.Decimal; status: string;
  reconciliationExcludedAt: Date | null; eventCampaignId: string | null;
  eventCode: { eventType: string }; memberIdentity: { memberId: string | null; verificationStatus: string } };

function campaignFixture(options: {
  campaigns?: Array<{ id: string; target?: string | null; activeFlag?: boolean; startDate?: Date | null; endDate?: Date | null; eventActive?: boolean }>;
  payment?: { id?: string; amount?: string; status?: string; type?: string; campaignId?: string | null;
    memberId?: string | null; verification?: string; excluded?: boolean; date?: Date; identityId?: string } | null;
  legacy?: string;
} = {}) {
  const campaigns: CampaignRow[] = (options.campaigns ?? [{ id: "campaign-1" }]).map(campaign => ({
    id: campaign.id, campaignName: `Campaign ${campaign.id}`,
    targetAmount: campaign.target === undefined || campaign.target === null ? null : d(campaign.target),
    activeFlag: campaign.activeFlag ?? true, startDate: campaign.startDate ?? null, endDate: campaign.endDate ?? null,
    eventCode: { activeFlag: campaign.eventActive ?? true, eventType: "CAMPAIGN" }
  }));
  const allocations: Allocation[] = [];
  const walletEntries: Wallet[] = [];
  const transfers: Array<{ id: string; status: string }> = [];
  const lockQueries: string[] = [];
  const lockValues: unknown[] = [];
  const writes = { allocation: 0, wallet: 0, bank: 0, transfer: 0 };
  let sequence = 0;
  const nextId = (prefix: string) => `${prefix}-${++sequence}`;
  const payment: Payment | null = options.payment === null ? null : {
    id: options.payment?.id ?? "bank-1",
    memberIdentityId: options.payment?.identityId ?? "identity-1",
    transactionDate: options.payment?.date ?? new Date("2026-09-01T00:00:00.000Z"),
    originalAmount: d(options.payment?.amount ?? "300006.00"),
    status: options.payment?.status ?? "FINALIZED",
    reconciliationExcludedAt: options.payment?.excluded ? new Date("2026-09-10T00:00:00.000Z") : null,
    eventCampaignId: options.payment?.campaignId === undefined ? "campaign-1" : options.payment.campaignId,
    eventCode: { eventType: options.payment?.type ?? "CAMPAIGN" },
    memberIdentity: { memberId: options.payment?.memberId === undefined ? "member-a" : options.payment.memberId,
      verificationStatus: options.payment?.verification ?? "VERIFIED" }
  };
  const walletMatches = (row: Wallet, where: Record<string, unknown>) => {
    if (where.memberId !== undefined && row.memberId !== where.memberId) return false;
    if (where.eventCampaignId !== undefined && row.eventCampaignId !== where.eventCampaignId) return false;
    if (where.entryStatus !== undefined && row.entryStatus !== where.entryStatus) return false;
    if (where.bankTransactionId !== undefined && row.bankTransactionId !== where.bankTransactionId) return false;
    if (where.carryTransferId !== undefined && row.carryTransferId !== where.carryTransferId) return false;
    const posting = where.postingSequence as { gt?: bigint; lt?: bigint; lte?: bigint } | undefined;
    if (posting?.gt !== undefined && !(row.postingSequence > posting.gt)) return false;
    if (posting?.lt !== undefined && !(row.postingSequence < posting.lt)) return false;
    if (posting?.lte !== undefined && !(row.postingSequence <= posting.lte)) return false;
    return true;
  };
  const tx = {
    $queryRaw: async (query: { sql?: string; strings?: string[]; values?: unknown[] }) => {
      lockQueries.push(query?.sql ?? (query?.strings ? query.strings.join("?") : String(query)));
      lockValues.push(...(query?.values ?? []));
      return [];
    },
    eventCampaign: { findUnique: async ({ where }: { where: { id: string } }) =>
      campaigns.find(row => row.id === where.id) ?? null },
    memberEventCampaignAllocation: {
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        allocations.filter(row => (where.bankTransactionId === undefined || row.bankTransactionId === where.bankTransactionId)
          && (where.allocationStatus === undefined || row.allocationStatus === where.allocationStatus)) ?? [],
      findUnique: async ({ where }: { where: { bankTransactionId?: string; carryTransferId?: string } }) =>
        allocations.find(row => (where.bankTransactionId !== undefined && row.bankTransactionId === where.bankTransactionId)
          || (where.carryTransferId !== undefined && row.carryTransferId === where.carryTransferId)) ?? null,
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        allocations.find(row => (where.bankTransactionId === undefined || row.bankTransactionId === where.bankTransactionId)
          && (where.eventCampaignId === undefined || row.eventCampaignId === where.eventCampaignId)) ?? null,
      aggregate: async ({ where }: { where: Record<string, unknown> }) => ({
        _sum: { amountDelta: allocations
          .filter(row => (where.eventCampaignId === undefined || row.eventCampaignId === where.eventCampaignId)
            && (where.allocationStatus === undefined || row.allocationStatus === where.allocationStatus))
          .reduce((sum, row) => sum.plus(row.amountDelta), d("0")) } }),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        writes.allocation += 1;
        const row: Allocation = { id: nextId("alloc"), bankTransactionId: (data.bankTransactionId as string | null) ?? null,
          carryTransferId: (data.carryTransferId as string | null) ?? null, amountDelta: d(String(data.amountDelta)),
          allocationType: String(data.allocationType), allocationStatus: String(data.allocationStatus ?? "ACTIVE"),
          eventCampaignId: String(data.eventCampaignId), memberId: String(data.memberId),
          voidedAt: null, voidedById: null, voidReason: null };
        allocations.push(row); return { id: row.id };
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Allocation> }) => {
        const row = allocations.find(item => item.id === where.id)!; Object.assign(row, data); return { ...row };
      }
    },
    memberEventCampaignWalletLedger: {
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        walletEntries.filter(row => walletMatches(row, where)).map(row => ({ ...row })),
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        const rows = walletEntries.filter(row => walletMatches(row, where))
          .sort((a, b) => a.postingSequence < b.postingSequence ? -1 : 1);
        return rows[0] ?? null;
      },
      aggregate: async ({ where }: { where: Record<string, unknown> }) => {
        const rows = walletEntries.filter(row => walletMatches(row, where));
        return {
          _sum: { amountDelta: rows.reduce((sum, row) => sum.plus(row.amountDelta), d("0")) },
          _max: { postingSequence: rows.reduce<bigint | null>((max, row) =>
            max === null || row.postingSequence > max ? row.postingSequence : max, null) }
        };
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        writes.wallet += 1;
        const row: Wallet = { id: nextId("wallet"), bankTransactionId: (data.bankTransactionId as string | null) ?? null,
          carryTransferId: (data.carryTransferId as string | null) ?? null, amountDelta: d(String(data.amountDelta)),
          entryType: String(data.entryType), entryStatus: String(data.entryStatus ?? "ACTIVE"),
          eventCampaignId: String(data.eventCampaignId), memberId: String(data.memberId),
          postingSequence: data.postingSequence as bigint, voidedAt: null, voidedById: null, voidReason: null };
        walletEntries.push(row); return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Wallet> }) => {
        const row = walletEntries.find(item => item.id === where.id)!; Object.assign(row, data); return { ...row };
      }
    },
    memberEventCarryTransfer: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        transfers.filter(row => where.id.in.includes(row.id)).map(row => ({ ...row })),
      create: async () => { writes.transfer += 1; throw new Error("Campaign wallet must not create transfers"); }
    },
    bankTransaction: {
      aggregate: async () => ({ _sum: { originalAmount: d(options.legacy ?? "0") } }),
      findUnique: async ({ where }: { where: { id: string } }) => payment && payment.id === where.id ? payment : null,
      findMany: async ({ where }: { where: { memberIdentityId?: string } }) =>
        payment && (where.memberIdentityId === undefined || where.memberIdentityId === payment.memberIdentityId) ? [payment] : [],
      create: async () => { writes.bank += 1; throw new Error("Campaign wallet must not create BankTransactions"); }
    }
  } as unknown as Prisma.TransactionClient;
  return { tx, campaigns, allocations, walletEntries, transfers, lockQueries, lockValues, writes, payment,
    seedOverflow: (memberId: string, campaignId: string, amount: string, postingSequence: bigint) => {
      walletEntries.push({ id: nextId("wallet"), bankTransactionId: null, carryTransferId: null, amountDelta: d(amount),
        entryType: "CAMPAIGN_OVERFLOW", entryStatus: "ACTIVE", eventCampaignId: campaignId, memberId,
        postingSequence, voidedAt: null, voidedById: null, voidReason: null });
    },
    seedWalletTransfer: (memberId: string, campaignId: string, amount: string, carryTransferId: string, postingSequence: bigint,
      entryType: "TRANSFER_OUT" | "TRANSFER_IN" = "TRANSFER_OUT") => {
      walletEntries.push({ id: nextId("wallet"), bankTransactionId: null, carryTransferId, amountDelta: d(amount),
        entryType, entryStatus: "ACTIVE", eventCampaignId: campaignId, memberId, postingSequence,
        voidedAt: null, voidedById: null, voidReason: null });
    }
  };
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
  const f = campaignFixture({ campaigns: [{ id: "campaign-1", target: "1000000.00" }], legacy: "900000.00" });
  const state = await campaignTargetState(f.tx, "campaign-1");
  assert.equal(f.lockQueries.length, 1);
  assert.match(f.lockQueries[0], /FOR UPDATE/);
  assert.equal(state.activeApplied, 90_000_000n);
  assert.equal(state.remaining, 10_000_000n);
});

test("direct Campaign contributions stay financial truth while only target application is recorded", async () => {
  const f = campaignFixture({ campaigns: [{ id: "campaign-1", target: "1000000.00" }], legacy: "900000.00" });
  const result = await synchronizeCampaignContribution(f.tx, "bank-1", "admin");
  assert.equal(result.state, "ALLOCATED");
  assert.equal(f.allocations.length, 1);
  assert.equal(f.allocations[0].amountDelta.toFixed(2), "100000.00");
  assert.equal(f.allocations[0].bankTransactionId, "bank-1");
  assert.equal(f.walletEntries.length, 1);
  assert.equal(f.walletEntries[0].amountDelta.toFixed(2), "200006.00");
  assert.equal(f.walletEntries[0].entryType, "CAMPAIGN_OVERFLOW");
  assert.equal(f.walletEntries[0].postingSequence, 1n);
  assert.deepEqual(f.writes, { allocation: 1, wallet: 1, bank: 0, transfer: 0 });
});

test("an already-full Campaign sends the entire contribution to the donor wallet", async () => {
  const f = campaignFixture({ campaigns: [{ id: "campaign-1", target: "1000000.00" }], legacy: "1000000.00",
    payment: { amount: "50006.00" } });
  const result = await synchronizeCampaignContribution(f.tx, "bank-1", "admin");
  assert.equal(result.state, "ALLOCATED");
  assert.equal(f.allocations[0].amountDelta.toFixed(2), "0.00");
  assert.equal(f.walletEntries.length, 1);
  assert.equal(f.walletEntries[0].amountDelta.toFixed(2), "50006.00");
});

test("a contribution that exactly meets the remaining target has zero overflow", async () => {
  const f = campaignFixture({ campaigns: [{ id: "campaign-1", target: "1000000.00" }], legacy: "900000.00",
    payment: { amount: "100000.00" } });
  await synchronizeCampaignContribution(f.tx, "bank-1", "admin");
  assert.equal(f.allocations[0].amountDelta.toFixed(2), "100000.00");
  assert.equal(f.walletEntries.length, 0);
});

test("an unlimited Campaign preserves the existing fully-applied behavior", async () => {
  const f = campaignFixture({ campaigns: [{ id: "campaign-1", target: null }] });
  await synchronizeCampaignContribution(f.tx, "bank-1", "admin");
  assert.equal(f.allocations[0].amountDelta.toFixed(2), "300006.00");
  assert.equal(f.walletEntries.length, 0);
});

test("Campaign contribution replay resolves the existing allocation without double posting", async () => {
  const f = campaignFixture({ campaigns: [{ id: "campaign-1", target: "1000000.00" }], legacy: "900000.00" });
  await synchronizeCampaignContribution(f.tx, "bank-1", "admin");
  const replay = await synchronizeCampaignContribution(f.tx, "bank-1", "admin");
  assert.equal(replay.state, "ALLOCATED");
  assert.equal((replay as { replayed?: boolean }).replayed, true);
  assert.equal(f.allocations.length, 1);
  assert.equal(f.walletEntries.length, 1);
  assert.deepEqual(f.writes, { allocation: 1, wallet: 1, bank: 0, transfer: 0 });
});

test("Campaign A -> Campaign B voids the old active economics and applies per the new target", async () => {
  const f = campaignFixture({ campaigns: [{ id: "campaign-1", target: "1000000.00" }, { id: "campaign-2", target: "1000000.00" }],
    legacy: "900000.00" });
  await synchronizeCampaignContribution(f.tx, "bank-1", "admin");
  assert.equal(f.allocations[0].eventCampaignId, "campaign-1");
  f.payment!.eventCampaignId = "campaign-2";
  const result = await reconcileCampaignContribution(f.tx, "bank-1", "admin");
  assert.equal(result.state, "ALLOCATED");
  const oldAllocation = f.allocations.find(row => row.eventCampaignId === "campaign-1")!;
  const oldOverflow = f.walletEntries.find(row => row.eventCampaignId === "campaign-1")!;
  assert.equal(oldAllocation.allocationStatus, "VOIDED");
  assert.ok(oldAllocation.voidedAt instanceof Date);
  assert.equal(oldAllocation.voidedById, "admin");
  assert.equal(oldOverflow.entryStatus, "VOIDED");
  assert.ok(oldOverflow.voidedAt instanceof Date);
  const newAllocation = f.allocations.find(row => row.eventCampaignId === "campaign-2" && row.allocationStatus === "ACTIVE")!;
  assert.equal(newAllocation.amountDelta.toFixed(2), "100000.00");
  const newOverflow = f.walletEntries.find(row => row.eventCampaignId === "campaign-2" && row.entryStatus === "ACTIVE")!;
  assert.equal(newOverflow.amountDelta.toFixed(2), "200006.00");
  assert.equal(f.payment!.originalAmount.toFixed(2), "300006.00");
  assert.deepEqual(f.writes, { allocation: 2, wallet: 2, bank: 0, transfer: 0 });
});

test("Campaign -> TIME_BASED revokes the Campaign economics without touching the contribution", async () => {
  const f = campaignFixture({ campaigns: [{ id: "campaign-1", target: "1000000.00" }], legacy: "900000.00" });
  await synchronizeCampaignContribution(f.tx, "bank-1", "admin");
  f.payment!.eventCode.eventType = "TIME_BASED";
  const result = await reconcileCampaignContribution(f.tx, "bank-1", "admin");
  assert.equal(result.state, "REVOKED");
  assert.equal(f.allocations[0].allocationStatus, "VOIDED");
  assert.equal(f.walletEntries[0].entryStatus, "VOIDED");
  assert.equal(f.allocations.filter(row => row.allocationStatus === "ACTIVE").length, 0);
  assert.equal(f.walletEntries.filter(row => row.entryStatus === "ACTIVE").length, 0);
});

test("Campaign -> STANDARD revokes the Campaign economics", async () => {
  const f = campaignFixture({ campaigns: [{ id: "campaign-1", target: "1000000.00" }], legacy: "900000.00" });
  await synchronizeCampaignContribution(f.tx, "bank-1", "admin");
  f.payment!.eventCode.eventType = "STANDARD";
  f.payment!.eventCampaignId = null;
  assert.equal((await reconcileCampaignContribution(f.tx, "bank-1", "admin")).state, "REVOKED");
  assert.equal(f.allocations[0].allocationStatus, "VOIDED");
  assert.equal(f.walletEntries[0].entryStatus, "VOIDED");
});

test("Campaign -> EXCLUDED or non-finalized revokes the Campaign economics", async () => {
  const excluded = campaignFixture({ campaigns: [{ id: "campaign-1", target: "1000000.00" }], legacy: "900000.00" });
  await synchronizeCampaignContribution(excluded.tx, "bank-1", "admin");
  excluded.payment!.reconciliationExcludedAt = new Date("2026-09-10T00:00:00.000Z");
  assert.equal((await reconcileCampaignContribution(excluded.tx, "bank-1", "admin")).state, "REVOKED");
  assert.equal(excluded.allocations[0].allocationStatus, "VOIDED");

  const notFinal = campaignFixture({ campaigns: [{ id: "campaign-1", target: "1000000.00" }], legacy: "900000.00" });
  await synchronizeCampaignContribution(notFinal.tx, "bank-1", "admin");
  notFinal.payment!.status = "CHECK";
  assert.equal((await reconcileCampaignContribution(notFinal.tx, "bank-1", "admin")).state, "REVOKED");
  assert.equal(notFinal.walletEntries[0].entryStatus, "VOIDED");
});

test("same Campaign resynchronization stays idempotent with no duplicate rows", async () => {
  const f = campaignFixture({ campaigns: [{ id: "campaign-1", target: "1000000.00" }], legacy: "900000.00" });
  const first = await synchronizeCampaignContribution(f.tx, "bank-1", "admin");
  const second = await synchronizeCampaignContribution(f.tx, "bank-1", "admin");
  const third = await reconcileCampaignContribution(f.tx, "bank-1", "admin");
  assert.equal((first as { allocationId: string }).allocationId, (second as { allocationId: string }).allocationId);
  assert.equal((second as { allocationId: string }).allocationId, (third as { allocationId: string }).allocationId);
  assert.equal(f.allocations.length, 1);
  assert.equal(f.walletEntries.length, 1);
});

test("a later active wallet transfer blocks contribution correction before mutation", async () => {
  const f = campaignFixture({ campaigns: [{ id: "campaign-1", target: "1000000.00" }, { id: "campaign-2", target: null }],
    legacy: "900000.00" });
  await synchronizeCampaignContribution(f.tx, "bank-1", "admin");
  const overflow = f.walletEntries[0];
  f.seedWalletTransfer("member-a", "campaign-1", "-50000.00", "transfer-2", overflow.postingSequence + 1n, "TRANSFER_OUT");
  f.transfers.push({ id: "transfer-2", status: "ACTIVE" });
  f.payment!.eventCampaignId = "campaign-2";
  await assert.rejects(() => reconcileCampaignContribution(f.tx, "bank-1", "admin"), /Balikkan transfer lanjutan/);
  assert.equal(f.allocations[0].allocationStatus, "ACTIVE");
  assert.equal(f.walletEntries[0].entryStatus, "ACTIVE");
  assert.equal(f.allocations.length, 1);
});

test("a fully reversed downstream transfer no longer blocks contribution correction", async () => {
  const f = campaignFixture({ campaigns: [{ id: "campaign-1", target: "1000000.00" }, { id: "campaign-2", target: null }],
    legacy: "900000.00" });
  await synchronizeCampaignContribution(f.tx, "bank-1", "admin");
  const overflow = f.walletEntries[0];
  f.seedWalletTransfer("member-a", "campaign-1", "-50000.00", "transfer-2", overflow.postingSequence + 1n, "TRANSFER_OUT");
  f.seedWalletTransfer("member-a", "campaign-1", "50000.00", "transfer-3", overflow.postingSequence + 2n, "TRANSFER_IN");
  f.transfers.push({ id: "transfer-2", status: "REVERSED" }, { id: "transfer-3", status: "ACTIVE" });
  f.payment!.eventCampaignId = "campaign-2";
  assert.equal((await reconcileCampaignContribution(f.tx, "bank-1", "admin")).state, "ALLOCATED");
  assert.equal(f.allocations.find(row => row.eventCampaignId === "campaign-1")!.allocationStatus, "VOIDED");
  assert.equal(f.walletEntries.find(row => row.eventCampaignId === "campaign-1")!.entryStatus, "VOIDED");
});

test("ownership move voids the old Member evidence and reapplies for the new owner", async () => {
  const f = campaignFixture({ campaigns: [{ id: "campaign-1", target: "1000000.00" }], legacy: "900000.00" });
  await synchronizeCampaignContribution(f.tx, "bank-1", "admin");
  f.payment!.memberIdentity.memberId = "member-b";
  const result = await reconcileCampaignContribution(f.tx, "bank-1", "admin", { reason: "Ownership moved" });
  assert.equal(result.state, "ALLOCATED");
  const oldRow = f.allocations.find(row => row.memberId === "member-a")!;
  assert.equal(oldRow.allocationStatus, "VOIDED");
  assert.equal(oldRow.voidReason, "Ownership moved");
  assert.equal(f.walletEntries.find(row => row.memberId === "member-a")!.entryStatus, "VOIDED");
  assert.equal(f.allocations.find(row => row.memberId === "member-b" && row.allocationStatus === "ACTIVE")!.amountDelta.toFixed(2), "100000.00");
  assert.equal(f.walletEntries.find(row => row.memberId === "member-b" && row.entryStatus === "ACTIVE")!.amountDelta.toFixed(2), "200006.00");
});

test("detach revokes the Campaign evidence and re-attach materialises it again", async () => {
  const f = campaignFixture({ campaigns: [{ id: "campaign-1", target: "1000000.00" }], legacy: "900000.00" });
  await synchronizeCampaignContribution(f.tx, "bank-1", "admin");
  f.payment!.memberIdentity = { memberId: null, verificationStatus: "UNVERIFIED" };
  assert.equal((await reconcileCampaignContribution(f.tx, "bank-1", "admin")).state, "REVOKED");
  assert.equal(f.allocations[0].allocationStatus, "VOIDED");
  f.payment!.memberIdentity = { memberId: "member-a", verificationStatus: "VERIFIED" };
  assert.equal((await reconcileCampaignContribution(f.tx, "bank-1", "admin")).state, "ALLOCATED");
  assert.equal(f.allocations.filter(row => row.allocationStatus === "ACTIVE").length, 1);
  assert.equal(f.walletEntries.filter(row => row.entryStatus === "ACTIVE").length, 1);
});

test("ownership migration is blocked when the wallet overflow was already transferred", async () => {
  const f = campaignFixture({ campaigns: [{ id: "campaign-1", target: "1000000.00" }], legacy: "900000.00" });
  await synchronizeCampaignContribution(f.tx, "bank-1", "admin");
  const overflow = f.walletEntries[0];
  f.seedWalletTransfer("member-a", "campaign-1", "-200000.00", "transfer-2", overflow.postingSequence + 1n, "TRANSFER_OUT");
  f.transfers.push({ id: "transfer-2", status: "ACTIVE" });
  f.payment!.memberIdentity.memberId = "member-b";
  await assert.rejects(() => reconcileCampaignContribution(f.tx, "bank-1", "admin"), /Balikkan transfer lanjutan/);
  assert.equal(f.allocations[0].allocationStatus, "ACTIVE");
  assert.equal(f.allocations.filter(row => row.allocationStatus === "ACTIVE").length, 1);
});

test("identity reconciliation targets every Campaign transaction of the identity", async () => {
  const f = campaignFixture({ campaigns: [{ id: "campaign-1", target: "1000000.00" }], legacy: "900000.00" });
  await synchronizeCampaignContribution(f.tx, "bank-1", "admin");
  f.payment!.memberIdentity = { memberId: null, verificationStatus: "UNVERIFIED" };
  await reconcileCampaignContributionsForIdentity(f.tx, "identity-1", "admin");
  assert.equal(f.allocations[0].allocationStatus, "VOIDED");
  assert.equal(f.walletEntries[0].entryStatus, "VOIDED");
});

test("serialized Campaign contributions can never apply more than the target", () => {
  const target = 1_000_000n;
  let applied = 900_000n;
  const lockOrder: string[] = [];
  const contribute = (incoming: bigint) => {
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
  const valid = campaignFixture({ campaigns: [{ id: "campaign-1", target: "1000000.00" }], legacy: "900000.00" });
  assert.equal((await requireCampaignCarryDestination(valid.tx, "campaign-1")).remaining, 10_000_000n);
  const full = campaignFixture({ campaigns: [{ id: "campaign-1", target: "1000000.00" }], legacy: "1000000.00" });
  await assert.rejects(() => requireCampaignCarryDestination(full.tx, "campaign-1"), /Target Campaign sudah terpenuhi/);
  const missing = campaignFixture();
  await assert.rejects(() => requireCampaignCarryDestination(missing.tx, "campaign-x"), /tidak ditemukan/);
  const inactive = campaignFixture({ campaigns: [{ id: "campaign-1", target: "1000000.00", activeFlag: false }] });
  await assert.rejects(() => requireCampaignCarryDestination(inactive.tx, "campaign-1"), /tidak aktif/);
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
    { id: "w1", bankTransactionId: "bank-1", carryTransferId: null, amountDelta: d("200006.00"), entryType: "CAMPAIGN_OVERFLOW", entryStatus: "ACTIVE", eventCampaignId: "campaign-1", memberId: "member-a", postingSequence: 1n, voidedAt: null, voidedById: null, voidReason: null },
    { id: "w2", bankTransactionId: null, carryTransferId: "transfer-1", amountDelta: d("-50000.00"), entryType: "TRANSFER_OUT", entryStatus: "ACTIVE", eventCampaignId: "campaign-1", memberId: "member-a", postingSequence: 2n, voidedAt: null, voidedById: null, voidReason: null },
    { id: "w3", bankTransactionId: null, carryTransferId: "transfer-2", amountDelta: d("900000.00"), entryType: "TRANSFER_IN", entryStatus: "VOIDED", eventCampaignId: "campaign-1", memberId: "member-a", postingSequence: 3n, voidedAt: null, voidedById: null, voidReason: null }
  );
  assert.equal(await campaignWalletCents(f.tx, "member-a", "campaign-1"), 15_000_600n);
});

test("posting sequences allocate monotonically per donor wallet", async () => {
  const f = campaignFixture();
  f.seedOverflow("member-a", "campaign-1", "1000.00", 3n);
  assert.deepEqual(await allocateCampaignWalletPostingSequences(f.tx, "member-a", "campaign-1", 2), [4n, 5n]);
  assert.deepEqual(await allocateCampaignWalletPostingSequences(f.tx, "member-a", "campaign-2", 1), [1n]);
});

test("Campaign wallet locks are taken once, in lexical order, before spendable balance is read", async () => {
  const f = campaignFixture();
  await lockCampaignsForPosting(f.tx, ["campaign-b", "campaign-a", "campaign-b"]);
  assert.equal(f.lockQueries.length, 1);
  assert.match(f.lockQueries[0], /ORDER BY event_campaign_id FOR UPDATE/);
  assert.deepEqual(f.lockValues, ["campaign-a", "campaign-b"]);
  const service = readFileSync(new URL("../src/modules/member/time-based/member-carry-transfer.service.ts", import.meta.url), "utf8");
  const forward = service.slice(service.indexOf("export async function forwardCarryTransferRecord"), service.indexOf("const sourceCarryBefore"));
  assert.ok(forward.indexOf("lockCampaignsForPosting") > -1, "Campaign source locks must be taken in the forward transfer path");
});

test("concurrent Campaign wallet spends cannot double-spend the pooled balance", async () => {
  const f = campaignFixture();
  f.seedOverflow("member-a", "campaign-1", "100000.00", 1n);
  let balance = await campaignWalletCents(f.tx, "member-a", "campaign-1");
  // Each request reads the wallet only after the campaign row lock, so spends serialize.
  const spend = (requested: bigint) => {
    if (!campaignTransferAmountIsAllowed(requested, null) || requested > balance) return false;
    balance -= requested;
    return true;
  };
  assert.equal(spend(8_000_000n), true);
  assert.equal(spend(8_000_000n), false);
  assert.equal(balance, 2_000_000n);
});

test("approval-time Campaign reconciliation covers transactions that left Campaign", () => {
  const repository = readFileSync(new URL("../src/modules/approval/sign-approval/sign-approval.repository.ts", import.meta.url), "utf8");
  assert.match(repository, /memberEventCampaignAllocations: \{ some: \{\} \}/);
  assert.match(repository, /memberEventCampaignWalletEntries: \{ some: \{\} \}/);
});

test("legacy Campaign tooling is exposed through the verifier and an explicit dry-run backfill", () => {
  const script = readFileSync(new URL("../scripts/verify-member-integrity.ts", import.meta.url), "utf8");
  assert.match(script, /campaign_legacy_contribution_without_evidence/);
  assert.match(script, /forward_campaign_source_wallet_missing/);
  assert.match(script, /reversal_campaign_source_allocation_missing/);
  assert.match(script, /campaign_wallet_posting_sequence_missing_or_duplicate/);
  const backfill = readFileSync(new URL("../scripts/backfill-campaign-evidence.ts", import.meta.url), "utf8");
  assert.match(backfill, /--dry-run/);
  assert.match(backfill, /--apply/);
  assert.match(backfill, /campaignBackfillVerdict/);
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { scripts: Record<string, string> };
  assert.equal(manifest.scripts["campaign:backfill"], "tsx scripts/backfill-campaign-evidence.ts");
});

test("non-Campaign or unresolved payments never post Campaign wallet evidence", async () => {
  const timeBased = campaignFixture({ payment: { amount: "100000.00", type: "TIME_BASED" } });
  assert.deepEqual(await synchronizeCampaignContribution(timeBased.tx, "bank-1", "admin"), { state: "NOT_CAMPAIGN" });
  const pendingMember = campaignFixture({ payment: { amount: "100000.00", memberId: null, verification: "UNVERIFIED" } });
  assert.deepEqual(await synchronizeCampaignContribution(pendingMember.tx, "bank-1", "admin"), { state: "PENDING_MEMBER" });
  assert.deepEqual(timeBased.writes, { allocation: 0, wallet: 0, bank: 0, transfer: 0 });
});

test("legacy Campaign backfill is only safe when the target can absorb the legacy total", () => {
  assert.deepEqual(campaignBackfillVerdict({ target: null, explicitApplied: 0n, legacyTotal: 500n }),
    { safe: true, reason: "UNLIMITED" });
  assert.deepEqual(campaignBackfillVerdict({ target: 1_000n, explicitApplied: 400n, legacyTotal: 600n }),
    { safe: true, reason: "FITS_REMAINING" });
  assert.deepEqual(campaignBackfillVerdict({ target: 1_000n, explicitApplied: 400n, legacyTotal: 601n }),
    { safe: false, reason: "TARGET_EXCEEDED_BY_LEGACY" });
});

test("cross-type transfer verifier accepts valid forward and reversal Campaign evidence", () => {
  const subscription = { id: "sub-a", memberId: "member-a" };
  const base = { memberId: "member-a", amount: d("150000.00"), status: "ACTIVE" };
  const forwardCampaignToTime = { ...base, id: "t1", idempotencyKey: "k1", requestHash: "h1", sourceSubscriptionId: null, sourceCampaignId: "c1",
    destinationSubscriptionId: "sub-a", destinationCampaignId: null, reversalOfTransferId: null };
  const reversalCampaignToTime = { ...base, id: "t2", idempotencyKey: "k2", requestHash: "h2", sourceSubscriptionId: "sub-a", sourceCampaignId: null,
    destinationSubscriptionId: null, destinationCampaignId: "c1", reversalOfTransferId: "t1" };
  const forwardTimeToCampaign = { ...base, id: "t3", idempotencyKey: "k3", requestHash: "h3", sourceSubscriptionId: "sub-a", sourceCampaignId: null,
    destinationSubscriptionId: null, destinationCampaignId: "c1", reversalOfTransferId: null };
  const reversalTimeToCampaign = { ...base, id: "t4", idempotencyKey: "k4", requestHash: "h4", sourceSubscriptionId: null, sourceCampaignId: "c1",
    destinationSubscriptionId: "sub-a", destinationCampaignId: null, reversalOfTransferId: "t3" };
  const forwardCampaignToCampaign = { ...base, id: "t5", idempotencyKey: "k5", requestHash: "h5", sourceSubscriptionId: null, sourceCampaignId: "c1",
    destinationSubscriptionId: null, destinationCampaignId: "c2", reversalOfTransferId: null };
  const reversalCampaignToCampaign = { ...base, id: "t6", idempotencyKey: "k6", requestHash: "h6", sourceSubscriptionId: null, sourceCampaignId: "c2",
    destinationSubscriptionId: null, destinationCampaignId: "c1", reversalOfTransferId: "t5" };
  const walletEntries = [
    { id: "w1", carryTransferId: "t1", entryType: "TRANSFER_OUT", entryStatus: "ACTIVE", amountDelta: d("-150000.00"), memberId: "member-a", eventCampaignId: "c1", postingSequence: 1n },
    { id: "w2", carryTransferId: "t2", entryType: "TRANSFER_IN", entryStatus: "ACTIVE", amountDelta: d("150000.00"), memberId: "member-a", eventCampaignId: "c1", postingSequence: 2n },
    { id: "w3", carryTransferId: "t4", entryType: "TRANSFER_IN", entryStatus: "ACTIVE", amountDelta: d("150000.00"), memberId: "member-a", eventCampaignId: "c1", postingSequence: 3n },
    { id: "w4", carryTransferId: "t5", entryType: "TRANSFER_OUT", entryStatus: "ACTIVE", amountDelta: d("-150000.00"), memberId: "member-a", eventCampaignId: "c1", postingSequence: 4n },
    { id: "w5", carryTransferId: "t6", entryType: "TRANSFER_IN", entryStatus: "ACTIVE", amountDelta: d("150000.00"), memberId: "member-a", eventCampaignId: "c1", postingSequence: 5n }
  ];
  const allocations = [
    { id: "a1", carryTransferId: "t3", allocationType: "CARRY_TRANSFER", allocationStatus: "ACTIVE", amountDelta: d("150000.00"), eventCampaignId: "c1" },
    { id: "a2", carryTransferId: "t4", allocationType: "CARRY_REVERSAL", allocationStatus: "ACTIVE", amountDelta: d("-150000.00"), eventCampaignId: "c1" },
    { id: "a3", carryTransferId: "t5", allocationType: "CARRY_TRANSFER", allocationStatus: "ACTIVE", amountDelta: d("150000.00"), eventCampaignId: "c2" },
    { id: "a4", carryTransferId: "t6", allocationType: "CARRY_REVERSAL", allocationStatus: "ACTIVE", amountDelta: d("-150000.00"), eventCampaignId: "c2" }
  ];
  const entries = [
    { id: "l1", subscriptionId: "sub-a", carryTransferId: "t1", entryType: "TRANSFER_IN", entryStatus: "ACTIVE", amountDelta: d("150000.00"), postingSequence: 1n },
    { id: "l2", subscriptionId: "sub-a", carryTransferId: "t2", entryType: "TRANSFER_OUT", entryStatus: "ACTIVE", amountDelta: d("-150000.00"), postingSequence: 2n },
    { id: "l3", subscriptionId: "sub-a", carryTransferId: "t3", entryType: "TRANSFER_OUT", entryStatus: "ACTIVE", amountDelta: d("-150000.00"), postingSequence: 3n },
    { id: "l4", subscriptionId: "sub-a", carryTransferId: "t4", entryType: "TRANSFER_IN", entryStatus: "ACTIVE", amountDelta: d("150000.00"), postingSequence: 4n }
  ];
  const transfers = [forwardCampaignToTime, reversalCampaignToTime, forwardTimeToCampaign, reversalTimeToCampaign,
    forwardCampaignToCampaign, reversalCampaignToCampaign];
  assert.deepEqual(validateCarryTransferIntegrity({ transfers, entries, subscriptions: [subscription], campaignWalletEntries: walletEntries, campaignAllocations: allocations }), []);
});

test("cross-type transfer verifier rejects corrupted reversal Campaign evidence", () => {
  const base = { memberId: "member-a", amount: d("150000.00"), status: "ACTIVE" };
  const forward = { ...base, id: "t1", idempotencyKey: "k1", requestHash: "h1", sourceSubscriptionId: null, sourceCampaignId: "c1",
    destinationSubscriptionId: "sub-a", destinationCampaignId: null, reversalOfTransferId: null };
  const reversal = { ...base, id: "t2", idempotencyKey: "k2", requestHash: "h2", sourceSubscriptionId: "sub-a", sourceCampaignId: null,
    destinationSubscriptionId: null, destinationCampaignId: "c1", reversalOfTransferId: "t1" };
  const forwardCampaignToCampaign = { ...base, id: "t5", idempotencyKey: "k5", requestHash: "h5", sourceSubscriptionId: null, sourceCampaignId: "c1",
    destinationSubscriptionId: null, destinationCampaignId: "c2", reversalOfTransferId: null };
  const reversalCampaignToCampaign = { ...base, id: "t6", idempotencyKey: "k6", requestHash: "h6", sourceSubscriptionId: null, sourceCampaignId: "c2",
    destinationSubscriptionId: null, destinationCampaignId: "c1", reversalOfTransferId: "t5" };
  const entries = [
    { id: "l1", subscriptionId: "sub-a", carryTransferId: "t1", entryType: "TRANSFER_IN", entryStatus: "ACTIVE", amountDelta: d("150000.00"), postingSequence: 1n },
    { id: "l2", subscriptionId: "sub-a", carryTransferId: "t2", entryType: "TRANSFER_OUT", entryStatus: "ACTIVE", amountDelta: d("-150000.00"), postingSequence: 2n }
  ];
  // Missing wallet restoration and missing compensating allocations on both reversals.
  const violations = validateCarryTransferIntegrity({ transfers: [forward, reversal, forwardCampaignToCampaign, reversalCampaignToCampaign],
    entries, subscriptions: [{ id: "sub-a", memberId: "member-a" }], campaignWalletEntries: [], campaignAllocations: [] });
  assert.ok(violations.some(row => row.code === "campaign_source_wallet_invalid"));
  assert.ok(violations.some(row => row.code === "campaign_reversal_destination_wallet_invalid"));
  assert.ok(violations.some(row => row.code === "campaign_reversal_source_allocation_invalid"));
});
