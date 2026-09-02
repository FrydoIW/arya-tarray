import { HttpError } from "../../../lib/http.js";
import type { BankAccountWorkspaceExecuteInput } from "./bank-account.schema.js";
import {
  applyBankAccountChangesAtomic,
  loadBankAccountWorkspace
} from "./bank-account.repository.js";

const SUPPORTED_BANKS = [
  {
    bankCode: "BCA",
    bankName: "Bank Central Asia",
    currencyCode: "IDR"
  }
] as const;

type BankAccountRecord = Awaited<ReturnType<typeof loadBankAccountWorkspace>>[number];

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

function toResponse(item: BankAccountRecord) {
  return {
    id: item.id,
    bankCode: item.bankCode,
    bankName: item.bankName,
    accountNo: item.accountNo,
    accountName: item.accountName,
    currencyCode: item.currencyCode,
    activeFlag: item.activeFlag,
    statementCount: item._count.statements,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    updatedBy: item.updatedBy
  };
}

function toWorkspaceResponse(items: BankAccountRecord[]) {
  return {
    accounts: items.map(toResponse),
    supportedBanks: SUPPORTED_BANKS.map((item) => ({ ...item }))
  };
}

export async function getBankAccountWorkspace() {
  return toWorkspaceResponse(await loadBankAccountWorkspace());
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
  const existingById = new Map(existingItems.map((item) => [item.id, item]));
  const existingIdentity = new Set(
    existingItems.map((item) => `${item.bankCode.toUpperCase()}::${item.accountNo.replace(/\D/g, "")}`)
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
      activeFlag: create.activeFlag
    };
  });

  const updates = input.updates.map((update) => {
    if (!existingById.has(update.id)) {
      throw new HttpError(404, "Salah satu Bank Account yang diubah tidak ditemukan.");
    }
    return {
      id: update.id,
      input: {
        accountName: update.input.accountName.trim(),
        activeFlag: update.input.activeFlag
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
