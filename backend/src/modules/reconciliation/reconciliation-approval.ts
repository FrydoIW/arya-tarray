import type { Prisma } from "@prisma/client";
import {
  SIGN_APPROVAL_MENU_CODE,
  STATEMENT_UPLOAD_APPROVAL_MENU_CODE
} from "../../constants/approval.js";

export function loadActiveStatementApprovalConfigWithEligibleApprovers(
  tx: Prisma.TransactionClient
) {
  return tx.approvalConfig.findFirst({
    where: {
      activeFlag: true,
      menu: {
        is: {
          menuCode: STATEMENT_UPLOAD_APPROVAL_MENU_CODE,
          menuType: "PAGE",
          activeFlag: true
        }
      }
    },
    select: {
      id: true,
      approvers: {
        where: {
          approverUser: {
            is: {
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
                              menuCode: SIGN_APPROVAL_MENU_CODE,
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
            }
          }
        },
        select: { approverUserId: true }
      }
    }
  });
}
