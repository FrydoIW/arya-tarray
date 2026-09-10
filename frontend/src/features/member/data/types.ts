export type MemberStatusFilter = "ACTIVE" | "INACTIVE" | "ALL";
export type RegistrationSource = "MANUAL" | "STATEMENT";
export type PeriodMode = "MONTH" | "DAY";
export type MemberDataQuery = { search: string; status: MemberStatusFilter; city: string; registrationSource: RegistrationSource | "ALL";
  page: number; pageSize: number };
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
