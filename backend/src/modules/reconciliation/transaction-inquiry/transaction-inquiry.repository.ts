import type { Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma.js";

const eventCodeSelect = {
  id: true,
  code: true,
  eventName: true
} as const;

const bankAccountSelect = {
  id: true,
  bankCode: true,
  bankName: true,
  accountNo: true,
  accountName: true,
  currencyCode: true,
  activeFlag: true
} as const;

const transactionListSelect = {
  id: true,
  transactionDate: true,
  transactionType: true,
  referenceNo: true,
  senderName: true,
  description: true,
  originalAmount: true,
  suffixCode: true,
  baseAmount: true,
  status: true,
  remark: true,
  suggestedEventCode: { select: eventCodeSelect },
  eventCode: { select: eventCodeSelect },
  statementUpload: {
    select: {
      id: true,
      fileName: true,
      periodFrom: true,
      periodTo: true,
      bankAccount: { select: bankAccountSelect }
    }
  }
} as const;

export type TransactionInquiryFilter = {
  periodStart: Date;
  periodEnd: Date;
  search: string;
  status: "ALL" | "RAW" | "CHECK" | "FINALIZED";
  bankAccountId?: string;
  finalEventId?: string;
};

function buildWhere(filter: TransactionInquiryFilter): Prisma.BankTransactionWhereInput {
  const search = filter.search.trim();
  return {
    transactionDate: { gte: filter.periodStart, lt: filter.periodEnd },
    ...(filter.status !== "ALL" ? { status: filter.status } : {}),
    ...(filter.bankAccountId ? { statementUpload: { is: { bankAccountId: filter.bankAccountId } } } : {}),
    ...(filter.finalEventId ? { eventCodeId: filter.finalEventId } : {}),
    ...(search ? {
      OR: [
        { description: { contains: search } },
        { referenceNo: { contains: search } },
        { senderName: { contains: search } },
        { transactionType: { contains: search } },
        { statementUpload: { is: { fileName: { contains: search } } } },
        { statementUpload: { is: { bankAccount: { is: { accountNo: { contains: search } } } } } },
        { statementUpload: { is: { bankAccount: { is: { accountName: { contains: search } } } } } }
      ]
    } : {})
  };
}

export async function loadTransactionInquiryWorkspaceRecords(input: {
  filter: TransactionInquiryFilter;
  page: number;
  pageSize: number;
}) {
  const where = buildWhere(input.filter);
  const skip = (input.page - 1) * input.pageSize;

  const [transactions, total, totalCredit, totalDebit, completeTransactions, bankAccounts, eventOptions] = await Promise.all([
    prisma.bankTransaction.findMany({
      where,
      select: transactionListSelect,
      orderBy: [{ transactionDate: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      skip,
      take: input.pageSize
    }),
    prisma.bankTransaction.count({ where }),
    prisma.bankTransaction.aggregate({
      where: { AND: [where, { originalAmount: { gt: 0 } }] },
      _sum: { originalAmount: true },
      _count: { _all: true }
    }),
    prisma.bankTransaction.aggregate({
      where: { AND: [where, { originalAmount: { lt: 0 } }] },
      _sum: { originalAmount: true },
      _count: { _all: true }
    }),
    prisma.bankTransaction.count({ where: { AND: [where, { status: "FINALIZED" }] } }),
    prisma.bankAccount.findMany({
      select: bankAccountSelect,
      orderBy: [{ bankCode: "asc" }, { accountNo: "asc" }]
    }),
    prisma.eventCode.findMany({
      where: { activeFlag: true },
      select: eventCodeSelect,
      orderBy: [{ code: "asc" }, { eventName: "asc" }]
    })
  ]);

  return {
    transactions,
    total,
    totalCredit: totalCredit._sum.originalAmount,
    totalDebit: totalDebit._sum.originalAmount,
    incomingTransactions: totalCredit._count._all,
    outgoingTransactions: totalDebit._count._all,
    completeTransactions,
    bankAccounts,
    eventOptions
  };
}

export async function loadTransactionInquiryDetailRecord(transactionId: string) {
  return prisma.bankTransaction.findUnique({
    where: { id: transactionId },
    include: {
      suggestedEventCode: { select: eventCodeSelect },
      eventCode: { select: eventCodeSelect },
      statementUpload: {
        include: {
          bankAccount: { select: bankAccountSelect },
          uploadedBy: { select: { id: true, fullName: true } },
          executedBy: { select: { id: true, fullName: true } },
          finalizedBy: { select: { id: true, fullName: true } },
          approval: {
            select: {
              id: true,
              status: true,
              submittedAt: true,
              decidedAt: true
            }
          }
        }
      },
      history: {
        include: {
          changedBy: { select: { id: true, fullName: true } }
        },
        orderBy: [{ changedAt: "desc" }, { id: "desc" }]
      }
    }
  });
}

export async function loadTransactionInquiryReportRecords(input: {
  filter: TransactionInquiryFilter;
  limit: number;
}) {
  const where = buildWhere(input.filter);
  const [count, transactions, userBankAccounts] = await Promise.all([
    prisma.bankTransaction.count({ where }),
    prisma.bankTransaction.findMany({
      where,
      select: transactionListSelect,
      orderBy: [{ transactionDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      take: input.limit + 1
    }),
    input.filter.bankAccountId
      ? prisma.bankAccount.findMany({ where: { id: input.filter.bankAccountId }, select: bankAccountSelect })
      : prisma.bankAccount.findMany({
          where: { statements: { some: { transactions: { some: { transactionDate: { gte: input.filter.periodStart, lt: input.filter.periodEnd } } } } } },
          select: bankAccountSelect,
          orderBy: [{ bankCode: "asc" }, { accountNo: "asc" }]
        })
  ]);
  return { count, transactions, bankAccounts: userBankAccounts };
}

export async function loadReportGeneratedBy(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, fullName: true, email: true }
  });
}

export async function loadEventCodeLabels(ids: string[]) {
  if (ids.length === 0) return [];
  return prisma.eventCode.findMany({
    where: { id: { in: ids } },
    select: eventCodeSelect
  });
}

export function loadTransactionInquiryEventOption(eventCodeId: string) {
  return prisma.eventCode.findUnique({ where: { id: eventCodeId }, select: eventCodeSelect });
}
