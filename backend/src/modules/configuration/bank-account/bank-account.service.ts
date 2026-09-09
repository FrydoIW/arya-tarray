import { Prisma } from "@prisma/client";
import { HttpError } from "../../../lib/http.js";
import type { BankAccountWorkspaceExecuteInput } from "./bank-account.schema.js";
import {
  applyBankAccountChangesAtomic,
  loadBankAccountWorkspace
} from "./bank-account.repository.js";
import { calculateBankBalance, openingBalanceCanBeChanged } from "./bank-account.balance.js";

const SUPPORTED_BANKS = [
  {
    bankCode: "BCA",
    bankName: "Bank Central Asia",
    currencyCode: "IDR"
  }
] as const;

type BankAccountWorkspaceRecord = Awaited<ReturnType<typeof loadBankAccountWorkspace>>;
type BankAccountRecord = BankAccountWorkspaceRecord["items"][number];

function normalizeBcaAccountNo(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 10) {
    throw new HttpError(400, "BCA Account Number harus terdiri dari 10 digit.");
  }
  return `${digits.slice(0, 3)}-${digits.slice(3)}`;
}

function getSupportedBank(bankCode: string) {
  return SUPPORTED_BANKS.find((item) => item.bankCode === bankCode.trim().toUpperCase());
}

function toResponse(item: BankAccountRecord, movement: BankAccountWorkspaceRecord["balances"][number] | undefined) {
  const openingBalanceEditable = openingBalanceCanBeChanged({
    openingBalanceLockedAt: item.openingBalanceLockedAt,
    statementCount: item._count.statements
  });
  return {
    id: item.id,
    bankCode: item.bankCode,
    bankName: item.bankName,
    accountNo: item.accountNo,
    accountName: item.accountName,
    currencyCode: item.currencyCode,
    openingBalance: item.openingBalance?.toFixed(2) ?? null,
    openingBalanceDate: item.openingBalanceDate?.toISOString().slice(0, 10) ?? null,
    openingBalanceLockedAt: item.openingBalanceLockedAt,
    openingBalanceEditable,
    balance: calculateBankBalance({
      openingBalance: item.openingBalance,
      openingBalanceDate: item.openingBalanceDate,
      finalizedIncoming: movement?.finalizedIncoming,
      finalizedOutgoing: movement?.finalizedOutgoing,
      pendingMovement: movement?.pendingMovement
    }),
    activeFlag: item.activeFlag,
    statementCount: item._count.statements,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    updatedBy: item.updatedBy
  };
}

function toWorkspaceResponse(workspace: BankAccountWorkspaceRecord) {
  const movementByAccountId = new Map(workspace.balances.map((item) => [item.bankAccountId, item]));
  return {
    accounts: workspace.items.map((item) => toResponse(item, movementByAccountId.get(item.id))),
    supportedBanks: SUPPORTED_BANKS.map((item) => ({ ...item }))
  };
}

export async function getBankAccountWorkspace() {
  return toWorkspaceResponse(await loadBankAccountWorkspace());
}

function parseOpeningBalanceDate(value: string | null) {
  return value == null ? null : new Date(`${value}T00:00:00.000Z`);
}

function normalizeOpeningBalance(value: string | null) {
  return value == null ? null : new Prisma.Decimal(value).toFixed(2);
}

function openingBalancePairIsComplete(openingBalance: string | null, openingBalanceDate: Date | null) {
  return (openingBalance == null) === (openingBalanceDate == null);
}

function ensureNoDuplicates(values: string[], message: string) {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new HttpError(400, message);
    seen.add(value);
  }
}

export async function executeBankAccountWorkspace(input: BankAccountWorkspaceExecuteInput, userId: string) {
  const existingItems = await loadBankAccountWorkspace();
  const existingById = new Map(existingItems.items.map((item) => [item.id, item]));
  const existingIdentity = new Set(
    existingItems.items.map((item) => `${item.bankCode.toUpperCase()}::${item.accountNo.replace(/\D/g, "")}`)
  );

  ensureNoDuplicates(input.creates.map((item) => item.clientId), "Draft Bank Account dikirim lebih dari satu kali.");
  ensureNoDuplicates(input.updates.map((item) => item.id), "Bank Account yang sama dikirim lebih dari satu kali.");

  const createIdentity = new Set<string>();
  const creates = input.creates.map((create) => {
    const supportedBank = getSupportedBank(create.bankCode);
    if (!supportedBank) {
      throw new HttpError(400, "Bank Account V1 hanya mendukung bank BCA.");
    }

    const normalizedAccountNo = normalizeBcaAccountNo(create.accountNo);
    const identity = `${supportedBank.bankCode}::${normalizedAccountNo.replace(/\D/g, "")}`;
    if (existingIdentity.has(identity) || createIdentity.has(identity)) {
      throw new HttpError(409, `${supportedBank.bankCode} ${normalizedAccountNo} sudah terdaftar.`);
    }
    createIdentity.add(identity);

    return {
      clientId: create.clientId,
      bankCode: supportedBank.bankCode,
      bankName: supportedBank.bankName,
      accountNo: normalizedAccountNo,
      accountName: create.accountName.trim(),
      currencyCode: supportedBank.currencyCode,
      activeFlag: create.activeFlag,
      openingBalance: normalizeOpeningBalance(create.openingBalance),
      openingBalanceDate: parseOpeningBalanceDate(create.openingBalanceDate)
    };
  });

  const updates = input.updates.map((update) => {
    const existing = existingById.get(update.id);
    if (!existing) {
      throw new HttpError(404, "Salah satu Bank Account yang diubah tidak ditemukan.");
    }
    const openingBalance = update.input.openingBalance === undefined
      ? existing.openingBalance?.toFixed(2) ?? null
      : normalizeOpeningBalance(update.input.openingBalance);
    const openingBalanceDate = update.input.openingBalanceDate === undefined
      ? existing.openingBalanceDate
      : parseOpeningBalanceDate(update.input.openingBalanceDate);
    if (!openingBalancePairIsComplete(openingBalance, openingBalanceDate)) {
      throw new HttpError(400, "Opening Balance and Balance As Of must be supplied together or both omitted.");
    }
    const openingBalanceChanged = openingBalance !== (existing.openingBalance?.toFixed(2) ?? null)
      || openingBalanceDate?.toISOString().slice(0, 10) !== existing.openingBalanceDate?.toISOString().slice(0, 10);
    if (openingBalanceChanged && !openingBalanceCanBeChanged({
      openingBalanceLockedAt: existing.openingBalanceLockedAt,
      statementCount: existing._count.statements
    })) {
      throw new HttpError(409, "Opening Balance can no longer be changed because this bank account already has statement activity.");
    }
    return {
      id: update.id,
      input: {
        accountName: update.input.accountName.trim(),
        activeFlag: update.input.activeFlag,
        openingBalance,
        openingBalanceDate,
        openingBalanceChanged
      }
    };
  });

  if (creates.length === 0 && updates.length === 0) {
    return {
      changedCount: 0,
      ...toWorkspaceResponse(existingItems)
    };
  }

  try {
    const result = await applyBankAccountChangesAtomic({ creates, updates, userId });
    return {
      changedCount: creates.length + updates.length,
      ...toWorkspaceResponse(result)
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("Unique constraint") || message.includes("Duplicate entry")) {
      throw new HttpError(409, "Bank dan Account Number tersebut sudah terdaftar.");
    }
    throw error;
  }
}
