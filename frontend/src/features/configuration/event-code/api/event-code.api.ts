import { apiFetch, apiFetchBlob } from "@/lib/api";
import type { CampaignInput, ChildInput, EventCampaign, EventCode, EventCodeBulkPreview, EventCodeChild, EventCodeExecutePayload, EventCodeUser, EventTimeRule, EventType, ItemSaleConfigDetail, ItemSaleWalletSummary, TimeRuleInput } from "../types";

type EventCodeApiUser = {
  id: string;
  fullName: string;
};

type EventCodeApiItem = {
  id: string;
  code: string;
  eventName: string;
  category: string | null;
  eventType?: EventType;
  description?: string | null;
  activeFlag: boolean;
  updatedAt?: string;
  updatedBy?: EventCodeApiUser | null;
};

type EventCodeExecuteResponse = {
  changedCount: number;
  items: EventCodeApiItem[];
};

function mapUser(user?: EventCodeApiUser | null): EventCodeUser | null {
  if (!user) return null;
  return {
    id: String(user.id),
    fullName: user.fullName
  };
}

function mapEventCode(item: EventCodeApiItem): EventCode {
  return {
    id: String(item.id),
    code: item.code,
    eventName: item.eventName,
    category: item.category ?? null,
    eventType: item.eventType ?? "STANDARD",
    description: item.description ?? null,
    activeFlag: item.activeFlag,
    updatedAt: item.updatedAt,
    updatedBy: mapUser(item.updatedBy)
  };
}

export function getCampaigns() {
  return apiFetch<EventCampaign[]>("/configuration/event-codes/campaigns");
}

export function executeCampaignChanges(payload: { creates: CampaignInput[]; updates: Array<{ id: string; input: CampaignInput }> }) {
  return apiFetch<{ changedCount: number; items: EventCampaign[] }>("/configuration/event-codes/campaigns/execute", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function getTimeRules() { return apiFetch<EventTimeRule[]>("/configuration/event-codes/time-rules"); }
export function executeTimeRules(payload: { updates: Array<{ eventCodeId: string; input: TimeRuleInput }> }) {
  return apiFetch<EventTimeRule[]>("/configuration/event-codes/time-rules/execute", { method: "POST", body: JSON.stringify(payload) });
}

export function getEventCodeChildren() {
  return apiFetch<EventCodeChild[]>("/configuration/event-codes/children");
}

export function executeChildChanges(payload: {
  creates: ChildInput[];
  updates: Array<{ id: string; input: ChildInput }>;
  deletes: string[];
}) {
  return apiFetch<{ changedCount: number; items: EventCodeChild[] }>("/configuration/event-codes/children/execute", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function getItemSaleConfig(childId: string) {
  return apiFetch<ItemSaleConfigDetail>(`/configuration/event-codes/children/${childId}/item-sale`);
}
export function configureItemSale(childId: string, payload: { unitPrice: string; openingStock: number; reason: string; idempotencyKey: string }) {
  return apiFetch(`/configuration/event-codes/children/${childId}/item-sale/configure`, { method: "POST", body: JSON.stringify(payload) });
}
export function updateItemSalePrice(childId: string, payload: { unitPrice: string; expectedVersion: number; reason: string }) {
  return apiFetch(`/configuration/event-codes/children/${childId}/item-sale/price`, { method: "PATCH", body: JSON.stringify(payload) });
}
export function adjustItemSaleStock(childId: string, payload: { movementType: "STOCK_IN" | "MANUAL_ADJUSTMENT"; quantityDelta: number; expectedVersion: number; reason: string; idempotencyKey: string }) {
  return apiFetch(`/configuration/event-codes/children/${childId}/item-sale/stock-adjustments`, { method: "POST", body: JSON.stringify(payload) });
}
export function getItemSaleWallet() {
  return apiFetch<ItemSaleWalletSummary>("/configuration/event-codes/item-sale/wallet");
}
export function allocateItemSaleWallet(payload: { sourceFundId: string; purchaseId: string; amount: string; reason: string; idempotencyKey: string }) {
  return apiFetch("/configuration/event-codes/item-sale/wallet/allocations", { method: "POST", body: JSON.stringify(payload) });
}
export function reverseItemSaleWalletAllocation(allocationId: string, reason: string) {
  return apiFetch(`/configuration/event-codes/item-sale/wallet/allocations/${allocationId}/reverse`, { method: "POST", body: JSON.stringify({ reason }) });
}

export async function getEventCodes() {
  const items = await apiFetch<EventCodeApiItem[]>("/configuration/event-codes");
  return items.map(mapEventCode);
}

export async function executeEventCodeChanges(payload: EventCodeExecutePayload) {
  const result = await apiFetch<EventCodeExecuteResponse>("/configuration/event-codes/execute", {
    method: "POST",
    body: JSON.stringify(payload)
  });

  return {
    changedCount: result.changedCount,
    items: result.items.map(mapEventCode)
  };
}

export async function getEventCodeTemplate() {
  const { blob } = await apiFetchBlob("/configuration/event-codes/template");
  return {
    blob,
    fileName: "arya-tarray-event-code-template.xlsx"
  };
}

export function previewEventCodeBulkUpload(file: File, stagedCodes: string[]) {
  const form = new FormData();
  form.append("file", file);
  form.append("stagedCodes", JSON.stringify(stagedCodes));
  return apiFetch<EventCodeBulkPreview>("/configuration/event-codes/bulk-preview", {
    method: "POST",
    body: form
  });
}
