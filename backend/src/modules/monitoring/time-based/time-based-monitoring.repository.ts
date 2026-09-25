import { prisma } from "../../../lib/prisma.js";
import { decimalStringToCents } from "../../reconciliation/reconciliation-classification.js";
import { centsToDecimal } from "../../member/data/member-donation.domain.js";

const cents = (value: { toString(): string } | null | undefined) => decimalStringToCents(value?.toString() ?? "0");

export function summarizeTimeBasedCarry(groups: Array<{ _sum: { amountDelta: { toString(): string } | null } }>) {
  const balances = groups.map(row => cents(row._sum.amountDelta));
  const positive = balances.filter(value => value > 0n);
  return {
    outstandingCarry: centsToDecimal(positive.reduce((sum, value) => sum + value, 0n)),
    carrySourceCount: positive.length
  };
}

export async function loadTimeBasedMonitoring(today: Date, expiringUntil: Date, pages: { carryPage: number; carryPageSize: number; expiryPage: number; expiryPageSize: number }) {
  const [ledgerGroups, activePrograms, covered, expiring, expired, withoutCoverage] = await Promise.all([
    prisma.memberEventBalanceLedger.groupBy({ by: ["subscriptionId"], where: { entryStatus: "ACTIVE" }, _sum: { amountDelta: true } }),
    prisma.memberEventSubscription.findMany({
      where: { activeFlag: true },
      select: {
        id: true, eventCodeId: true, startDate: true, validUntil: true,
        eventCode: { select: { code: true, eventName: true, activeFlag: true, timeRule: { select: { unitAmount: true, durationMonths: true, activeFlag: true } } } }
      }
    }),
    prisma.memberEventSubscription.count({ where: { activeFlag: true, validUntil: { gte: today }, OR: [{ startDate: null }, { startDate: { lte: today } }] } }),
    prisma.memberEventSubscription.count({ where: { activeFlag: true, validUntil: { gte: today, lte: expiringUntil }, OR: [{ startDate: null }, { startDate: { lte: today } }] } }),
    prisma.memberEventSubscription.count({ where: { activeFlag: true, validUntil: { lt: today } } }),
    prisma.memberEventSubscription.count({ where: { activeFlag: true, validUntil: null } })
  ]);
  const positiveIds = ledgerGroups.filter(row => cents(row._sum.amountDelta) > 0n).map(row => row.subscriptionId);
  const [carryTotal, carryRows, expiryTotal, expiryRows] = await Promise.all([
    prisma.memberEventSubscription.count({ where: { id: { in: positiveIds } } }),
    prisma.memberEventSubscription.findMany({ where: { id: { in: positiveIds } }, skip: (pages.carryPage - 1) * pages.carryPageSize, take: pages.carryPageSize,
      orderBy: { member: { memberName: "asc" } }, select: { id: true, activeFlag: true, member: { select: { id: true, memberCode: true, memberName: true } }, eventCode: { select: { code: true, eventName: true } } } }),
    prisma.memberEventSubscription.count({ where: { activeFlag: true, validUntil: { gte: today, lte: expiringUntil }, OR: [{ startDate: null }, { startDate: { lte: today } }] } }),
    prisma.memberEventSubscription.findMany({ where: { activeFlag: true, validUntil: { gte: today, lte: expiringUntil }, OR: [{ startDate: null }, { startDate: { lte: today } }] }, skip: (pages.expiryPage - 1) * pages.expiryPageSize, take: pages.expiryPageSize,
      orderBy: [{ validUntil: "asc" }, { id: "asc" }], select: { id: true, validUntil: true, member: { select: { id: true, memberCode: true, memberName: true } }, eventCode: { select: { code: true, eventName: true } } } })
  ]);
  const balanceById = new Map(ledgerGroups.map(row => [row.subscriptionId, cents(row._sum.amountDelta)]));
  const groups = new Map<string, { code: string; eventName: string; rule: { unitAmount: string; durationMonths: number } | null; activePrograms: number; currentlyCovered: number; expiringSoon: number; carryCents: bigint; carrySources: number }>();
  for (const row of activePrograms) {
    const current = groups.get(row.eventCodeId) ?? { code: row.eventCode.code, eventName: row.eventCode.eventName, rule: row.eventCode.timeRule?.activeFlag ? { unitAmount: row.eventCode.timeRule.unitAmount.toString(), durationMonths: row.eventCode.timeRule.durationMonths } : null, activePrograms: 0, currentlyCovered: 0, expiringSoon: 0, carryCents: 0n, carrySources: 0 };
    current.activePrograms++; if (row.validUntil && row.validUntil >= today && (!row.startDate || row.startDate <= today)) current.currentlyCovered++;
    if (row.validUntil && row.validUntil >= today && row.validUntil <= expiringUntil && (!row.startDate || row.startDate <= today)) current.expiringSoon++;
    const carry = balanceById.get(row.id) ?? 0n; if (carry > 0n) { current.carryCents += carry; current.carrySources++; } groups.set(row.eventCodeId, current);
  }
  const carrySummary = summarizeTimeBasedCarry(ledgerGroups);
  return { summary: { activePrograms: activePrograms.length, currentlyCovered: covered, expiringSoon: expiring, expiredCoverage: expired, programsWithoutCoverage: withoutCoverage, ...carrySummary },
    eventGroups: [...groups.values()].map(({ carryCents, ...row }) => ({
      ...row,
      outstandingCarry: centsToDecimal(carryCents)
    })).sort((a, b) => a.code.localeCompare(b.code)),
    carryAttention: { rows: carryRows.map(row => ({ member: row.member, subscriptionId: row.id, program: row.eventCode, activeFlag: row.activeFlag, carryBalance: centsToDecimal(balanceById.get(row.id) ?? 0n) })), pagination: { page: pages.carryPage, pageSize: pages.carryPageSize, total: carryTotal, totalPages: Math.max(1, Math.ceil(carryTotal / pages.carryPageSize)) } },
    upcomingExpiry: { rows: expiryRows.map(row => ({ member: row.member, subscriptionId: row.id, program: row.eventCode, validUntil: row.validUntil })), pagination: { page: pages.expiryPage, pageSize: pages.expiryPageSize, total: expiryTotal, totalPages: Math.max(1, Math.ceil(expiryTotal / pages.expiryPageSize)) } } };
}
