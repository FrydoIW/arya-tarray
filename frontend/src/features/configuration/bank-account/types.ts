export type BankAccountUser = {
  id: string;
  fullName: string;
};

export type SupportedBank = {
  bankCode: string;
  bankName: string;
  currencyCode: string;
};

export type BankAccount = {
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
  updatedBy?: BankAccountUser | null;
  isDraft?: boolean;
};

export type BankAccountCreateInput = {
  clientId: string;
  bankCode: string;
  accountNo: string;
  accountName: string;
  activeFlag: boolean;
};

export type BankAccountUpdateInput = {
  id: string;
  input: {
    accountName: string;
    activeFlag: boolean;
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
