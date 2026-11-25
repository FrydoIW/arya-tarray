import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../lib/http.js";
import { memberTransaction } from "../member/member-identity/member-transaction.js";
import type { AdjustItemSaleStockInput, ConfigureItemSaleInput, UpdateItemSalePriceInput } from "./item-sale.schema.js";

type Tx = Prisma.TransactionClient;
const pendingStatuses = ["DRAFT", "REVIEW_REQUIRED", "PENDING_BUYER", "PENDING_STOCK"];

function decimal(value: string | Prisma.Decimal) { return new Prisma.Decimal(value); }
function purchaseJson(value: { eventCodeId: string; eventCodeChildId: string; quantity: number; unitPriceSnapshot: Prisma.Decimal; totalAmount: Prisma.Decimal; status: string; buyerMemberId: string | null; version: number }) {
  return { eventCodeId: value.eventCodeId, eventCodeChildId: value.eventCodeChildId, quantity: value.quantity,
    unitPriceSnapshot: value.unitPriceSnapshot.toString(), totalAmount: value.totalAmount.toString(), status: value.status,
    buyerMemberId: value.buyerMemberId, version: value.version };
}
async function audit(tx: Tx, input: { entityType: "ITEM_CONFIG" | "PURCHASE" | "FUND"; entityId: string; action: string; before?: Prisma.InputJsonValue; after?: Prisma.InputJsonValue; reason: string; userId: string }) {
  await tx.itemSaleAudit.create({ data: { id: randomUUID(), entityType: input.entityType, entityId: input.entityId, action: input.action,
    beforeData: input.before ?? Prisma.JsonNull, afterData: input.after ?? Prisma.JsonNull, reason: input.reason, actionById: input.userId } });
}

/**
 * Reconciles one bank receipt into the append-only ITEM_SALE fund ledger.
 * The bank amount never changes: a confirmed sale reduces customer liability,
 * while pending/reversed purchases leave the corresponding money unallocated.
 */
export async function synchronizeItemSaleFund(tx: Tx, transactionId: string, userId: string, reason: string) {
  await tx.$queryRaw(Prisma.sql`SELECT bank_transaction_id FROM arya_bank_transaction
    WHERE bank_transaction_id = ${transactionId} FOR UPDATE`);
  const row = await tx.bankTransaction.findUnique({ where: { id: transactionId }, select: {
    id: true, status: true, originalAmount: true, reconciliationExcludedAt: true,
    eventCode: { select: { eventType: true } },
    memberIdentity: { select: { memberId: true, verificationStatus: true } },
    itemSalePurchase: { select: { id: true, status: true, totalAmount: true, walletAppliedAmount: true, version: true } },
    itemSaleFund: true
  } });
  if (!row) throw new HttpError(404, "Bank transaction not found");

  const targetSale = row.status === "FINALIZED" && !row.reconciliationExcludedAt
    && row.originalAmount.greaterThan(0) && row.eventCode?.eventType === "ITEM_SALE";
  if (!targetSale && !row.itemSaleFund) return null;
  const ownerMemberId = row.memberIdentity?.verificationStatus === "VERIFIED" ? row.memberIdentity.memberId : null;
  const ownershipStatus = ownerMemberId ? "ATTRIBUTED" : "SUSPENSE";
  const walletApplied = row.itemSalePurchase?.walletAppliedAmount ?? new Prisma.Decimal(0);
  const desiredAllocation = targetSale && row.itemSalePurchase?.status === "CONFIRMED"
    ? row.itemSalePurchase.totalAmount.minus(walletApplied) : new Prisma.Decimal(0);
  if (desiredAllocation.lessThan(0) || desiredAllocation.greaterThan(row.originalAmount)) {
    throw new HttpError(409, "ITEM_SALE sale allocation cannot exceed the original bank amount after wallet application");
  }

  let fund = row.itemSaleFund;
  if (!fund) {
    fund = await tx.itemSaleFund.create({ data: {
      bankTransactionId: row.id, purchaseId: row.itemSalePurchase?.id ?? null, ownerMemberId,
      ownershipStatus, originalAmount: row.originalAmount, allocatedSaleAmount: 0, otherAllocatedAmount: 0,
      unallocatedAmount: row.originalAmount, status: "OPEN", createdById: userId, updatedById: userId
    } });
    await tx.itemSaleFundLedger.create({ data: {
      fundId: fund.id, purchaseId: row.itemSalePurchase?.id ?? null, entryType: "SOURCE_RECEIPT",
      amountDelta: row.originalAmount, balanceAfter: row.originalAmount,
      idempotencyKey: `ITEM_SALE_SOURCE:${row.id}`, reason, createdById: userId
    } });
  } else if (!fund.originalAmount.equals(row.originalAmount)) {
    throw new HttpError(409, "ITEM_SALE fund no longer matches its immutable bank receipt");
  }

  if (!targetSale && fund.otherAllocatedAmount.greaterThan(0)) {
    throw new HttpError(409, "Reverse active wallet allocations before excluding this ITEM_SALE source receipt.");
  }

  const ownershipChanged = fund.ownerMemberId !== ownerMemberId || fund.ownershipStatus !== ownershipStatus;
  if (ownershipChanged) {
    const conflict = await tx.itemSaleFundAllocation.findFirst({ where: {
      sourceFundId: fund.id, status: "ACTIVE",
      ...(ownerMemberId ? { purchase: { is: { OR: [{ buyerMemberId: null }, { buyerMemberId: { not: ownerMemberId } }] } } } : {})
    }, select: { id: true } });
    if (conflict) throw new HttpError(409, "Resolve active ITEM_SALE wallet allocations before changing the wallet owner.");
    await tx.itemSaleFundLedger.create({ data: {
      fundId: fund.id, purchaseId: row.itemSalePurchase?.id ?? fund.purchaseId, entryType: "OWNERSHIP_UPDATE",
      amountDelta: 0, balanceAfter: fund.unallocatedAmount,
      idempotencyKey: `ITEM_SALE_OWNER:${fund.id}:${ownerMemberId ?? "SUSPENSE"}`,
      reason, createdById: userId
    } }).catch((error: unknown) => {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
    });
  }

  const allocationDelta = desiredAllocation.minus(fund.allocatedSaleAmount);
  const unallocatedAmount = targetSale
    ? row.originalAmount.minus(desiredAllocation).minus(fund.otherAllocatedAmount)
    : new Prisma.Decimal(0);
  if (unallocatedAmount.lessThan(0)) {
    throw new HttpError(409, "ITEM_SALE wallet allocation exceeds the remaining customer liability");
  }
  const balanceDelta = unallocatedAmount.minus(fund.unallocatedAmount);
  if (!balanceDelta.equals(0)) {
    const entryType = !targetSale ? "SOURCE_REVERSAL"
      : fund.status === "REVERSED" ? "SOURCE_REINSTATEMENT"
        : allocationDelta.greaterThan(0) ? "SALE_ALLOCATION" : "SALE_RELEASE";
    await tx.itemSaleFundLedger.create({ data: {
      fundId: fund.id, purchaseId: row.itemSalePurchase?.id ?? fund.purchaseId,
      entryType,
      amountDelta: balanceDelta,
      balanceAfter: unallocatedAmount,
      idempotencyKey: `ITEM_SALE_FUND:${row.itemSalePurchase?.id ?? row.id}:${row.itemSalePurchase?.version ?? 0}:${targetSale}:${desiredAllocation.toString()}:${fund.otherAllocatedAmount.toString()}`,
      reason, createdById: userId
    } });
  }

  const status = !targetSale ? "REVERSED" : unallocatedAmount.equals(0) ? "SETTLED" : "OPEN";
  return tx.itemSaleFund.update({ where: { id: fund.id }, data: {
    purchaseId: row.itemSalePurchase?.id ?? fund.purchaseId, ownerMemberId, ownershipStatus,
    allocatedSaleAmount: desiredAllocation, unallocatedAmount, status,
    version: { increment: 1 }, updatedById: userId
  } });
}

/**
 * Releases wallet money previously moved from a source fund into a purchase.
 * A partial release reduces the active allocation amount; a full release marks
 * it REVERSED. Every source fund gets an append-only WALLET_RELEASE entry.
 */
async function releasePurchaseWalletAllocations(tx: Tx, purchaseId: string, userId: string, reason: string, requestedAmount?: Prisma.Decimal, exactAllocationId?: string) {
  await tx.$queryRaw`SELECT item_sale_purchase_id FROM arya_item_sale_purchase WHERE item_sale_purchase_id = ${purchaseId} FOR UPDATE`;
  const purchase = await tx.itemSalePurchase.findUnique({ where: { id: purchaseId }, select: { id: true, walletAppliedAmount: true, buyerMemberId: true, status: true } });
  if (!purchase) throw new HttpError(404, "Item purchase not found");
  if (exactAllocationId && purchase.status === "CONFIRMED") throw new HttpError(409, "Reverse the confirmed purchase before reversing its wallet funding.");
  if (exactAllocationId && (!requestedAmount?.greaterThan(0) || requestedAmount.greaterThan(purchase.walletAppliedAmount))) {
    throw new HttpError(409, "Wallet allocation amount does not match the purchase funding.");
  }
  let remaining = requestedAmount ?? purchase.walletAppliedAmount;
  if (remaining.lessThanOrEqualTo(0)) return new Prisma.Decimal(0);
  const allocations = await tx.itemSaleFundAllocation.findMany({ where: {
    purchaseId, status: "ACTIVE", ...(exactAllocationId ? { id: exactAllocationId } : {})
  }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  let released = new Prisma.Decimal(0);
  for (const allocation of allocations) {
    if (!remaining.greaterThan(0)) break;
    const take = Prisma.Decimal.min(remaining, allocation.amount);
    const fundRows = await tx.$queryRaw<Array<{ item_sale_fund_id: string }>>`
      SELECT item_sale_fund_id FROM arya_item_sale_fund WHERE item_sale_fund_id = ${allocation.sourceFundId} FOR UPDATE
    `;
    if (fundRows.length === 0) throw new HttpError(409, "Wallet source fund is no longer available");
    const fund = await tx.itemSaleFund.findUniqueOrThrow({ where: { id: allocation.sourceFundId } });
    if (fund.status === "REVERSED") throw new HttpError(409, "A reversed wallet source cannot be restored");
    if (exactAllocationId && (!allocation.amount.equals(remaining) || !fund.ownerMemberId ||
      fund.ownershipStatus !== "ATTRIBUTED" || fund.ownerMemberId !== purchase.buyerMemberId)) {
      throw new HttpError(409, "Wallet allocation no longer matches its purchase, amount, or verified owner.");
    }
    const unallocated = fund.unallocatedAmount.plus(take);
    const otherAllocated = fund.otherAllocatedAmount.minus(take);
    if (otherAllocated.lessThan(0)) throw new HttpError(409, "Wallet allocation ledger is inconsistent");
    await tx.itemSaleFund.update({ where: { id: fund.id }, data: {
      unallocatedAmount: unallocated, otherAllocatedAmount: otherAllocated,
      status: unallocated.equals(0) ? "SETTLED" : "OPEN", version: { increment: 1 }, updatedById: userId
    } });
    await tx.itemSaleFundLedger.create({ data: {
      fundId: fund.id, purchaseId, entryType: "WALLET_RELEASE", amountDelta: take, balanceAfter: unallocated,
      idempotencyKey: `ITEM_SALE_WALLET_RELEASE:${allocation.id}:${allocation.amount.toString()}:${take.toString()}`,
      reason, createdById: userId
    } });
    const nextAmount = allocation.amount.minus(take);
    await tx.itemSaleFundAllocation.update({ where: { id: allocation.id }, data: {
      status: nextAmount.equals(0) ? "REVERSED" : "ACTIVE",
      ...(nextAmount.equals(0) ? { reversedAt: new Date(), reversedById: userId, reversalReason: reason } : { amount: nextAmount })
    } });
    await audit(tx, { entityType: "FUND", entityId: fund.id, action: "WALLET_ALLOCATION_RELEASED",
      before: { amount: allocation.amount.toString(), allocationId: allocation.id }, after: { amount: nextAmount.toString() }, reason, userId });
    released = released.plus(take);
    remaining = remaining.minus(take);
  }
  if (!remaining.equals(0)) throw new HttpError(409, "Active wallet allocation evidence could not cover the requested release.");
  const walletApplied = purchase.walletAppliedAmount.minus(released);
  if (walletApplied.lessThan(0)) throw new HttpError(409, "Wallet release exceeds the purchase funding");
  await tx.itemSalePurchase.update({ where: { id: purchase.id }, data: { walletAppliedAmount: walletApplied, version: { increment: 1 }, updatedById: userId } });
  return released;
}

/** Keeps wallet funding equal to the purchase shortfall after quantity changes. */
async function reconcilePurchaseWalletApplication(tx: Tx, purchaseId: string, total: Prisma.Decimal, bankAmount: Prisma.Decimal, userId: string, reason: string) {
  const purchase = await tx.itemSalePurchase.findUnique({ where: { id: purchaseId }, select: { walletAppliedAmount: true } });
  if (!purchase || purchase.walletAppliedAmount.equals(0)) return new Prisma.Decimal(0);
  const needed = total.minus(bankAmount);
  const target = needed.greaterThan(0) ? needed : new Prisma.Decimal(0);
  if (purchase.walletAppliedAmount.greaterThan(target)) {
    await releasePurchaseWalletAllocations(tx, purchaseId, userId, reason, purchase.walletAppliedAmount.minus(target));
    return target;
  }
  return purchase.walletAppliedAmount;
}

export type ItemSaleWalletAllocationInput = {
  sourceFundId: string;
  purchaseId: string;
  amount: string;
  reason: string;
  idempotencyKey: string;
  userId: string;
};

/**
 * Moves unallocated customer liability from one bank receipt to a pending
 * purchase of the same verified buyer. This never mutates the bank transaction
 * and never transfers money to another Member.
 */
export function allocateItemSaleWallet(input: ItemSaleWalletAllocationInput) {
  return memberTransaction(async tx => {
    const sourceRows = await tx.$queryRaw<Array<{ item_sale_fund_id: string }>>`
      SELECT item_sale_fund_id FROM arya_item_sale_fund WHERE item_sale_fund_id = ${input.sourceFundId} FOR UPDATE
    `;
    if (sourceRows.length === 0) throw new HttpError(404, "Wallet source fund not found");
    const purchaseRows = await tx.$queryRaw<Array<{ item_sale_purchase_id: string }>>`
      SELECT item_sale_purchase_id FROM arya_item_sale_purchase WHERE item_sale_purchase_id = ${input.purchaseId} FOR UPDATE
    `;
    if (purchaseRows.length === 0) throw new HttpError(404, "Item purchase not found");

    const existing = await tx.itemSaleFundAllocation.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) {
      const same = existing.sourceFundId === input.sourceFundId && existing.purchaseId === input.purchaseId
        && existing.amount.equals(new Prisma.Decimal(input.amount))
        && existing.reason === input.reason.trim();
      if (!same) throw new HttpError(409, "Idempotency key was already used for a different wallet allocation");
      const fund = await tx.itemSaleFund.findUniqueOrThrow({ where: { id: existing.sourceFundId } });
      const purchase = await tx.itemSalePurchase.findUniqueOrThrow({ where: { id: existing.purchaseId } });
      return { allocation: existing, fund, purchase };
    }

    const [fund, purchase] = await Promise.all([
      tx.itemSaleFund.findUniqueOrThrow({ where: { id: input.sourceFundId }, include: { bankTransaction: { select: { id: true, referenceNo: true, originalAmount: true } } } }),
      tx.itemSalePurchase.findUniqueOrThrow({ where: { id: input.purchaseId }, include: { bankTransaction: { select: { id: true, originalAmount: true } } } })
    ]);
    if (fund.status === "REVERSED") throw new HttpError(409, "A reversed wallet source cannot be allocated");
    if (!fund.ownerMemberId || fund.ownershipStatus !== "ATTRIBUTED") throw new HttpError(409, "Verify the source wallet owner before allocating funds");
    if (!purchase.buyerMemberId || purchase.status === "CONFIRMED" || purchase.status === "REVERSED" || purchase.status === "VOIDED") {
      throw new HttpError(409, "Wallet can only fund a pending purchase of a verified buyer");
    }
    if (purchase.buyerMemberId !== fund.ownerMemberId) throw new HttpError(409, "Wallet source and purchase must belong to the same verified buyer");

    const amount = new Prisma.Decimal(input.amount);
    if (amount.lessThanOrEqualTo(0)) throw new HttpError(400, "Allocation amount must be positive");
    if (amount.greaterThan(fund.unallocatedAmount)) throw new HttpError(409, "Allocation exceeds the available wallet balance");
    const shortfall = purchase.totalAmount.minus(purchase.bankTransaction.originalAmount).minus(purchase.walletAppliedAmount);
    if (shortfall.lessThanOrEqualTo(0)) throw new HttpError(409, "This purchase does not need wallet funding");
    if (amount.greaterThan(shortfall)) throw new HttpError(409, "Allocation exceeds the purchase funding shortfall");

    const allocation = await tx.itemSaleFundAllocation.create({ data: {
      sourceFundId: fund.id, purchaseId: purchase.id, amount,
      status: "ACTIVE", idempotencyKey: input.idempotencyKey.trim(), reason: input.reason.trim(), createdById: input.userId
    } });
    const unallocated = fund.unallocatedAmount.minus(amount);
    const otherAllocated = fund.otherAllocatedAmount.plus(amount);
    await tx.itemSaleFund.update({ where: { id: fund.id }, data: {
      unallocatedAmount: unallocated, otherAllocatedAmount: otherAllocated,
      status: unallocated.equals(0) ? "SETTLED" : "OPEN", version: { increment: 1 }, updatedById: input.userId
    } });
    await tx.itemSaleFundLedger.create({ data: {
      fundId: fund.id, purchaseId: purchase.id, entryType: "WALLET_ALLOCATION", amountDelta: amount.negated(),
      balanceAfter: unallocated, idempotencyKey: `ITEM_SALE_WALLET_ALLOCATION:${allocation.id}`,
      reason: input.reason.trim(), createdById: input.userId
    } });
    const updatedPurchase = await tx.itemSalePurchase.update({ where: { id: purchase.id }, data: {
      walletAppliedAmount: purchase.walletAppliedAmount.plus(amount), version: { increment: 1 }, updatedById: input.userId
    } });
    await audit(tx, { entityType: "FUND", entityId: fund.id, action: "WALLET_ALLOCATED",
      before: { unallocatedAmount: fund.unallocatedAmount.toString(), otherAllocatedAmount: fund.otherAllocatedAmount.toString() },
      after: { unallocatedAmount: unallocated.toString(), otherAllocatedAmount: otherAllocated.toString(), purchaseId: purchase.id, amount: amount.toString() },
      reason: input.reason.trim(), userId: input.userId });

    // Let the normal purchase workflow confirm only when buyer, stock, and all
    // funding sources are now valid. It remains pending otherwise.
    if (updatedPurchase.status === "REVIEW_REQUIRED" || updatedPurchase.status === "PENDING_BUYER" || updatedPurchase.status === "PENDING_STOCK") {
      await synchronizeItemSaleTransaction(tx, updatedPurchase.bankTransactionId, input.userId, {
        quantity: updatedPurchase.quantity, reason: `Wallet allocation: ${input.reason.trim()}`
      });
    }
    const refreshedFund = await tx.itemSaleFund.findUniqueOrThrow({ where: { id: fund.id } });
    const refreshedPurchase = await tx.itemSalePurchase.findUniqueOrThrow({ where: { id: purchase.id } });
    return { allocation, fund: refreshedFund, purchase: refreshedPurchase };
  });
}

export function reverseItemSaleWalletAllocation(input: { allocationId: string; reason: string; userId: string }) {
  return memberTransaction(async tx => {
    const allocationRows = await tx.$queryRaw<Array<{ item_sale_fund_allocation_id: string }>>`
      SELECT item_sale_fund_allocation_id FROM arya_item_sale_fund_allocation
      WHERE item_sale_fund_allocation_id = ${input.allocationId} FOR UPDATE
    `;
    if (allocationRows.length === 0) throw new HttpError(404, "Wallet allocation not found");
    const allocation = await tx.itemSaleFundAllocation.findUniqueOrThrow({ where: { id: input.allocationId }, include: { purchase: { select: { id: true, status: true } } } });
    if (allocation.status === "REVERSED") return allocation;
    if (allocation.status !== "ACTIVE") throw new HttpError(409, "This wallet allocation cannot be reversed");
    if (allocation.purchase.status === "CONFIRMED") throw new HttpError(409, "Reverse the confirmed purchase before reversing its wallet funding");
    await releasePurchaseWalletAllocations(tx, allocation.purchaseId, input.userId, input.reason.trim(), allocation.amount, allocation.id);
    return tx.itemSaleFundAllocation.findUniqueOrThrow({ where: { id: allocation.id } });
  });
}

export async function getItemSaleWalletSummary() {
  const funds = await prisma.itemSaleFund.findMany({
    include: {
      bankTransaction: { select: { id: true, transactionDate: true, referenceNo: true, senderName: true, description: true, originalAmount: true, statementUpload: { select: { id: true, fileName: true } } } },
      purchase: { select: { id: true, quantity: true, totalAmount: true, paymentAmountSnapshot: true, walletAppliedAmount: true, status: true, eventCodeChild: { select: { id: true, childCode: true, childName: true } } } },
      ownerMember: { select: { id: true, memberCode: true, memberName: true } },
      entries: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 50, include: { createdBy: { select: { id: true, fullName: true } } } },
      allocations: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], include: { purchase: { select: { id: true, status: true, quantity: true, totalAmount: true } }, createdBy: { select: { id: true, fullName: true } }, reversedBy: { select: { id: true, fullName: true } } } }
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }]
  });
  const pendingPurchases = await prisma.itemSalePurchase.findMany({
    where: { status: { in: pendingStatuses } },
    include: {
      bankTransaction: { select: { id: true, referenceNo: true, originalAmount: true, transactionDate: true, memberIdentity: { select: { memberId: true, verificationStatus: true } } } },
      eventCodeChild: { select: { id: true, childCode: true, childName: true, itemSaleConfig: { select: { stockOnHand: true } } } },
      buyerMember: { select: { id: true, memberCode: true, memberName: true } }
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }]
  });

  const decimal = (value: Prisma.Decimal | null | undefined) => value ?? new Prisma.Decimal(0);
  const sum = (rows: typeof funds, field: "originalAmount" | "allocatedSaleAmount" | "unallocatedAmount" | "otherAllocatedAmount") =>
    rows.reduce((total, row) => total.plus(decimal(row[field])), new Prisma.Decimal(0));
  const activeFunds = funds.filter(fund => fund.status !== "REVERSED");
  const memberMap = new Map<string, { memberId: string; memberCode: string; memberName: string; walletBalance: Prisma.Decimal; suspense: boolean }>();
  for (const fund of activeFunds) {
    const key = fund.ownerMemberId ?? "SUSPENSE";
    const current = memberMap.get(key) ?? {
      memberId: fund.ownerMemberId ?? "", memberCode: fund.ownerMember?.memberCode ?? "SUSPENSE",
      memberName: fund.ownerMember?.memberName ?? "Belum terverifikasi", walletBalance: new Prisma.Decimal(0), suspense: !fund.ownerMemberId
    };
    current.walletBalance = current.walletBalance.plus(fund.unallocatedAmount);
    memberMap.set(key, current);
  }
  const pending = pendingPurchases.map(purchase => {
    const shortfall = purchase.totalAmount.minus(purchase.bankTransaction.originalAmount).minus(purchase.walletAppliedAmount);
    return {
      purchaseId: purchase.id, buyerMember: purchase.buyerMember, status: purchase.status,
      quantity: purchase.quantity, unitPrice: purchase.unitPriceSnapshot.toString(),
      totalAmount: purchase.totalAmount.toString(), bankAmount: purchase.bankTransaction.originalAmount.toString(),
      walletAppliedAmount: purchase.walletAppliedAmount.toString(),
      shortfall: shortfall.greaterThan(0) ? shortfall.toString() : "0",
      reason: purchase.resolutionReason,
      sourceBankTransaction: { id: purchase.bankTransaction.id, referenceNo: purchase.bankTransaction.referenceNo, date: purchase.bankTransaction.transactionDate },
      item: purchase.eventCodeChild,
      stockOnHand: purchase.eventCodeChild.itemSaleConfig?.stockOnHand ?? null,
      buyerVerified: Boolean(purchase.buyerMember && purchase.bankTransaction.memberIdentity?.verificationStatus === "VERIFIED")
    };
  });
  return {
    summary: {
      totalOriginal: sum(funds, "originalAmount").toString(),
      totalSaleAllocated: sum(activeFunds, "allocatedSaleAmount").toString(),
      totalUnallocated: sum(activeFunds, "unallocatedAmount").toString(),
      totalOtherAllocated: sum(activeFunds, "otherAllocatedAmount").toString(),
      suspenseUnallocated: sum(activeFunds.filter(fund => fund.ownershipStatus === "SUSPENSE"), "unallocatedAmount").toString(),
      memberUnallocated: sum(activeFunds.filter(fund => fund.ownershipStatus === "ATTRIBUTED"), "unallocatedAmount").toString(),
      pendingCount: pending.length,
      pendingStockCount: pendingPurchases.filter(row => row.status === "PENDING_STOCK").length,
      pendingBuyerCount: pendingPurchases.filter(row => row.status === "PENDING_BUYER").length
    },
    funds: funds.map(fund => ({
      id: fund.id, status: fund.status, ownershipStatus: fund.ownershipStatus,
      originalAmount: fund.originalAmount.toString(), allocatedSaleAmount: fund.allocatedSaleAmount.toString(),
      otherAllocatedAmount: fund.otherAllocatedAmount.toString(), unallocatedAmount: fund.unallocatedAmount.toString(),
      ownerMember: fund.ownerMember, purchase: fund.purchase ? { ...fund.purchase, totalAmount: fund.purchase.totalAmount.toString(), paymentAmountSnapshot: fund.purchase.paymentAmountSnapshot?.toString() ?? null, walletAppliedAmount: fund.purchase.walletAppliedAmount.toString() } : null,
      bankTransaction: { ...fund.bankTransaction, originalAmount: fund.bankTransaction.originalAmount.toString() },
      entries: fund.entries.map(entry => ({ id: entry.id, entryType: entry.entryType, amountDelta: entry.amountDelta.toString(), balanceAfter: entry.balanceAfter.toString(), reason: entry.reason, createdAt: entry.createdAt, createdBy: entry.createdBy })),
      allocations: fund.allocations.map(allocation => ({ id: allocation.id, amount: allocation.amount.toString(), status: allocation.status, reason: allocation.reason, createdAt: allocation.createdAt, createdBy: allocation.createdBy, reversedAt: allocation.reversedAt, reversedBy: allocation.reversedBy, reversalReason: allocation.reversalReason, purchase: allocation.purchase ? { ...allocation.purchase, totalAmount: allocation.purchase.totalAmount.toString() } : null }))
    })),
    members: [...memberMap.values()].map(member => ({ ...member, walletBalance: member.walletBalance.toString() })).sort((a, b) => b.walletBalance.localeCompare(a.walletBalance)),
    pendingPurchases: pending
  };
}

export async function getItemSaleWalletFund(fundId: string) {
  const wallet = await getItemSaleWalletSummary();
  const fund = wallet.funds.find(item => item.id === fundId);
  if (!fund) throw new HttpError(404, "ITEM_SALE wallet fund not found");
  return fund;
}

export async function getItemSaleConfig(childId: string) {
  const child = await prisma.eventCodeChild.findUnique({ where: { id: childId }, select: {
    id: true, childCode: true, childName: true, activeFlag: true,
    eventCode: { select: { id: true, code: true, eventName: true, eventType: true, activeFlag: true } },
    itemSaleConfig: { select: { unitPrice: true, stockOnHand: true, version: true, createdAt: true, updatedAt: true,
      createdBy: { select: { id: true, fullName: true } }, updatedBy: { select: { id: true, fullName: true } } } },
    itemSaleInventoryMovements: { take: 100, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: {
      id: true, movementType: true, quantityDelta: true, stockBefore: true, stockAfter: true, sourceReference: true,
      reversalOfMovementId: true, reason: true, createdAt: true, createdBy: { select: { id: true, fullName: true } }
    } }
  } });
  if (!child) throw new HttpError(404, "Item Child not found");
  if (child.eventCode.eventType !== "ITEM_SALE") throw new HttpError(400, "Physical inventory is only available for ITEM_SALE children");
  return { ...child, itemSaleConfig: child.itemSaleConfig ? { ...child.itemSaleConfig, unitPrice: child.itemSaleConfig.unitPrice.toString() } : null };
}

async function requireItemChild(tx: Tx, childId: string) {
  const child = await tx.eventCodeChild.findUnique({ where: { id: childId }, select: { id: true, childCode: true, childName: true, activeFlag: true,
    eventCode: { select: { id: true, code: true, eventType: true, activeFlag: true } }, itemSaleConfig: true } });
  if (!child) throw new HttpError(404, "Item Child not found");
  if (child.eventCode.eventType !== "ITEM_SALE") throw new HttpError(400, "This Child does not belong to an ITEM_SALE Event Code");
  if (!child.eventCode.activeFlag || !child.activeFlag) throw new HttpError(409, "Inactive ITEM_SALE items cannot receive new inventory changes");
  return child;
}

export function configureItemSale(childId: string, input: ConfigureItemSaleInput, userId: string) {
  return memberTransaction(async tx => {
    const child = await requireItemChild(tx, childId);
    if (child.itemSaleConfig) throw new HttpError(409, "ITEM_SALE configuration already exists. Use price or stock adjustment actions.");
    const duplicate = await tx.itemSaleInventoryMovement.findUnique({ where: { idempotencyKey: input.idempotencyKey }, select: { eventCodeChildId: true } });
    if (duplicate) throw new HttpError(409, "This opening-stock request was already used");
    const config = await tx.itemSaleConfig.create({ data: { eventCodeChildId: child.id, unitPrice: decimal(input.unitPrice), stockOnHand: input.openingStock,
      createdById: userId, updatedById: userId } });
    await tx.itemSaleInventoryMovement.create({ data: { id: randomUUID(), eventCodeChildId: child.id, movementType: "OPENING_STOCK",
      quantityDelta: input.openingStock, stockBefore: 0, stockAfter: input.openingStock, sourceReference: `ITEM:${child.id}`,
      idempotencyKey: input.idempotencyKey, reason: input.reason, createdById: userId } });
    await audit(tx, { entityType: "ITEM_CONFIG", entityId: child.id, action: "CONFIGURED", after: {
      unitPrice: config.unitPrice.toString(), stockOnHand: config.stockOnHand, version: config.version
    }, reason: input.reason, userId });
    return getItemSaleConfigRecord(tx, child.id);
  });
}

async function getItemSaleConfigRecord(tx: Tx, childId: string) {
  const config = await tx.itemSaleConfig.findUniqueOrThrow({ where: { eventCodeChildId: childId }, select: { eventCodeChildId: true, unitPrice: true, stockOnHand: true, version: true, createdAt: true, updatedAt: true } });
  return { ...config, unitPrice: config.unitPrice.toString() };
}

export function updateItemSalePrice(childId: string, input: UpdateItemSalePriceInput, userId: string) {
  return memberTransaction(async tx => {
    const child = await requireItemChild(tx, childId);
    const current = child.itemSaleConfig;
    if (!current) throw new HttpError(409, "Configure this ITEM_SALE item before changing its price");
    const unresolved = await tx.itemSalePurchase.findFirst({ where: { eventCodeChildId: child.id, status: { in: pendingStatuses } }, select: { id: true } });
    if (unresolved) throw new HttpError(409, "Resolve pending purchases before changing the item price. Their protected price snapshot must not become ambiguous.");
    const result = await tx.itemSaleConfig.updateMany({ where: { eventCodeChildId: child.id, version: input.expectedVersion }, data: {
      unitPrice: decimal(input.unitPrice), version: { increment: 1 }, updatedById: userId
    } });
    if (result.count !== 1) throw new HttpError(409, "Item price configuration changed. Reload before retrying.");
    const next = await tx.itemSaleConfig.findUniqueOrThrow({ where: { eventCodeChildId: child.id } });
    await audit(tx, { entityType: "ITEM_CONFIG", entityId: child.id, action: "PRICE_CHANGED",
      before: { unitPrice: current.unitPrice.toString(), version: current.version }, after: { unitPrice: next.unitPrice.toString(), version: next.version },
      reason: input.reason, userId });
    return { ...next, unitPrice: next.unitPrice.toString() };
  });
}

export function adjustItemSaleStock(childId: string, input: AdjustItemSaleStockInput, userId: string) {
  return memberTransaction(async tx => {
    await tx.$queryRaw(Prisma.sql`SELECT event_code_child_id FROM arya_event_code_child
      WHERE event_code_child_id = ${childId} FOR UPDATE`);
    const child = await requireItemChild(tx, childId);
    const current = child.itemSaleConfig;
    if (!current) throw new HttpError(409, "Configure this ITEM_SALE item before adjusting stock");
    const duplicate = await tx.itemSaleInventoryMovement.findUnique({ where: { idempotencyKey: input.idempotencyKey }, select: {
      eventCodeChildId: true, movementType: true, quantityDelta: true, sourceReference: true, reason: true
    } });
    if (duplicate) {
      if (duplicate.eventCodeChildId !== child.id) throw new HttpError(409, "Idempotency key belongs to another item");
      const sameRequest = duplicate.movementType === input.movementType
        && duplicate.quantityDelta === input.quantityDelta
        && duplicate.sourceReference === `ITEM:${child.id}`
        && duplicate.reason.trim() === input.reason.trim();
      if (!sameRequest) throw new HttpError(409, "Idempotency key was already used for a different stock adjustment");
      return getItemSaleConfigRecord(tx, child.id);
    }
    const stockAfter = current.stockOnHand + input.quantityDelta;
    if (stockAfter < 0) throw new HttpError(409, `Stock adjustment would make stock negative. Current stock is ${current.stockOnHand}.`);
    const updated = await tx.itemSaleConfig.updateMany({ where: { eventCodeChildId: child.id, version: input.expectedVersion,
      ...(input.quantityDelta < 0 ? { stockOnHand: { gte: -input.quantityDelta } } : {}) }, data: {
      stockOnHand: { increment: input.quantityDelta }, version: { increment: 1 }, updatedById: userId
    } });
    if (updated.count !== 1) throw new HttpError(409, "Item stock changed or is insufficient. Reload before retrying.");
    await tx.itemSaleInventoryMovement.create({ data: { id: randomUUID(), eventCodeChildId: child.id, movementType: input.movementType,
      quantityDelta: input.quantityDelta, stockBefore: current.stockOnHand, stockAfter, sourceReference: `ITEM:${child.id}`,
      idempotencyKey: input.idempotencyKey, reason: input.reason, createdById: userId } });
    await audit(tx, { entityType: "ITEM_CONFIG", entityId: child.id, action: input.movementType,
      before: { stockOnHand: current.stockOnHand, version: current.version }, after: { stockOnHand: stockAfter, version: current.version + 1 }, reason: input.reason, userId });
    return getItemSaleConfigRecord(tx, child.id);
  });
}

export async function stageRawItemSalePurchase(tx: Tx, input: { transactionId: string; quantity: number | null; userId: string; reason: string }) {
  const transaction = await tx.bankTransaction.findUnique({ where: { id: input.transactionId }, select: {
    id: true, status: true, eventCodeId: true, eventCodeChildId: true, baseAmount: true, originalAmount: true, memberIdentityId: true,
    eventCode: { select: { eventType: true } }, eventCodeChild: { select: { activeFlag: true, itemSaleConfig: true } },
    itemSalePurchase: true, memberIdentity: { select: { memberId: true, verificationStatus: true } }
  } });
  if (!transaction) throw new HttpError(404, "Bank transaction not found");
  const current = transaction.itemSalePurchase;
  const isSale = transaction.eventCode?.eventType === "ITEM_SALE";
  if (!isSale) {
    if (input.quantity !== null) throw new HttpError(400, "Item quantity is only valid for ITEM_SALE");
    if (current && current.status !== "CONFIRMED" && current.status !== "REVERSED") {
      await tx.itemSalePurchase.update({ where: { id: current.id }, data: { status: "VOIDED", resolutionReason: input.reason, version: { increment: 1 }, updatedById: input.userId } });
      await audit(tx, { entityType: "PURCHASE", entityId: current.id, action: "DRAFT_VOIDED", before: purchaseJson(current), reason: input.reason, userId: input.userId });
    }
    return null;
  }
  if (!transaction.eventCodeId || !transaction.eventCodeChildId) throw new HttpError(400, "ITEM_SALE requires an active Child item");
  if (!input.quantity || input.quantity <= 0) throw new HttpError(400, "ITEM_SALE quantity must be a positive integer");
  const config = transaction.eventCodeChild?.itemSaleConfig;
  if (!transaction.eventCodeChild?.activeFlag || !config) throw new HttpError(409, "The selected ITEM_SALE Child is inactive or has no price/stock configuration");
  const total = config.unitPrice.mul(input.quantity);
  const exact = transaction.originalAmount.greaterThanOrEqualTo(total);
  const buyerMemberId = transaction.memberIdentity?.verificationStatus === "VERIFIED" ? transaction.memberIdentity.memberId : null;
  const status = exact ? "DRAFT" : "REVIEW_REQUIRED";
  const reason = exact ? null : `Payment amount does not match ${input.quantity} × configured item price.`;
  if (current?.status === "CONFIRMED") throw new HttpError(409, "A confirmed purchase can only be changed through Edit Income approval");
  const data = { eventCodeId: transaction.eventCodeId, eventCodeChildId: transaction.eventCodeChildId, memberIdentityId: transaction.memberIdentityId,
    buyerMemberId, quantity: input.quantity, unitPriceSnapshot: config.unitPrice, totalAmount: total, paymentAmountSnapshot: transaction.originalAmount,
    status, resolutionReason: reason, updatedById: input.userId };
  const purchase = current
    ? await tx.itemSalePurchase.update({ where: { id: current.id }, data: { ...data, version: { increment: 1 } } })
    : await tx.itemSalePurchase.create({ data: { id: randomUUID(), bankTransactionId: transaction.id, ...data, createdById: input.userId } });
  await audit(tx, { entityType: "PURCHASE", entityId: purchase.id, action: current ? "DRAFT_UPDATED" : "DRAFT_CREATED",
    before: current ? purchaseJson(current) : undefined, after: purchaseJson(purchase), reason: input.reason, userId: input.userId });
  return purchase;
}

export async function assertStatementItemSalesReady(tx: Tx, transactionIds: string[]) {
  const rows = await tx.bankTransaction.findMany({ where: { id: { in: transactionIds }, eventCode: { is: { eventType: "ITEM_SALE" } } }, select: {
    id: true, eventCodeChildId: true, itemSalePurchase: { select: { id: true, quantity: true } }, eventCodeChild: { select: { activeFlag: true, itemSaleConfig: { select: { unitPrice: true } } } }
  } });
  const invalid = rows.find(row => !row.eventCodeChildId || !row.eventCodeChild?.activeFlag || !row.eventCodeChild.itemSaleConfig || !row.itemSalePurchase || row.itemSalePurchase.quantity <= 0);
  if (invalid) throw new HttpError(400, "Every ITEM_SALE transaction requires an active configured item and explicit positive quantity before Execute.");
}

export function assertConfirmedItemSaleUnchanged(
  purchase: { status: string; eventCodeChildId: string; quantity: number } | null | undefined,
  target: { childId: string | null; quantity: number | null } | null
) {
  if (purchase?.status === "CONFIRMED" &&
    (!target || target.childId !== purchase.eventCodeChildId || target.quantity !== purchase.quantity)) {
    throw new HttpError(409, "Confirmed ITEM_SALE cannot be reversed or changed without a verified physical return through an authorized workflow.");
  }
}

export async function assertIdentityHasNoActiveItemSaleFunding(tx: Tx, identityId: string) {
  // Runs inside the same serializable transaction as the identity update.
  // The allocation transaction also reads both endpoints before writing.
  const allocation = await tx.itemSaleFundAllocation.findFirst({ where: {
    status: "ACTIVE",
    OR: [
      { sourceFund: { bankTransaction: { memberIdentityId: identityId } } },
      { purchase: { memberIdentityId: identityId } },
      { purchase: { bankTransaction: { memberIdentityId: identityId } } }
    ]
  }, select: { id: true } });
  if (allocation) throw new HttpError(409, "Resolve active incoming and outgoing ITEM_SALE wallet allocations before moving or unlinking this identity.");
}

export async function synchronizeItemSaleTransaction(tx: Tx, transactionId: string, userId: string, options: { quantity?: number | null; reason?: string; strict?: boolean } = {}) {
  const row = await tx.bankTransaction.findUnique({ where: { id: transactionId }, select: {
    id: true, status: true, originalAmount: true, baseAmount: true, eventCodeId: true, eventCodeChildId: true, memberIdentityId: true, reconciliationExcludedAt: true,
    eventCode: { select: { eventType: true } }, eventCodeChild: { select: { activeFlag: true, itemSaleConfig: true } },
    memberIdentity: { select: { memberId: true, verificationStatus: true } }, itemSalePurchase: true
  } });
  if (!row) throw new HttpError(404, "Bank transaction not found");
  const reason = options.reason ?? "Synchronize approved ITEM_SALE classification";
  const withFund = async <T>(value: T) => {
    await synchronizeItemSaleFund(tx, transactionId, userId, reason);
    return value;
  };
  let current = row.itemSalePurchase;
  const targetSale = row.status === "FINALIZED" && !row.reconciliationExcludedAt && row.originalAmount.greaterThan(0) && row.eventCode?.eventType === "ITEM_SALE";
  if (!targetSale) {
    if (!current) return withFund(null);
    assertConfirmedItemSaleUnchanged(current, null);
    if (current.walletAppliedAmount.greaterThan(0)) {
      await releasePurchaseWalletAllocations(tx, current.id, userId, `Purchase reversed: ${reason}`);
    }
    if (current.status !== "REVERSED" && current.status !== "VOIDED") {
      const nextStatus = "VOIDED";
      const next = await tx.itemSalePurchase.update({ where: { id: current.id }, data: { status: nextStatus, resolutionReason: reason,
        version: { increment: 1 }, updatedById: userId } });
      await audit(tx, { entityType: "PURCHASE", entityId: current.id, action: nextStatus, before: purchaseJson(current), after: purchaseJson(next), reason, userId });
      return withFund(next);
    }
    return withFund(current);
  }
  if (!row.eventCodeId || !row.eventCodeChildId || !row.eventCodeChild?.activeFlag || !row.eventCodeChild.itemSaleConfig) {
    if (options.strict) throw new HttpError(409, "ITEM_SALE item is inactive or no longer configured");
    return withFund(current);
  }
  const desiredQuantity = options.quantity ?? current?.quantity ?? null;
  if (!desiredQuantity || desiredQuantity <= 0) {
    if (options.strict) throw new HttpError(409, "ITEM_SALE quantity is missing or invalid");
    return withFund(current);
  }
  assertConfirmedItemSaleUnchanged(current, { childId: row.eventCodeChildId, quantity: desiredQuantity });
  const buyerMemberId = row.memberIdentity?.verificationStatus === "VERIFIED" ? row.memberIdentity.memberId : null;
  if (current && current.buyerMemberId !== buyerMemberId) {
    const conflict = await tx.itemSaleFundAllocation.findFirst({ where: {
      purchaseId: current.id, status: "ACTIVE",
      ...(buyerMemberId ? { sourceFund: { is: { OR: [
        { ownerMemberId: null }, { ownerMemberId: { not: buyerMemberId } }, { ownershipStatus: { not: "ATTRIBUTED" } }
      ] } } } : {})
    }, select: { id: true } });
    if (conflict) throw new HttpError(409, "Resolve active ITEM_SALE wallet funding before changing the purchase buyer.");
  }
  const price = current?.eventCodeChildId === row.eventCodeChildId ? current.unitPriceSnapshot : row.eventCodeChild.itemSaleConfig.unitPrice;
  const total = price.mul(desiredQuantity);
  if (current && current.walletAppliedAmount.greaterThan(0)) {
    await reconcilePurchaseWalletApplication(tx, current.id, total, row.originalAmount, userId, reason);
    current = await tx.itemSalePurchase.findUniqueOrThrow({ where: { id: current.id } });
  }
  const walletApplied = current?.walletAppliedAmount ?? new Prisma.Decimal(0);
  const paymentMatches = row.originalAmount.plus(walletApplied).greaterThanOrEqualTo(total);
  if (current?.status === "CONFIRMED") {
    if (!paymentMatches) throw new HttpError(409, "Confirmed ITEM_SALE purchase no longer has full funding.");
    if (current.buyerMemberId !== buyerMemberId || current.memberIdentityId !== row.memberIdentityId) {
      const next = await tx.itemSalePurchase.update({ where: { id: current.id }, data: { buyerMemberId, memberIdentityId: row.memberIdentityId, version: { increment: 1 }, updatedById: userId } });
      return withFund(next);
    }
    return withFund(current);
  }
  if ((!paymentMatches || !buyerMemberId) && options.strict) {
    throw new HttpError(409, !paymentMatches ? "ITEM_SALE original bank amount plus wallet funding is lower than quantity x unit price" : "ITEM_SALE buyer identity must be VERIFIED before approval can change inventory");
  }
  if (!current) {
    current = await tx.itemSalePurchase.create({ data: { id: randomUUID(), bankTransactionId: row.id, eventCodeId: row.eventCodeId,
      eventCodeChildId: row.eventCodeChildId, memberIdentityId: row.memberIdentityId, buyerMemberId, quantity: desiredQuantity,
      unitPriceSnapshot: price, totalAmount: total, paymentAmountSnapshot: row.originalAmount, walletAppliedAmount: 0,
      status: !paymentMatches ? "REVIEW_REQUIRED" : buyerMemberId ? "DRAFT" : "PENDING_BUYER",
      resolutionReason: !paymentMatches ? "Payment amount does not match purchase total." : buyerMemberId ? null : "Buyer identity is not VERIFIED.",
      createdById: userId, updatedById: userId } });
  }
  if (!paymentMatches || !buyerMemberId) {
    const status = paymentMatches ? "PENDING_BUYER" : "REVIEW_REQUIRED";
    const next = await tx.itemSalePurchase.update({ where: { id: current.id }, data: { eventCodeId: row.eventCodeId, eventCodeChildId: row.eventCodeChildId,
      memberIdentityId: row.memberIdentityId, buyerMemberId, quantity: desiredQuantity, unitPriceSnapshot: price, totalAmount: total,
      paymentAmountSnapshot: row.originalAmount, status, resolutionReason: paymentMatches ? "Buyer identity is not VERIFIED." : "Original bank amount plus wallet funding is lower than purchase total.",
      version: { increment: 1 }, updatedById: userId } });
    return withFund(next);
  }
  const config = await tx.itemSaleConfig.findUniqueOrThrow({ where: { eventCodeChildId: row.eventCodeChildId } });
  const stock = await tx.itemSaleConfig.updateMany({ where: { eventCodeChildId: config.eventCodeChildId, version: config.version, stockOnHand: { gte: desiredQuantity } }, data: {
    stockOnHand: { decrement: desiredQuantity }, version: { increment: 1 }, updatedById: userId
  } });
  if (stock.count !== 1) {
    if (options.strict) throw new HttpError(409, `Insufficient or concurrently changed stock for ITEM_SALE quantity ${desiredQuantity}`);
    const pending = await tx.itemSalePurchase.update({ where: { id: current.id }, data: { status: "PENDING_STOCK", resolutionReason: "Stock is insufficient or changed concurrently.",
      version: { increment: 1 }, updatedById: userId } });
    return withFund(pending);
  }
  const nextVersion = current.version + 1;
  await tx.itemSaleInventoryMovement.create({ data: { id: randomUUID(), eventCodeChildId: row.eventCodeChildId, purchaseId: current.id,
    movementType: "SALE", quantityDelta: -desiredQuantity, stockBefore: config.stockOnHand, stockAfter: config.stockOnHand - desiredQuantity,
    sourceReference: row.id, idempotencyKey: `SALE:${current.id}:${nextVersion}`, reason, createdById: userId } });
  const next = await tx.itemSalePurchase.update({ where: { id: current.id }, data: { eventCodeId: row.eventCodeId, eventCodeChildId: row.eventCodeChildId,
    memberIdentityId: row.memberIdentityId, buyerMemberId, quantity: desiredQuantity, unitPriceSnapshot: price, totalAmount: total,
    paymentAmountSnapshot: row.originalAmount, status: "CONFIRMED", resolutionReason: null, confirmedAt: new Date(), confirmedById: userId,
    reversedAt: null, reversedById: null, version: { increment: 1 }, updatedById: userId } });
  await audit(tx, { entityType: "PURCHASE", entityId: current.id, action: "CONFIRMED",
    before: purchaseJson(current), after: purchaseJson(next), reason, userId });
  return withFund(next);
}

export async function assertCorrectionItemSaleValid(tx: Tx, items: Array<{ action: string; bankTransactionId: string | null; proposedEventCodeId: string | null; proposedEventCodeChildId: string | null; proposedItemSaleQuantity: number | null; manualOriginalAmount: Prisma.Decimal | null; bankTransaction: { id: string; baseAmount?: Prisma.Decimal | null; originalAmount: Prisma.Decimal; itemSalePurchase?: { id: string; status: string; eventCodeChildId: string; quantity: number; unitPriceSnapshot: Prisma.Decimal; walletAppliedAmount?: Prisma.Decimal } | null } | null }>) {
  for (const item of items) {
    const purchase = item.bankTransaction?.itemSalePurchase;
    assertConfirmedItemSaleUnchanged(purchase, item.action === "EXCLUDED" ? null : {
      childId: item.proposedEventCodeChildId, quantity: item.proposedItemSaleQuantity
    });
    if (item.action === "EXCLUDED") continue;
    const eventId = item.proposedEventCodeId;
    const event = eventId ? await tx.eventCode.findUnique({ where: { id: eventId }, select: { eventType: true } }) : null;
    if (event?.eventType !== "ITEM_SALE") continue;
    if (!item.proposedEventCodeChildId || !item.proposedItemSaleQuantity || item.proposedItemSaleQuantity <= 0) throw new HttpError(409, "ITEM_SALE correction requires an item and positive quantity");
    const child = await tx.eventCodeChild.findUnique({ where: { id: item.proposedEventCodeChildId }, select: { id: true, eventCodeId: true, activeFlag: true, itemSaleConfig: true } });
    if (!child || child.eventCodeId !== eventId || !child.activeFlag || !child.itemSaleConfig) throw new HttpError(409, "Proposed ITEM_SALE item is inactive, belongs to another parent, or is not configured");
    const applicableUnitPrice = purchase?.eventCodeChildId === child.id
      ? purchase.unitPriceSnapshot
      : child.itemSaleConfig.unitPrice;
    const total = applicableUnitPrice.mul(item.proposedItemSaleQuantity);
    const payment = item.action === "ADDED"
      ? item.manualOriginalAmount
      : item.bankTransaction?.originalAmount.plus(purchase?.walletAppliedAmount ?? new Prisma.Decimal(0));
    if (item.action === "ADDED" && (!payment || !payment.greaterThan(0))) throw new HttpError(409, "A manual ITEM_SALE addition must be a positive incoming amount");
    if (!payment?.greaterThanOrEqualTo(total)) throw new HttpError(409, "Proposed ITEM_SALE quantity x applicable unit price cannot exceed the original bank amount plus wallet funding");
    if (purchase?.status !== "CONFIRMED" && child.itemSaleConfig.stockOnHand < item.proposedItemSaleQuantity) throw new HttpError(409, "Proposed ITEM_SALE item has insufficient stock");
  }
}

export function retryItemSalePurchase(transactionId: string, userId: string) {
  return memberTransaction(tx => synchronizeItemSaleTransaction(tx, transactionId, userId, { reason: "Authorized ITEM_SALE purchase retry" }));
}

export async function synchronizePendingItemSalesForMember(tx: Tx, memberId: string, userId: string) {
  const rows = await tx.bankTransaction.findMany({ where: { status: "FINALIZED", memberIdentity: { is: { memberId, verificationStatus: "VERIFIED" } },
    eventCode: { is: { eventType: "ITEM_SALE" } }, itemSalePurchase: { is: { status: { in: pendingStatuses } } } }, select: { id: true } });
  for (const row of rows) await synchronizeItemSaleTransaction(tx, row.id, userId, { reason: "Buyer identity verified" });
}
