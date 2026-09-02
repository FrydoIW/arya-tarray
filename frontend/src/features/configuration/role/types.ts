export type AuditUser = {
  id: string;
  fullName: string;
};

export type Role = {
  id: string;
  roleCode: string;
  roleName: string;
  description: string | null;
  activeFlag: boolean;
  assignedUsers: number;
  updatedAt?: string;
  updatedBy: AuditUser | null;
  isDraft?: boolean;
};

export type MenuType = "GROUP" | "PAGE";

export type MenuRegistryItem = {
  id: string;
  parentMenuId: string | null;
  parentMenu: {
    id: string;
    menuCode: string;
    menuName: string;
  } | null;
  menuCode: string;
  menuName: string;
  route: string | null;
  menuType: MenuType;
  displayOrder: number;
  activeFlag: boolean;
  childCount: number;
  assignedRoles: number;
  updatedAt?: string;
  updatedBy: AuditUser | null;
  isDraft?: boolean;
};

export type RoleMenuAssignment = {
  roleId: string;
  menuId: string;
};

export type RoleWorkspace = {
  roles: Role[];
  menus: MenuRegistryItem[];
  roleMenus: RoleMenuAssignment[];
};

export type RoleCreateInput = {
  roleCode: string;
  roleName: string;
  description: string | null;
  activeFlag: boolean;
};

export type RoleUpdateInput = {
  roleName: string;
  description: string | null;
  activeFlag: boolean;
};

export type MenuCreateInput = {
  clientId: string;
  parentMenuRef: string | null;
  menuCode: string;
  menuName: string;
  route: string | null;
  menuType: MenuType;
  displayOrder: number;
  activeFlag: boolean;
};

export type MenuUpdateInput = {
  parentMenuRef: string | null;
  menuName: string;
  displayOrder: number;
  activeFlag: boolean;
};

export type RoleWorkspaceExecutePayload = {
  roles: {
    creates: RoleCreateInput[];
    updates: Array<{ id: string; input: RoleUpdateInput }>;
    deletes: string[];
  };
  menus: {
    creates: MenuCreateInput[];
    updates: Array<{ id: string; input: MenuUpdateInput }>;
    deletes: string[];
  };
  roleMenus?: RoleMenuAssignment[] | null;
};

export type RoleStatusFilter = "ALL" | "ACTIVE" | "INACTIVE";
export type MenuStatusFilter = "ALL" | "ACTIVE" | "INACTIVE";
export type MenuTypeFilter = "ALL" | MenuType;
export type MatrixMode = "INQUIRY" | "EDIT";
