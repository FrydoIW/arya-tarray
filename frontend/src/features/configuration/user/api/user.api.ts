import { apiFetch } from "@/lib/api";
import type {
  AuditUser,
  UserItem,
  UserRoleOption,
  UserWorkspace,
  UserWorkspaceExecutePayload
} from "../types";

type ApiAuditUser = {
  id: string;
  fullName: string;
};

type ApiRole = {
  id: string;
  roleCode: string;
  roleName: string;
  description?: string | null;
  activeFlag: boolean;
};

type ApiUser = {
  id: string;
  fullName: string;
  email: string;
  status: "ACTIVE" | "INACTIVE";
  role?: {
    id: string;
    roleCode: string;
    roleName: string;
    activeFlag: boolean;
  } | null;
  roleCount?: number;
  updatedAt?: string;
  updatedBy?: ApiAuditUser | null;
};

type ApiWorkspace = {
  users: ApiUser[];
  roles: ApiRole[];
};

type ApiExecuteResponse = ApiWorkspace & {
  changedCount: number;
};

function mapAuditUser(value?: ApiAuditUser | null): AuditUser | null {
  if (!value) return null;
  return {
    id: String(value.id),
    fullName: value.fullName
  };
}

function mapRole(value: ApiRole): UserRoleOption {
  return {
    id: String(value.id),
    roleCode: value.roleCode,
    roleName: value.roleName,
    description: value.description ?? null,
    activeFlag: Boolean(value.activeFlag)
  };
}

function mapUser(value: ApiUser): UserItem {
  const role = value.role
    ? {
        id: String(value.role.id),
        roleCode: value.role.roleCode,
        roleName: value.role.roleName,
        activeFlag: Boolean(value.role.activeFlag)
      }
    : null;

  return {
    id: String(value.id),
    fullName: value.fullName,
    email: value.email,
    status: value.status,
    roleId: role?.id ?? "",
    role,
    roleCount: Number(value.roleCount ?? (role ? 1 : 0)),
    updatedAt: value.updatedAt,
    updatedBy: mapAuditUser(value.updatedBy)
  };
}

function mapWorkspace(value: ApiWorkspace): UserWorkspace {
  return {
    users: value.users.map(mapUser),
    roles: value.roles.map(mapRole)
  };
}

export async function getUserWorkspace() {
  return mapWorkspace(await apiFetch<ApiWorkspace>("/configuration/users/workspace"));
}

export async function executeUserWorkspace(payload: UserWorkspaceExecutePayload) {
  const result = await apiFetch<ApiExecuteResponse>("/configuration/users/workspace/execute", {
    method: "POST",
    body: JSON.stringify(payload)
  });

  return {
    changedCount: Number(result.changedCount ?? 0),
    ...mapWorkspace(result)
  };
}
