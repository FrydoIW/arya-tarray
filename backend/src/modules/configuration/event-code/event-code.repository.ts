import { prisma } from "../../../lib/prisma.js";
import { HttpError } from "../../../lib/http.js";

const updatedByInclude = {
  updatedBy: {
    select: {
      id: true,
      fullName: true
    }
  }
} as const;

export function listEventCodes(search?: string) {
  return prisma.eventCode.findMany({
    where: search
      ? {
          OR: [
            { code: { contains: search } },
            { eventName: { contains: search } },
            { category: { contains: search } },
            { description: { contains: search } }
          ]
        }
      : undefined,
    include: updatedByInclude,
    orderBy: [{ activeFlag: "desc" }, { code: "asc" }]
  });
}

export function findEventCodeUsage(ids: string[]) {
  if (ids.length === 0) return Promise.resolve([]);

  return prisma.eventCode.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      code: true,
      _count: {
        select: {
          suggestedTransactions: true,
          transactions: true,
          campaigns: true,
          memberSubscriptions: true
        }
      },
      timeRule: { select: { eventCodeId: true } }
    }
  });
}

export async function applyEventCodeChangesAtomic(data: {
  creates: Array<{
    code: string;
    eventName: string;
    category: string | null;
    eventType: string;
    description: string | null;
    activeFlag: boolean;
  }>;
  updates: Array<{
    id: string;
    input: {
      code: string;
      eventName: string;
      category: string | null;
      eventType: string;
      description: string | null;
      activeFlag: boolean;
    };
  }>;
  deletes: string[];
  userId: string;
}) {
  return prisma.$transaction(async (tx) => {
    const requestedTypes = new Map(data.updates.map((item) => [item.id, item.input.eventType]));
    const currentTypes = await tx.eventCode.findMany({
      where: { id: { in: [...requestedTypes.keys()] } },
      select: { id: true, eventType: true, code: true, timeRule: { select: { eventCodeId: true } }, _count: { select: { transactions: true, memberSubscriptions: true } } }
    });
    for (const current of currentTypes) {
      const nextType = requestedTypes.get(current.id)!;
      if (current.eventType !== "TIME_BASED" && nextType === "TIME_BASED" && current._count.transactions > 0) {
        throw new HttpError(409, `Event Code ${current.code} with transaction history cannot become TIME_BASED. Create a new Event Code instead.`);
      }
      if (current.eventType === "TIME_BASED" && nextType !== "TIME_BASED" && (current._count.transactions > 0 || current._count.memberSubscriptions > 0 || current.timeRule)) {
        throw new HttpError(409, `TIME_BASED Event Code ${current.code} with a Time Rule, transaction or subscription history must remain TIME_BASED. Deactivate it instead.`);
      }
    }
    const nonCampaignIds = data.updates.filter((item) => item.input.eventType !== "CAMPAIGN").map((item) => item.id);
    if (nonCampaignIds.length) {
      const used = await tx.eventCode.findFirst({ where: { id: { in: nonCampaignIds }, campaigns: { some: {} } }, select: { code: true } });
      if (used) throw new HttpError(409, `Event Code ${used.code} has Campaign history. Deactivate it instead.`);
    }
    const nonTimeBasedIds = data.updates.filter((item) => item.input.eventType !== "TIME_BASED").map((item) => item.id);
    if (nonTimeBasedIds.length) {
      const used = await tx.eventCode.findFirst({ where: { id: { in: nonTimeBasedIds }, OR: [{ memberSubscriptions: { some: {} } }, { timeRule: { isNot: null } }] }, select: { code: true } });
      if (used) throw new HttpError(409, `Event Code ${used.code} has a Time Rule or Time-Based subscription history. Deactivate it instead.`);
    }
    if (data.deletes.length > 0) {
      await tx.eventCode.deleteMany({
        where: { id: { in: data.deletes } }
      });
    }

    for (const update of data.updates) {
      await tx.eventCode.update({
        where: { id: update.id },
        data: {
          code: update.input.code,
          eventName: update.input.eventName,
          category: update.input.category,
          eventType: update.input.eventType,
          description: update.input.description,
          activeFlag: update.input.activeFlag,
          updatedById: data.userId
        }
      });
    }

    for (const create of data.creates) {
      await tx.eventCode.create({
        data: {
          code: create.code,
          eventName: create.eventName,
          category: create.category,
          eventType: create.eventType,
          description: create.description,
          activeFlag: create.activeFlag,
          createdById: data.userId,
          updatedById: data.userId
        }
      });
    }

    return tx.eventCode.findMany({
      include: updatedByInclude,
      orderBy: [{ activeFlag: "desc" }, { code: "asc" }]
    });
  });
}
