import type { Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma.js";
import {
  assertAdministrativeRecoveryAccessPreserved,
  loadAdministrativeRecoveryAccess
} from "../admin-access-guard.js";

export const roleInclude = {
  updatedBy: {
    select: {
      id: true,
      fullName: true
    }
  },
  _count: {
    select: {
      userRoles: true
    }
  }
} as const;

export const menuInclude = {
  parent: {
    select: {
      id: true,
      menuCode: true,
      menuName: true
    }
  },
  updatedBy: {
    select: {
      id: true,
      fullName: true
    }
  },
  _count: {
    select: {
      children: true,
      roleMenus: true
    }
  }
} as const;

export function listRoles(search?: string) {
  return prisma.role.findMany({
    where: search
      ? {
          OR: [
            { roleCode: { contains: search } },
            { roleName: { contains: search } },
            { description: { contains: search } },
            { updatedBy: { is: { fullName: { contains: search } } } }
          ]
        }
      : undefined,
    include: roleInclude,
    orderBy: [{ activeFlag: "desc" }, { roleCode: "asc" }]
  });
}

export function listMenus() {
  return prisma.menu.findMany({
    include: menuInclude,
    orderBy: [
      { parentMenuId: "asc" },
      { displayOrder: "asc" },
      { menuCode: "asc" }
    ]
  });
}

export function listRoleMenus() {
  return prisma.roleMenu.findMany({
    select: {
      roleId: true,
      menuId: true
    }
  });
}

export async function loadRoleWorkspace() {
  const [roles, menus, roleMenus] = await Promise.all([
    listRoles(),
    listMenus(),
    listRoleMenus()
  ]);

  return { roles, menus, roleMenus };
}

export function findRoleUsage(ids: string[]) {
  if (ids.length === 0) return Promise.resolve([]);

  return prisma.role.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      roleCode: true,
      _count: {
        select: {
          userRoles: true
        }
      }
    }
  });
}

export function findMenuApprovalUsage(ids: string[]) {
  if (ids.length === 0) return Promise.resolve([]);

  return prisma.approvalConfig.findMany({
    where: { menuId: { in: ids } },
    select: {
      id: true,
      menuId: true,
      menu: {
        select: {
          menuCode: true,
          menuName: true
        }
      }
    }
  });
}

export type WorkspaceAtomicInput = {
  roles: {
    creates: Array<{
      roleCode: string;
      roleName: string;
      description: string | null;
      activeFlag: boolean;
    }>;
    updates: Array<{
      id: string;
      input: {
        roleName: string;
        description: string | null;
        activeFlag: boolean;
      };
    }>;
    deletes: string[];
  };
  menus: {
    creates: Array<{
      clientId: string;
      parentMenuRef: string | null;
      menuCode: string;
      menuName: string;
      route: string | null;
      menuType: "GROUP" | "PAGE";
      displayOrder: number;
      activeFlag: boolean;
    }>;
    updates: Array<{
      id: string;
      input: {
        parentMenuRef: string | null;
        menuName: string;
        displayOrder: number;
        activeFlag: boolean;
      };
    }>;
    deletes: string[];
  };
  roleMenus?: Array<{ roleId: string; menuId: string }> | null;
  userId: string;
};

async function loadWorkspaceWithTx(tx: Prisma.TransactionClient) {
  const [roles, menus, roleMenus] = await Promise.all([
    tx.role.findMany({
      include: roleInclude,
      orderBy: [{ activeFlag: "desc" }, { roleCode: "asc" }]
    }),
    tx.menu.findMany({
      include: menuInclude,
      orderBy: [
        { parentMenuId: "asc" },
        { displayOrder: "asc" },
        { menuCode: "asc" }
      ]
    }),
    tx.roleMenu.findMany({
      select: { roleId: true, menuId: true }
    })
  ]);

  return { roles, menus, roleMenus };
}

export async function applyRoleWorkspaceAtomic(data: WorkspaceAtomicInput) {
  return prisma.$transaction(async (tx) => {
    const hadAdministrativeRecoveryAccess = await loadAdministrativeRecoveryAccess(tx);
    // Access rows must be removed before deleting a Role or Menu.
    if (data.roles.deletes.length > 0 || data.menus.deletes.length > 0) {
      await tx.roleMenu.deleteMany({
        where: {
          OR: [
            ...(data.roles.deletes.length > 0 ? [{ roleId: { in: data.roles.deletes } }] : []),
            ...(data.menus.deletes.length > 0 ? [{ menuId: { in: data.menus.deletes } }] : [])
          ]
        }
      });
    }

    if (data.roles.deletes.length > 0) {
      await tx.role.deleteMany({ where: { id: { in: data.roles.deletes } } });
    }

    for (const update of data.roles.updates) {
      await tx.role.update({
        where: { id: update.id },
        data: {
          roleName: update.input.roleName,
          description: update.input.description,
          activeFlag: update.input.activeFlag,
          updatedById: data.userId
        }
      });
    }

    for (const create of data.roles.creates) {
      await tx.role.create({
        data: {
          roleCode: create.roleCode,
          roleName: create.roleName,
          description: create.description,
          activeFlag: create.activeFlag,
          createdById: data.userId,
          updatedById: data.userId
        }
      });
    }

    const createdMenuIds = new Map<string, string>();
    const resolveParent = (ref: string | null) => ref ? (createdMenuIds.get(ref) ?? ref) : null;

    // Create draft Groups first so existing/draft Pages can point to them in the same Execute.
    for (const create of data.menus.creates.filter((item) => item.menuType === "GROUP")) {
      const created = await tx.menu.create({
        data: {
          parentMenuId: null,
          menuCode: create.menuCode,
          menuName: create.menuName,
          route: null,
          menuType: create.menuType,
          displayOrder: create.displayOrder,
          activeFlag: create.activeFlag,
          createdById: data.userId,
          updatedById: data.userId
        }
      });
      createdMenuIds.set(create.clientId, created.id);
    }

    // Move/update existing Pages before deleting an old parent Group.
    for (const update of data.menus.updates) {
      await tx.menu.update({
        where: { id: update.id },
        data: {
          parentMenuId: resolveParent(update.input.parentMenuRef),
          menuName: update.input.menuName,
          displayOrder: update.input.displayOrder,
          activeFlag: update.input.activeFlag,
          updatedById: data.userId
        }
      });
    }

    // Delete child Pages before parent Groups to satisfy the self FK.
    if (data.menus.deletes.length > 0) {
      await tx.menu.deleteMany({
        where: {
          id: { in: data.menus.deletes },
          menuType: "PAGE"
        }
      });
      await tx.menu.deleteMany({
        where: {
          id: { in: data.menus.deletes },
          menuType: "GROUP"
        }
      });
    }

    // Pages last so they can resolve persisted or newly created Group parents.
    for (const create of data.menus.creates.filter((item) => item.menuType === "PAGE")) {
      const created = await tx.menu.create({
        data: {
          parentMenuId: resolveParent(create.parentMenuRef),
          menuCode: create.menuCode,
          menuName: create.menuName,
          route: create.route,
          menuType: create.menuType,
          displayOrder: create.displayOrder,
          activeFlag: create.activeFlag,
          createdById: data.userId,
          updatedById: data.userId
        }
      });
      createdMenuIds.set(create.clientId, created.id);
    }

    if (data.roleMenus !== undefined && data.roleMenus !== null) {
      await tx.roleMenu.deleteMany();
      if (data.roleMenus.length > 0) {
        await tx.roleMenu.createMany({
          data: data.roleMenus.map((item) => ({
            roleId: item.roleId,
            menuId: item.menuId,
            createdById: data.userId
          }))
        });
      }
    }

    await assertAdministrativeRecoveryAccessPreserved(tx, hadAdministrativeRecoveryAccess);
    return loadWorkspaceWithTx(tx);
  });
}
