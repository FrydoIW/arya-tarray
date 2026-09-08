export type EventCodeUser = {
  id: string;
  fullName: string;
};

export type EventCode = {
  id: string;
  code: string;
  eventName: string;
  category: string | null;
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
  description: string | null;
  activeFlag: boolean;
};

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
