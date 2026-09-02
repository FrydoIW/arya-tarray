import type { Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma.js";

const bankAccountInclude = {
  updatedBy: {
    select: {
      id: true,
      fullName: true
    }
  },
  _count: {
    select: {
      statements: true
    }
  }
} as const;

function listBankAccountsWithClient(client: Prisma.TransactionClient | typeof prisma) {
  return client.bankAccount.findMany({
    include: bankAccountInclude,
    orderBy: [
      { activeFlag: "desc" },
      { bankCode: "asc" },
      { accountNo: "asc" }
    ]
  });
}

export function loadBankAccountWorkspace() {
  return listBankAccountsWithClient(prisma);
}

export type BankAccountAtomicInput = {
  creates: Array<{
    clientId: string;
    bankCode: string;
    bankName: string;
    accountNo: string;
    accountName: string;
    currencyCode: string;
    activeFlag: boolean;
  }>;
  updates: Array<{
    id: string;
    input: {
      accountName: string;
      activeFlag: boolean;
    };
  }>;
  userId: string;
};

export async function applyBankAccountChangesAtomic(data: BankAccountAtomicInput) {
  return prisma.$transaction(async (tx) => {
    for (const update of data.updates) {
      await tx.bankAccount.update({
        where: { id: update.id },
        data: {
          accountName: update.input.accountName,
          activeFlag: update.input.activeFlag,
          updatedById: data.userId
        }
      });
    }

    for (const create of data.creates) {
      await tx.bankAccount.create({
        data: {
          bankCode: create.bankCode,
          bankName: create.bankName,
          accountNo: create.accountNo,
          accountName: create.accountName,
          currencyCode: create.currencyCode,
          activeFlag: create.activeFlag,
          createdById: data.userId,
          updatedById: data.userId
        }
      });
    }

    return listBankAccountsWithClient(tx);
  });
}
