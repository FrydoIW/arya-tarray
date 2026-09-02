import { apiFetch } from "@/lib/api";
import type {
  BankAccount,
  BankAccountExecutePayload,
  BankAccountUser,
  BankAccountWorkspace,
  SupportedBank
} from "../types";

type BankAccountApiUser = {
  id: string;
  fullName: string;
};

type BankAccountApiItem = {
  id: string;
  bankCode: string;
  bankName: string;
  accountNo: string;
  accountName: string;
  currencyCode: string;
  activeFlag: boolean;
  statementCount: number;
  createdAt?: string;
  updatedAt?: string;
  updatedBy?: BankAccountApiUser | null;
};

type SupportedBankApiItem = {
  bankCode: string;
  bankName: string;
  currencyCode: string;
};

type WorkspaceApiResponse = {
  accounts: BankAccountApiItem[];
  supportedBanks: SupportedBankApiItem[];
};

type ExecuteApiResponse = WorkspaceApiResponse & {
  changedCount: number;
};

function mapUser(user?: BankAccountApiUser | null): BankAccountUser | null {
  return user ? { id: String(user.id), fullName: user.fullName } : null;
}

function mapAccount(item: BankAccountApiItem): BankAccount {
  return {
    id: String(item.id),
    bankCode: item.bankCode,
    bankName: item.bankName,
    accountNo: item.accountNo,
    accountName: item.accountName,
    currencyCode: item.currencyCode,
    activeFlag: item.activeFlag,
    statementCount: Number(item.statementCount ?? 0),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    updatedBy: mapUser(item.updatedBy)
  };
}

function mapSupportedBank(item: SupportedBankApiItem): SupportedBank {
  return {
    bankCode: item.bankCode,
    bankName: item.bankName,
    currencyCode: item.currencyCode
  };
}

function mapWorkspace(result: WorkspaceApiResponse): BankAccountWorkspace {
  return {
    accounts: result.accounts.map(mapAccount),
    supportedBanks: result.supportedBanks.map(mapSupportedBank)
  };
}

export async function getBankAccountWorkspace() {
  return mapWorkspace(await apiFetch<WorkspaceApiResponse>("/configuration/bank-accounts/workspace"));
}

export async function executeBankAccountWorkspace(payload: BankAccountExecutePayload) {
  const result = await apiFetch<ExecuteApiResponse>("/configuration/bank-accounts/workspace/execute", {
    method: "POST",
    body: JSON.stringify(payload)
  });

  return {
    changedCount: result.changedCount,
    ...mapWorkspace(result)
  };
}
