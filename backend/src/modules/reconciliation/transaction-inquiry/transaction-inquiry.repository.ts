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
  memberIdentity: {
    select: {
      id: true,
      accountName: true,
      verificationStatus: true,
      member: {
        select: { id: true, memberCode: true, memberName: true, initialName: true, activeFlag: true }
      }
    }
  },
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
  memberId?: string;
  memberLinkStatus: "ALL" | "LINKED" | "UNLINKED";
};

export function buildTransactionInquiryWhere(filter: TransactionInquiryFilter): Prisma.BankTransactionWhereInput {
  const search = filter.search.trim();
  const conditions: Prisma.BankTransactionWhereInput[] = [
    { transactionDate: { gte: filter.periodStart, lt: filter.periodEnd } }
  ];
  if (filter.status !== "ALL") conditions.push({ status: filter.status });
  if (filter.bankAccountId) conditions.push({ statementUpload: { is: { bankAccountId: filter.bankAccountId } } });
  if (filter.finalEventId) conditions.push({ eventCodeId: filter.finalEventId });
  if (filter.memberId) conditions.push({ memberIdentity: { is: { memberId: filter.memberId } } });
  if (filter.memberLinkStatus === "LINKED") {
    conditions.push({ memberIdentity: { is: { member: { isNot: null } } } });
  } else if (filter.memberLinkStatus === "UNLINKED") {
    conditions.push({ OR: [{ memberIdentityId: null }, { memberIdentity: { is: { memberId: null } } }] });
  }
  if (search) {
    conditions.push({
      OR: [
        { description: { contains: search } },
        { referenceNo: { contains: search } },
        { senderName: { contains: search } },
        { transactionType: { contains: search } },
        { statementUpload: { is: { fileName: { contains: search } } } },
        { statementUpload: { is: { bankAccount: { is: { accountNo: { contains: search } } } } } },
        { statementUpload: { is: { bankAccount: { is: { accountName: { contains: search } } } } } }
      ]
    });
  }
  return { AND: conditions };
}

export async function loadTransactionInquiryWorkspaceRecords(input: {
  filter: TransactionInquiryFilter;
  page: number;
  pageSize: number;
}) {
  const where = buildTransactionInquiryWhere(input.filter);
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
      memberIdentity: {
        select: {
          id: true,
          accountName: true,
          verificationStatus: true,
          member: { select: { id: true, memberCode: true, memberName: true, initialName: true, activeFlag: true } }
        }
      },
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
  const where = buildTransactionInquiryWhere(input.filter);
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

const memberOptionSelect = {
  id: true,
  memberCode: true,
  memberName: true,
  initialName: true,
  activeFlag: true
} as const;

export function loadTransactionInquiryMemberOptions(search: string, limit: number) {
  const term = search.trim();
  return prisma.member.findMany({
    where: term ? {
      OR: [
        { memberCode: { contains: term } },
        { memberName: { contains: term } },
        { initialName: { contains: term } }
      ]
    } : undefined,
    select: memberOptionSelect,
    orderBy: [{ activeFlag: "desc" }, { memberCode: "asc" }],
    take: limit
  });
}

export function loadTransactionInquiryMemberOption(memberId: string) {
  return prisma.member.findUnique({ where: { id: memberId }, select: memberOptionSelect });
}
