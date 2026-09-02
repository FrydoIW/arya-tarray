import type {
  MenuCreateInput,
  MenuRegistryItem,
  MenuStatusFilter,
  MenuTypeFilter,
  MenuUpdateInput,
  Role,
  RoleCreateInput,
  RoleMenuAssignment,
  RoleStatusFilter,
  RoleUpdateInput,
  RoleWorkspaceExecutePayload
} from "../types";

export function roleMenuKey(roleId: string, menuId: string) {
  return `${roleId}:${menuId}`;
}

export function normalizeRoleCreate(item: Role): RoleCreateInput {
  return {
    roleCode: item.roleCode.trim().toUpperCase(),
    roleName: item.roleName.trim(),
    description: item.description?.trim() || null,
    activeFlag: item.activeFlag
  };
}

export function normalizeRoleUpdate(item: Role): RoleUpdateInput {
  return {
    roleName: item.roleName.trim(),
    description: item.description?.trim() || null,
    activeFlag: item.activeFlag
  };
}

export function sameRoleUpdate(a: RoleUpdateInput, b: RoleUpdateInput) {
  return a.roleName === b.roleName
    && a.description === b.description
    && a.activeFlag === b.activeFlag;
}

export function normalizeMenuCreate(item: MenuRegistryItem): MenuCreateInput {
  return {
    clientId: item.id,
    parentMenuRef: item.menuType === "GROUP" ? null : item.parentMenuId,
    menuCode: item.menuCode.trim().toUpperCase(),
    menuName: item.menuName.trim(),
    route: item.menuType === "GROUP" ? null : item.route?.trim() || null,
    menuType: item.menuType,
    displayOrder: Number(item.displayOrder || 0),
    activeFlag: item.activeFlag
  };
}

export function normalizeMenuUpdate(item: MenuRegistryItem): MenuUpdateInput {
  return {
    parentMenuRef: item.menuType === "GROUP" ? null : item.parentMenuId,
    menuName: item.menuName.trim(),
    displayOrder: Number(item.displayOrder || 0),
    activeFlag: item.activeFlag
  };
}

export function sameMenuUpdate(a: MenuUpdateInput, b: MenuUpdateInput) {
  return a.parentMenuRef === b.parentMenuRef
    && a.menuName === b.menuName
    && a.displayOrder === b.displayOrder
    && a.activeFlag === b.activeFlag;
}

export function validateRoles(rows: Role[]) {
  const codes = new Set<string>();

  for (const row of rows) {
    const code = row.roleCode.trim().toUpperCase();
    const name = row.roleName.trim();
    const description = row.description?.trim() ?? "";

    if (!code) return "Role Code wajib diisi.";
    if (!/^[A-Z0-9_]+$/.test(code)) return `Role Code ${code} hanya boleh berisi huruf besar, angka, dan underscore.`;
    if (code.length > 50) return `Role Code ${code} maksimal 50 karakter.`;
    if (!name) return `Role Name untuk ${code} wajib diisi.`;
    if (name.length > 100) return `Role Name untuk ${code} maksimal 100 karakter.`;
    if (description.length > 255) return `Description untuk ${code} maksimal 255 karakter.`;
    if (codes.has(code)) return `Role Code ${code} muncul lebih dari satu kali.`;
    codes.add(code);
  }

  return "";
}

export function validateMenus(rows: MenuRegistryItem[]) {
  const codes = new Set<string>();
  const routes = new Set<string>();
  const groups = new Set(rows.filter((row) => row.menuType === "GROUP").map((row) => row.id));

  for (const row of rows) {
    const code = row.menuCode.trim().toUpperCase();
    const name = row.menuName.trim();
    const route = row.route?.trim() ?? "";

    if (!code) return "Menu Code wajib diisi.";
    if (!/^[A-Z0-9_]+$/.test(code)) return `Menu Code ${code} hanya boleh berisi huruf besar, angka, dan underscore.`;
    if (code.length > 100) return `Menu Code ${code} maksimal 100 karakter.`;
    if (!name) return `Menu Name untuk ${code} wajib diisi.`;
    if (name.length > 150) return `Menu Name untuk ${code} maksimal 150 karakter.`;
    if (!Number.isInteger(Number(row.displayOrder)) || Number(row.displayOrder) < 0) return `Display Order untuk ${code} harus angka 0 atau lebih.`;
    if (codes.has(code)) return `Menu Code ${code} muncul lebih dari satu kali.`;
    codes.add(code);

    if (row.menuType === "GROUP") {
      if (row.parentMenuId) return `Group ${code} tidak boleh memiliki parent.`;
    } else {
      if (!row.parentMenuId || !groups.has(row.parentMenuId)) return `Page ${code} wajib memilih Parent Group.`;
      if (!route) return `Route untuk Page ${code} wajib diisi.`;
      if (!route.startsWith("/")) return `Route ${route} harus diawali dengan '/'.`;
      if (routes.has(route)) return `Route ${route} digunakan lebih dari satu Page.`;
      routes.add(route);
    }
  }

  return "";
}

export function filterRoles(rows: Role[], search: string, statusFilter: RoleStatusFilter) {
  const keyword = search.trim().toLowerCase();
  return rows.filter((item) => {
    const statusMatches = statusFilter === "ALL"
      || (statusFilter === "ACTIVE" && item.activeFlag)
      || (statusFilter === "INACTIVE" && !item.activeFlag);
    if (!statusMatches) return false;
    if (!keyword) return true;
    return [item.roleCode, item.roleName, item.description ?? "", item.updatedBy?.fullName ?? ""]
      .some((value) => value.toLowerCase().includes(keyword));
  });
}

export function withAssignedRoleCounts(
  menus: MenuRegistryItem[],
  roles: Role[],
  access: Set<string>
) {
  return menus.map((item) => {
    if (item.menuType !== "PAGE" || item.isDraft) return item;
    let assignedRoles = 0;
    for (const role of roles) {
      if (!role.isDraft && access.has(roleMenuKey(role.id, item.id))) assignedRoles += 1;
    }
    return { ...item, assignedRoles };
  });
}

export function filterMenus(
  rows: MenuRegistryItem[],
  allMenus: MenuRegistryItem[],
  search: string,
  statusFilter: MenuStatusFilter,
  typeFilter: MenuTypeFilter
) {
  const keyword = search.trim().toLowerCase();
  const menuMap = new Map(allMenus.map((menu) => [menu.id, menu]));

  return rows.filter((item) => {
    const statusMatches = statusFilter === "ALL"
      || (statusFilter === "ACTIVE" && item.activeFlag)
      || (statusFilter === "INACTIVE" && !item.activeFlag);
    const typeMatches = typeFilter === "ALL" || item.menuType === typeFilter;
    if (!statusMatches || !typeMatches) return false;
    if (!keyword) return true;

    const parentName = item.parentMenuId ? menuMap.get(item.parentMenuId)?.menuName ?? "" : "";
    return [item.menuCode, item.menuName, item.route ?? "", parentName, item.updatedBy?.fullName ?? ""]
      .some((value) => value.toLowerCase().includes(keyword));
  });
}

export function summarizeRoles(rows: Role[]) {
  return {
    total: rows.length,
    active: rows.filter((item) => item.activeFlag).length,
    inactive: rows.filter((item) => !item.activeFlag).length,
    assignments: rows.reduce((total, item) => total + item.assignedUsers, 0)
  };
}

export function summarizeMenus(rows: MenuRegistryItem[]) {
  return {
    total: rows.length,
    groups: rows.filter((item) => item.menuType === "GROUP").length,
    pages: rows.filter((item) => item.menuType === "PAGE").length,
    active: rows.filter((item) => item.activeFlag).length
  };
}

export function rolesAreDirty(serverRows: Role[], workingRows: Role[], deletedIds: string[]) {
  if (deletedIds.length > 0 || workingRows.some((item) => item.isDraft)) return true;
  if (workingRows.length !== serverRows.length) return true;
  const serverMap = new Map(serverRows.map((item) => [item.id, item]));
  return workingRows.some((item) => {
    const original = serverMap.get(item.id);
    return !original || !sameRoleUpdate(normalizeRoleUpdate(item), normalizeRoleUpdate(original));
  });
}

export function menusAreDirty(
  serverRows: MenuRegistryItem[],
  workingRows: MenuRegistryItem[],
  deletedIds: string[]
) {
  if (deletedIds.length > 0 || workingRows.some((item) => item.isDraft)) return true;
  if (workingRows.length !== serverRows.length) return true;
  const serverMap = new Map(serverRows.map((item) => [item.id, item]));
  return workingRows.some((item) => {
    const original = serverMap.get(item.id);
    return !original || !sameMenuUpdate(normalizeMenuUpdate(item), normalizeMenuUpdate(original));
  });
}

export function accessIsDirty(serverAccess: Set<string>, workingAccess: Set<string>) {
  if (workingAccess.size !== serverAccess.size) return true;
  for (const key of workingAccess) if (!serverAccess.has(key)) return true;
  return false;
}

export function buildRoleWorkspacePayload(params: {
  serverRoles: Role[];
  workingRoles: Role[];
  deletedRoleIds: string[];
  serverMenus: MenuRegistryItem[];
  workingMenus: MenuRegistryItem[];
  deletedMenuIds: string[];
  workingAccess: Set<string>;
  includeRoleMenus: boolean;
}): RoleWorkspaceExecutePayload {
  const {
    serverRoles,
    workingRoles,
    deletedRoleIds,
    serverMenus,
    workingMenus,
    deletedMenuIds,
    workingAccess,
    includeRoleMenus
  } = params;

  const serverRoleMap = new Map(serverRoles.map((item) => [item.id, item]));
  const roleCreates: RoleCreateInput[] = [];
  const roleUpdates: Array<{ id: string; input: RoleUpdateInput }> = [];

  for (const item of workingRoles) {
    if (item.isDraft) {
      roleCreates.push(normalizeRoleCreate(item));
      continue;
    }

    const original = serverRoleMap.get(item.id);
    const input = normalizeRoleUpdate(item);
    if (!original || !sameRoleUpdate(input, normalizeRoleUpdate(original))) {
      roleUpdates.push({ id: item.id, input });
    }
  }

  const serverMenuMap = new Map(serverMenus.map((item) => [item.id, item]));
  const menuCreates: MenuCreateInput[] = [];
  const menuUpdates: Array<{ id: string; input: MenuUpdateInput }> = [];

  for (const item of workingMenus) {
    if (item.isDraft) {
      menuCreates.push(normalizeMenuCreate(item));
      continue;
    }

    const original = serverMenuMap.get(item.id);
    const input = normalizeMenuUpdate(item);
    if (!original || !sameMenuUpdate(input, normalizeMenuUpdate(original))) {
      menuUpdates.push({ id: item.id, input });
    }
  }

  let roleMenus: RoleMenuAssignment[] | null | undefined;
  if (includeRoleMenus) {
    const persistedRoleIds = new Set(workingRoles.filter((item) => !item.isDraft).map((item) => item.id));
    const persistedPageIds = new Set(
      workingMenus.filter((item) => !item.isDraft && item.menuType === "PAGE").map((item) => item.id)
    );

    roleMenus = [];
    for (const key of workingAccess) {
      const [roleId, menuId] = key.split(":");
      if (persistedRoleIds.has(roleId) && persistedPageIds.has(menuId)) {
        roleMenus.push({ roleId, menuId });
      }
    }
  }

  return {
    roles: {
      creates: roleCreates,
      updates: roleUpdates,
      deletes: deletedRoleIds
    },
    menus: {
      creates: menuCreates,
      updates: menuUpdates,
      deletes: deletedMenuIds
    },
    roleMenus
  };
}
