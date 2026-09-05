import { currentBusinessDayValue, currentBusinessMonthValue } from "../../../lib/business-time.js";
import { HttpError } from "../../../lib/http.js";
import { formatPeriodLabel, resolvePeriod } from "../../../lib/period.js";
import { storedTransactionRequiresClassification } from "../../reconciliation/reconciliation-classification.js";
import {
  loadDashboardMemberRecords,
  loadDashboardPeriodSummary,
  loadDashboardRecentActivityCandidates,
  loadDashboardTrendMonth,
  loadDashboardViewer,
  loadTopFinalEvents,
  type DashboardPeriodRange
} from "./dashboard.repository.js";
import type { DashboardWorkspaceQuery } from "./dashboard.schema.js";
import { isRegistrationFollowUpIdentity, summarizeDashboardMemberDonations } from "./dashboard-member.domain.js";

const TREND_MONTHS = 6;
const RECENT_ACTIVITY_LIMIT = 6;

function parseMonth(value: string) {
  const [yearRaw, monthRaw] = value.split("-");
  return { year: Number(yearRaw), month: Number(monthRaw) };
}

function monthValue(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(value: string, offset: number) {
  const { year, month } = parseMonth(value);
  return monthValue(new Date(Date.UTC(year, month - 1 + offset, 1)));
}

function monthRange(value: string): DashboardPeriodRange {
  const period = resolvePeriod("MONTH", value, `${value}-01`);
  return {
    periodStart: period.start,
    periodEnd: period.end
  };
}

function monthLabel(value: string) {
  const { year, month } = parseMonth(value);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function decimalToCents(value: { toString(): string } | null | undefined) {
  const raw = value?.toString() ?? "0";
  const negative = raw.startsWith("-");
  const normalized = negative ? raw.slice(1) : raw;
  const [whole = "0", fraction = ""] = normalized.split(".");
  const cents = BigInt(whole || "0") * 100n + BigInt((fraction + "00").slice(0, 2));
  return negative ? -cents : cents;
}

function centsToDecimal(value: bigint) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  return `${negative ? "-" : ""}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, "0")}`;
}

function absoluteDecimal(value: { toString(): string } | null | undefined) {
  const cents = decimalToCents(value);
  return centsToDecimal(cents < 0n ? -cents : cents);
}

function percentChange(current: bigint, previous: bigint) {
  if (previous === 0n) return current === 0n ? 0 : null;
  return Number(((current - previous) * 1000n) / previous) / 10;
}

function numberChange(current: number, previous: number) {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function statusCount(groups: Array<{ status: string; _count: { _all: number } }>, status: string) {
  return groups.find((group) => group.status === status)?._count._all ?? 0;
}

function summarizeTransactionStatus(records: Awaited<ReturnType<typeof loadDashboardPeriodSummary>>) {
  const raw = statusCount(records.transactionStatusGroups, "RAW");
  const pendingApproval = statusCount(records.transactionStatusGroups, "CHECK");
  const complete = statusCount(records.transactionStatusGroups, "FINALIZED");
  const needsReview = records.rawTransactions.filter((transaction) =>
    storedTransactionRequiresClassification(transaction) && !transaction.eventCodeId
  ).length;
  const draft = Math.max(0, raw - needsReview);

  return {
    draft,
    needsReview,
    pendingApproval,
    complete,
    total: draft + needsReview + pendingApproval + complete
  };
}

function summarizeStatementStatus(records: Awaited<ReturnType<typeof loadDashboardPeriodSummary>>) {
  const draft = statusCount(records.statementStatusGroups, "RAW");
  const pendingApproval = statusCount(records.statementStatusGroups, "CHECK");
  const complete = statusCount(records.statementStatusGroups, "FINALIZED");
  return { draft, pendingApproval, complete, total: draft + pendingApproval + complete };
}

function statementPeriodLabel(input: { periodFrom: Date | null; periodTo: Date | null }) {
  const target = input.periodTo ?? input.periodFrom;
  if (!target) return "Statement";
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).format(target);
}

function statementDetail(input: {
  periodFrom: Date | null;
  periodTo: Date | null;
  bankAccount: { bankCode: string; accountNo: string };
}) {
  return `${input.bankAccount.bankCode} ${statementPeriodLabel(input)} · ${input.bankAccount.accountNo}`;
}

function mapRecentActivities(records: Awaited<ReturnType<typeof loadDashboardRecentActivityCandidates>>) {
  const statementActivities = records.statementUploads.map((item) => ({
    id: `upload-${item.id}`,
    type: "STATEMENT_UPLOADED" as const,
    title: "New statement uploaded",
    detail: statementDetail(item),
    actor: item.uploadedBy.fullName,
    occurredAt: item.uploadedAt
  }));

  const approvalActivities = records.approvalHistory.map((item) => {
    const statement = item.approval.statementUpload;
    const type = item.action === "APPROVED"
      ? "STATEMENT_FINALIZED" as const
      : item.action === "REJECTED"
        ? "STATEMENT_RETURNED" as const
        : "APPROVAL_SUBMITTED" as const;
    const title = item.action === "APPROVED"
      ? "Statement finalized"
      : item.action === "REJECTED"
        ? "Statement returned"
        : "Statement submitted for approval";

    return {
      id: `approval-${item.id}`,
      type,
      title,
      detail: statementDetail(statement),
      actor: item.actionBy.fullName,
      occurredAt: item.actionAt
    };
  });

  const editActivities = records.transactionHistory.map((item) => {
    const transaction = item.transaction;
    const reference = transaction.referenceNo || transaction.description?.split("\n")[0] || transaction.id;
    return {
      id: `edit-${item.id}`,
      type: "INCOME_EDITED" as const,
      title: "Income edited",
      detail: `${statementDetail(transaction.statementUpload)} · ${reference}`,
      actor: item.changedBy.fullName,
      occurredAt: item.changedAt
    };
  });

  return [...statementActivities, ...approvalActivities, ...editActivities]
    .sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime())
    .slice(0, RECENT_ACTIVITY_LIMIT);
}

export async function getDashboardWorkspace(input: DashboardWorkspaceQuery, userId: string) {
  const periodMode = input.periodMode ?? "MONTH";
  const month = input.month ?? currentBusinessMonthValue();
  const date = input.date ?? (periodMode === "DAY" ? currentBusinessDayValue() : `${month}-01`);
  const period = resolvePeriod(periodMode, month, date);
  const previousMonth = shiftMonth(month, -1);
  const currentRange = { periodStart: period.start, periodEnd: period.end };
  const previousRange = periodMode === "DAY"
    ? { periodStart: new Date(period.start.getTime() - 86_400_000), periodEnd: period.start }
    : monthRange(previousMonth);
  const trendMonths = Array.from({ length: TREND_MONTHS }, (_, index) => shiftMonth(period.month, index - (TREND_MONTHS - 1)));

  const [viewer, current, previous, trendRecords, topEventsRecords, recentCandidates, memberRecords] = await Promise.all([
    loadDashboardViewer(userId),
    loadDashboardPeriodSummary(currentRange),
    loadDashboardPeriodSummary(previousRange),
    Promise.all(trendMonths.map(async (trendMonth) => ({
      month: trendMonth,
      record: await loadDashboardTrendMonth(monthRange(trendMonth))
    }))),
    loadTopFinalEvents(currentRange),
    loadDashboardRecentActivityCandidates(),
    loadDashboardMemberRecords(currentRange)
  ]);

  if (!viewer) throw new HttpError(401, "Current user is no longer available");

  const eventCodeById = new Map(topEventsRecords.eventCodes.map((event) => [event.id, event]));
  const currentIncoming = decimalToCents(current.incomingAmount);
  const previousIncoming = decimalToCents(previous.incomingAmount);
  const currentOutgoing = decimalToCents(current.outgoingAmount);
  const previousOutgoing = decimalToCents(previous.outgoingAmount);
  const memberAnalytics = summarizeDashboardMemberDonations(memberRecords.donationGroups, memberRecords.identities, memberRecords.eventCodes);
  const followUpCounts = new Map(memberRecords.followUpTransactionGroups.flatMap(group =>
    group.memberIdentityId ? [[group.memberIdentityId, group._count._all] as const] : []
  ));
  const eventGroupsByCategory = new Map<string, {
    category: string;
    transactionCount: number;
    totalAmountCents: bigint;
    events: Array<{ eventCodeId: string; code: string; eventName: string; transactionCount: number; totalAmount: string; amountCents: bigint }>;
  }>();

  for (const group of topEventsRecords.groups) {
    if (!group.eventCodeId) continue;
    const event = eventCodeById.get(group.eventCodeId);
    if (!event) continue;
    const category = event.category?.trim() || "Uncategorized";
    const amountCents = decimalToCents(group._sum.originalAmount);
    const currentGroup = eventGroupsByCategory.get(category) ?? {
      category,
      transactionCount: 0,
      totalAmountCents: 0n,
      events: []
    };
    currentGroup.transactionCount += group._count._all;
    currentGroup.totalAmountCents += amountCents;
    currentGroup.events.push({
      eventCodeId: event.id,
      code: event.code,
      eventName: event.eventName,
      transactionCount: group._count._all,
      totalAmount: centsToDecimal(amountCents),
      amountCents
    });
    eventGroupsByCategory.set(category, currentGroup);
  }

  return {
    viewer,
    filters: {
      periodMode,
      month: period.month,
      date: period.date,
      monthLabel: formatPeriodLabel(period),
      periodLabel: formatPeriodLabel(period),
      comparisonLabel: periodMode === "DAY" ? "vs previous day" : "vs last month"
    },
    metrics: {
      totalStatements: {
        value: current.totalStatements,
        changePercent: numberChange(current.totalStatements, previous.totalStatements)
      },
      totalTransactions: {
        value: current.totalTransactions,
        changePercent: numberChange(current.totalTransactions, previous.totalTransactions)
      },
      totalIncoming: {
        value: centsToDecimal(currentIncoming),
        changePercent: percentChange(currentIncoming, previousIncoming)
      },
      totalOutgoing: {
        value: centsToDecimal(currentOutgoing < 0n ? -currentOutgoing : currentOutgoing),
        changePercent: percentChange(
          currentOutgoing < 0n ? -currentOutgoing : currentOutgoing,
          previousOutgoing < 0n ? -previousOutgoing : previousOutgoing
        )
      },
      completeTransactions: {
        value: current.completeTransactions,
        changePercent: numberChange(current.completeTransactions, previous.completeTransactions)
      }
    },
    trend: trendRecords.map(({ month: trendMonth, record }) => ({
      month: trendMonth,
      label: monthLabel(trendMonth),
      transactions: record.totalTransactions,
      incoming: record.incomingAmount?.toString() ?? "0.00",
      outgoing: absoluteDecimal(record.outgoingAmount)
    })),
    transactionStatus: summarizeTransactionStatus(current),
    statementStatus: summarizeStatementStatus(current),
    eventGroups: [...eventGroupsByCategory.values()]
      .sort((left, right) => right.totalAmountCents === left.totalAmountCents
        ? left.category.localeCompare(right.category)
        : right.totalAmountCents > left.totalAmountCents ? 1 : -1)
      .map((group) => ({
        category: group.category,
        transactionCount: group.transactionCount,
        totalAmount: centsToDecimal(group.totalAmountCents),
        events: group.events
          .sort((left, right) => right.amountCents === left.amountCents
            ? left.code.localeCompare(right.code)
            : right.amountCents > left.amountCents ? 1 : -1)
          .map(({ amountCents: _amountCents, ...event }) => event)
      })),
    memberSummary: {
      linkedAmount: memberAnalytics.linkedAmount,
      contributingMemberCount: memberAnalytics.contributingMemberCount,
      linkedTransactionCount: memberAnalytics.linkedTransactionCount,
      linkedIdentityCount: memberAnalytics.linkedIdentityCount,
      unlinkedTransactionCount: memberAnalytics.unlinkedTransactionCount,
      unlinkedIdentityCount: memberAnalytics.unlinkedIdentityCount,
      unlinkedObservedAmount: memberAnalytics.unlinkedObservedAmount,
      unverifiedIdentityCount: memberRecords.unverifiedIdentityCount
    },
    topMembers: memberAnalytics.topMembers,
    memberEventGroups: memberAnalytics.eventGroups,
    registrationFollowUp: {
      unverifiedIdentityCount: memberRecords.unverifiedIdentityCount,
      identities: memberRecords.followUpIdentities.filter(isRegistrationFollowUpIdentity).map(identity => ({
        memberIdentityId: identity.id,
        accountName: identity.accountName,
        firstSeenAt: identity.firstSeenAt,
        lastSeenAt: identity.lastSeenAt,
        transactionCount: followUpCounts.get(identity.id) ?? 0
      }))
    },
    recentActivities: mapRecentActivities(recentCandidates),
    lastUpdatedAt: new Date()
  };
}
