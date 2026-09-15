import { Prisma } from "@prisma/client";
import { HttpError } from "../../../lib/http.js";
import { prisma } from "../../../lib/prisma.js";
import { assertCampaignParentActive, assertCampaignPeriodContainsTransactions } from "./event-campaign.rules.js";

export const campaignSelect = {
  id: true,
  eventCodeId: true,
  campaignName: true,
  startDate: true,
  endDate: true,
  targetAmount: true,
  activeFlag: true,
  remark: true,
  createdAt: true,
  updatedAt: true,
  updatedBy: { select: { id: true, fullName: true } },
  eventCode: { select: { id: true, code: true, eventName: true, eventType: true, activeFlag: true } }
} as const;

export function officialCampaignAmountWhere(ids: string[]): Prisma.BankTransactionWhereInput {
  return {
    eventCampaignId: { in: ids },
    status: "FINALIZED",
    originalAmount: { gt: 0 },
    reconciliationExcludedAt: null
  };
}

export async function listCampaignRecords(options: { activeRelevantFrom?: Date; take?: number } = {}, client: Pick<typeof prisma, "eventCampaign" | "bankTransaction"> = prisma) {
  const campaigns = await client.eventCampaign.findMany({
    where: options.activeRelevantFrom ? { activeFlag: true, eventCode: { activeFlag: true }, OR: [{ endDate: null }, { endDate: { gte: options.activeRelevantFrom } }] } : undefined,
    select: campaignSelect,
    orderBy: [{ activeFlag: "desc" }, { startDate: "desc" }, { createdAt: "desc" }],
    take: options.take
  });
  const ids = campaigns.map((item) => item.id);
  const totals = ids.length ? await client.bankTransaction.groupBy({
    by: ["eventCampaignId"],
    where: officialCampaignAmountWhere(ids),
    _sum: { originalAmount: true }
  }) : [];
  return { campaigns, totals };
}

export async function applyCampaignChangesAtomic(input: {
  creates: Array<{ eventCodeId: string; campaignName: string; startDate: string | null; endDate: string | null; targetAmount: string | null; activeFlag: boolean; remark: string | null }>;
  updates: Array<{ id: string; input: { eventCodeId: string; campaignName: string; startDate: string | null; endDate: string | null; targetAmount: string | null; activeFlag: boolean; remark: string | null } }>;
  userId: string;
}) {
  return prisma.$transaction(async (tx) => {
    const updatedIds = input.updates.map((item) => item.id);
    if (new Set(updatedIds).size !== updatedIds.length) throw new HttpError(400, "Duplicate Campaign update");
    const existing = updatedIds.length ? await tx.eventCampaign.findMany({ where: { id: { in: updatedIds } }, select: { id: true, eventCodeId: true, activeFlag: true, startDate: true, endDate: true } }) : [];
    if (existing.length !== updatedIds.length) throw new HttpError(404, "One or more Campaigns no longer exist");
    const existingById = new Map(existing.map((item) => [item.id, item.eventCodeId]));
    if (input.updates.some((item) => existingById.get(item.id) !== item.input.eventCodeId)) {
      throw new HttpError(400, "A Campaign cannot move to another Event Code");
    }
    const eventIds = [...new Set([...input.creates.map((item) => item.eventCodeId), ...input.updates.map((item) => item.input.eventCodeId)])];
    const eventCodes = await tx.eventCode.findMany({ where: { id: { in: eventIds }, eventType: "CAMPAIGN" }, select: { id: true, activeFlag: true } });
    if (eventCodes.length !== eventIds.length) throw new HttpError(400, "Campaigns require a CAMPAIGN Event Code");
    const activeEventIds = new Set(eventCodes.filter((item) => item.activeFlag).map((item) => item.id));
    if (input.creates.some((item) => !activeEventIds.has(item.eventCodeId))) {
      throw new HttpError(400, "New Campaigns require an active Event Code");
    }
    const dateChangedIds = input.updates.filter(update => {
      const before = existing.find(row => row.id === update.id)!;
      return (before.startDate?.toISOString().slice(0, 10) ?? null) !== update.input.startDate
        || (before.endDate?.toISOString().slice(0, 10) ?? null) !== update.input.endDate;
    }).map(row => row.id);
    const linkedBounds = dateChangedIds.length ? await tx.bankTransaction.groupBy({
      by: ["eventCampaignId"], where: { eventCampaignId: { in: dateChangedIds } },
      _min: { transactionDate: true }, _max: { transactionDate: true }, _count: { _all: true, transactionDate: true }
    }) : [];
    for (const update of input.updates) {
      const before = existing.find(row => row.id === update.id)!;
      assertCampaignParentActive(activeEventIds.has(update.input.eventCodeId), !before.activeFlag && update.input.activeFlag);
      const bounds = linkedBounds.find(row => row.eventCampaignId === update.id);
      if (bounds) assertCampaignPeriodContainsTransactions(update.input, { earliest: bounds._min.transactionDate,
        latest: bounds._max.transactionDate, missingDates: bounds._count._all - bounds._count.transactionDate });
      await tx.eventCampaign.update({
        where: { id: update.id },
        data: {
          campaignName: update.input.campaignName,
          startDate: update.input.startDate ? new Date(`${update.input.startDate}T00:00:00.000Z`) : null,
          endDate: update.input.endDate ? new Date(`${update.input.endDate}T00:00:00.000Z`) : null,
          targetAmount: update.input.targetAmount ? new Prisma.Decimal(update.input.targetAmount) : null,
          activeFlag: update.input.activeFlag,
          remark: update.input.remark,
          updatedById: input.userId
        }
      });
    }
    for (const create of input.creates) {
      await tx.eventCampaign.create({
        data: {
          eventCodeId: create.eventCodeId,
          campaignName: create.campaignName,
          startDate: create.startDate ? new Date(`${create.startDate}T00:00:00.000Z`) : null,
          endDate: create.endDate ? new Date(`${create.endDate}T00:00:00.000Z`) : null,
          targetAmount: create.targetAmount ? new Prisma.Decimal(create.targetAmount) : null,
          activeFlag: create.activeFlag,
          remark: create.remark,
          createdById: input.userId,
          updatedById: input.userId
        }
      });
    }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
