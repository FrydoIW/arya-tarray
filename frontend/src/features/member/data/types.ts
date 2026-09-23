export type MemberStatusFilter = "ACTIVE" | "INACTIVE" | "ALL";
export type RegistrationSource = "MANUAL" | "STATEMENT";
export type PeriodMode = "MONTH" | "DAY";
export type MemberDataQuery = { search: string; status: MemberStatusFilter; city: string; registrationSource: RegistrationSource | "ALL";
  programBalance: "ALL" | "HAS_CARRY" | "NO_CARRY"; page: number; pageSize: number };
export type MemberRow = {
  memberId: string; memberCode: string; memberName: string; initialName: string | null;
  birthDate: string | null; age: number | null; phone: string | null; email: string | null;
  city: string | null; registrationSource: RegistrationSource; activeFlag: boolean;
  identityCount: number; registeredAt: string; lifetimeDonation: string; lifetimeTransactions: number;
};
export type EventOption = { id: string; code: string; eventName: string; category: string | null; activeFlag: boolean };
export type MemberWorkspace = {
  summary: { total: number; active: number; inactive: number; manual: number; statement: number };
  filters: { cities: string[] }; rows: MemberRow[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};
export type MemberProfileInput = {
  memberName?: string; initialName?: string | null; birthDate?: string | null; phone?: string | null;
  email?: string | null; address?: string | null; city?: string | null; remark?: string | null;
};
export type Identity = {
  memberIdentityId: string; sourceType: string; accountName: string; initialName: string | null;
  normalizedName: string; bankName: string | null; accountNumber: string | null; accountType: string | null;
  verificationStatus: string; firstSeenAt: string; lastSeenAt: string; verifiedAt: string | null;
  remark: string | null; transactionCount: number;
};
export type IdentityMetadataInput = {
  initialName?: string | null; bankName?: string | null; accountNumber?: string | null;
  accountType?: string | null; remark?: string | null;
};
export type MemberDetail = Omit<MemberRow, "identityCount" | "lifetimeDonation" | "lifetimeTransactions"> & {
  address: string | null; remark: string | null; createdAt: string; updatedAt: string;
  registeredBy: Actor | null; createdBy: Actor | null; updatedBy: Actor | null; identities: Identity[];
};
export type Actor = { id: string; fullName: string };
export type IdentityOption = Omit<Identity, "normalizedName" | "verificationStatus" | "verifiedAt" | "remark">;
export type MemberOption = { memberId: string; memberCode: string; memberName: string; initialName: string | null; city: string | null; activeFlag: boolean };
export type DonationQuery = { periodMode: PeriodMode; month: string; date: string; eventCodeId: string; search: string; page: number; pageSize: number };
export type DonationRow = {
  transactionId: string; transactionDate: string | null; sourceType: string; correctionReason: string | null;
  manualAddedAt: string | null; manualAddedBy: Actor | null;
  identity: { memberIdentityId: string; accountName: string; initialName: string | null; sourceType: string } | null;
  referenceNo: string | null; description: string | null; amount: string;
  finalEvent: { eventCodeId: string; eventCode: string; eventName: string; category: string } | null;
  statement: { statementId: string; fileName: string };
};
export type DonationWorkspace = {
  member: { memberId: string; memberCode: string; memberName: string };
  filters: { periodMode: PeriodMode; month: string; date: string; eventCodeId: string | null; search: string };
  summary: { lifetimeAmount: string; lifetimeTransactionCount: number; periodAmount: string; periodTransactionCount: number };
  rows: DonationRow[]; eventOptions: EventOption[];
  eventBreakdown: Array<{ eventCodeId: string; eventCode: string; eventName: string; category: string; transactionCount: number; amount: string }>;
  categoryBreakdown: Array<{ category: string; transactionCount: number; eventCount: number; amount: string }>;
  pagination: { page: number; pageSize: number; totalRows: number; totalPages: number };
};
export type IdentityHistoryAction = "REGISTER" | "LINK" | "ATTACH" | "IGNORE" | "MOVE" | "DETACH";
export type IdentityHistoryRow = {
  historyId: string; action: IdentityHistoryAction; statusBefore: string; statusAfter: string; reason: string | null;
  actionAt: string; actionBy: Actor;
  identity: { memberIdentityId: string; accountName: string; sourceType: string; bankName: string | null; accountNumber: string | null };
  fromMember: { memberId: string; memberCode: string; memberName: string } | null;
  toMember: { memberId: string; memberCode: string; memberName: string } | null;
};
export type IdentityHistoryWorkspace = {
  rows: IdentityHistoryRow[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

export type ContributionRow = {
  eventCodeId: string; eventCode: string; eventName: string; eventType: string; category: string;
  campaign: { campaignId: string; campaignName: string; displayStatus: string } | null;
  totalAmount: string; transactionCount: number;
};
export type SponsorshipSubscription = {
  subscriptionId: string; event: { eventCodeId: string; code: string; eventName: string; eventType: string };
  referenceNo: string | null; displayName: string | null; startDate: string | null; validUntil: string | null;
  activeFlag: boolean; eventActiveFlag: boolean; remark: string | null; status: "ACTIVE" | "INACTIVE";
  timeRule: { unitAmount: string; durationMonths: number } | null;
  carryBalance: string; principal: string; consumed: string; transferIn: string; transferOut: string;
  balanceHistory: Array<{ ledgerId: string; transactionId: string | null; referenceNo: string | null; type: string; status: string; amountDelta: string; effectiveDate: string | null; unitAmount: string | null; durationMonths: number | null; voidReason: string | null }>;
  coverage: Array<{ coverageId: string; source: string; status: string; transactionId: string | null; transactionDate: string | null; referenceNo: string | null; amountApplied: string | null; unitAmount: string | null; durationMonths: number | null; grantedUnits: number | null; coverageFrom: string; coverageTo: string; remark: string | null; voidReason: string | null }>;
};
export type SponsorshipWorkspace = {
  eventOptions: Array<{ eventCodeId: string; code: string; eventName: string }>;
  subscriptions: SponsorshipSubscription[];
  contributions: ContributionRow[];
  campaigns: Array<{ campaignId: string; campaignName: string; eventCodeId: string; eventCode: string; eventName: string; status: string;
    targetAmount: string | null; targetApplied: string; targetRemaining: string | null; directContribution: string; allocatedFromCarry: string;
    carryBalance: string; appliedToCampaign: string; totalAllocation: string;
    allocationHistory: Array<{ allocationId: string; amountDelta: string; allocationType: string; allocationStatus: string; effectiveDate: string; reason: string }> }>;
  availableCampaigns: Array<{ campaignId: string; campaignName: string; eventCodeId: string; code: string; eventName: string }>;
  campaignParticipationOptions: Array<{ campaignId: string; campaignName: string; eventCodeId: string; code: string; eventName: string; startDate: string | null; endDate: string | null }>;
  contributionTotals: Record<string, { amount: string; transactionCount: number }>;
  pendingPayments: Array<{ transactionId: string; transactionDate: string | null; referenceNo: string | null; amount: string; principalAmount: string; event: { eventCodeId: string; code: string; eventName: string } | null; unitAmount: string | null; grantedUnits: number | null; durationMonths: number | null; reason: string }>;
};

export type CarryTransferSubscription = {
  subscriptionId: string; referenceNo: string | null; displayName: string | null;
  eventCodeId: string; eventCode: string; eventName: string;
};
export type CarryTransferView = {
  transferId: string; memberId: string; sourceType: "TIME_BASED" | "CAMPAIGN"; sourceSubscriptionId: string | null; sourceCampaignId: string | null;
  destinationType: "TIME_BASED" | "CAMPAIGN"; destinationSubscriptionId: string | null; destinationCampaignId: string | null;
  amount: string; effectiveDate: string; reason: string; destinationRule: { unitAmount: string; durationMonths: number };
  reversalOfTransferId: string | null; createdAt: string;
};
export type CarryTransferRecord = {
  transferId: string; status: string; amount: string; effectiveDate: string; reason: string; createdAt: string;
  destinationRule: { unitAmount: string; durationMonths: number };
  createdBy: { userId: string; fullName: string } | null; reversedAt: string | null; reversedBy: { userId: string; fullName: string } | null;
  source: CarryTransferSubscription | null; destination: CarryTransferSubscription | null;
  sourceType: "TIME_BASED" | "CAMPAIGN";
  sourceCampaign: { campaignId: string; campaignName: string; eventCodeId: string; eventCode: string; eventName: string } | null;
  destinationCampaign: { campaignId: string; campaignName: string; eventCodeId: string; eventCode: string; eventName: string } | null;
  reversalOf: { transferId: string; status: string; effectiveDate: string } | null;
  reversal: { transferId: string; status: string; effectiveDate: string } | null;
  isReversible: boolean;
};
export type CarryTransferHistory = {
  rows: CarryTransferRecord[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};
export type CarryTransferWalletBalance = { type: "TIME_BASED"; subscriptionId: string; carryBefore: string; carryAfter: string };
export type CarryTransferCampaignWalletBalance = { type: "CAMPAIGN"; campaignId: string; carryBefore: string; carryAfter: string };
export type CarryTransferCampaignAllocation = { type: "CAMPAIGN"; campaignId: string; allocation: { allocationId: string; amountDelta: string; allocationType: string } };
export type CarryTransferDestination = (CarryTransferWalletBalance & { allocation: CarryTransferAllocation | null }) | CarryTransferCampaignAllocation;
export type CarryTransferAllocation = { units: number; amountApplied: string; unitAmount: string; durationMonths: number;
  coverage: { coverageId: string; coverageFrom: string; coverageTo: string } | null };
export type CarryTransferResult = {
  transfer: CarryTransferView; source: CarryTransferWalletBalance | CarryTransferCampaignWalletBalance;
  destination: CarryTransferDestination;
};
export type CarryTransferReversalResult = {
  original: CarryTransferView; reversal: CarryTransferView;
  restoringDestination: CarryTransferWalletBalance | CarryTransferCampaignWalletBalance; reversingSource: CarryTransferWalletBalance | CarryTransferCampaignWalletBalance | CarryTransferCampaignAllocation;
};
export type CarryTransferSource = {
  type: "TIME_BASED" | "CAMPAIGN"; sourceId: string; eventCode: string; eventName: string; label: string; carryBalance: string;
};
export type CarryTransferInput = { destinationSubscriptionId?: string; destinationCampaignId?: string; amount: string; reason: string; idempotencyKey: string };
export type CarryTransferReverseInput = { reason: string; idempotencyKey: string };
export type SubscriptionInput = { eventCodeId: string; referenceNo: string | null; displayName: string | null; remark: string | null };
export type SubscriptionMetadataInput = { referenceNo: string | null; displayName: string | null; remark: string | null };
export type CampaignParticipationInput = { eventCampaignId: string; remark: string | null };
export type OpeningCoverageInput = { coverageFrom: string; coverageTo: string; remark: string };
