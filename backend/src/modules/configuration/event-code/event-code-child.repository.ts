import { prisma } from "../../../lib/prisma.js";
import { HttpError } from "../../../lib/http.js";
import type { ChildExecuteInput, ChildValueInput } from "./event-code-child.schema.js";

const childSelect = {
  id: true,
  eventCodeId: true,
  childCode: true,
  childName: true,
  description: true,
  displayOrder: true,
  activeFlag: true,
  createdAt: true,
  updatedAt: true,
  eventCode: {
    select: {
      id: true,
      code: true,
      eventName: true,
      eventType: true,
      activeFlag: true
    }
  },
  _count: {
    select: {
      transactions: true,
      correctionItemsBefore: true,
      correctionItemsProposed: true
    }
  },
  updatedBy: {
    select: {
      id: true,
      fullName: true
    }
  }
} as const;

export type EventCodeChildRecord = Awaited<ReturnType<typeof prisma.eventCodeChild.findMany>>[number];

export function listEventCodeChildren() {
  return prisma.eventCodeChild.findMany({
    select: childSelect,
    orderBy: [{ eventCode: { code: "asc" } }, { displayOrder: "asc" }, { childCode: "asc" }, { childName: "asc" }]
  });
}

export function findChildUsage(ids: string[]) {
  if (ids.length === 0) return Promise.resolve([]);
  return prisma.eventCodeChild.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      childCode: true,
      _count: {
        select: {
          transactions: true,
          correctionItemsBefore: true,
          correctionItemsProposed: true
        }
      }
    }
  });
}

export async function applyChildChangesAtomic(input: {
  creates: ChildValueInput[];
  updates: Array<{ id: string; input: ChildValueInput }>;
  deletes: string[];
  userId: string;
}) {
  return prisma.$transaction(async (tx) => {
    const updatedIds = input.updates.map((item) => item.id);
    const existing = updatedIds.length
      ? await tx.eventCodeChild.findMany({
          where: { id: { in: updatedIds } },
          select: { id: true, eventCodeId: true }
        })
      : [];
    const existingById = new Map(existing.map((item) => [item.id, item]));

    for (const update of input.updates) {
      const current = existingById.get(update.id);
      if (!current) throw new HttpError(404, "Salah satu Child yang diubah tidak ditemukan");
      if (current.eventCodeId !== update.input.eventCodeId) {
        throw new HttpError(409, "A Child cannot be moved to another Event Code. Deactivate it and create a new Child instead.");
      }
    }

    const parentIds = [...new Set([
      ...input.creates.map((item) => item.eventCodeId),
      ...input.updates.map((item) => item.input.eventCodeId)
    ])];
    if (parentIds.length) {
      const parents = await tx.eventCode.findMany({
        where: { id: { in: parentIds } },
        select: { id: true, activeFlag: true, code: true }
      });
      const parentById = new Map(parents.map((parent) => [parent.id, parent]));
      for (const create of input.creates) {
        const parent = parentById.get(create.eventCodeId);
        if (!parent) throw new HttpError(404, "Salah satu Event Code untuk Child baru tidak ditemukan");
        if (!parent.activeFlag) {
          throw new HttpError(409, `Event Code ${parent.code} is inactive. Activate it before creating a Child.`);
        }
      }
      for (const update of input.updates) {
        const parent = parentById.get(update.input.eventCodeId);
        if (!parent) throw new HttpError(404, "Salah satu Event Code untuk Child yang diubah tidak ditemukan");
      }
    }

    if (input.deletes.length > 0) {
      const usage = await findChildUsage(input.deletes);
      const used = usage.find((item) => item._count.transactions > 0 || item._count.correctionItemsBefore > 0 || item._count.correctionItemsProposed > 0);
      if (used) {
        throw new HttpError(409, `Child ${used.childCode} sudah dipakai transaksi atau koreksi. Ubah status menjadi Inactive daripada menghapusnya.`);
      }
    }

    const allChildren = await tx.eventCodeChild.findMany({
      select: { id: true, eventCodeId: true, childCode: true }
    });
    const finalRows = new Map<string, { eventCodeId: string; childCode: string; id: string }>();
    for (const child of allChildren) {
      if (input.deletes.includes(child.id)) continue;
      finalRows.set(child.id, { eventCodeId: child.eventCodeId, childCode: child.childCode, id: child.id });
    }
    for (const update of input.updates) {
      finalRows.set(update.id, { eventCodeId: update.input.eventCodeId, childCode: update.input.childCode.trim(), id: update.id });
    }

    const codeOwners = new Map<string, string>();
    for (const row of finalRows.values()) {
      const key = `${row.eventCodeId}:${row.childCode}`;
      const owner = codeOwners.get(key);
      if (owner && owner !== row.id) {
        throw new HttpError(409, `Child Code ${row.childCode} muncul lebih dari satu kali untuk Event Code yang sama`);
      }
      codeOwners.set(key, row.id);
    }

    input.creates.forEach((create, index) => {
      const key = `${create.eventCodeId}:${create.childCode.trim()}`;
      if (codeOwners.has(key)) {
        throw new HttpError(409, `Child Code ${create.childCode} sudah digunakan untuk Event Code ini`);
      }
      codeOwners.set(key, `create-${index}`);
    });

    if (input.deletes.length > 0) {
      await tx.eventCodeChild.deleteMany({ where: { id: { in: input.deletes } } });
    }

    for (const update of input.updates) {
      await tx.eventCodeChild.update({
        where: { id: update.id },
        data: {
          childCode: update.input.childCode.trim(),
          childName: update.input.childName.trim(),
          description: update.input.description?.trim() || null,
          displayOrder: update.input.displayOrder,
          activeFlag: update.input.activeFlag,
          updatedById: input.userId
        }
      });
    }

    for (const create of input.creates) {
      await tx.eventCodeChild.create({
        data: {
          eventCodeId: create.eventCodeId,
          childCode: create.childCode.trim(),
          childName: create.childName.trim(),
          description: create.description?.trim() || null,
          displayOrder: create.displayOrder,
          activeFlag: create.activeFlag,
          createdById: input.userId,
          updatedById: input.userId
        }
      });
    }

    return tx.eventCodeChild.findMany({
      select: childSelect,
      orderBy: [{ eventCode: { code: "asc" } }, { displayOrder: "asc" }, { childCode: "asc" }, { childName: "asc" }]
    });
  }, { isolationLevel: "Serializable" });
}
