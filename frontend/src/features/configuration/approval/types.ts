export type ApprovalAuditUser = {
  id: string;
  fullName: string;
};

export type ApprovalMenuOption = {
  id: string;
  menuCode: string;
  menuName: string;
  route: string | null;
  activeFlag: boolean;
};

export type ApprovalApproverUser = {
  id: string;
  fullName: string;
  email: string;
};

export type ApprovalAssignedApprover = ApprovalApproverUser & {
  eligible: boolean;
};

export type ApprovalConfiguration = {
  id: string;
  menu: ApprovalMenuOption;
  approvers: ApprovalAssignedApprover[];
  activeFlag: boolean;
  createdAt?: string;
  updatedAt?: string;
  updatedBy: ApprovalAuditUser | null;
  isDraft?: boolean;
};

export type ApprovalWorkspace = {
  configurations: ApprovalConfiguration[];
  menus: ApprovalMenuOption[];
  approverUsers: ApprovalApproverUser[];
};

export type ApprovalCreateInput = {
  clientId: string;
  menuId: string;
  approverUserIds: string[];
  activeFlag: boolean;
};

export type ApprovalUpdateInput = {
  approverUserIds: string[];
  activeFlag: boolean;
};

export type ApprovalWorkspaceExecutePayload = {
  creates: ApprovalCreateInput[];
  updates: Array<{
    id: string;
    input: ApprovalUpdateInput;
  }>;
};

export type ApprovalStatusFilter = "ALL" | "ACTIVE" | "INACTIVE";
