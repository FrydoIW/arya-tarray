import { Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma.js";
import type { AccountQuery } from "./coa.schema.js";

export function listAccounts(query: AccountQuery) {
  const where: Prisma.AccountingAccountWhereInput = {
    accountType: query.type,
    activeFlag: query.active === undefined ? undefined : query.active === "true",
    OR: query.search ? [
      { code: { contains: query.search } },
      { name: { contains: query.search } }
    ] : undefined
  };
  return prisma.$transaction(async tx => {
    const [total, rows] = await Promise.all([
      tx.accountingAccount.count({ where }),
      tx.accountingAccount.findMany({ where, orderBy: [{ code: "asc" }, { id: "asc" }],
        skip: (query.page - 1) * query.pageSize, take: query.pageSize,
        select: { id: true, code: true, name: true, parentAccountId: true, accountType: true,
          accountClassification: true, reportSection: true, normalBalance: true, contraFlag: true,
          postingFlag: true, activeFlag: true, createdAt: true, updatedAt: true,
          _count: { select: { lines: true } } } })
    ]);
    return { rows, total, page: query.page, pageSize: query.pageSize };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

export function accountById(tx: Prisma.TransactionClient, id: string) {
  return tx.accountingAccount.findUnique({ where: { id }, select: {
    id: true, code: true, name: true, accountType: true, normalBalance: true, parentAccountId: true,
    postingFlag: true, activeFlag: true, _count: { select: { lines: true, revFkAccAccountParent: true } }
  } });
}

export function ancestorIds(tx: Prisma.TransactionClient, parentId: string) {
  return tx.$queryRaw<Array<{ id: string }>>`
    WITH RECURSIVE ancestors AS (
      SELECT accounting_account_id AS id, parent_account_id FROM arya_accounting_account
      WHERE accounting_account_id = ${parentId}
      UNION ALL
      SELECT parent.accounting_account_id AS id, parent.parent_account_id
      FROM arya_accounting_account parent JOIN ancestors child
        ON parent.accounting_account_id = child.parent_account_id
    )
    SELECT id FROM ancestors LIMIT 1001`;
}
