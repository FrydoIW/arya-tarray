import { HttpError } from "../../../lib/http.js";
import type { EventCodeExecuteInput } from "./event-code.schema.js";
import { createEventCodeTemplate, parseEventCodeBulkWorkbook } from "./event-code.workbook.js";
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
  eventType: string;
  description: string | null;
  activeFlag: boolean;
  createdAt: Date;
  updatedAt: Date;
  updatedBy: {
    id: string;
    fullName: string;
  } | null;
};

export function assertEventTypeTransition(input: { currentType: string; nextType: string; transactionCount: number; subscriptionCount: number; hasTimeRule?: boolean }) {
  if (input.currentType !== "TIME_BASED" && input.nextType === "TIME_BASED" && input.transactionCount > 0) {
    throw new HttpError(409, "Event Code with transaction history cannot become TIME_BASED. Create a new Event Code instead.");
  }
  if (input.currentType === "TIME_BASED" && input.nextType !== "TIME_BASED" && (input.transactionCount > 0 || input.subscriptionCount > 0 || input.hasTimeRule)) {
    throw new HttpError(409, "TIME_BASED Event Code with a Time Rule, transaction or subscription history must remain TIME_BASED. Deactivate it instead.");
  }
}

function toResponse(item: EventCodeRecord) {
  return {
    id: item.id,
    code: item.code,
    eventName: item.eventName,
    category: item.category,
    eventType: item.eventType,
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

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export async function downloadEventCodeTemplate() {
  return createEventCodeTemplate();
}

export async function previewEventCodeBulkUpload(input: {
  file?: Express.Multer.File;
  stagedCodes: string[];
}) {
  const file = input.file;
  if (!file) throw new HttpError(400, "Choose an XLSX workbook to upload.");
  if (file.size <= 0) throw new HttpError(400, "The uploaded workbook is empty.");
  if (!file.originalname.toLowerCase().endsWith(".xlsx")) {
    throw new HttpError(400, "Unsupported file type. Please upload an .xlsx workbook.");
  }
  if (file.mimetype !== XLSX_MIME && file.mimetype !== "application/octet-stream") {
    throw new HttpError(400, "Unsupported file type. Please upload a valid XLSX workbook.");
  }

  const existingItems = await listEventCodeRecords();
  const preview = await parseEventCodeBulkWorkbook(file.buffer, {
    existingCodes: existingItems.map((item) => item.code),
    stagedCodes: input.stagedCodes
  });
  const fileName = file.originalname.split(/[\\/]/).pop() || "event-codes.xlsx";
  return { fileName, ...preview };
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
    const used = usageRows.find((item) => item._count.suggestedTransactions > 0 || item._count.transactions > 0 || item._count.campaigns > 0 || item._count.memberSubscriptions > 0 || item.timeRule);
    if (used) {
      throw new HttpError(
        409,
        `Event Code ${used.code} sudah dipakai transaksi. Ubah status menjadi Inactive daripada menghapusnya.`
      );
    }
  }

  const changedAwayFromCampaign = input.updates.filter((update) =>
    existingById.get(update.id)?.eventType === "CAMPAIGN" && update.input.eventType !== "CAMPAIGN"
  );
  if (changedAwayFromCampaign.length > 0) {
    const usage = await findEventCodeUsage(changedAwayFromCampaign.map((item) => item.id));
    if (usage.some((item) => item._count.campaigns > 0)) {
      throw new HttpError(409, "Event Code with Campaign history must remain CAMPAIGN. Deactivate it instead.");
    }
  }
  const changedAwayFromTimeBased = input.updates.filter((update) =>
    existingById.get(update.id)?.eventType === "TIME_BASED" && update.input.eventType !== "TIME_BASED"
  );
  if (changedAwayFromTimeBased.length > 0) {
    const usage = await findEventCodeUsage(changedAwayFromTimeBased.map((item) => item.id));
    if (usage.some((item) => item._count.memberSubscriptions > 0 || item.timeRule)) {
      throw new HttpError(409, "Event Code with a Time Rule or Time-Based subscription history must remain TIME_BASED. Deactivate it instead.");
    }
  }
  const typeChanges = input.updates.filter(update => existingById.get(update.id)?.eventType !== update.input.eventType);
  if (typeChanges.length > 0) {
    const usage = new Map((await findEventCodeUsage(typeChanges.map(item => item.id))).map(item => [item.id, item]));
    for (const change of typeChanges) {
      const current = existingById.get(change.id)!; const row = usage.get(change.id)!;
      assertEventTypeTransition({ currentType: current.eventType, nextType: change.input.eventType, transactionCount: row._count.transactions, subscriptionCount: row._count.memberSubscriptions, hasTimeRule: Boolean(row.timeRule) });
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
