import { Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma.js";

export function listFiscalYears() {
  return prisma.accountingFiscalYear.findMany({ orderBy: [{ startDate: "desc" }, { yearCode: "desc" }],
    take: 100, include: { revFkAccPeriodFy: { orderBy: { periodNo: "asc" }, take: 53 } } });
}

export function findOverlappingFiscalYear(tx: Prisma.TransactionClient, start: Date, end: Date) {
  return tx.accountingFiscalYear.findFirst({ where: { startDate: { lte: end }, endDate: { gte: start } }, select: { id: true } });
}

export function findOverlappingPeriod(tx: Prisma.TransactionClient, start: Date, end: Date) {
  return tx.accountingPeriod.findFirst({ where: { startDate: { lte: end }, endDate: { gte: start } }, select: { id: true } });
}
