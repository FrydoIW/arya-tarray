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
async function audit(tx: Tx, input: { entityType: "ITEM_CONFIG" | "PURCHASE"; entityId: string; action: string; before?: Prisma.InputJsonValue; after?: Prisma.InputJsonValue; reason: string; userId: string }) {
  await tx.itemSaleAudit.create({ data: { id: randomUUID(), entityType: input.entityType, entityId: input.entityId, action: input.action,
    beforeData: input.before ?? Prisma.JsonNull, afterData: input.after ?? Prisma.JsonNull, reason: input.reason, actionById: input.userId } });
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
    const child = await requireItemChild(tx, childId);
    const current = child.itemSaleConfig;
    if (!current) throw new HttpError(409, "Configure this ITEM_SALE item before adjusting stock");
    const duplicate = await tx.itemSaleInventoryMovement.findUnique({ where: { idempotencyKey: input.idempotencyKey }, select: { id: true, eventCodeChildId: true } });
    if (duplicate) {
      if (duplicate.eventCodeChildId !== child.id) throw new HttpError(409, "Idempotency key belongs to another item");
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
    id: true, status: true, eventCodeId: true, eventCodeChildId: true, baseAmount: true, memberIdentityId: true,
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
  const exact = transaction.baseAmount ? transaction.baseAmount.equals(total) : false;
  const buyerMemberId = transaction.memberIdentity?.verificationStatus === "VERIFIED" ? transaction.memberIdentity.memberId : null;
  const status = exact ? "DRAFT" : "REVIEW_REQUIRED";
  const reason = exact ? null : `Payment amount does not match ${input.quantity} × configured item price.`;
  if (current?.status === "CONFIRMED") throw new HttpError(409, "A confirmed purchase can only be changed through Edit Income approval");
  const data = { eventCodeId: transaction.eventCodeId, eventCodeChildId: transaction.eventCodeChildId, memberIdentityId: transaction.memberIdentityId,
    buyerMemberId, quantity: input.quantity, unitPriceSnapshot: config.unitPrice, totalAmount: total, paymentAmountSnapshot: transaction.baseAmount,
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

async function reverseConfirmedPurchase(tx: Tx, purchase: Prisma.ItemSalePurchaseGetPayload<{}>, userId: string, reason: string) {
  const sale = await tx.itemSaleInventoryMovement.findFirst({ where: { purchaseId: purchase.id, movementType: "SALE", reversalMovement: null }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  if (!sale) throw new HttpError(409, "Confirmed purchase has no reversible SALE movement. No inventory change was applied.");
  const existing = await tx.itemSaleInventoryMovement.findUnique({ where: { reversalOfMovementId: sale.id } });
  if (existing) return existing;
  const config = await tx.itemSaleConfig.findUnique({ where: { eventCodeChildId: sale.eventCodeChildId } });
  if (!config) throw new HttpError(409, "Historical item configuration is missing. No inventory reversal was applied.");
  const quantity = -sale.quantityDelta;
  const updated = await tx.itemSaleConfig.updateMany({ where: { eventCodeChildId: config.eventCodeChildId, version: config.version }, data: {
    stockOnHand: { increment: quantity }, version: { increment: 1 }, updatedById: userId
  } });
  if (updated.count !== 1) throw new HttpError(409, "Item stock changed while reversing this sale. Retry the approval action.");
  return tx.itemSaleInventoryMovement.create({ data: { id: randomUUID(), eventCodeChildId: sale.eventCodeChildId, purchaseId: purchase.id,
    movementType: "SALE_REVERSAL", quantityDelta: quantity, stockBefore: config.stockOnHand, stockAfter: config.stockOnHand + quantity,
    sourceReference: purchase.bankTransactionId, idempotencyKey: `SALE_REVERSAL:${sale.id}`, reversalOfMovementId: sale.id, reason, createdById: userId } });
}

export async function synchronizeItemSaleTransaction(tx: Tx, transactionId: string, userId: string, options: { quantity?: number | null; reason?: string; strict?: boolean } = {}) {
  const row = await tx.bankTransaction.findUnique({ where: { id: transactionId }, select: {
    id: true, status: true, originalAmount: true, baseAmount: true, eventCodeId: true, eventCodeChildId: true, memberIdentityId: true, reconciliationExcludedAt: true,
    eventCode: { select: { eventType: true } }, eventCodeChild: { select: { activeFlag: true, itemSaleConfig: true } },
    memberIdentity: { select: { memberId: true, verificationStatus: true } }, itemSalePurchase: true
  } });
  if (!row) throw new HttpError(404, "Bank transaction not found");
  const reason = options.reason ?? "Synchronize approved ITEM_SALE classification";
  let current = row.itemSalePurchase;
  const targetSale = row.status === "FINALIZED" && !row.reconciliationExcludedAt && row.originalAmount.greaterThan(0) && row.eventCode?.eventType === "ITEM_SALE";
  if (!targetSale) {
    if (!current) return null;
    if (current.status === "CONFIRMED") await reverseConfirmedPurchase(tx, current, userId, reason);
    if (current.status !== "REVERSED" && current.status !== "VOIDED") {
      const nextStatus = current.status === "CONFIRMED" ? "REVERSED" : "VOIDED";
      const next = await tx.itemSalePurchase.update({ where: { id: current.id }, data: { status: nextStatus, resolutionReason: reason,
        reversedAt: current.status === "CONFIRMED" ? new Date() : null, reversedById: current.status === "CONFIRMED" ? userId : null,
        version: { increment: 1 }, updatedById: userId } });
      await audit(tx, { entityType: "PURCHASE", entityId: current.id, action: nextStatus, before: purchaseJson(current), after: purchaseJson(next), reason, userId });
      return next;
    }
    return current;
  }
  if (!row.eventCodeId || !row.eventCodeChildId || !row.eventCodeChild?.activeFlag || !row.eventCodeChild.itemSaleConfig) {
    if (options.strict) throw new HttpError(409, "ITEM_SALE item is inactive or no longer configured");
    return current;
  }
  const desiredQuantity = options.quantity ?? current?.quantity ?? null;
  if (!desiredQuantity || desiredQuantity <= 0) {
    if (options.strict) throw new HttpError(409, "ITEM_SALE quantity is missing or invalid");
    return current;
  }
  const changing = Boolean(current?.status === "CONFIRMED" && (current.eventCodeChildId !== row.eventCodeChildId || current.quantity !== desiredQuantity));
  const price = current && !changing && current.eventCodeChildId === row.eventCodeChildId ? current.unitPriceSnapshot : row.eventCodeChild.itemSaleConfig.unitPrice;
  const total = price.mul(desiredQuantity);
  const buyerMemberId = row.memberIdentity?.verificationStatus === "VERIFIED" ? row.memberIdentity.memberId : null;
  const paymentMatches = Boolean(row.baseAmount?.equals(total));
  if (current?.status === "CONFIRMED" && !changing) {
    if (current.buyerMemberId !== buyerMemberId || current.memberIdentityId !== row.memberIdentityId) {
      return tx.itemSalePurchase.update({ where: { id: current.id }, data: { buyerMemberId, memberIdentityId: row.memberIdentityId, version: { increment: 1 }, updatedById: userId } });
    }
    return current;
  }
  if ((!paymentMatches || !buyerMemberId) && options.strict) {
    throw new HttpError(409, !paymentMatches ? "ITEM_SALE payment amount does not match quantity × unit price" : "ITEM_SALE buyer identity must be VERIFIED before approval can change inventory");
  }
  if (!current) {
    current = await tx.itemSalePurchase.create({ data: { id: randomUUID(), bankTransactionId: row.id, eventCodeId: row.eventCodeId,
      eventCodeChildId: row.eventCodeChildId, memberIdentityId: row.memberIdentityId, buyerMemberId, quantity: desiredQuantity,
      unitPriceSnapshot: price, totalAmount: total, paymentAmountSnapshot: row.baseAmount,
      status: !paymentMatches ? "REVIEW_REQUIRED" : buyerMemberId ? "DRAFT" : "PENDING_BUYER",
      resolutionReason: !paymentMatches ? "Payment amount does not match purchase total." : buyerMemberId ? null : "Buyer identity is not VERIFIED.",
      createdById: userId, updatedById: userId } });
  }
  if (!paymentMatches || !buyerMemberId) {
    const status = paymentMatches ? "PENDING_BUYER" : "REVIEW_REQUIRED";
    const next = await tx.itemSalePurchase.update({ where: { id: current.id }, data: { eventCodeId: row.eventCodeId, eventCodeChildId: row.eventCodeChildId,
      memberIdentityId: row.memberIdentityId, buyerMemberId, quantity: desiredQuantity, unitPriceSnapshot: price, totalAmount: total,
      paymentAmountSnapshot: row.baseAmount, status, resolutionReason: paymentMatches ? "Buyer identity is not VERIFIED." : "Payment amount does not match purchase total.",
      version: { increment: 1 }, updatedById: userId } });
    return next;
  }
  if (current.status === "CONFIRMED") await reverseConfirmedPurchase(tx, current, userId, reason);
  const config = await tx.itemSaleConfig.findUniqueOrThrow({ where: { eventCodeChildId: row.eventCodeChildId } });
  const stock = await tx.itemSaleConfig.updateMany({ where: { eventCodeChildId: config.eventCodeChildId, version: config.version, stockOnHand: { gte: desiredQuantity } }, data: {
    stockOnHand: { decrement: desiredQuantity }, version: { increment: 1 }, updatedById: userId
  } });
  if (stock.count !== 1) {
    if (options.strict) throw new HttpError(409, `Insufficient or concurrently changed stock for ITEM_SALE quantity ${desiredQuantity}`);
    return tx.itemSalePurchase.update({ where: { id: current.id }, data: { status: "PENDING_STOCK", resolutionReason: "Stock is insufficient or changed concurrently.",
      version: { increment: 1 }, updatedById: userId } });
  }
  const nextVersion = current.version + 1;
  await tx.itemSaleInventoryMovement.create({ data: { id: randomUUID(), eventCodeChildId: row.eventCodeChildId, purchaseId: current.id,
    movementType: "SALE", quantityDelta: -desiredQuantity, stockBefore: config.stockOnHand, stockAfter: config.stockOnHand - desiredQuantity,
    sourceReference: row.id, idempotencyKey: `SALE:${current.id}:${nextVersion}`, reason, createdById: userId } });
  const next = await tx.itemSalePurchase.update({ where: { id: current.id }, data: { eventCodeId: row.eventCodeId, eventCodeChildId: row.eventCodeChildId,
    memberIdentityId: row.memberIdentityId, buyerMemberId, quantity: desiredQuantity, unitPriceSnapshot: price, totalAmount: total,
    paymentAmountSnapshot: row.baseAmount, status: "CONFIRMED", resolutionReason: null, confirmedAt: new Date(), confirmedById: userId,
    reversedAt: null, reversedById: null, version: { increment: 1 }, updatedById: userId } });
  await audit(tx, { entityType: "PURCHASE", entityId: current.id, action: changing ? "CORRECTED_AND_CONFIRMED" : "CONFIRMED",
    before: purchaseJson(current), after: purchaseJson(next), reason, userId });
  return next;
}

export async function assertCorrectionItemSaleValid(tx: Tx, items: Array<{ action: string; bankTransactionId: string | null; proposedEventCodeId: string | null; proposedEventCodeChildId: string | null; proposedItemSaleQuantity: number | null; manualOriginalAmount: Prisma.Decimal | null; bankTransaction: { id: string; baseAmount?: Prisma.Decimal | null; originalAmount: Prisma.Decimal; itemSalePurchase?: { id: string; status: string; eventCodeChildId: string; quantity: number; unitPriceSnapshot: Prisma.Decimal } | null } | null }>) {
  for (const item of items) {
    if (item.action === "EXCLUDED") continue;
    const eventId = item.proposedEventCodeId;
    const event = eventId ? await tx.eventCode.findUnique({ where: { id: eventId }, select: { eventType: true } }) : null;
    if (event?.eventType !== "ITEM_SALE") continue;
    if (!item.proposedEventCodeChildId || !item.proposedItemSaleQuantity || item.proposedItemSaleQuantity <= 0) throw new HttpError(409, "ITEM_SALE correction requires an item and positive quantity");
    const child = await tx.eventCodeChild.findUnique({ where: { id: item.proposedEventCodeChildId }, select: { id: true, eventCodeId: true, activeFlag: true, itemSaleConfig: true } });
    if (!child || child.eventCodeId !== eventId || !child.activeFlag || !child.itemSaleConfig) throw new HttpError(409, "Proposed ITEM_SALE item is inactive, belongs to another parent, or is not configured");
    const purchase = item.bankTransaction?.itemSalePurchase;
    const applicableUnitPrice = purchase?.eventCodeChildId === child.id
      ? purchase.unitPriceSnapshot
      : child.itemSaleConfig.unitPrice;
    const total = applicableUnitPrice.mul(item.proposedItemSaleQuantity);
    const payment = item.action === "ADDED" ? item.manualOriginalAmount : item.bankTransaction?.baseAmount;
    if (!payment?.equals(total)) throw new HttpError(409, "Proposed ITEM_SALE quantity × applicable unit price must equal the bank base amount");
    const returned = purchase?.status === "CONFIRMED" && purchase.eventCodeChildId === child.id ? purchase.quantity : 0;
    if (child.itemSaleConfig.stockOnHand + returned < item.proposedItemSaleQuantity) throw new HttpError(409, "Proposed ITEM_SALE item has insufficient stock");
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
