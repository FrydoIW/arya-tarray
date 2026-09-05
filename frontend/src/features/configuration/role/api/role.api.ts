import { apiFetch } from "@/lib/api";
import type {
  AuditUser,
  MenuRegistryItem,
  Role,
  RoleMenuAssignment,
  RoleWorkspace,
  RoleWorkspaceExecutePayload
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
  assignedUsers: number;
  updatedAt?: string;
  updatedBy?: ApiAuditUser | null;
};

type ApiMenu = {
  id: string;
  parentMenuId?: string | null;
  parentMenu?: {
    id: string;
    menuCode: string;
    menuName: string;
  } | null;
  menuCode: string;
  menuName: string;
  route?: string | null;
  menuType: "GROUP" | "PAGE";
  displayOrder: number;
  activeFlag: boolean;
  childCount?: number;
  assignedRoles?: number;
  updatedAt?: string;
  updatedBy?: ApiAuditUser | null;
};

type ApiWorkspace = {
  roles: ApiRole[];
  menus: ApiMenu[];
  roleMenus: RoleMenuAssignment[];
};

type ApiExecuteResponse = ApiWorkspace & {
  changedCount: number;
};

function mapUser(user?: ApiAuditUser | null): AuditUser | null {
  if (!user) return null;
  return { id: String(user.id), fullName: user.fullName };
}

function mapRole(item: ApiRole): Role {
  return {
    id: String(item.id),
    roleCode: item.roleCode,
    roleName: item.roleName,
    description: item.description ?? null,
    activeFlag: Boolean(item.activeFlag),
    assignedUsers: Number(item.assignedUsers ?? 0),
    updatedAt: item.updatedAt,
    updatedBy: mapUser(item.updatedBy)
  };
}

function mapMenu(item: ApiMenu): MenuRegistryItem {
  return {
    id: String(item.id),
    parentMenuId: item.parentMenuId ? String(item.parentMenuId) : null,
    parentMenu: item.parentMenu
      ? {
          id: String(item.parentMenu.id),
          menuCode: item.parentMenu.menuCode,
          menuName: item.parentMenu.menuName
        }
      : null,
    menuCode: item.menuCode,
    menuName: item.menuName,
    route: item.route ?? null,
    menuType: item.menuType,
    displayOrder: Number(item.displayOrder ?? 0),
    activeFlag: Boolean(item.activeFlag),
    childCount: Number(item.childCount ?? 0),
    assignedRoles: Number(item.assignedRoles ?? 0),
    updatedAt: item.updatedAt,
    updatedBy: mapUser(item.updatedBy)
  };
}

function mapWorkspace(value: ApiWorkspace): RoleWorkspace {
  return {
    roles: value.roles.map(mapRole),
    menus: value.menus.map(mapMenu),
    roleMenus: value.roleMenus.map((item) => ({
      roleId: String(item.roleId),
      menuId: String(item.menuId)
    }))
  };
}

export async function getRoles() {
  const items = await apiFetch<ApiRole[]>("/configuration/roles");
  return items.map(mapRole);
}

export async function getRoleWorkspace(signal?: AbortSignal) {
  return mapWorkspace(await apiFetch<ApiWorkspace>("/configuration/roles/workspace", { signal }));
}

export async function executeRoleWorkspace(payload: RoleWorkspaceExecutePayload) {
  const result = await apiFetch<ApiExecuteResponse>("/configuration/roles/workspace/execute", {
    method: "POST",
    body: JSON.stringify(payload)
  });

  return {
    changedCount: Number(result.changedCount ?? 0),
    ...mapWorkspace(result)
  };
}
