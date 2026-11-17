import { Prisma } from "@prisma/client";
import { currentBusinessDayValue } from "../../../lib/business-time.js";
import { HttpError } from "../../../lib/http.js";
import { decimalStringToCents } from "../../../lib/money.js";

type Tx = Prisma.TransactionClient;

export type ChildSubscriptionConfigView = {
  id: string;
  eventCodeId: string;
  childCode: string;
  childName: string;
  activeFlag: boolean;
  capacity: number | null;
  unitAmount: { toString(): string } | null;
  durationMonths: number | null;
};

/** A child is eligible for enrollment only with a complete, valid configuration. */
export function childConfigurationComplete(child: ChildSubscriptionConfigView) {
  return child.activeFlag
    && child.capacity !== null && child.capacity > 0
    && child.durationMonths !== null && child.durationMonths > 0
    && child.unitAmount !== null && decimalStringToCents(child.unitAmount.toString()) > 0n;
}

export function childUnitAmountCents(child: ChildSubscriptionConfigView) {
  if (!child.unitAmount) throw new HttpError(409, `Child ${child.childCode} has no configured unit amount.`);
  const cents = decimalStringToCents(child.unitAmount.toString());
  if (cents <= 0n) throw new HttpError(409, `Child ${child.childCode} unit amount is invalid.`);
  return cents;
}

export function businessDayUtcStart() {
  return new Date(`${currentBusinessDayValue()}T00:00:00.000Z`);
}

export function utcDay(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

/**
 * Slot ownership is enrollment, not financial entitlement: a subscription
 * occupies its child's slot while it is an active enrollment and has not yet
 * passed its coverage end. Expired entitlements release the slot for
 * availability math even though their records remain activeFlag=1.
 */
export function subscriptionOccupiesSlot(subscription: { activeFlag: boolean; validUntil: Date | null }, today: Date) {
  if (!subscription.activeFlag) return false;
  if (!subscription.validUntil) return true;
  return utcDay(subscription.validUntil).getTime() >= utcDay(today).getTime();
}

/** Serializes capacity math on one child row for the caller's transaction. */
export async function lockEventCodeChildForCapacity(tx: Tx, childId: string) {
  await tx.$queryRaw(Prisma.sql`SELECT event_code_child_id FROM arya_event_code_child
    WHERE event_code_child_id = ${childId} FOR UPDATE`);
}

export async function loadChildSubscriptionConfig(tx: Tx, childId: string): Promise<ChildSubscriptionConfigView | null> {
  const child = await tx.eventCodeChild.findUnique({
    where: { id: childId },
    select: {
      id: true, eventCodeId: true, childCode: true, childName: true, activeFlag: true,
      capacity: true, unitAmount: true, durationMonths: true,
      eventCode: { select: { eventType: true, activeFlag: true } }
    }
  });
  return child as unknown as ChildSubscriptionConfigView | null;
}

export async function countOccupiedChildSlots(tx: Tx, childId: string, today: Date, excludeSubscriptionId?: string) {
  const rows = await tx.memberEventSubscription.findMany({
    where: {
      eventCodeChildId: childId,
      activeFlag: true,
      ...(excludeSubscriptionId ? { id: { not: excludeSubscriptionId } } : {}),
      OR: [{ validUntil: null }, { validUntil: { gte: today } }]
    },
    select: { id: true }
  });
  return rows.length;
}

/**
 * Atomic slot availability check. Must run inside the caller's serializable
 * transaction AFTER lockEventCodeChildForCapacity. Never call as an unsafe
 * COUNT-then-INSERT pattern; the child row lock serializes enrollments.
 */
export async function assertChildSlotAvailable(tx: Tx, input: {
  childId: string;
  memberId: string;
  excludeSubscriptionId?: string;
}) {
  const result = await tryResolveChildSlot(tx, input);
  if (result.state === "CAPACITY_FULL") {
    throw new HttpError(409, `Slot ${result.child.childCode} sudah penuh (${result.occupied}/${result.child.capacity}). Tidak ada slot tersedia.`);
  }
  if (result.state === "NOT_CONFIGURED") {
    throw new HttpError(409, `Child ${result.child.childCode} belum memiliki konfigurasi lengkap (capacity, unit amount, duration). Lengkapi konfigurasi sebelum enrollment.`);
  }
  if (result.state === "INACTIVE") {
    throw new HttpError(409, `Child ${result.child.childCode} tidak menerima enrollment baru.`);
  }
  if (result.state === "MISSING") {
    throw new HttpError(404, "Subscription Child tidak ditemukan.");
  }
  return result;
}

export type ChildSlotResolution =
  | { state: "AVAILABLE"; child: ChildSubscriptionConfigView; occupied: number }
  | { state: "CAPACITY_FULL"; child: ChildSubscriptionConfigView; occupied: number }
  | { state: "NOT_CONFIGURED"; child: ChildSubscriptionConfigView; occupied: number }
  | { state: "INACTIVE"; child: ChildSubscriptionConfigView; occupied: number }
  | { state: "MISSING"; child: null; occupied: number };

/**
 * Non-throwing slot resolution used by automatic subscription creation during
 * TIME_BASED synchronization: capacity/config problems keep the payment
 * unresolved instead of failing an entire statement approval.
 */
export async function tryResolveChildSlot(tx: Tx, input: {
  childId: string;
  memberId: string;
  excludeSubscriptionId?: string;
}): Promise<ChildSlotResolution> {
  await lockEventCodeChildForCapacity(tx, input.childId);
  const child = await loadChildSubscriptionConfig(tx, input.childId);
  if (!child) return { state: "MISSING", child: null, occupied: 0 };
  if (!child.activeFlag) return { state: "INACTIVE", child, occupied: 0 };
  if (!childConfigurationComplete(child)) return { state: "NOT_CONFIGURED", child, occupied: 0 };
  const today = businessDayUtcStart();
  const occupied = await countOccupiedChildSlots(tx, child.id, today, input.excludeSubscriptionId);
  if (occupied >= child.capacity!) return { state: "CAPACITY_FULL", child, occupied };
  return { state: "AVAILABLE", child, occupied };
}
