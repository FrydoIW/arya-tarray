import type { Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma.js";
import { officialDonationTransactionWhere } from "../../member/member-donation.rules.js";
import { decimalStringToCents } from "../../reconciliation/reconciliation-classification.js";
import { centsToDecimal } from "../../member/data/member-donation.domain.js";

export type DashboardPeriodRange = {
  periodStart: Date;
  periodEnd: Date;
};

function transactionPeriodWhere(range: DashboardPeriodRange): Prisma.BankTransactionWhereInput {
  return {
    reconciliationExcludedAt: null,
    transactionDate: {
      gte: range.periodStart,
      lt: range.periodEnd
    }
  };
}

function statementPeriodWhere(range: DashboardPeriodRange): Prisma.BankStatementUploadWhereInput {
  return {
    AND: [
      { periodFrom: { lt: range.periodEnd } },
      { periodTo: { gte: range.periodStart } }
    ]
  };
}

export async function loadDashboardPeriodSummary(range: DashboardPeriodRange) {
  const transactionWhere = transactionPeriodWhere(range);
  const statementWhere = statementPeriodWhere(range);

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
        eventCodeId: true,
        eventCampaignId: true,
        eventCode: { select: { eventType: true } }
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

export async function loadDashboardTrendMonth(range: DashboardPeriodRange) {
  const where = transactionPeriodWhere(range);
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

export async function loadTopFinalEvents(range: DashboardPeriodRange) {
  const groups = await prisma.bankTransaction.groupBy({
    by: ["eventCodeId"],
    where: {
      AND: [
        transactionPeriodWhere(range),
        officialDonationTransactionWhere()
      ]
    },
    _count: { _all: true },
    _sum: { originalAmount: true },
    orderBy: { _sum: { originalAmount: "desc" } }
  });

  const ids = groups
    .map((group) => group.eventCodeId)
    .filter((value): value is string => Boolean(value));

  const eventCodes = ids.length
    ? await prisma.eventCode.findMany({
        where: { id: { in: ids } },
        select: { id: true, code: true, eventName: true, category: true }
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

export async function loadDashboardTimeBasedSummary(today: Date, expiringUntil: Date, client: Pick<typeof prisma, "memberEventSubscription"> = prisma) {
  const base = { activeFlag: true } as const;
  const [activeSubscriptions, expiringSoon, expiredSubscriptions] = await Promise.all([
    client.memberEventSubscription.count({ where: { ...base, validUntil: { gte: today }, OR: [{ startDate: null }, { startDate: { lte: today } }] } }),
    client.memberEventSubscription.count({ where: { ...base, validUntil: { gte: today, lte: expiringUntil }, OR: [{ startDate: null }, { startDate: { lte: today } }] } }),
    client.memberEventSubscription.count({ where: { ...base, validUntil: { lt: today } } })
  ]);
  return { activeSubscriptions, expiringSoon, expiredSubscriptions };
}

export function summarizeTimeBasedCarry(groups: Array<{ _sum: { amountDelta: { toString(): string } | null } }>) {
  const balances = groups.map(row => row._sum.amountDelta ? decimalStringToCents(row._sum.amountDelta.toString()) : 0n);
  const positive = balances.filter(value => value > 0n);
  return { outstandingCarryBalance: centsToDecimal(positive.reduce((sum, value) => sum + value, 0n)),
    subscriptionsWithCarryBalance: positive.length };
}

export async function loadDashboardTimeBasedCarry(client: Pick<typeof prisma, "memberEventBalanceLedger" | "memberEventSubscription"> = prisma) {
  const groups = await client.memberEventBalanceLedger.groupBy({ by: ["subscriptionId"],
    where: { entryStatus: "ACTIVE" }, _sum: { amountDelta: true } });
  const positive = groups.filter(row => row._sum.amountDelta && row._sum.amountDelta.greaterThan(0));
  const subscriptions = positive.length ? await client.memberEventSubscription.findMany({
    where: { id: { in: positive.map(row => row.subscriptionId) } },
    select: { id: true, eventCode: { select: { id: true, code: true, eventName: true } } }
  }) : [];
  const amounts = new Map(positive.map(row => [row.subscriptionId, decimalStringToCents(row._sum.amountDelta!.toString())]));
  const byEvent = new Map<string, { eventCodeId: string; code: string; eventName: string; amount: bigint }>();
  for (const sub of subscriptions) {
    const current = byEvent.get(sub.eventCode.id) ?? { eventCodeId: sub.eventCode.id, code: sub.eventCode.code, eventName: sub.eventCode.eventName, amount: 0n };
    current.amount += amounts.get(sub.id) ?? 0n;
    byEvent.set(sub.eventCode.id, current);
  }
  return { ...summarizeTimeBasedCarry(groups), carryByEvent: [...byEvent.values()]
    .sort((a, b) => a.amount === b.amount ? a.code.localeCompare(b.code) : a.amount > b.amount ? -1 : 1)
    .slice(0, 5).map(row => ({ eventCodeId: row.eventCodeId, code: row.code, eventName: row.eventName, amount: centsToDecimal(row.amount) })) };
}

const officialMemberDonationWhere = (range: DashboardPeriodRange): Prisma.BankTransactionWhereInput => ({
  AND: [
    officialDonationTransactionWhere(),
    { transactionDate: { gte: range.periodStart, lt: range.periodEnd } }
  ]
});

const registrationFollowUpTransactionWhere = (range: DashboardPeriodRange): Prisma.BankTransactionWhereInput => ({
  // MemberIdentity is created and attached only by the shared eligible-incoming
  // discovery flow. Query its persisted relation; never reconstruct ownership
  // from sender text, status, or a guessed Final Event on the Dashboard.
  transactionDate: { gte: range.periodStart, lt: range.periodEnd }
});

export async function loadDashboardMemberRecords(range: DashboardPeriodRange) {
  const followUpTransactionWhere = registrationFollowUpTransactionWhere(range);
  const [donationGroups, unverifiedIdentityCount, followUpIdentities] = await Promise.all([
    prisma.bankTransaction.groupBy({
      by: ["memberIdentityId", "eventCodeId"],
      where: officialMemberDonationWhere(range),
      _count: { _all: true },
      _sum: { originalAmount: true }
    }),
    prisma.memberIdentity.count({
      where: {
        verificationStatus: "UNVERIFIED",
        memberId: null,
        transactions: { some: followUpTransactionWhere }
      }
    }),
    prisma.memberIdentity.findMany({
      where: {
        verificationStatus: "UNVERIFIED",
        memberId: null,
        transactions: { some: followUpTransactionWhere }
      },
      select: { id: true, accountName: true, firstSeenAt: true, lastSeenAt: true, verificationStatus: true, memberId: true },
      orderBy: [{ lastSeenAt: "desc" }, { id: "asc" }],
      take: 5
    })
  ]);

  const identityIds = donationGroups.flatMap(group => group.memberIdentityId ? [group.memberIdentityId] : []);
  const eventCodeIds = donationGroups.flatMap(group => group.eventCodeId ? [group.eventCodeId] : []);
  const followUpIds = followUpIdentities.map(identity => identity.id);
  const [identities, eventCodes, followUpTransactionGroups] = await Promise.all([
    identityIds.length ? prisma.memberIdentity.findMany({
      where: { id: { in: identityIds } },
      select: {
        id: true,
        verificationStatus: true,
        member: { select: { id: true, memberCode: true, memberName: true, activeFlag: true } }
      }
    }) : Promise.resolve([]),
    eventCodeIds.length ? prisma.eventCode.findMany({
      where: { id: { in: eventCodeIds } },
      select: { id: true, code: true, eventName: true, category: true }
    }) : Promise.resolve([]),
    followUpIds.length ? prisma.bankTransaction.groupBy({
      by: ["memberIdentityId"],
      where: { AND: [followUpTransactionWhere, { memberIdentityId: { in: followUpIds } }] },
      _count: { _all: true }
    }) : Promise.resolve([])
  ]);

  return { donationGroups, identities, eventCodes, unverifiedIdentityCount, followUpIdentities, followUpTransactionGroups };
}
