import type { ChildExecuteInput } from "./event-code-child.schema.js";
import { applyChildChangesAtomic, listEventCodeChildren } from "./event-code-child.repository.js";

function toResponse(item: {
  id: string;
  eventCodeId: string;
  childCode: string;
  childName: string;
  description: string | null;
  displayOrder: number;
  activeFlag: boolean;
  createdAt: Date;
  updatedAt: Date;
  eventCode: { id: string; code: string; eventName: string; eventType: string; activeFlag: boolean };
  _count: { transactions: number; correctionItemsBefore: number; correctionItemsProposed: number };
  updatedBy: { id: string; fullName: string } | null;
}) {
  return {
    id: item.id,
    eventCodeId: item.eventCodeId,
    childCode: item.childCode,
    childName: item.childName,
    description: item.description,
    displayOrder: item.displayOrder,
    activeFlag: item.activeFlag,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    eventCode: item.eventCode,
    transactionCount: item._count.transactions,
    correctionCount: item._count.correctionItemsBefore + item._count.correctionItemsProposed,
    updatedBy: item.updatedBy
  };
}

export async function getChildSummaries() {
  const items = await listEventCodeChildren();
  return items.map(toResponse);
}

export async function executeChildChanges(input: ChildExecuteInput, userId: string) {
  const items = await applyChildChangesAtomic({
    creates: input.creates,
    updates: input.updates,
    deletes: input.deletes,
    userId
  });
  return {
    changedCount: input.creates.length + input.updates.length + input.deletes.length,
    items: items.map(toResponse)
  };
}
