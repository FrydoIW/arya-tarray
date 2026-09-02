export type UserStatus = "ACTIVE" | "INACTIVE";
export type UserStatusFilter = "ALL" | UserStatus;

export type AuditUser = {
  id: string;
  fullName: string;
};

export type UserRoleOption = {
  id: string;
  roleCode: string;
  roleName: string;
  description: string | null;
  activeFlag: boolean;
};

export type UserItem = {
  id: string;
  fullName: string;
  email: string;
  status: UserStatus;
  roleId: string;
  role: {
    id: string;
    roleCode: string;
    roleName: string;
    activeFlag: boolean;
  } | null;
  roleCount: number;
  updatedAt?: string;
  updatedBy: AuditUser | null;
  isDraft?: boolean;
  draftPassword?: string;
};

export type UserWorkspace = {
  users: UserItem[];
  roles: UserRoleOption[];
};

export type AddUserDraftInput = {
  fullName: string;
  email: string;
  password: string;
  roleId: string;
  status: UserStatus;
};

export type UserCreateInput = AddUserDraftInput & {
  clientId: string;
};

export type UserUpdateInput = {
  fullName: string;
  email: string;
  roleId: string;
  status: UserStatus;
};

export type UserWorkspaceExecutePayload = {
  creates: UserCreateInput[];
  updates: Array<{
    id: string;
    input: UserUpdateInput;
  }>;
  passwordResets: Array<{
    id: string;
    password: string;
  }>;
};
