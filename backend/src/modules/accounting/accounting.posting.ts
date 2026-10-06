import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import {
  accountingCutoverDate, accountingDateValue, assertBalanced, recognitionLines, reclassificationLines,
  type AccountingSource, type AccountingDimension, type AccountingLineDraft
} from "./accounting.domain.js";

export const accountingSourceInclude = {
  statementUpload: { include: { bankAccount: true } }, eventCode: true, eventCampaign: true,
  memberIdentity: { include: { member: true } }
} satisfies Prisma.BankTransactionInclude;
export type AccountingSourceRow = Prisma.BankTransactionGetPayload<{ include: typeof accountingSourceInclude }>;

export function mapAccountingSource(row: AccountingSourceRow): AccountingSource {
  return { ...row, eventType: row.eventCode?.eventType ?? null };
}

export function mapAccountingDimension(row: AccountingSourceRow): AccountingDimension {
  const bank = row.statementUpload.bankAccount;
  const identity = row.memberIdentity;
  const member = identity?.verificationStatus === "VERIFIED" ? identity.member : null;
  return {
    bankAccountId: bank.id, bankNameSnapshot: bank.bankName, bankAccountNoSnapshot: bank.accountNo,
    bankAccountNameSnapshot: bank.accountName, eventCodeId: row.eventCodeId,
    eventCodeSnapshot: row.eventCode?.code ?? null, eventNameSnapshot: row.eventCode?.eventName ?? null,
    eventTypeSnapshot: row.eventCode?.eventType ?? null, eventCampaignId: row.eventCampaignId,
    campaignNameSnapshot: row.eventCampaign?.campaignName ?? null, memberIdentityId: row.memberIdentityId,
    donorNameSnapshot: identity?.accountName ?? row.senderName, memberId: member?.id ?? null,
    memberCodeSnapshot: member?.memberCode ?? null, memberNameSnapshot: member?.memberName ?? null
  };
}

type Accounts = Awaited<ReturnType<typeof postingAccounts>>;
async function postingAccounts(tx: Prisma.TransactionClient) {
  const rows = await tx.accountingAccount.findMany({ where: { code: { in: ["1110", "4110"] }, activeFlag: true, postingFlag: true } });
  if (rows.length !== 2 || !rows.some(a => a.code === "1110" && a.accountType === "ASSET" && a.normalBalance === "DEBIT")
    || !rows.some(a => a.code === "4110" && a.accountType === "REVENUE" && a.normalBalance === "CREDIT")) {
    throw new Error("Approved Accounting posting accounts are not provisioned correctly.");
  }
  return new Map(rows.map(row => [row.code, row]));
}

async function persistJournal(tx: Prisma.TransactionClient, accounts: Accounts, input: {
  sourceEventKey: string; journalType: "RECOGNITION" | "RECLASSIFICATION"; bankTransactionId: string;
  correctionItemId?: string; relatedJournalId?: string; accountingDate: Date;
  postedAt: Date; postedById: string; descriptionSnapshot: string | null; lines: AccountingLineDraft[];
}) {
  assertBalanced(input.lines);
  const { lines, ...header } = input;
  const id = randomUUID();
  return tx.accountingJournal.create({ data: {
    ...header, id, journalNumber: `JRN-${accountingDateValue(header.accountingDate).replaceAll("-", "")}-${id}`,
    lines: { create: lines.map((line, index) => {
      const { accountCode, ...evidence } = line;
      const account = accounts.get(accountCode)!;
      return { ...evidence, lineNo: index + 1, accountId: account.id,
        accountCodeSnapshot: account.code, accountNameSnapshot: account.name };
    }) }
  } });
}

/** Internal finalization seam. Caller owns the Serializable transaction and source-row locks. */
export async function postStatementRecognition(tx: Prisma.TransactionClient, statementId: string, userId: string, now: Date) {
  const cutover = accountingCutoverDate();
  const rows = await tx.bankTransaction.findMany({ where: { statementUploadId: statementId,
    status: "FINALIZED", sourceType: "BANK", reconciliationExcludedAt: null,
    transactionDate: { gte: cutover }, originalAmount: { gt: 0 }, eventCodeId: { not: null } },
    include: accountingSourceInclude, orderBy: { id: "asc" } });
  const drafts = rows.map(row => ({ row, lines: recognitionLines(mapAccountingSource(row), mapAccountingDimension(row), cutover) }))
    .filter(draft => draft.lines.length > 0);
  if (!drafts.length) return;
  const existing = new Set((await tx.accountingJournal.findMany({ where: { sourceEventKey: {
    in: drafts.map(({ row }) => `FINALIZED_BANK_TRANSACTION:${row.id}`) } }, select: { sourceEventKey: true } }))
    .map(journal => journal.sourceEventKey));
  const accounts = await postingAccounts(tx);
  for (const { row, lines } of drafts) {
    const sourceEventKey = `FINALIZED_BANK_TRANSACTION:${row.id}`;
    if (existing.has(sourceEventKey)) continue;
    await persistJournal(tx, accounts, { sourceEventKey, journalType: "RECOGNITION", bankTransactionId: row.id,
      accountingDate: row.transactionDate!, postedAt: now, postedById: userId, descriptionSnapshot: row.description, lines });
  }
}

export type AccountingCorrection = { id: string; action: string; bankTransactionId: string | null };
/** Never recognizes historical rows merely because a correction is approved. */
export async function postCorrectionReclassifications(tx: Prisma.TransactionClient, items: AccountingCorrection[], userId: string, now: Date) {
  const modified = items.filter(item => item.action === "MODIFIED" && item.bankTransactionId);
  if (!modified.length) return;
  const cutover = accountingCutoverDate();
  const ids = modified.map(item => item.bankTransactionId!);
  const rows = await tx.bankTransaction.findMany({ where: { id: { in: ids }, status: "FINALIZED",
    sourceType: "BANK", transactionDate: { gte: cutover }, reconciliationExcludedAt: null }, include: accountingSourceInclude });
  const journals = await tx.accountingJournal.findMany({ where: { bankTransactionId: { in: ids } },
    include: { lines: { orderBy: { lineNo: "asc" } } }, orderBy: [{ postedAt: "asc" }, { createdAt: "asc" }, { id: "asc" }] });
  let accounts: Accounts | undefined;
  for (const item of modified) {
    if (journals.some(j => j.sourceEventKey === `CORRECTION_RECLASSIFICATION:${item.id}`)) continue;
    const row = rows.find(r => r.id === item.bankTransactionId);
    const history = journals.filter(j => j.bankTransactionId === item.bankTransactionId);
    const original = history.find(j => j.journalType === "RECOGNITION");
    if (!row || !original) continue;
    const previous = history.at(-1)?.lines.find(line => line.accountCodeSnapshot === "4110" && line.credit.greaterThan(0));
    const originalRevenue = original.lines.find(line => line.accountCodeSnapshot === "4110" && line.credit.greaterThan(0));
    if (!previous || !originalRevenue) throw new Error("Accounting recognition evidence is incomplete.");
    const lines = reclassificationLines(originalRevenue.credit.toFixed(2), previous, mapAccountingDimension(row));
    if (!lines.length) continue;
    accounts ??= await postingAccounts(tx);
    await persistJournal(tx, accounts, { sourceEventKey: `CORRECTION_RECLASSIFICATION:${item.id}`,
      journalType: "RECLASSIFICATION", bankTransactionId: row.id, correctionItemId: item.id,
      relatedJournalId: original.id, accountingDate: original.accountingDate, postedAt: now, postedById: userId,
      descriptionSnapshot: "Approved Event/Campaign correction", lines });
  }
}
