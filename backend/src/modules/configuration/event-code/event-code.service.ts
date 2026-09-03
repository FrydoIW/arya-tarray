import { HttpError } from "../../../lib/http.js";
import type { EventCodeExecuteInput } from "./event-code.schema.js";
import {
  applyEventCodeChangesAtomic,
  findEventCodeUsage,
  listEventCodes as listEventCodeRecords
} from "./event-code.repository.js";

type EventCodeRecord = {
  id: string;
  code: string;
  eventName: string;
  category: string | null;
  description: string | null;
  activeFlag: boolean;
  createdAt: Date;
  updatedAt: Date;
  updatedBy: {
    id: string;
    fullName: string;
  } | null;
};

function toResponse(item: EventCodeRecord) {
  return {
    id: item.id,
    code: item.code,
    eventName: item.eventName,
    category: item.category,
    description: item.description,
    activeFlag: item.activeFlag,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    updatedBy: item.updatedBy
  };
}

export async function listEventCodes(search?: string) {
  const items = await listEventCodeRecords(search);
  return items.map(toResponse);
}

export async function executeEventCodeChanges(input: EventCodeExecuteInput, userId: string) {
  const existingItems = await listEventCodeRecords();
  const existingById = new Map(existingItems.map((item) => [item.id, item]));

  const deleteIds = new Set<string>();
  for (const id of input.deletes) {
    if (deleteIds.has(id)) {
      throw new HttpError(400, `Event Code ${id} dikirim untuk delete lebih dari satu kali`);
    }
    if (!existingById.has(id)) {
      throw new HttpError(404, "Salah satu Event Code yang dihapus tidak ditemukan");
    }
    deleteIds.add(id);
  }

  const updatedIds = new Set<string>();
  for (const update of input.updates) {
    if (updatedIds.has(update.id)) {
      throw new HttpError(400, `Event Code ${update.id} dikirim lebih dari satu kali`);
    }
    if (deleteIds.has(update.id)) {
      throw new HttpError(400, "Event Code yang sama tidak boleh di-update dan di-delete dalam satu Execute");
    }
    if (!existingById.has(update.id)) {
      throw new HttpError(404, "Salah satu Event Code yang diubah tidak ditemukan");
    }
    updatedIds.add(update.id);
  }

  if (input.deletes.length > 0) {
    const usageRows = await findEventCodeUsage(input.deletes);
    const used = usageRows.find((item) => item._count.suggestedTransactions > 0 || item._count.transactions > 0);
    if (used) {
      throw new HttpError(
        409,
        `Event Code ${used.code} sudah dipakai transaksi. Ubah status menjadi Inactive daripada menghapusnya.`
      );
    }
  }

  const finalRows = new Map(
    existingItems
      .filter((item) => !deleteIds.has(item.id))
      .map((item) => [item.id, { id: item.id, code: item.code }])
  );

  for (const update of input.updates) {
    finalRows.set(update.id, {
      id: update.id,
      code: update.input.code
    });
  }

  const codeOwners = new Map<string, string>();
  for (const row of finalRows.values()) {
    const owner = codeOwners.get(row.code);
    if (owner && owner !== row.id) {
      throw new HttpError(409, `Event Code ${row.code} muncul lebih dari satu kali`);
    }
    codeOwners.set(row.code, row.id);
  }

  input.creates.forEach((create, index) => {
    if (codeOwners.has(create.code)) {
      throw new HttpError(409, `Event Code ${create.code} sudah digunakan`);
    }
    codeOwners.set(create.code, `create-${index}`);
  });

  const items = await applyEventCodeChangesAtomic({
    creates: input.creates,
    updates: input.updates,
    deletes: input.deletes,
    userId
  });

  return {
    changedCount: input.creates.length + input.updates.length + input.deletes.length,
    items: items.map(toResponse)
  };
}
