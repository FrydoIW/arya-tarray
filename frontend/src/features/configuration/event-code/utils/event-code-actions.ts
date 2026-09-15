import type { EventCode, EventCodeInput } from "../types";

export function normalizeInput(item: EventCode): EventCodeInput {
  return {
    code: item.code.trim(),
    eventName: item.eventName.trim(),
    category: item.category?.trim() || null,
    eventType: item.eventType,
    description: item.description?.trim() || null,
    activeFlag: item.activeFlag
  };
}

export function sameInput(a: EventCodeInput, b: EventCodeInput) {
  return a.code === b.code
    && a.eventName === b.eventName
    && a.category === b.category
    && a.eventType === b.eventType
    && a.description === b.description
    && a.activeFlag === b.activeFlag;
}

export function validateRows(rows: EventCode[]) {
  const usedCodes = new Set<string>();

  for (const [index, row] of rows.entries()) {
    const code = row.code.trim();
    const eventName = row.eventName.trim();
    const category = row.category?.trim() ?? "";

    if (!/^\d{3}$/.test(code)) {
      return `Row ${index + 1}: Event Code harus tepat 3 digit.`;
    }
    if (!eventName || eventName.length > 150) {
      return `Row ${index + 1}: Event Name wajib diisi dan maksimal 150 karakter.`;
    }
    if (category.length > 50) {
      return `Row ${index + 1}: Category maksimal 50 karakter.`;
    }
    if ((row.description?.trim().length ?? 0) > 500) return `Row ${index + 1}: Description maksimal 500 karakter.`;
    if (!["STANDARD", "CAMPAIGN", "TIME_BASED"].includes(row.eventType)) return `Row ${index + 1}: Invalid Event Type.`;
    if (usedCodes.has(code)) {
      return `Event Code ${code} muncul lebih dari satu kali.`;
    }
    usedCodes.add(code);
  }

  return "";
}

export function eventCodeActionState(dirty: boolean, rows: EventCode[], busy: boolean) {
  const validationError = validateRows(rows);
  return { canClear: dirty && !busy, canExecute: dirty && !busy && !validationError, canReload: !dirty && !busy, validationError };
}
