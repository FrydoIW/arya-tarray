import type { Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma.js";
import {
  assertAdministrativeRecoveryAccessPreserved,
  loadAdministrativeRecoveryAccess
} from "../admin-access-guard.js";

const auditUserSelect = {
  id: true,
  fullName: true
} as const;

export const userInclude = {
  updatedBy: {
    select: auditUserSelect
  },
  userRoles: {
    include: {
      role: {
        select: {
          id: true,
          roleCode: true,
          roleName: true,
          activeFlag: true
        }
      }
    }
  }
} as const;

export function listUsers() {
  return prisma.user.findMany({
    include: userInclude,
    orderBy: [
      { status: "asc" },
      { fullName: "asc" },
      { email: "asc" }
    ]
  });
}

export function listUserRoles() {
  return prisma.role.findMany({
    select: {
      id: true,
      roleCode: true,
      roleName: true,
      description: true,
      activeFlag: true
    },
    orderBy: [
      { activeFlag: "desc" },
      { roleCode: "asc" }
    ]
  });
}

export async function loadUserWorkspace() {
  const [users, roles] = await Promise.all([
    listUsers(),
    listUserRoles()
  ]);

  return { users, roles };
}

export type UserWorkspaceAtomicInput = {
  creates: Array<{
    fullName: string;
    email: string;
    passwordHash: string;
    roleId: string;
    status: "ACTIVE" | "INACTIVE";
  }>;
  updates: Array<{
    id: string;
    input: {
      fullName: string;
      email: string;
      roleId: string;
      status: "ACTIVE" | "INACTIVE";
    };
  }>;
  passwordResets: Array<{
    id: string;
    passwordHash: string;
  }>;
  actorUserId: string;
};

async function loadWorkspaceWithTx(tx: Prisma.TransactionClient) {
  const [users, roles] = await Promise.all([
    tx.user.findMany({
      include: userInclude,
      orderBy: [
        { status: "asc" },
        { fullName: "asc" },
        { email: "asc" }
      ]
    }),
    tx.role.findMany({
      select: {
        id: true,
        roleCode: true,
        roleName: true,
        description: true,
        activeFlag: true
      },
      orderBy: [
        { activeFlag: "desc" },
        { roleCode: "asc" }
      ]
    })
  ]);

  return { users, roles };
}

export async function applyUserWorkspaceAtomic(data: UserWorkspaceAtomicInput) {
  return prisma.$transaction(async (tx) => {
    const hadAdministrativeRecoveryAccess = await loadAdministrativeRecoveryAccess(tx);
    for (const update of data.updates) {
      await tx.user.update({
        where: { id: update.id },
        data: {
          fullName: update.input.fullName,
          email: update.input.email,
          status: update.input.status,
          updatedById: data.actorUserId
        }
      });

      await tx.userRole.deleteMany({
        where: { userId: update.id }
      });

      await tx.userRole.create({
        data: {
          userId: update.id,
          roleId: update.input.roleId
        }
      });
    }

    for (const reset of data.passwordResets) {
      await tx.user.update({
        where: { id: reset.id },
        data: {
          passwordHash: reset.passwordHash,
          updatedById: data.actorUserId
        }
      });
    }

    for (const create of data.creates) {
      const user = await tx.user.create({
        data: {
          fullName: create.fullName,
          email: create.email,
          passwordHash: create.passwordHash,
          status: create.status,
          createdById: data.actorUserId,
          updatedById: data.actorUserId
        }
      });

      await tx.userRole.create({
        data: {
          userId: user.id,
          roleId: create.roleId
        }
      });
    }

    await assertAdministrativeRecoveryAccessPreserved(tx, hadAdministrativeRecoveryAccess);
    return loadWorkspaceWithTx(tx);
  });
}
