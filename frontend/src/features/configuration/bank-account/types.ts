export type BankAccountUser = {
  id: string;
  fullName: string;
};

export type SupportedBank = {
  bankCode: string;
  bankName: string;
  currencyCode: string;
};

export type BankAccountBalance = {
  configured: boolean;
  finalizedIncoming: string | null;
  finalizedOutgoing: string | null;
  reconciledBalance: string | null;
  pendingMovement: string | null;
};

export type BankAccount = {
  id: string;
  bankCode: string;
  bankName: string;
  accountNo: string;
  accountName: string;
  currencyCode: string;
  openingBalance: string | null;
  openingBalanceDate: string | null;
  openingBalanceLockedAt: string | null;
  openingBalanceEditable: boolean;
  balance: BankAccountBalance;
  activeFlag: boolean;
  statementCount: number;
  createdAt?: string;
  updatedAt?: string;
  updatedBy?: BankAccountUser | null;
  isDraft?: boolean;
};

export type BankAccountCreateInput = {
  clientId: string;
  bankCode: string;
  accountNo: string;
  accountName: string;
  activeFlag: boolean;
  openingBalance: string | null;
  openingBalanceDate: string | null;
};

export type BankAccountUpdateInput = {
  id: string;
  input: {
    accountName: string;
    activeFlag: boolean;
    openingBalance: string | null;
    openingBalanceDate: string | null;
  };
};

export type BankAccountExecutePayload = {
  creates: BankAccountCreateInput[];
  updates: BankAccountUpdateInput[];
};

export type BankAccountWorkspace = {
  accounts: BankAccount[];
  supportedBanks: SupportedBank[];
};

export type BankAccountStatusFilter = "ALL" | "ACTIVE" | "INACTIVE";
