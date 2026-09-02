import { apiFetch } from "@/lib/api";
import type { EventCode, EventCodeExecutePayload, EventCodeUser } from "../types";

type EventCodeApiUser = {
  id: string;
  fullName: string;
};

type EventCodeApiItem = {
  id: string;
  code: string;
  eventName: string;
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
