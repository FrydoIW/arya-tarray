import { apiFetch, apiFetchBlob } from "@/lib/api";
import type { CampaignInput, EventCampaign, EventCode, EventCodeBulkPreview, EventCodeExecutePayload, EventCodeUser, EventTimeRule, EventType, TimeRuleInput } from "../types";

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
export function executeTimeRuleChange(payload: { eventCodeId: string; input: TimeRuleInput }) {
  return apiFetch<EventTimeRule[]>("/configuration/event-codes/time-rules/execute", { method: "POST", body: JSON.stringify(payload) });
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
