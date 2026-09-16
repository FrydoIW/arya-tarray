import { Prisma } from "@prisma/client";
import { HttpError } from "../../../lib/http.js";
import { prisma } from "../../../lib/prisma.js";
import type { TimeRuleBulkExecuteInput, TimeRuleExecuteInput } from "./event-time-rule.schema.js";

const select = { eventCodeId: true, unitAmount: true, durationMonths: true, activeFlag: true, remark: true, updatedAt: true, eventCode: { select: { id: true, code: true, eventName: true, eventType: true, activeFlag: true } } } as const;

type TimeRuleReadClient = Pick<typeof prisma, "eventTimeRule">;
type TimeRuleTransactionRunner = Pick<typeof prisma, "$transaction">;

function map(row: Awaited<ReturnType<typeof listTimeRules>>[number]) {
  return { ...row, unitAmount: row.unitAmount.toString() };
}

export function assertNoOutstandingTimeBasedCarry(balances: Array<{ _sum: { amountDelta: { isZero(): boolean } | null } }>) {
  if (balances.some(row => row._sum.amountDelta && !row._sum.amountDelta.isZero()))
    throw new HttpError(409, "Resolve outstanding TIME_BASED carry balances before changing this Time Rule.");
}

export async function listTimeRules(client: TimeRuleReadClient = prisma) {
  return client.eventTimeRule.findMany({ select, orderBy: { eventCode: { code: "asc" } } });
}

export async function getTimeRuleSummaries(client: TimeRuleReadClient = prisma) {
  return (await listTimeRules(client)).map(map);
}

export async function applyTimeRuleUpdate(tx: Prisma.TransactionClient, update: TimeRuleExecuteInput, userId: string) {
  const event = await tx.eventCode.findUnique({ where: { id: update.eventCodeId }, select: { id: true, code: true, eventType: true, activeFlag: true } });
  const label = event ? `Event Code ${event.code}` : `Event Code ${update.eventCodeId}`;
  if (!event || event.eventType !== "TIME_BASED") throw new HttpError(400, `${label} must be a TIME_BASED Event Code`);
  if (!event.activeFlag) throw new HttpError(400, `${label} must be active`);
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
  if (unresolved) throw new HttpError(409, `${label}: Resolve or allocate pending TIME_BASED payments before changing this Time Rule. Existing unresolved official or pending approval transactions have no protected rule snapshot.`);
  const balances = await tx.memberEventBalanceLedger.groupBy({
    by: ["subscriptionId"], where: { entryStatus: "ACTIVE", subscription: { eventCodeId: event.id } },
    _sum: { amountDelta: true }
  });
  try {
    assertNoOutstandingTimeBasedCarry(balances);
  } catch (error) {
    if (error instanceof HttpError) throw new HttpError(error.status, `${label}: ${error.message}`);
    throw error;
  }
  await tx.eventTimeRule.upsert({
    where: { eventCodeId: update.eventCodeId },
    create: { eventCodeId: update.eventCodeId, unitAmount: new Prisma.Decimal(update.input.unitAmount), durationMonths: update.input.durationMonths, activeFlag: update.input.activeFlag, remark: update.input.remark, createdById: userId, updatedById: userId },
    update: { unitAmount: new Prisma.Decimal(update.input.unitAmount), durationMonths: update.input.durationMonths, activeFlag: update.input.activeFlag, remark: update.input.remark, updatedById: userId }
  });
}

export async function applyTimeRuleUpdatesAtomic(client: TimeRuleTransactionRunner, input: TimeRuleBulkExecuteInput, userId: string) {
  await client.$transaction(async tx => {
    for (const update of input.updates) await applyTimeRuleUpdate(tx, update, userId);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function executeTimeRules(input: TimeRuleBulkExecuteInput, userId: string, client: TimeRuleTransactionRunner & TimeRuleReadClient = prisma) {
  await applyTimeRuleUpdatesAtomic(client, input, userId);
  return getTimeRuleSummaries(client);
}
