import type { ChildExecuteInput } from "./event-code-child.schema.js";
import { applyChildChangesAtomic, listChildOccupancy, listEventCodeChildren } from "./event-code-child.repository.js";

function toResponse(item: {
  id: string;
  eventCodeId: string;
  childCode: string;
  childName: string;
  description: string | null;
  displayOrder: number;
  activeFlag: boolean;
  capacity: number | null;
  unitAmount: { toString(): string } | null;
  durationMonths: number | null;
  createdAt: Date;
  updatedAt: Date;
  eventCode: { id: string; code: string; eventName: string; eventType: string; activeFlag: boolean };
  _count: { transactions: number; correctionItemsBefore: number; correctionItemsProposed: number };
  updatedBy: { id: string; fullName: string } | null;
}, occupied: number) {
  const configurationComplete = Boolean(
    item.capacity !== null && item.capacity > 0
    && item.durationMonths !== null && item.durationMonths > 0
    && item.unitAmount !== null
  );
  return {
    id: item.id,
    eventCodeId: item.eventCodeId,
    childCode: item.childCode,
    childName: item.childName,
    description: item.description,
    displayOrder: item.displayOrder,
    activeFlag: item.activeFlag,
    capacity: item.capacity,
    unitAmount: item.unitAmount ? item.unitAmount.toString() : null,
    durationMonths: item.durationMonths,
    occupiedSlots: occupied,
    availableSlots: item.capacity !== null ? Math.max(0, item.capacity - occupied) : null,
    configurationComplete,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    eventCode: item.eventCode,
    transactionCount: item._count.transactions,
    correctionCount: item._count.correctionItemsBefore + item._count.correctionItemsProposed,
    updatedBy: item.updatedBy
  };
}

export async function getChildSummaries() {
  const [items, occupancy] = await Promise.all([listEventCodeChildren(), listChildOccupancy()]);
  return items.map((item) => toResponse(item, occupancy.get(item.id) ?? 0));
}

export async function executeChildChanges(input: ChildExecuteInput, userId: string) {
  const items = await applyChildChangesAtomic({
    creates: input.creates,
    updates: input.updates,
    deletes: input.deletes,
    userId
  });
  const occupancy = await listChildOccupancy();
  return {
    changedCount: input.creates.length + input.updates.length + input.deletes.length,
    items: items.map((item) => toResponse(item, occupancy.get(item.id) ?? 0))
  };
}
