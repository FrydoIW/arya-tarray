import { apiFetch, apiFetchBlob } from "@/lib/api";
import type { EventCode, EventCodeBulkPreview, EventCodeExecutePayload, EventCodeUser } from "../types";

type EventCodeApiUser = {
  id: string;
  fullName: string;
};

type EventCodeApiItem = {
  id: string;
  code: string;
  eventName: string;
  category: string | null;
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
    description: item.description ?? null,
    activeFlag: item.activeFlag,
    updatedAt: item.updatedAt,
    updatedBy: mapUser(item.updatedBy)
  };
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
