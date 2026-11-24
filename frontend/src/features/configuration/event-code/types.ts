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
  directContribution: string;
  carryAllocation: string;
  targetApplied: string;
  campaignCarry: string;
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

export type EventCodeChild = {
  id: string;
  eventCodeId: string;
  childCode: string;
  childName: string;
  description: string | null;
  displayOrder: number;
  activeFlag: boolean;
  capacity: number | null;
  unitAmount: string | null;
  durationMonths: number | null;
  occupiedSlots: number;
  availableSlots: number | null;
  configurationComplete: boolean;
  itemSaleUnitPrice?: string | null;
  itemSaleStockOnHand?: number | null;
  itemSaleVersion?: number | null;
  eventCode: { id: string; code: string; eventName: string; eventType: EventType; activeFlag: boolean };
  transactionCount: number;
  correctionCount: number;
  updatedAt?: string;
  updatedBy?: EventCodeUser | null;
};

export type ChildInput = Pick<EventCodeChild, "eventCodeId" | "childCode" | "childName" | "description" | "displayOrder" | "activeFlag" | "capacity" | "unitAmount" | "durationMonths">;

export type ItemSaleConfigDetail = {
  id: string;
  childCode: string;
  childName: string;
  activeFlag: boolean;
  eventCode: { id: string; code: string; eventName: string; eventType: EventType; activeFlag: boolean };
  itemSaleConfig: { unitPrice: string; stockOnHand: number; version: number; createdAt: string; updatedAt: string; createdBy: EventCodeUser; updatedBy: EventCodeUser } | null;
  itemSaleInventoryMovements: Array<{ id: string; movementType: string; quantityDelta: number; stockBefore: number; stockAfter: number; sourceReference: string; reversalOfMovementId: string | null; reason: string; createdAt: string; createdBy: EventCodeUser }>;
};

export type ItemSaleWalletFund = {
  id: string;
  status: string;
  ownershipStatus: string;
  originalAmount: string;
  allocatedSaleAmount: string;
  otherAllocatedAmount: string;
  unallocatedAmount: string;
  ownerMember: { id: string; memberCode: string; memberName: string } | null;
  purchase: { id: string; quantity: number; totalAmount: string; paymentAmountSnapshot: string | null; walletAppliedAmount: string; status: string; eventCodeChild: { id: string; childCode: string; childName: string } | null } | null;
  bankTransaction: { id: string; transactionDate: string | null; referenceNo: string | null; senderName: string | null; description: string | null; originalAmount: string; statementUpload: { id: string; fileName: string } };
  entries: Array<{ id: string; entryType: string; amountDelta: string; balanceAfter: string; reason: string; createdAt: string; createdBy: EventCodeUser }>;
  allocations: Array<{ id: string; amount: string; status: string; reason: string; createdAt: string; createdBy: EventCodeUser; reversedAt: string | null; reversedBy: EventCodeUser | null; reversalReason: string | null; purchase: { id: string; status: string; quantity: number; totalAmount: string } | null }>;
};

export type ItemSaleWalletSummary = {
  summary: {
    totalOriginal: string; totalSaleAllocated: string; totalUnallocated: string; totalOtherAllocated: string;
    suspenseUnallocated: string; memberUnallocated: string; pendingCount: number; pendingStockCount: number; pendingBuyerCount: number;
  };
  funds: ItemSaleWalletFund[];
  members: Array<{ memberId: string; memberCode: string; memberName: string; walletBalance: string; suspense: boolean }>;
  pendingPurchases: Array<{
    purchaseId: string; buyerMember: { id: string; memberCode: string; memberName: string } | null;
    status: string; quantity: number; unitPrice: string; totalAmount: string; bankAmount: string; walletAppliedAmount: string;
    shortfall: string; reason: string | null;
    sourceBankTransaction: { id: string; referenceNo: string | null; date: string | null };
    item: { id: string; childCode: string; childName: string } | null; stockOnHand: number | null; buyerVerified: boolean;
  }>;
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
