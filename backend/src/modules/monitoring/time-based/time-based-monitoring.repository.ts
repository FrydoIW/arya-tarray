import type { Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma.js";
import { centsToDecimal, decimalStringToCents } from "../../../lib/money.js";
import { dateOnly, extendTimelineWindow, isTimelineSegmentVisible, type TimelineFilter } from "./time-based-monitoring.domain.js";

const cents = (value: { toString(): string } | null | undefined) => decimalStringToCents(value?.toString() ?? "0");
const activeCoverage = { coverageStatus: "ACTIVE" } as const;

export function summarizeTimeBasedCarry(groups: Array<{ _sum: { amountDelta: { toString(): string } | null } }>) {
  const positive = groups.map(row => cents(row._sum.amountDelta)).filter(value => value > 0n);
  return { outstandingCarry: centsToDecimal(positive.reduce((sum, value) => sum + value, 0n)), carrySourceCount: positive.length };
}

function currentCoverageWhere(today: Date): Prisma.MemberEventCoverageWhereInput {
  return { ...activeCoverage, coverageFrom: { lte: today }, coverageTo: { gte: today } };
}

function timelineWhere(filter: TimelineFilter, today: Date, expiringUntil: Date, positiveIds: string[]): Prisma.MemberEventSubscriptionWhereInput {
  if (filter === "HAS_CARRY") return { id: { in: positiveIds } };
  if (filter === "EXPIRING") return { activeFlag: true, coverages: { some: { ...currentCoverageWhere(today), coverageTo: { lte: expiringUntil } } } };
  if (filter === "EXPIRED") return { activeFlag: true, coverages: { some: { ...activeCoverage, coverageTo: { lt: today } }, none: { ...activeCoverage, coverageTo: { gte: today } } } };
  if (filter === "NO_COVERAGE") return { activeFlag: true, coverages: { none: activeCoverage } };
  return { activeFlag: true };
}

export async function loadTimeBasedMonitoring(today: Date, expiringUntil: Date, input: {
  timelinePage: number; timelinePageSize: number; timelineFilter: TimelineFilter;
  window: { start: Date; end: Date; monthCount: number };
}) {
  const [ledgerGroups, activePrograms, covered, expiring, expired, withoutCoverage] = await Promise.all([
    prisma.memberEventBalanceLedger.groupBy({ by: ["subscriptionId"], where: { entryStatus: "ACTIVE" }, _sum: { amountDelta: true } }),
    prisma.memberEventSubscription.findMany({ where: { activeFlag: true }, select: {
      id: true, eventCodeId: true, startDate: true, validUntil: true,
      eventCode: { select: { code: true, eventName: true, activeFlag: true, timeRule: { select: { unitAmount: true, durationMonths: true, activeFlag: true } } } }
    } }),
    prisma.memberEventSubscription.count({ where: { activeFlag: true, validUntil: { gte: today }, OR: [{ startDate: null }, { startDate: { lte: today } }] } }),
    prisma.memberEventSubscription.count({ where: { activeFlag: true, validUntil: { gte: today, lte: expiringUntil }, OR: [{ startDate: null }, { startDate: { lte: today } }] } }),
    prisma.memberEventSubscription.count({ where: { activeFlag: true, validUntil: { lt: today } } }),
    prisma.memberEventSubscription.count({ where: { activeFlag: true, validUntil: null } })
  ]);

  const balanceById = new Map(ledgerGroups.map(row => [row.subscriptionId, cents(row._sum.amountDelta)]));
  const positiveIds = [...balanceById].filter(([, balance]) => balance > 0n).map(([subscriptionId]) => subscriptionId);
  const where = timelineWhere(input.timelineFilter, today, expiringUntil, positiveIds);
  const [carrySubscriptions, timelineTotal, furthestCoverage] = await Promise.all([
    positiveIds.length ? prisma.memberEventSubscription.findMany({ where: { id: { in: positiveIds } }, select: { id: true, eventCodeId: true } }) : [],
    prisma.memberEventSubscription.count({ where }),
    prisma.memberEventCoverage.aggregate({ where: { ...activeCoverage, coverageTo: { gte: input.window.start }, subscription: { is: where } }, _max: { coverageTo: true } })
  ]);
  const window = extendTimelineWindow(input.window, furthestCoverage._max.coverageTo);
  const timelineSubscriptions = await prisma.memberEventSubscription.findMany({ where, skip: (input.timelinePage - 1) * input.timelinePageSize, take: input.timelinePageSize,
      orderBy: [{ member: { memberName: "asc" } }, { id: "asc" }], select: {
        id: true, activeFlag: true, validUntil: true,
        member: { select: { id: true, memberCode: true, memberName: true } },
        eventCode: { select: { id: true, code: true, eventName: true } },
        coverages: { where: { ...activeCoverage, OR: [
          { coverageFrom: { lte: window.end }, coverageTo: { gte: window.start } }, currentCoverageWhere(today)
        ] }, orderBy: [{ coverageFrom: "asc" }, { id: "asc" }], select: { id: true, coverageFrom: true, coverageTo: true, coverageSource: true, coverageStatus: true } }
      } });

  const timelineSubscriptionIds = timelineSubscriptions.map(subscription => subscription.id);
  const [currentCoverageRows, historicalCoverageRows, futureCoverageRows] = await Promise.all([
    prisma.memberEventCoverage.findMany({ where: { ...currentCoverageWhere(today), subscriptionId: { in: timelineSubscriptionIds } }, distinct: ["subscriptionId"], select: { subscriptionId: true } }),
    prisma.memberEventCoverage.findMany({ where: { ...activeCoverage, coverageTo: { lt: today }, subscriptionId: { in: timelineSubscriptionIds } }, distinct: ["subscriptionId"], select: { subscriptionId: true } }),
    prisma.memberEventCoverage.findMany({ where: { ...activeCoverage, coverageFrom: { gt: today }, subscriptionId: { in: timelineSubscriptionIds } }, distinct: ["subscriptionId"], select: { subscriptionId: true } })
  ]);
  const currentCoverageIds = new Set(currentCoverageRows.map(row => row.subscriptionId));
  const historicalCoverageIds = new Set(historicalCoverageRows.map(row => row.subscriptionId));
  const futureCoverageIds = new Set(futureCoverageRows.map(row => row.subscriptionId));

  const carryByEvent = new Map<string, bigint>();
  for (const subscription of carrySubscriptions) carryByEvent.set(subscription.eventCodeId, (carryByEvent.get(subscription.eventCodeId) ?? 0n) + (balanceById.get(subscription.id) ?? 0n));
  const groups = new Map<string, { code: string; eventName: string; rule: { unitAmount: string; durationMonths: number } | null; activePrograms: number; currentlyCovered: number; expiringSoon: number }>();
  for (const row of activePrograms) {
    const current = groups.get(row.eventCodeId) ?? { code: row.eventCode.code, eventName: row.eventCode.eventName,
      rule: row.eventCode.timeRule?.activeFlag ? { unitAmount: row.eventCode.timeRule.unitAmount.toString(), durationMonths: row.eventCode.timeRule.durationMonths } : null,
      activePrograms: 0, currentlyCovered: 0, expiringSoon: 0 };
    current.activePrograms += 1;
    if (row.validUntil && row.validUntil >= today && (!row.startDate || row.startDate <= today)) current.currentlyCovered += 1;
    if (row.validUntil && row.validUntil >= today && row.validUntil <= expiringUntil && (!row.startDate || row.startDate <= today)) current.expiringSoon += 1;
    groups.set(row.eventCodeId, current);
  }

  const carrySummary = summarizeTimeBasedCarry(ledgerGroups);
  return {
    summary: { activePrograms: activePrograms.length, currentlyCovered: covered, expiringSoon: expiring, expiredCoverage: expired, programsWithoutCoverage: withoutCoverage, ...carrySummary },
    eventGroups: [...groups.entries()].map(([eventCodeId, row]) => ({ ...row, notCurrentlyCovered: row.activePrograms - row.currentlyCovered,
      outstandingCarry: centsToDecimal(carryByEvent.get(eventCodeId) ?? 0n) })).sort((left, right) => left.code.localeCompare(right.code)),
    timeline: {
      window: { start: dateOnly(window.start), end: dateOnly(window.end), monthCount: window.monthCount },
      rows: timelineSubscriptions.map(subscription => {
        const currentlyCovered = currentCoverageIds.has(subscription.id);
        const coverageStatus = !subscription.activeFlag ? "INACTIVE" : currentlyCovered ? "COVERED" : historicalCoverageIds.has(subscription.id) && !futureCoverageIds.has(subscription.id) ? "EXPIRED" : "NO_COVERAGE";
        return { member: subscription.member, subscriptionId: subscription.id, activeFlag: subscription.activeFlag, program: subscription.eventCode,
          currentlyCovered, coverageStatus, validUntil: dateOnly(subscription.validUntil), carryBalance: centsToDecimal(balanceById.get(subscription.id) ?? 0n),
          coverageSegments: subscription.coverages.filter(coverage => isTimelineSegmentVisible(coverage, window)).map(coverage => ({
            coverageId: coverage.id, coverageFrom: dateOnly(coverage.coverageFrom), coverageTo: dateOnly(coverage.coverageTo), source: coverage.coverageSource
          })) };
      }),
      pagination: { page: input.timelinePage, pageSize: input.timelinePageSize, total: timelineTotal, totalPages: Math.max(1, Math.ceil(timelineTotal / input.timelinePageSize)) }
    }
  };
}
