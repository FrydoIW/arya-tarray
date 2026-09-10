export type IdentityStatus = "UNVERIFIED" | "VERIFIED" | "IGNORED";
export type MemberOption = {
  memberId: string; memberCode: string; memberName: string;
  initialName: string | null; city: string | null; activeFlag: boolean;
};
export type Candidate = {
  memberIdentityId: string; accountName: string; initialName: string | null;
  bankName: string | null; accountNumber: string | null; accountType: string | null;
  verificationStatus: IdentityStatus; firstSeenAt: string; lastSeenAt: string; remark: string | null;
  transactionCount: number; observedAmount: string; member: MemberOption | null;
};
export type Workspace = {
  summary: { unverified: number; verified: number; ignored: number };
  rows: Candidate[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};
export type WorkspaceQuery = { search: string; status: IdentityStatus | "ALL"; page: number; pageSize: number };
export type MemberInput = {
  memberName: string; initialName: string | null; birthDate: string | null; phone: string | null;
  email: string | null; city: string | null; address: string | null; remark: string | null;
};
export const statusLabels: Record<IdentityStatus, string> = {
  UNVERIFIED: "Belum Registrasi", VERIFIED: "Terverifikasi", IGNORED: "Diabaikan"
};
