import type { EventType } from "@/lib/event-type";

export type EventCodeUser = {
  id: string;
  fullName: string;
};

export type EventCode = {
  id: string;
  code: string;
  eventName: string;
  category: string | null;
  eventType: EventType;
  description: string | null;
  activeFlag: boolean;
  updatedAt?: string;
  updatedBy?: EventCodeUser | null;
  isDraft?: boolean;
};

export type EventCodeInput = {
  code: string;
  eventName: string;
  category: string | null;
  eventType?: EventType;
  description: string | null;
  activeFlag: boolean;
};

export type { EventType };

export type EventCampaign = {
  id: string;
  eventCodeId: string;
  campaignName: string;
  eventCode: { id: string; code: string; eventName: string };
  startDate: string | null;
  endDate: string | null;
  targetAmount: string | null;
  collectedAmount: string;
  remainingAmount: string | null;
  progressPercent: number | null;
  targetReached: boolean;
  displayStatus: "CLOSED" | "SCHEDULED" | "ENDED" | "ACTIVE";
  activeFlag: boolean;
  remark: string | null;
};

export type CampaignInput = Pick<EventCampaign, "eventCodeId" | "campaignName" | "startDate" | "endDate" | "targetAmount" | "activeFlag" | "remark">;

export type EventTimeRule = {
  eventCodeId: string;
  unitAmount: string;
  durationMonths: number;
  activeFlag: boolean;
  remark: string | null;
  eventCode: { id: string; code: string; eventName: string; eventType: EventType; activeFlag: boolean };
};
export type TimeRuleInput = Pick<EventTimeRule, "unitAmount" | "durationMonths" | "activeFlag" | "remark">;

export type EventCodeExecutePayload = {
  creates: EventCodeInput[];
  updates: Array<{
    id: string;
    input: EventCodeInput;
  }>;
  deletes: string[];
};

export type EventCodeStatusFilter = "ALL" | "ACTIVE" | "INACTIVE";
export type EventCodeMode = "INQUIRY" | "EDIT";

export type EventCodeBulkPreviewRow = {
  rowNumber: number;
  code: string;
  eventName: string;
  category: string | null;
  description: string | null;
  eventType: string;
  status: string;
  activeFlag: boolean | null;
  errors: string[];
};

export type EventCodeBulkPreview = {
  fileName: string;
  rowsDetected: number;
  readyCount: number;
  invalidCount: number;
  rows: EventCodeBulkPreviewRow[];
};
