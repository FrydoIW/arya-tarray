import type { Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma.js";

const eventCodeSelect = {
  id: true,
  code: true,
  eventName: true,
  activeFlag: true,
  eventType: true,
  timeRule: { select: { unitAmount: true, durationMonths: true, activeFlag: true } }
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
  sourceType: true,
  correctionReason: true,
  manualAddedAt: true,
  reconciliationExcludedAt: true,
  reconciliationExclusionReason: true,
  suggestedEventCode: { select: eventCodeSelect },
  eventCode: { select: eventCodeSelect },
  eventCampaign: { select: { id: true, campaignName: true, activeFlag: true, eventCodeId: true } },
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
  eventCampaignId?: string;
  memberId?: string;
  memberLinkStatus: "ALL" | "LINKED" | "UNLINKED";
};

export function buildTransactionInquiryWhere(filter: TransactionInquiryFilter): Prisma.BankTransactionWhereInput {
  const search = filter.search.trim();
  const conditions: Prisma.BankTransactionWhereInput[] = [
    { transactionDate: { gte: filter.periodStart, lt: filter.periodEnd } },
    // Transaction Inquiry represents the current official reconciliation view.
    // Excluded rows remain in the database/audit trail but no longer contribute
    // to normal inquiry totals or generated reports after approval.
    { reconciliationExcludedAt: null },
    { statementUpload: { is: { status: { not: "WITHDRAWN" } } } }
  ];
  if (filter.status !== "ALL") conditions.push({ status: filter.status });
  if (filter.bankAccountId) conditions.push({ statementUpload: { is: { bankAccountId: filter.bankAccountId } } });
  if (filter.finalEventId) conditions.push({ eventCodeId: filter.finalEventId });
  if (filter.eventCampaignId) conditions.push({ eventCampaignId: filter.eventCampaignId });
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
  const total = await prisma.bankTransaction.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / input.pageSize));
  const page = Math.min(input.page, totalPages);
  const skip = (page - 1) * input.pageSize;

  const historicalEventWhere: Prisma.EventCodeWhereInput = {
    OR: [
      { activeFlag: true },
      ...(input.filter.finalEventId ? [{ id: input.filter.finalEventId }] : []),
      {
        transactions: {
          some: {
            transactionDate: { gte: input.filter.periodStart, lt: input.filter.periodEnd },
            reconciliationExcludedAt: null
          }
        }
      }
    ]
  };

  const [transactions, totalCredit, totalDebit, completeTransactions, bankAccounts, eventOptions, campaignOptions] = await Promise.all([
    prisma.bankTransaction.findMany({
      where,
      select: transactionListSelect,
      orderBy: [{ transactionDate: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      skip,
      take: input.pageSize
    }),
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
      where: historicalEventWhere,
      select: eventCodeSelect,
      orderBy: [{ activeFlag: "desc" }, { code: "asc" }, { eventName: "asc" }]
    }),
    prisma.eventCampaign.findMany({
      where: { OR: [
        { activeFlag: true },
        ...(input.filter.eventCampaignId ? [{ id: input.filter.eventCampaignId }] : []),
        { transactions: { some: { reconciliationExcludedAt: null } } }
      ] },
      select: { id: true, campaignName: true, eventCodeId: true, activeFlag: true },
      orderBy: [{ activeFlag: "desc" }, { campaignName: "asc" }]
    })
  ]);

  return {
    transactions,
    total,
    page,
    totalCredit: totalCredit._sum.originalAmount,
    totalDebit: totalDebit._sum.originalAmount,
    incomingTransactions: totalCredit._count._all,
    outgoingTransactions: totalDebit._count._all,
    completeTransactions,
    bankAccounts,
    eventOptions,
    campaignOptions
  };
}

export async function loadTransactionInquiryDetailRecord(transactionId: string) {
  return prisma.bankTransaction.findUnique({
    where: { id: transactionId },
    include: {
      suggestedEventCode: { select: eventCodeSelect },
      eventCode: { select: eventCodeSelect },
      eventCampaign: { select: { id: true, campaignName: true, eventCodeId: true, activeFlag: true } },
      memberEventCoverages: { where: { coverageStatus: "ACTIVE", coverageSource: "TRANSACTION" }, select: { subscription: { select: { id: true, memberId: true, referenceNo: true, displayName: true } }, coverageFrom: true, coverageTo: true, unitAmountSnapshot: true, grantedUnits: true, durationMonthsSnapshot: true }, take: 1 },
      memberEventBalanceLedger: { where: { entryType: "PAYMENT" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { entryStatus: true, amountDelta: true, unitAmountSnapshot: true, durationMonthsSnapshot: true,
          subscription: { select: { id: true, memberId: true, eventCodeId: true, referenceNo: true, displayName: true } } } },
      manualAddedBy: { select: { id: true, fullName: true } },
      reconciliationExcludedBy: { select: { id: true, fullName: true } },
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

export async function loadTimeBasedCarryAfterPayment(subscriptionId: string, transactionDate: Date, bankTransactionId: string) {
  const result = await prisma.memberEventBalanceLedger.aggregate({
    where: { subscriptionId, entryStatus: "ACTIVE", OR: [
      { effectiveDate: { lt: transactionDate } },
      { effectiveDate: transactionDate, bankTransactionId: { lte: bankTransactionId } }
    ] },
    _sum: { amountDelta: true }
  });
  return result._sum.amountDelta;
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
          where: { statements: { some: { transactions: { some: {
            transactionDate: { gte: input.filter.periodStart, lt: input.filter.periodEnd },
            reconciliationExcludedAt: null
          } } } } },
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

export function loadTransactionInquiryCampaignOption(eventCampaignId: string) {
  return prisma.eventCampaign.findUnique({ where: { id: eventCampaignId }, select: { id: true, campaignName: true } });
}

export function loadCampaignLabels(ids: string[]) {
  return ids.length ? prisma.eventCampaign.findMany({ where: { id: { in: ids } }, select: { id: true, campaignName: true } }) : Promise.resolve([]);
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
