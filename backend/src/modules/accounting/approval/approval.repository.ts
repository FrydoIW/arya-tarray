import { Prisma } from "@prisma/client";
import { HttpError } from "../../../lib/http.js";
import type { AccountingApprovalEvidence } from "./approval.domain.js";
import { approvalKindSchema, approvalStatusSchema } from "./approval.schema.js";

export const ACCOUNTING_MANAGE = "ACCOUNTING_JOURNAL_MANAGE";
export const ACCOUNTING_APPROVE = "ACCOUNTING_JOURNAL_APPROVE";
export const ACCOUNTING_POST = "ACCOUNTING_JOURNAL_POST";
export const requestInclude = { approvers: true } satisfies Prisma.AccountingApprovalRequestInclude;
export type ApprovalRecord = Prisma.AccountingApprovalRequestGetPayload<{ include: typeof requestInclude }>;

export async function hasAccountingPermission(tx: Prisma.TransactionClient, userId: string, menuCode: string) {
  return Boolean(await tx.user.findFirst({ where: { id: userId, status: "ACTIVE", userRoles: { some: {
    role: { is: { activeFlag: true, roleMenus: { some: { menu: { is: { menuCode,
      menuType: "PAGE", activeFlag: true } } } } } }
  } } }, select: { id: true } }));
}
export async function requireAccountingPermission(tx: Prisma.TransactionClient, userId: string, code: string) {
  if (!await hasAccountingPermission(tx, userId, code)) throw new HttpError(403, `Access denied for menu ${code}`);
}
export async function loadApproval(tx: Prisma.TransactionClient, id: string) {
  const request = await tx.accountingApprovalRequest.findUnique({ where: { id }, include: requestInclude });
  if (!request) throw new HttpError(404, "Accounting approval request was not found.");
  return request;
}
export function approvalEvidence(request: ApprovalRecord): AccountingApprovalEvidence {
  return { id: request.id, kind: approvalKindSchema.parse(request.requestKind),
    sourceDocumentId: request.sourceDocumentId, sourceVersion: request.sourceVersion,
    sourceDigest: request.sourceDigest, requestedById: request.requestedById,
    status: approvalStatusSchema.parse(request.status), decidedById: request.decidedById,
    approverIds: request.approvers.map(assignment => assignment.approverUserId) };
}
export async function configuredIndependentApprovers(tx: Prisma.TransactionClient, requesterId: string) {
  const config = await tx.approvalConfig.findFirst({ where: { activeFlag: true,
    menu: { is: { menuCode: ACCOUNTING_APPROVE, menuType: "PAGE", activeFlag: true } } },
    select: { approvers: { select: { approverUserId: true } } } });
  const ids = config?.approvers.map(a => a.approverUserId).filter(id => id !== requesterId) ?? [];
  const users = ids.length ? await tx.user.findMany({ where: { id: { in: ids }, status: "ACTIVE",
    userRoles: { some: { role: { is: { activeFlag: true, roleMenus: { some: { menu: { is: {
      menuCode: ACCOUNTING_APPROVE, menuType: "PAGE", activeFlag: true } } } } } } } } }, select: { id: true } }) : [];
  if (!users.length) throw new HttpError(409, "Configure at least one independent active Accounting approver with approval permission before submission.");
  return users.map(user => user.id);
}
export function appendApprovalHistory(tx: Prisma.TransactionClient, input: {
  approvalRequestId: string; actorId: string; action: string; statusBefore: string | null;
  statusAfter: string; sourceDigest: string; remark?: string | null; actionAt?: Date;
}) {
  return tx.accountingApprovalHistory.create({ data: input });
}

