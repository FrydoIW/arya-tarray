import type { Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma.js";

export type DashboardMonthRange = {
  monthStart: Date;
  nextMonthStart: Date;
};

function transactionMonthWhere(range: DashboardMonthRange): Prisma.BankTransactionWhereInput {
  return {
    transactionDate: {
      gte: range.monthStart,
      lt: range.nextMonthStart
    }
  };
}

function statementMonthWhere(range: DashboardMonthRange): Prisma.BankStatementUploadWhereInput {
  return {
    AND: [
      { periodFrom: { lt: range.nextMonthStart } },
      { periodTo: { gte: range.monthStart } }
    ]
  };
}

export async function loadDashboardMonthSummary(range: DashboardMonthRange) {
  const transactionWhere = transactionMonthWhere(range);
  const statementWhere = statementMonthWhere(range);

  const [
    totalStatements,
    totalTransactions,
    incoming,
    outgoing,
    completeTransactions,
    transactionStatusGroups,
    statementStatusGroups,
    rawTransactions
  ] = await Promise.all([
    prisma.bankStatementUpload.count({ where: statementWhere }),
    prisma.bankTransaction.count({ where: transactionWhere }),
    prisma.bankTransaction.aggregate({
      where: { AND: [transactionWhere, { originalAmount: { gt: 0 } }] },
      _sum: { originalAmount: true },
      _count: { _all: true }
    }),
    prisma.bankTransaction.aggregate({
      where: { AND: [transactionWhere, { originalAmount: { lt: 0 } }] },
      _sum: { originalAmount: true },
      _count: { _all: true }
    }),
    prisma.bankTransaction.count({
      where: { AND: [transactionWhere, { status: "FINALIZED" }] }
    }),
    prisma.bankTransaction.groupBy({
      by: ["status"],
      where: transactionWhere,
      _count: { _all: true }
    }),
    prisma.bankStatementUpload.groupBy({
      by: ["status"],
      where: statementWhere,
      _count: { _all: true }
    }),
    prisma.bankTransaction.findMany({
      where: { AND: [transactionWhere, { status: "RAW" }] },
      select: {
        transactionType: true,
        originalAmount: true,
        eventCodeId: true
      }
    })
  ]);

  return {
    totalStatements,
    totalTransactions,
    incomingAmount: incoming._sum.originalAmount,
    incomingTransactions: incoming._count._all,
    outgoingAmount: outgoing._sum.originalAmount,
    outgoingTransactions: outgoing._count._all,
    completeTransactions,
    transactionStatusGroups,
    statementStatusGroups,
    rawTransactions
  };
}

export async function loadDashboardTrendMonth(range: DashboardMonthRange) {
  const where = transactionMonthWhere(range);
  const [totalTransactions, incoming, outgoing] = await Promise.all([
    prisma.bankTransaction.count({ where }),
    prisma.bankTransaction.aggregate({
      where: { AND: [where, { originalAmount: { gt: 0 } }] },
      _sum: { originalAmount: true }
    }),
    prisma.bankTransaction.aggregate({
      where: { AND: [where, { originalAmount: { lt: 0 } }] },
      _sum: { originalAmount: true }
    })
  ]);

  return {
    totalTransactions,
    incomingAmount: incoming._sum.originalAmount,
    outgoingAmount: outgoing._sum.originalAmount
  };
}

export async function loadTopFinalEvents(range: DashboardMonthRange, limit = 5) {
  const groups = await prisma.bankTransaction.groupBy({
    by: ["eventCodeId"],
    where: {
      AND: [
        transactionMonthWhere(range),
        { status: "FINALIZED" },
        { originalAmount: { gt: 0 } },
        { eventCodeId: { not: null } }
      ]
    },
    _count: { _all: true },
    _sum: { originalAmount: true },
    orderBy: { _sum: { originalAmount: "desc" } },
    take: limit
  });

  const ids = groups
    .map((group) => group.eventCodeId)
    .filter((value): value is string => Boolean(value));

  const eventCodes = ids.length
    ? await prisma.eventCode.findMany({
        where: { id: { in: ids } },
        select: { id: true, code: true, eventName: true }
      })
    : [];

  return { groups, eventCodes };
}

export async function loadDashboardRecentActivityCandidates() {
  const [statementUploads, approvalHistory, transactionHistory] = await Promise.all([
    prisma.bankStatementUpload.findMany({
      select: {
        id: true,
        fileName: true,
        periodFrom: true,
        periodTo: true,
        uploadedAt: true,
        bankAccount: { select: { bankCode: true, accountNo: true } },
        uploadedBy: { select: { fullName: true } }
      },
      orderBy: [{ uploadedAt: "desc" }, { id: "desc" }],
      take: 8
    }),
    prisma.reconciliationApprovalHistory.findMany({
      where: { action: { in: ["SUBMITTED", "APPROVED", "REJECTED"] } },
      select: {
        id: true,
        action: true,
        actionAt: true,
        remark: true,
        actionBy: { select: { fullName: true } },
        approval: {
          select: {
            statementUpload: {
              select: {
                id: true,
                fileName: true,
                periodFrom: true,
                periodTo: true,
                bankAccount: { select: { bankCode: true, accountNo: true } }
              }
            }
          }
        }
      },
      orderBy: [{ actionAt: "desc" }, { id: "desc" }],
      take: 10
    }),
    prisma.bankTransactionHistory.findMany({
      where: { fieldName: { in: ["event_code_id", "remark"] } },
      select: {
        id: true,
        fieldName: true,
        changedAt: true,
        remark: true,
        changedBy: { select: { fullName: true } },
        transaction: {
          select: {
            id: true,
            referenceNo: true,
            description: true,
            statementUpload: {
              select: {
                id: true,
                periodFrom: true,
                periodTo: true,
                bankAccount: { select: { bankCode: true, accountNo: true } }
              }
            }
          }
        }
      },
      orderBy: [{ changedAt: "desc" }, { id: "desc" }],
      take: 8
    })
  ]);

  return { statementUploads, approvalHistory, transactionHistory };
}

export function loadDashboardViewer(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, fullName: true, email: true }
  });
}
