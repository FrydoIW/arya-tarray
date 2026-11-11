import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { HttpError } from "../../../lib/http.js";
import { prisma } from "../../../lib/prisma.js";
import { accountById, ancestorIds, listAccounts } from "./coa.repository.js";
import type { AccountQuery, CreateAccountInput, UpdateAccountInput } from "./coa.schema.js";

export { listAccounts };

async function requireParent(tx: Prisma.TransactionClient, parentId: string | null, type: string, selfId?: string) {
  if (!parentId) return;
  if (parentId === selfId) throw new HttpError(400, "An account cannot be its own parent.");
  const parent = await accountById(tx, parentId);
  if (!parent) throw new HttpError(404, "Parent account was not found.");
  if (parent.accountType !== type || parent.postingFlag || !parent.activeFlag) {
    throw new HttpError(409, "Parent must be an active header account of the same type.");
  }
  if (selfId) {
    const ancestors = await ancestorIds(tx, parentId);
    if (ancestors.length > 1000 || ancestors.some(a => a.id === selfId)) {
      throw new HttpError(409, "Account hierarchy would contain a cycle or exceed 1,000 levels.");
    }
  }
}

export async function createAccountInTransaction(tx: Prisma.TransactionClient, input: CreateAccountInput) {
  await requireParent(tx, input.parentAccountId, input.accountType);
  if (await tx.accountingAccount.findUnique({ where: { code: input.code }, select: { id: true } })) {
    throw new HttpError(409, "Account code is already in use.");
  }
  return tx.accountingAccount.create({ data: { id: randomUUID(), ...input } });
}

export function createAccount(input: CreateAccountInput) {
  return prisma.$transaction(tx => createAccountInTransaction(tx, input),
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function updateAccountInTransaction(tx: Prisma.TransactionClient, id: string, input: UpdateAccountInput) {
  const existing = await accountById(tx, id);
  if (!existing) throw new HttpError(404, "Account was not found.");
  if (input.parentAccountId !== undefined) {
    await requireParent(tx, input.parentAccountId, existing.accountType, id);
  }
  if (input.postingFlag && existing._count.revFkAccAccountParent > 0) {
    throw new HttpError(409, "A header with children cannot become a posting account.");
  }
  if (existing._count.lines > 0 && Object.keys(input).some(key => key !== "activeFlag")) {
    throw new HttpError(409, "A posted account may only be activated or deactivated; its classification and hierarchy are historical evidence.");
  }
  return tx.accountingAccount.update({ where: { id }, data: input });
}

export function updateAccount(id: string, input: UpdateAccountInput) {
  return prisma.$transaction(tx => updateAccountInTransaction(tx, id, input),
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
