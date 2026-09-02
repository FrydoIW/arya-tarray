import type { Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma.js";
import {
  SIGN_APPROVAL_MENU_CODE,
  STATEMENT_UPLOAD_APPROVAL_MENU_CODE
} from "../../../constants/approval.js";

export const SUPPORTED_APPROVAL_MENU_CODE = STATEMENT_UPLOAD_APPROVAL_MENU_CODE;
export const APPROVER_ACCESS_MENU_CODE = SIGN_APPROVAL_MENU_CODE;

const approvalConfigInclude = {
  menu: {
    select: {
      id: true,
      menuCode: true,
      menuName: true,
      route: true,
      menuType: true,
      activeFlag: true
    }
  },
  updatedBy: {
    select: {
      id: true,
      fullName: true
    }
  },
  approvers: {
    include: {
      approverUser: {
        select: {
          id: true,
          fullName: true,
          email: true,
          status: true
        }
      }
    },
    orderBy: {
      createdAt: "asc"
    }
  }
} as const;

const supportedMenuSelect = {
  id: true,
  menuCode: true,
  menuName: true,
  route: true,
  menuType: true,
  activeFlag: true
} as const;

const approverUserSelect = {
  id: true,
  fullName: true,
  email: true,
  status: true
} as const;

function listApprovalConfigsWithClient(client: Prisma.TransactionClient | typeof prisma) {
  return client.approvalConfig.findMany({
    where: {
      menu: {
        is: {
          menuCode: SUPPORTED_APPROVAL_MENU_CODE,
          menuType: "PAGE"
        }
      }
    },
    include: approvalConfigInclude,
    orderBy: [{ activeFlag: "desc" }, { createdAt: "asc" }]
  });
}

function listSupportedMenusWithClient(client: Prisma.TransactionClient | typeof prisma) {
  return client.menu.findMany({
    where: {
      menuCode: SUPPORTED_APPROVAL_MENU_CODE,
      menuType: "PAGE"
    },
    select: supportedMenuSelect,
    orderBy: { displayOrder: "asc" }
  });
}

function listEligibleApproversWithClient(client: Prisma.TransactionClient | typeof prisma) {
  return client.user.findMany({
    where: {
      status: "ACTIVE",
      userRoles: {
        some: {
          role: {
            is: {
              activeFlag: true,
              roleMenus: {
                some: {
                  menu: {
                    is: {
                      menuCode: APPROVER_ACCESS_MENU_CODE,
                      menuType: "PAGE",
                      activeFlag: true
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    select: approverUserSelect,
    orderBy: [{ fullName: "asc" }, { email: "asc" }]
  });
}

export async function loadApprovalWorkspace() {
  const [configurations, menus, approverUsers] = await Promise.all([
    listApprovalConfigsWithClient(prisma),
    listSupportedMenusWithClient(prisma),
    listEligibleApproversWithClient(prisma)
  ]);

  return { configurations, menus, approverUsers };
}

export type ApprovalWorkspaceAtomicInput = {
  creates: Array<{
    clientId: string;
    menuId: string;
    approverUserIds: string[];
    activeFlag: boolean;
  }>;
  updates: Array<{
    id: string;
    input: {
      approverUserIds: string[];
      activeFlag: boolean;
    };
  }>;
  userId: string;
};

async function loadWorkspaceWithTx(tx: Prisma.TransactionClient) {
  const [configurations, menus, approverUsers] = await Promise.all([
    listApprovalConfigsWithClient(tx),
    listSupportedMenusWithClient(tx),
    listEligibleApproversWithClient(tx)
  ]);

  return { configurations, menus, approverUsers };
}

export async function applyApprovalWorkspaceAtomic(data: ApprovalWorkspaceAtomicInput) {
  return prisma.$transaction(async (tx) => {
    for (const create of data.creates) {
      const config = await tx.approvalConfig.create({
        data: {
          menuId: create.menuId,
          activeFlag: create.activeFlag,
          createdById: data.userId,
          updatedById: data.userId
        }
      });

      await tx.approvalConfigApprover.createMany({
        data: create.approverUserIds.map((approverUserId) => ({
          approvalConfigId: config.id,
          approverUserId,
          createdById: data.userId
        }))
      });
    }

    for (const update of data.updates) {
      const existingMembership = await tx.approvalConfigApprover.findMany({
        where: { approvalConfigId: update.id },
        select: { approverUserId: true }
      });

      const existingIds = new Set(existingMembership.map((item) => item.approverUserId));
      const requestedIds = new Set(update.input.approverUserIds);
      const removedIds = [...existingIds].filter((id) => !requestedIds.has(id));
      const addedIds = [...requestedIds].filter((id) => !existingIds.has(id));

      if (removedIds.length > 0) {
        await tx.approvalConfigApprover.deleteMany({
          where: {
            approvalConfigId: update.id,
            approverUserId: { in: removedIds }
          }
        });
      }

      if (addedIds.length > 0) {
        await tx.approvalConfigApprover.createMany({
          data: addedIds.map((approverUserId) => ({
            approvalConfigId: update.id,
            approverUserId,
            createdById: data.userId
          }))
        });
      }

      await tx.approvalConfig.update({
        where: { id: update.id },
        data: {
          activeFlag: update.input.activeFlag,
          updatedById: data.userId
        }
      });
    }

    return loadWorkspaceWithTx(tx);
  });
}
