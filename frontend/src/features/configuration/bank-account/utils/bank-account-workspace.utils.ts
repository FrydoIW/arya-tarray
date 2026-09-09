import type {
  BankAccount,
  BankAccountBalance,
  BankAccountExecutePayload,
  BankAccountStatusFilter,
  SupportedBank
} from "../types";

export function canonicalAccountNo(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 10);
  if (digits.length <= 3) return digits;
  return `${digits.slice(0, 3)}-${digits.slice(3)}`;
}

export function canonicalOpeningBalance(value: string | null) {
  if (value == null) return null;
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return value.trim();
  const integer = match[2].replace(/^0+(?=\d)/, "");
  const decimal = (match[3] ?? "").padEnd(2, "0");
  const negative = match[1] === "-" && (integer !== "0" || decimal !== "00");
  return `${negative ? "-" : ""}${integer}.${decimal}`;
}

function moneyToCents(value: string) {
  const normalized = canonicalOpeningBalance(value) ?? "0.00";
  const negative = normalized.startsWith("-");
  const [whole, fraction] = (negative ? normalized.slice(1) : normalized).split(".");
  const cents = BigInt(whole) * BigInt(100) + BigInt(fraction);
  return negative ? -cents : cents;
}

function centsToMoney(value: bigint) {
  const negative = value < BigInt(0);
  const absolute = negative ? -value : value;
  return `${negative ? "-" : ""}${absolute / BigInt(100)}.${(absolute % BigInt(100)).toString().padStart(2, "0")}`;
}

export function rebaseBankAccountBalance(balance: BankAccountBalance, openingBalance: string | null): BankAccountBalance {
  if (openingBalance == null) {
    return {
      configured: false,
      finalizedIncoming: null,
      finalizedOutgoing: null,
      reconciledBalance: null,
      pendingMovement: null
    };
  }

  const incoming = balance.finalizedIncoming ?? "0.00";
  const outgoing = balance.finalizedOutgoing ?? "0.00";
  return {
    configured: true,
    finalizedIncoming: incoming,
    finalizedOutgoing: outgoing,
    reconciledBalance: centsToMoney(moneyToCents(openingBalance) + moneyToCents(incoming) - moneyToCents(outgoing)),
    pendingMovement: balance.pendingMovement ?? "0.00"
  };
}

function comparable(row: BankAccount) {
  return {
    accountName: row.accountName.trim(),
    activeFlag: row.activeFlag,
    openingBalance: canonicalOpeningBalance(row.openingBalance),
    openingBalanceDate: row.openingBalanceDate
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
    return a.accountName !== b.accountName
      || a.activeFlag !== b.activeFlag
      || a.openingBalance !== b.openingBalance
      || a.openingBalanceDate !== b.openingBalanceDate;
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

    const hasOpeningBalance = row.openingBalance != null && row.openingBalance.trim() !== "";
    const hasOpeningBalanceDate = Boolean(row.openingBalanceDate);
    if (hasOpeningBalance !== hasOpeningBalanceDate) {
      return `Row ${index + 1}: Opening Balance and Balance As Of must be supplied together or both omitted.`;
    }
    if (hasOpeningBalance && !/^-?\d{1,17}(?:\.\d{1,2})?$/.test(row.openingBalance!.trim())) {
      return `Row ${index + 1}: Opening Balance must be a valid amount with at most 2 decimal places.`;
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
        activeFlag: row.activeFlag,
        openingBalance: canonicalOpeningBalance(row.openingBalance),
        openingBalanceDate: row.openingBalanceDate
      });
      continue;
    }

    const original = serverById.get(row.id);
    if (!original) continue;
    const next = comparable(row);
    const before = comparable(original);
    if (next.accountName !== before.accountName
      || next.activeFlag !== before.activeFlag
      || next.openingBalance !== before.openingBalance
      || next.openingBalanceDate !== before.openingBalanceDate) {
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
