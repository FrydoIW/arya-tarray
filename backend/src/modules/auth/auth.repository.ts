import { prisma } from "../../lib/prisma.js";

const userWithRoles = {
  userRoles: {
    include: {
      role: {
        include: {
          roleMenus: {
            include: {
              menu: true
            }
          }
        }
      }
    }
  }
} as const;

export function findUserByEmail(email: string) {
  return prisma.user.findFirst({
    where: { email },
    include: userWithRoles
  });
}

export function findUserById(id: string) {
  return prisma.user.findUnique({
    where: { id },
    include: userWithRoles
  });
}
