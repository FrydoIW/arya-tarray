import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ADMIN_EMAIL = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim() || "admin@aryatarray.local";
const ADMIN_NAME = process.env.BOOTSTRAP_ADMIN_NAME?.trim() || "Arya Tarray Admin";

function bootstrapAdminPassword() {
  const value = process.env.BOOTSTRAP_ADMIN_PASSWORD?.trim();
  if (!value) {
    throw new Error(
      "BOOTSTRAP_ADMIN_PASSWORD is required only when the bootstrap admin does not exist yet."
    );
  }
  if (value.length < 12) {
    throw new Error("BOOTSTRAP_ADMIN_PASSWORD must contain at least 12 characters.");
  }
  return value;
}

async function ensureRole(roleCode: string, roleName: string, description: string) {
  const existing = await prisma.role.findFirst({ where: { roleCode } });

  if (existing) {
    return existing;
  }

  return prisma.role.create({
    data: { roleCode, roleName, description, activeFlag: true }
  });
}

async function ensureAdmin(adminRoleId: string) {
  const existing = await prisma.user.findFirst({ where: { email: ADMIN_EMAIL } });

  const admin = existing
    ? existing
    : await prisma.user.create({
        data: {
          fullName: ADMIN_NAME,
          email: ADMIN_EMAIL,
          passwordHash: await bcrypt.hash(bootstrapAdminPassword(), 12),
          status: "ACTIVE"
        }
      });

  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: admin.id,
        roleId: adminRoleId
      }
    },
    update: {},
    create: {
      userId: admin.id,
      roleId: adminRoleId
    }
  });

  return admin;
}


async function stampRoleAudit(roleIds: string[], userId: string) {
  await prisma.role.updateMany({
    where: { id: { in: roleIds }, createdById: null },
    data: { createdById: userId }
  });
  await prisma.role.updateMany({
    where: { id: { in: roleIds }, updatedById: null },
    data: { updatedById: userId }
  });
}

async function ensureEventCode(
  code: string,
  eventName: string,
  description: string,
  userId: string
) {
  const existing = await prisma.eventCode.findFirst({ where: { code } });

  if (existing) {
    return existing;
  }

  return prisma.eventCode.create({
    data: {
      code,
      eventName,
      description,
      activeFlag: true,
      createdById: userId,
      updatedById: userId
    }
  });
}


async function ensureBankAccountMenu(userId: string, adminRoleId: string) {
  let configuration = await prisma.menu.findFirst({ where: { menuCode: "CONFIGURATION" } });

  if (!configuration) {
    configuration = await prisma.menu.create({
      data: {
        menuCode: "CONFIGURATION",
        menuName: "Configuration",
        route: null,
        menuType: "GROUP",
        displayOrder: 40,
        activeFlag: true,
        createdById: userId,
        updatedById: userId
      }
    });
  }

  const existing = await prisma.menu.findFirst({ where: { menuCode: "CONFIG_BANK_ACCOUNT" } });
  const sibling = await prisma.menu.findFirst({
    where: { parentMenuId: configuration.id },
    orderBy: { displayOrder: "desc" },
    select: { displayOrder: true }
  });

  const menu = existing
    ? await prisma.menu.update({
        where: { id: existing.id },
        data: {
          parentMenuId: configuration.id,
          menuName: "Bank Account",
          route: "/configuration/bank-account",
          menuType: "PAGE",
          activeFlag: true,
          updatedById: userId
        }
      })
    : await prisma.menu.create({
        data: {
          parentMenuId: configuration.id,
          menuCode: "CONFIG_BANK_ACCOUNT",
          menuName: "Bank Account",
          route: "/configuration/bank-account",
          menuType: "PAGE",
          displayOrder: (sibling?.displayOrder ?? 0) + 10,
          activeFlag: true,
          createdById: userId,
          updatedById: userId
        }
      });

  await prisma.roleMenu.upsert({
    where: { roleId_menuId: { roleId: adminRoleId, menuId: menu.id } },
    update: {},
    create: { roleId: adminRoleId, menuId: menu.id, createdById: userId }
  });

  return menu;
}


async function ensureEditIncomeMenu(userId: string, adminRoleId: string) {
  let reconciliation = await prisma.menu.findFirst({ where: { menuCode: "RECONCILIATION" } });

  if (!reconciliation) {
    reconciliation = await prisma.menu.create({
      data: {
        menuCode: "RECONCILIATION",
        menuName: "Reconciliation",
        route: null,
        menuType: "GROUP",
        displayOrder: 20,
        activeFlag: true,
        createdById: userId,
        updatedById: userId
      }
    });
  }

  const existing = await prisma.menu.findFirst({ where: { menuCode: "RECON_EDIT_INCOME" } });
  const statementUpload = await prisma.menu.findFirst({
    where: { menuCode: "RECON_STATEMENT_UPLOAD", parentMenuId: reconciliation.id },
    select: { displayOrder: true }
  });
  const sibling = await prisma.menu.findFirst({
    where: { parentMenuId: reconciliation.id },
    orderBy: { displayOrder: "desc" },
    select: { displayOrder: true }
  });
  const preferredOrder = statementUpload ? statementUpload.displayOrder + 10 : (sibling?.displayOrder ?? 0) + 10;

  const menu = existing
    ? await prisma.menu.update({
        where: { id: existing.id },
        data: {
          parentMenuId: reconciliation.id,
          menuName: "Edit Income",
          route: "/reconciliation/edit-income",
          menuType: "PAGE",
          activeFlag: true,
          updatedById: userId
        }
      })
    : await prisma.menu.create({
        data: {
          parentMenuId: reconciliation.id,
          menuCode: "RECON_EDIT_INCOME",
          menuName: "Edit Income",
          route: "/reconciliation/edit-income",
          menuType: "PAGE",
          displayOrder: preferredOrder,
          activeFlag: true,
          createdById: userId,
          updatedById: userId
        }
      });

  await prisma.roleMenu.upsert({
    where: { roleId_menuId: { roleId: adminRoleId, menuId: menu.id } },
    update: {},
    create: { roleId: adminRoleId, menuId: menu.id, createdById: userId }
  });

  return menu;
}


async function ensureTransactionInquiryMenu(userId: string, adminRoleId: string) {
  let reconciliation = await prisma.menu.findFirst({ where: { menuCode: "RECONCILIATION" } });

  if (!reconciliation) {
    reconciliation = await prisma.menu.create({
      data: {
        menuCode: "RECONCILIATION",
        menuName: "Reconciliation",
        route: null,
        menuType: "GROUP",
        displayOrder: 20,
        activeFlag: true,
        createdById: userId,
        updatedById: userId
      }
    });
  }

  const existing = await prisma.menu.findFirst({ where: { menuCode: "RECON_TRANSACTION_INQUIRY" } });
  const editIncome = await prisma.menu.findFirst({
    where: { menuCode: "RECON_EDIT_INCOME", parentMenuId: reconciliation.id },
    select: { displayOrder: true }
  });
  const sibling = await prisma.menu.findFirst({
    where: { parentMenuId: reconciliation.id },
    orderBy: { displayOrder: "desc" },
    select: { displayOrder: true }
  });
  const preferredOrder = editIncome ? editIncome.displayOrder + 10 : (sibling?.displayOrder ?? 0) + 10;

  const menu = existing
    ? await prisma.menu.update({
        where: { id: existing.id },
        data: {
          parentMenuId: reconciliation.id,
          menuName: "Transaction Inquiry",
          route: "/reconciliation/transaction-inquiry",
          menuType: "PAGE",
          activeFlag: true,
          updatedById: userId
        }
      })
    : await prisma.menu.create({
        data: {
          parentMenuId: reconciliation.id,
          menuCode: "RECON_TRANSACTION_INQUIRY",
          menuName: "Transaction Inquiry",
          route: "/reconciliation/transaction-inquiry",
          menuType: "PAGE",
          displayOrder: preferredOrder,
          activeFlag: true,
          createdById: userId,
          updatedById: userId
        }
      });

  await prisma.roleMenu.upsert({
    where: { roleId_menuId: { roleId: adminRoleId, menuId: menu.id } },
    update: {},
    create: { roleId: adminRoleId, menuId: menu.id, createdById: userId }
  });

  return menu;
}

async function ensureMonitoringDashboardMenu(userId: string, adminRoleId: string) {
  let monitoring = await prisma.menu.findFirst({ where: { menuCode: "MONITORING" } });

  if (!monitoring) {
    monitoring = await prisma.menu.create({
      data: {
        menuCode: "MONITORING",
        menuName: "Monitoring",
        route: null,
        menuType: "GROUP",
        displayOrder: 10,
        activeFlag: true,
        createdById: userId,
        updatedById: userId
      }
    });
  }

  const existing = await prisma.menu.findFirst({ where: { menuCode: "MONITORING_DASHBOARD" } });
  const menu = existing
    ? await prisma.menu.update({
        where: { id: existing.id },
        data: {
          parentMenuId: monitoring.id,
          menuName: "Dashboard",
          route: "/dashboard",
          menuType: "PAGE",
          displayOrder: 10,
          activeFlag: true,
          updatedById: userId
        }
      })
    : await prisma.menu.create({
        data: {
          parentMenuId: monitoring.id,
          menuCode: "MONITORING_DASHBOARD",
          menuName: "Dashboard",
          route: "/dashboard",
          menuType: "PAGE",
          displayOrder: 10,
          activeFlag: true,
          createdById: userId,
          updatedById: userId
        }
      });

  await prisma.roleMenu.upsert({
    where: { roleId_menuId: { roleId: adminRoleId, menuId: menu.id } },
    update: {},
    create: { roleId: adminRoleId, menuId: menu.id, createdById: userId }
  });

  return menu;
}

async function main() {
  const bootstrapAdmin = await prisma.user.findFirst({
    where: { email: ADMIN_EMAIL },
    select: { id: true }
  });
  if (!bootstrapAdmin) {
    bootstrapAdminPassword();
  }

  const roles = await Promise.all([
    ensureRole("ADMIN", "Administrator", "Full system administration access"),
    ensureRole("OPERATOR", "Reconciliation Operator", "Statement and reconciliation operator"),
    ensureRole("APPROVER", "Approval Signer", "Reconciliation approval signer"),
    ensureRole("VIEWER", "Inquiry Viewer", "Read-only operational access")
  ]);

  const adminRole = roles.find((role) => role.roleCode === "ADMIN")!;
  const admin = await ensureAdmin(adminRole.id);
  await stampRoleAudit(roles.map((role) => role.id), admin.id);

  await Promise.all([
    ensureEventCode("017", "Rupang", "Donation allocation for Rupang", admin.id),
    ensureEventCode("058", "Sangha Dana", "Donation allocation for Sangha Dana", admin.id),
    ensureEventCode("075", "Proyek Bhutan", "Donation allocation for Proyek Bhutan", admin.id)
  ]);

  await ensureMonitoringDashboardMenu(admin.id, adminRole.id);
  await ensureBankAccountMenu(admin.id, adminRole.id);
  await ensureEditIncomeMenu(admin.id, adminRole.id);
  await ensureTransactionInquiryMenu(admin.id, adminRole.id);

  console.log("Arya Tarray foundation seed completed.");
  console.log(`Bootstrap admin: ${ADMIN_EMAIL}`);
  console.log("Existing admin credentials were not modified by this seed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());
