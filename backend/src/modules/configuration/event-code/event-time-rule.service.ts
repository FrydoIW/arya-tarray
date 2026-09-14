import { Prisma } from "@prisma/client";
import { HttpError } from "../../../lib/http.js";
import { prisma } from "../../../lib/prisma.js";
import type { TimeRuleExecuteInput } from "./event-time-rule.schema.js";

const select = { eventCodeId: true, unitAmount: true, durationMonths: true, activeFlag: true, remark: true, updatedAt: true, eventCode: { select: { id: true, code: true, eventName: true, eventType: true, activeFlag: true } } } as const;

function map(row: Awaited<ReturnType<typeof listTimeRules>>[number]) {
  return { ...row, unitAmount: row.unitAmount.toString() };
}

export function assertNoOutstandingTimeBasedCarry(balances: Array<{ _sum: { amountDelta: { isZero(): boolean } | null } }>) {
  if (balances.some(row => row._sum.amountDelta && !row._sum.amountDelta.isZero()))
    throw new HttpError(409, "Resolve outstanding TIME_BASED carry balances before changing this Time Rule.");
}

export async function listTimeRules() {
  return prisma.eventTimeRule.findMany({ select, orderBy: { eventCode: { code: "asc" } } });
}

export async function getTimeRuleSummaries() {
  return (await listTimeRules()).map(map);
}

export async function executeTimeRuleChange(input: TimeRuleExecuteInput, userId: string) {
  return prisma.$transaction(async tx => {
    const event = await tx.eventCode.findUnique({ where: { id: input.eventCodeId }, select: { id: true, eventType: true, activeFlag: true } });
    if (!event || event.eventType !== "TIME_BASED") throw new HttpError(400, "Time Rules require a TIME_BASED Event Code");
    if (!event.activeFlag) throw new HttpError(400, "Time Rule Event Code must be active");
    const unresolved = await tx.bankTransaction.findFirst({
      where: {
        eventCodeId: event.id,
        reconciliationExcludedAt: null,
        OR: [
          { status: "CHECK" },
          { status: "FINALIZED", originalAmount: { gt: 0 }, memberEventBalanceLedger: { none: { entryType: "PAYMENT", entryStatus: "ACTIVE" } } }
        ]
      },
      select: { id: true }
    });
    if (unresolved) throw new HttpError(409, "Resolve or allocate pending TIME_BASED payments before changing this Time Rule. Existing unresolved official or pending approval transactions have no protected rule snapshot.");
    const balances = await tx.memberEventBalanceLedger.groupBy({
      by: ["subscriptionId"], where: { entryStatus: "ACTIVE", subscription: { eventCodeId: event.id } },
      _sum: { amountDelta: true }
    });
    assertNoOutstandingTimeBasedCarry(balances);
    await tx.eventTimeRule.upsert({
      where: { eventCodeId: input.eventCodeId },
      create: { eventCodeId: input.eventCodeId, unitAmount: new Prisma.Decimal(input.input.unitAmount), durationMonths: input.input.durationMonths, activeFlag: input.input.activeFlag, remark: input.input.remark, createdById: userId, updatedById: userId },
      update: { unitAmount: new Prisma.Decimal(input.input.unitAmount), durationMonths: input.input.durationMonths, activeFlag: input.input.activeFlag, remark: input.input.remark, updatedById: userId }
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return getTimeRuleSummaries();
}
