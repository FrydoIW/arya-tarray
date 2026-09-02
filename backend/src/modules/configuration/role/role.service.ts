import { HttpError } from "../../../lib/http.js";
import type { RoleWorkspaceExecuteInput } from "./role.schema.js";
import {
  applyRoleWorkspaceAtomic,
  findMenuApprovalUsage,
  findRoleUsage,
  listRoles as listRoleRecords,
  loadRoleWorkspace as loadRoleWorkspaceRecords
} from "./role.repository.js";

type RoleRecord = Awaited<ReturnType<typeof listRoleRecords>>[number];
type WorkspaceRecord = Awaited<ReturnType<typeof loadRoleWorkspaceRecords>>;
type MenuRecord = WorkspaceRecord["menus"][number];

function toRoleResponse(item: RoleRecord) {
  return {
    id: item.id,
    roleCode: item.roleCode,
    roleName: item.roleName,
    description: item.description,
    activeFlag: item.activeFlag,
    assignedUsers: item._count.userRoles,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    updatedBy: item.updatedBy
  };
}

function toMenuResponse(item: MenuRecord) {
  return {
    id: item.id,
    parentMenuId: item.parentMenuId,
    parentMenu: item.parent,
    menuCode: item.menuCode,
    menuName: item.menuName,
    route: item.route,
    menuType: item.menuType,
    displayOrder: item.displayOrder,
    activeFlag: item.activeFlag,
    childCount: item._count.children,
    assignedRoles: item._count.roleMenus,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    updatedBy: item.updatedBy
  };
}

function toWorkspaceResponse(workspace: WorkspaceRecord) {
  return {
    roles: workspace.roles.map(toRoleResponse),
    menus: workspace.menus.map(toMenuResponse),
    roleMenus: workspace.roleMenus
  };
}

export async function listRoles(search?: string) {
  const items = await listRoleRecords(search);
  return items.map(toRoleResponse);
}

export async function getRoleWorkspace() {
  return toWorkspaceResponse(await loadRoleWorkspaceRecords());
}

export async function executeRoleWorkspace(input: RoleWorkspaceExecuteInput, userId: string) {
  const workspace = await loadRoleWorkspaceRecords();
  const existingRolesById = new Map(workspace.roles.map((item) => [item.id, item]));
  const existingMenusById = new Map(workspace.menus.map((item) => [item.id, item]));

  const roleDeleteIds = new Set<string>();
  for (const id of input.roles.deletes) {
    if (roleDeleteIds.has(id)) throw new HttpError(400, `Role ${id} dikirim untuk delete lebih dari satu kali`);
    if (!existingRolesById.has(id)) throw new HttpError(404, "Salah satu Role yang dihapus tidak ditemukan");
    roleDeleteIds.add(id);
  }

  const roleUpdateIds = new Set<string>();
  for (const update of input.roles.updates) {
    if (roleUpdateIds.has(update.id)) throw new HttpError(400, `Role ${update.id} dikirim lebih dari satu kali`);
    if (roleDeleteIds.has(update.id)) throw new HttpError(400, "Role yang sama tidak boleh di-update dan di-delete dalam satu Execute");
    if (!existingRolesById.has(update.id)) throw new HttpError(404, "Salah satu Role yang diubah tidak ditemukan");
    roleUpdateIds.add(update.id);
  }

  if (input.roles.deletes.length > 0) {
    const usageRows = await findRoleUsage(input.roles.deletes);
    const used = usageRows.find((item) => item._count.userRoles > 0);
    if (used) {
      throw new HttpError(
        409,
        `Role ${used.roleCode} masih dipakai ${used._count.userRoles} user. Ubah status menjadi Inactive daripada menghapusnya.`
      );
    }
  }

  const finalRoleCodes = new Set(
    workspace.roles
      .filter((item) => !roleDeleteIds.has(item.id))
      .map((item) => item.roleCode.toUpperCase())
  );
  for (const create of input.roles.creates) {
    const code = create.roleCode.toUpperCase();
    if (finalRoleCodes.has(code)) throw new HttpError(409, `Role Code ${code} sudah digunakan`);
    finalRoleCodes.add(code);
  }

  const menuDeleteIds = new Set<string>();
  for (const id of input.menus.deletes) {
    if (menuDeleteIds.has(id)) throw new HttpError(400, `Menu ${id} dikirim untuk delete lebih dari satu kali`);
    if (!existingMenusById.has(id)) throw new HttpError(404, "Salah satu Menu yang dihapus tidak ditemukan");
    menuDeleteIds.add(id);
  }

  if (input.menus.deletes.length > 0) {
    const approvalUsage = await findMenuApprovalUsage(input.menus.deletes);
    const used = approvalUsage[0];
    if (used) {
      throw new HttpError(
        409,
        `Menu ${used.menu.menuName} digunakan oleh Approval Configuration dan tidak dapat dihapus. Ubah Menu menjadi Inactive untuk menjaga referensi historis.`
      );
    }
  }

  const menuUpdateIds = new Set<string>();
  for (const update of input.menus.updates) {
    if (menuUpdateIds.has(update.id)) throw new HttpError(400, `Menu ${update.id} dikirim lebih dari satu kali`);
    if (menuDeleteIds.has(update.id)) throw new HttpError(400, "Menu yang sama tidak boleh di-update dan di-delete dalam satu Execute");
    if (!existingMenusById.has(update.id)) throw new HttpError(404, "Salah satu Menu yang diubah tidak ditemukan");
    menuUpdateIds.add(update.id);
  }

  const menuUpdateById = new Map(input.menus.updates.map((item) => [item.id, item]));
  for (const menuId of menuDeleteIds) {
    const menu = existingMenusById.get(menuId)!;
    if (menu.menuType === "GROUP") {
      const remainingChild = workspace.menus.find((item) => {
        if (item.parentMenuId !== menuId || menuDeleteIds.has(item.id)) return false;
        const plannedUpdate = menuUpdateById.get(item.id);
        return !plannedUpdate || plannedUpdate.input.parentMenuRef === menuId;
      });
      if (remainingChild) {
        throw new HttpError(
          409,
          `Group ${menu.menuName} masih memiliki child menu ${remainingChild.menuName}. Hapus atau pindahkan child menu terlebih dahulu.`
        );
      }
    }
  }

  const createByClientId = new Map(input.menus.creates.map((item) => [item.clientId, item]));
  const duplicateClientId = input.menus.creates.find(
    (item, index, items) => items.findIndex((other) => other.clientId === item.clientId) !== index
  );
  if (duplicateClientId) throw new HttpError(400, `Draft Menu ${duplicateClientId.clientId} dikirim lebih dari satu kali`);

  const finalMenuCodes = new Set(
    workspace.menus
      .filter((item) => !menuDeleteIds.has(item.id))
      .map((item) => item.menuCode.toUpperCase())
  );
  const finalRoutes = new Set(
    workspace.menus
      .filter((item) => !menuDeleteIds.has(item.id) && item.menuType === "PAGE" && item.route)
      .map((item) => item.route!)
  );

  for (const create of input.menus.creates) {
    const code = create.menuCode.toUpperCase();
    if (finalMenuCodes.has(code)) throw new HttpError(409, `Menu Code ${code} sudah digunakan`);
    finalMenuCodes.add(code);

    if (create.menuType === "PAGE" && create.route) {
      if (finalRoutes.has(create.route)) throw new HttpError(409, `Route ${create.route} sudah digunakan oleh menu lain`);
      finalRoutes.add(create.route);
    }
  }

  const isGroupReference = (ref: string | null) => {
    if (!ref) return false;
    const draft = createByClientId.get(ref);
    if (draft) return draft.menuType === "GROUP";
    const existing = existingMenusById.get(ref);
    return Boolean(existing && !menuDeleteIds.has(existing.id) && existing.menuType === "GROUP");
  };

  for (const create of input.menus.creates) {
    if (create.menuType === "GROUP" && create.parentMenuRef) {
      throw new HttpError(400, `Group ${create.menuCode} tidak boleh memiliki parent`);
    }
    if (create.menuType === "PAGE" && !isGroupReference(create.parentMenuRef)) {
      throw new HttpError(400, `Parent untuk ${create.menuCode} harus berupa Group yang valid`);
    }
  }

  for (const update of input.menus.updates) {
    const existing = existingMenusById.get(update.id)!;
    if (existing.menuType === "GROUP" && update.input.parentMenuRef) {
      throw new HttpError(400, `Group ${existing.menuCode} tidak boleh memiliki parent`);
    }
    if (existing.menuType === "PAGE" && !isGroupReference(update.input.parentMenuRef)) {
      throw new HttpError(400, `Parent untuk ${existing.menuCode} harus berupa Group yang valid`);
    }
  }

  if (input.roleMenus !== undefined && input.roleMenus !== null) {
    const finalRoleIds = new Set(
      workspace.roles.filter((item) => !roleDeleteIds.has(item.id)).map((item) => item.id)
    );
    const finalPageMenuIds = new Set(
      workspace.menus
        .filter((item) => !menuDeleteIds.has(item.id) && item.menuType === "PAGE")
        .map((item) => item.id)
    );

    const assignmentKeys = new Set<string>();
    for (const assignment of input.roleMenus) {
      if (!finalRoleIds.has(assignment.roleId)) throw new HttpError(400, "Role pada Access Matrix tidak valid");
      if (!finalPageMenuIds.has(assignment.menuId)) throw new HttpError(400, "Menu pada Access Matrix harus berupa PAGE yang sudah tersimpan");
      const key = `${assignment.roleId}:${assignment.menuId}`;
      if (assignmentKeys.has(key)) throw new HttpError(400, "Access Matrix berisi assignment duplikat");
      assignmentKeys.add(key);
    }
  }

  const result = await applyRoleWorkspaceAtomic({
    roles: input.roles,
    menus: input.menus,
    roleMenus: input.roleMenus,
    userId
  });

  return {
    changedCount:
      input.roles.creates.length + input.roles.updates.length + input.roles.deletes.length
      + input.menus.creates.length + input.menus.updates.length + input.menus.deletes.length,
    ...toWorkspaceResponse(result)
  };
}
