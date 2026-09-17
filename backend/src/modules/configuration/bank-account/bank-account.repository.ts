import { Prisma } from "@prisma/client";
import { HttpError } from "../../../lib/http.js";
import { prisma } from "../../../lib/prisma.js";
import type { BankBalanceMovement } from "./bank-account.balance.js";

const bankAccountInclude = {
  updatedBy: {
    select: {
      id: true,
      fullName: true
    }
  },
  _count: {
    select: {
      statements: { where: { status: { not: "WITHDRAWN" } } }
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
  return loadBankAccountWorkspaceWithClient(prisma);
}

async function loadBankBalanceMovements(client: Prisma.TransactionClient | typeof prisma) {
  return client.$queryRaw<BankBalanceMovement[]>`
    SELECT
      ba.bank_account_id AS bankAccountId,
      COALESCE(SUM(CASE WHEN bt.status = 'FINALIZED' AND bt.reconciliation_excluded_at IS NULL AND bt.original_amount > 0 THEN bt.original_amount ELSE 0 END), 0) AS finalizedIncoming,
      COALESCE(SUM(CASE WHEN bt.status = 'FINALIZED' AND bt.reconciliation_excluded_at IS NULL AND bt.original_amount < 0 THEN -bt.original_amount ELSE 0 END), 0) AS finalizedOutgoing,
      COALESCE(SUM(CASE WHEN bt.status IN ('RAW', 'CHECK') THEN bt.original_amount ELSE 0 END), 0) AS pendingMovement
    FROM arya_bank_account ba
    LEFT JOIN arya_bank_statement_upload bs
      ON bs.bank_account_id = ba.bank_account_id
      AND bs.status <> 'WITHDRAWN'
    LEFT JOIN arya_bank_transaction bt
      ON bt.statement_upload_id = bs.statement_upload_id
      AND bt.transaction_date > ba.opening_balance_date
    GROUP BY ba.bank_account_id
  `;
}

async function loadBankAccountWorkspaceWithClient(client: Prisma.TransactionClient | typeof prisma) {
  const [items, balances] = await Promise.all([
    listBankAccountsWithClient(client),
    loadBankBalanceMovements(client)
  ]);
  return { items, balances };
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
    openingBalance: string | null;
    openingBalanceDate: Date | null;
  }>;
  updates: Array<{
    id: string;
    input: {
      accountName: string;
      activeFlag: boolean;
      openingBalance: string | null;
      openingBalanceDate: Date | null;
      openingBalanceChanged: boolean;
    };
  }>;
  userId: string;
};

export async function applyBankAccountChangesAtomic(data: BankAccountAtomicInput) {
  return prisma.$transaction(async (tx) => {
    for (const update of data.updates) {
      const updateData = {
        accountName: update.input.accountName,
        activeFlag: update.input.activeFlag,
        updatedById: data.userId,
        ...(update.input.openingBalanceChanged ? {
          openingBalance: update.input.openingBalance,
          openingBalanceDate: update.input.openingBalanceDate
        } : {})
      };

      if (update.input.openingBalanceChanged) {
        const result = await tx.bankAccount.updateMany({
          where: {
            id: update.id,
            openingBalanceLockedAt: null,
            statements: { none: { status: { not: "WITHDRAWN" } } }
          },
          data: updateData
        });
        if (result.count !== 1) {
          throw new HttpError(409, "Opening Balance can no longer be changed because this bank account already has statement activity.");
        }
      } else {
        await tx.bankAccount.update({ where: { id: update.id }, data: updateData });
      }
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
          openingBalance: create.openingBalance,
          openingBalanceDate: create.openingBalanceDate,
          createdById: data.userId,
          updatedById: data.userId
        }
      });
    }

    return loadBankAccountWorkspaceWithClient(tx);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
