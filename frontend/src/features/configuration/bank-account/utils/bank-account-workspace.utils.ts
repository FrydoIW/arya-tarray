import type {
  BankAccount,
  BankAccountExecutePayload,
  BankAccountStatusFilter,
  SupportedBank
} from "../types";

export function canonicalAccountNo(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 10);
  if (digits.length <= 3) return digits;
  return `${digits.slice(0, 3)}-${digits.slice(3)}`;
}

function comparable(row: BankAccount) {
  return {
    accountName: row.accountName.trim(),
    activeFlag: row.activeFlag
  };
}

export function bankAccountsAreDirty(serverRows: BankAccount[], workingRows: BankAccount[]) {
  if (workingRows.some((row) => row.isDraft)) return true;
  if (serverRows.length !== workingRows.length) return true;

  const serverById = new Map(serverRows.map((row) => [row.id, row]));
  return workingRows.some((row) => {
    const original = serverById.get(row.id);
    if (!original) return true;
    const a = comparable(row);
    const b = comparable(original);
    return a.accountName !== b.accountName || a.activeFlag !== b.activeFlag;
  });
}

export function validateBankAccountWorkspace(rows: BankAccount[], supportedBanks: SupportedBank[]) {
  const supportedCodes = new Set(supportedBanks.map((item) => item.bankCode));
  const identities = new Set<string>();

  for (const [index, row] of rows.entries()) {
    if (!supportedCodes.has(row.bankCode)) {
      return `Row ${index + 1}: bank ${row.bankCode || "-"} belum didukung.`;
    }

    const digits = row.accountNo.replace(/\D/g, "");
    if (digits.length !== 10) {
      return `Row ${index + 1}: BCA Account Number harus 10 digit.`;
    }
    if (!row.accountName.trim()) {
      return `Row ${index + 1}: Account Name wajib diisi.`;
    }

    const identity = `${row.bankCode}::${digits}`;
    if (identities.has(identity)) {
      return `Bank Account ${canonicalAccountNo(row.accountNo)} muncul lebih dari satu kali.`;
    }
    identities.add(identity);
  }

  return "";
}

export function buildBankAccountPayload(serverRows: BankAccount[], workingRows: BankAccount[]): BankAccountExecutePayload {
  const serverById = new Map(serverRows.map((row) => [row.id, row]));
  const creates: BankAccountExecutePayload["creates"] = [];
  const updates: BankAccountExecutePayload["updates"] = [];

  for (const row of workingRows) {
    if (row.isDraft) {
      creates.push({
        clientId: row.id,
        bankCode: row.bankCode,
        accountNo: canonicalAccountNo(row.accountNo),
        accountName: row.accountName.trim(),
        activeFlag: row.activeFlag
      });
      continue;
    }

    const original = serverById.get(row.id);
    if (!original) continue;
    const next = comparable(row);
    const before = comparable(original);
    if (next.accountName !== before.accountName || next.activeFlag !== before.activeFlag) {
      updates.push({ id: row.id, input: next });
    }
  }

  return { creates, updates };
}

export function filterBankAccounts(rows: BankAccount[], search: string, statusFilter: BankAccountStatusFilter) {
  const query = search.trim().toLowerCase();
  return rows.filter((row) => {
    const statusMatches = statusFilter === "ALL"
      || (statusFilter === "ACTIVE" && row.activeFlag)
      || (statusFilter === "INACTIVE" && !row.activeFlag);
    if (!statusMatches) return false;
    if (!query) return true;
    return [row.bankCode, row.bankName, row.accountNo, row.accountName, row.currencyCode, row.updatedBy?.fullName ?? ""]
      .some((value) => value.toLowerCase().includes(query));
  });
}

export function summarizeBankAccounts(rows: BankAccount[], supportedBanks: SupportedBank[]) {
  return {
    total: rows.length,
    active: rows.filter((row) => row.activeFlag).length,
    inactive: rows.filter((row) => !row.activeFlag).length,
    supportedBanks: supportedBanks.map((item) => item.bankCode).join(", ") || "-"
  };
}
