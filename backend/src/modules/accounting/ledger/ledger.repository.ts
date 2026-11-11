import type { Prisma } from "@prisma/client";

export function openPeriodsForDate(tx: Prisma.TransactionClient, date: Date) {
  return tx.accountingPeriod.findMany({ where: { startDate: { lte: date }, endDate: { gte: date } },
    select: { id: true, status: true, relFkAccPeriodFy: { select: { status: true } } }, take: 2 });
}

export function postingAccountsByIds(tx: Prisma.TransactionClient, ids: string[]) {
  return tx.accountingAccount.findMany({ where: { id: { in: ids } },
    select: { id: true, code: true, name: true, postingFlag: true, activeFlag: true } });
}

export function bankAccountsByIds(tx: Prisma.TransactionClient, ids: string[]) {
  return tx.bankAccount.findMany({ where: { id: { in: ids } },
    select: { id: true, bankName: true, accountNo: true, accountName: true, activeFlag: true } });
}

export function restrictionsByIds(tx: Prisma.TransactionClient, ids: string[]) {
  return tx.accountingFundRestriction.findMany({ where: { id: { in: ids } },
    select: { id: true, accountingFundId: true, status: true } });
}

export function activeFundsByIds(tx: Prisma.TransactionClient, ids: string[]) {
  return tx.accountingFund.findMany({ where: { id: { in: ids }, status: "ACTIVE" }, select: { id: true } });
}

export function counterpartyIds(tx: Prisma.TransactionClient, ids: string[]) {
  return tx.accountingCounterparty.findMany({ where: { id: { in: ids }, activeFlag: true }, select: { id: true } });
}
