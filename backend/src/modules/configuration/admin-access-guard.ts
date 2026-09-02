import type { Prisma } from "@prisma/client";
import { HttpError } from "../../lib/http.js";

export const ADMIN_RECOVERY_MENU_CODES = ["CONFIG_ROLE", "CONFIG_USER"] as const;

export type AdminAccessSnapshotUser = {
  status: string;
  userRoles: Array<{
    role: {
      activeFlag: boolean;
      roleMenus: Array<{
        menu: {
          menuCode: string;
          menuType: string;
          activeFlag: boolean;
        };
      }>;
    };
  }>;
};

type AdminAccessClient = Pick<Prisma.TransactionClient, "user">;

export function hasAdministrativeRecoveryAccess(users: AdminAccessSnapshotUser[]) {
  return users.some((user) => {
    if (user.status !== "ACTIVE") return false;

    const effectiveMenuCodes = new Set<string>();
    for (const userRole of user.userRoles) {
      if (!userRole.role.activeFlag) continue;
      for (const roleMenu of userRole.role.roleMenus) {
        const menu = roleMenu.menu;
        if (menu.menuType === "PAGE" && menu.activeFlag) {
          effectiveMenuCodes.add(menu.menuCode);
        }
      }
    }

    return ADMIN_RECOVERY_MENU_CODES.every((menuCode) => effectiveMenuCodes.has(menuCode));
  });
}

export function shouldRejectAdministrativeAccessLoss(hadAccessBefore: boolean, hasAccessAfter: boolean) {
  return hadAccessBefore && !hasAccessAfter;
}

export async function loadAdministrativeRecoveryAccess(client: AdminAccessClient) {
  const users = await client.user.findMany({
    where: { status: "ACTIVE" },
    select: {
      status: true,
      userRoles: {
        select: {
          role: {
            select: {
              activeFlag: true,
              roleMenus: {
                select: {
                  menu: {
                    select: {
                      menuCode: true,
                      menuType: true,
                      activeFlag: true
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  });

  return hasAdministrativeRecoveryAccess(users);
}

export async function assertAdministrativeRecoveryAccessPreserved(
  client: AdminAccessClient,
  hadAccessBefore: boolean
) {
  if (!hadAccessBefore) return;

  const hasAccessAfter = await loadAdministrativeRecoveryAccess(client);
  if (shouldRejectAdministrativeAccessLoss(hadAccessBefore, hasAccessAfter)) {
    throw new HttpError(
      409,
      "Perubahan ditolak karena harus selalu tersisa minimal satu user ACTIVE yang memiliki akses Configuration Role dan User."
    );
  }
}
