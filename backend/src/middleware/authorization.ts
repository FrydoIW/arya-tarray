import type { NextFunction, Request, Response } from "express";
import { prisma } from "../lib/prisma.js";

export async function requireActiveUser(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.auth?.userId;

    if (!userId) {
      res.status(401).json({ message: "Authentication required" });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { status: true }
    });

    if (!user || user.status !== "ACTIVE") {
      res.status(401).json({ message: "User is inactive or no longer available" });
      return;
    }

    next();
  } catch (error) {
    next(error);
  }
}

export function requireMenuAccess(menuCode: string) {
  return async function menuAccessMiddleware(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.auth?.userId;

      if (!userId) {
        res.status(401).json({ message: "Authentication required" });
        return;
      }

      const access = await prisma.userRole.findFirst({
        where: {
          userId,
          role: {
            is: {
              activeFlag: true,
              roleMenus: {
                some: {
                  menu: {
                    is: {
                      menuCode,
                      menuType: "PAGE",
                      activeFlag: true
                    }
                  }
                }
              }
            }
          }
        },
        select: { userId: true }
      });

      if (!access) {
        res.status(403).json({ message: `Access denied for menu ${menuCode}` });
        return;
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}
