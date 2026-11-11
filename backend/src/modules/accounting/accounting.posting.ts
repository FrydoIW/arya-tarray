import { Prisma } from "@prisma/client";
import { HttpError } from "../../lib/http.js";
import {
  accountingCutoverDate, recognitionLines, reclassificationLines,
  type AccountingSource, type AccountingDimension, type AccountingLineDraft
} from "./accounting.domain.js";
import { createPostedJournalInTransaction } from "./ledger/posted-journal.service.js";
import { settlementReservationState } from "./apar/apar.repository.js";
import { resolvedFundBankIds } from "./funds/fund-bank.service.js";

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

type BankDimensionCandidate = Omit<AccountingDimension,
  "bankAccountId" | "bankNameSnapshot" | "bankAccountNoSnapshot" | "bankAccountNameSnapshot"> & {
  bankAccountId: string | null;
  bankNameSnapshot: string | null;
  bankAccountNoSnapshot: string | null;
  bankAccountNameSnapshot: string | null;
};

/** Phase 1 reclassification may only inherit complete bank posting evidence. */
export function bankAccountingDimension(line: BankDimensionCandidate): AccountingDimension | null {
  const { bankAccountId, bankNameSnapshot, bankAccountNoSnapshot, bankAccountNameSnapshot } = line;
  if (bankAccountId === null || bankNameSnapshot === null || bankAccountNoSnapshot === null
    || bankAccountNameSnapshot === null) return null;
  return {
    bankAccountId, bankNameSnapshot, bankAccountNoSnapshot, bankAccountNameSnapshot,
    eventCodeId: line.eventCodeId, eventCodeSnapshot: line.eventCodeSnapshot,
    eventNameSnapshot: line.eventNameSnapshot, eventTypeSnapshot: line.eventTypeSnapshot,
    eventCampaignId: line.eventCampaignId, campaignNameSnapshot: line.campaignNameSnapshot,
    memberIdentityId: line.memberIdentityId, donorNameSnapshot: line.donorNameSnapshot,
    memberId: line.memberId, memberCodeSnapshot: line.memberCodeSnapshot,
    memberNameSnapshot: line.memberNameSnapshot
  };
}

type Accounts = Awaited<ReturnType<typeof postingAccounts>>;
async function postingAccounts(tx: Prisma.TransactionClient) {
  const rows = await tx.accountingAccount.findMany({ where: { code: { in: ["1110", "4110"] }, activeFlag: true, postingFlag: true } });
  if (rows.length !== 2 || !rows.some(a => a.code === "1110" && a.accountType === "ASSET" && a.normalBalance === "DEBIT")
    || !rows.some(a => a.code === "4110" && a.accountType === "REVENUE" && a.normalBalance === "CREDIT")) {
    throw new HttpError(409, "Accounting posting accounts 1110 and 4110 must be active, posting-enabled and correctly classified before finalization.");
  }
  return new Map(rows.map(row => [row.code, row]));
}

async function persistJournal(tx: Prisma.TransactionClient, accounts: Accounts, input: {
  journalType: "RECOGNITION" | "RECLASSIFICATION"; bankTransactionId: string;
  correctionItemId?: string; relatedJournalId?: string; accountingDate: Date;
  postedAt: Date; postedById: string; descriptionSnapshot: string | null; lines: AccountingLineDraft[];
}) {
  if (input.journalType === "RECLASSIFICATION" && !input.correctionItemId) {
    throw new Error("Approved reclassification requires its correction item reference.");
  }
  const sourceReference = input.journalType === "RECOGNITION" ? input.bankTransactionId : input.correctionItemId;
  if (!sourceReference) throw new Error("Accounting posting requires a source reference.");
  return createPostedJournalInTransaction(tx, {
    journalType: input.journalType,
    sourceKind: input.journalType === "RECOGNITION" ? "FINALIZED_BANK_TRANSACTION" : "CORRECTION_RECLASSIFICATION",
    sourceReference,
    bankTransactionId: input.bankTransactionId, correctionItemId: input.correctionItemId,
    relatedJournalId: input.relatedJournalId, accountingDate: input.accountingDate,
    postedAt: input.postedAt, postedById: input.postedById,
    descriptionSnapshot: input.descriptionSnapshot,
    lines: input.lines.map((line, index) => {
      const { accountCode, ...evidence } = line;
      const account = accounts.get(accountCode);
      if (!account) throw new Error(`Accounting posting account ${accountCode} is unavailable.`);
      return { ...evidence, lineNo: index + 1, accountId: account.id,
        accountCodeSnapshot: account.code, accountNameSnapshot: account.name };
    })
  });
}

/** Internal finalization seam. Caller owns the Serializable transaction and source-row locks. */
export async function postStatementRecognition(tx: Prisma.TransactionClient, statementId: string, userId: string, now: Date) {
  const cutover = accountingCutoverDate();
  const rows = await tx.bankTransaction.findMany({ where: { statementUploadId: statementId,
    status: "FINALIZED", sourceType: "BANK", reconciliationExcludedAt: null,
    transactionDate: { gte: cutover }, originalAmount: { gt: 0 }, eventCodeId: { not: null } },
    include: accountingSourceInclude, orderBy: { id: "asc" } });
  const candidates = rows.map(row => ({ row, lines: recognitionLines(mapAccountingSource(row), mapAccountingDimension(row), cutover) }))
    .filter(draft => draft.lines.length > 0);
  if (!candidates.length) return;
  const bankAdjustments = await tx.accountingJournalDraft.findMany({ where: { sourceKind: "ADJUSTING_JOURNAL", status: { in: ["DRAFT", "POSTED"] }, OR: candidates.map(({ row }) => ({ finalizationMetadata: { path: "$.bankTransactionId", equals: row.id } })) }, select: { id: true } });
  if (bankAdjustments.length) throw new HttpError(409, "REVIEW_REQUIRED: bank adjustment evidence already exists; do not create a second Phase 1 recognition.");
  const fundBankIds = await resolvedFundBankIds(tx, candidates.map(({ row }) => row.id));
  const settlements = await settlementReservationState(tx, candidates.map(({ row }) => row.id));
  if (settlements.some(settlement => settlement.status === "DRAFT")) {
    throw new HttpError(409, "An incoming bank transaction is reserved by a draft AP/AR settlement; post or cancel that settlement before finalization.");
  }
  const settledBankIds = new Set(settlements.filter(settlement => settlement.status === "POSTED" && settlement.postingJournalId
    && !settlement.relFkAccSettlementJournal?.revFkAccJournalReversal).map(settlement => settlement.bankTransactionId));
  const drafts = candidates.filter(({ row }) => !settledBankIds.has(row.id) && !fundBankIds.has(row.id));
  if (!drafts.length) return;
  const existing = new Set((await tx.accountingJournal.findMany({ where: { sourceEventKey: {
    in: drafts.map(({ row }) => `FINALIZED_BANK_TRANSACTION:${row.id}`) } }, select: { sourceEventKey: true } }))
    .map(journal => journal.sourceEventKey));
  const accounts = await postingAccounts(tx);
  for (const { row, lines } of drafts) {
    const sourceEventKey = `FINALIZED_BANK_TRANSACTION:${row.id}`;
    if (existing.has(sourceEventKey)) continue;
    if (!row.transactionDate) throw new Error("Finalized bank transaction has no accounting date.");
    await persistJournal(tx, accounts, { journalType: "RECOGNITION", bankTransactionId: row.id,
      accountingDate: row.transactionDate, postedAt: now, postedById: userId, descriptionSnapshot: row.description, lines });
  }
}

export type AccountingCorrection = { id: string; action: string; bankTransactionId: string | null };
/** Never recognizes historical rows merely because a correction is approved. */
export async function postCorrectionReclassifications(tx: Prisma.TransactionClient, items: AccountingCorrection[], userId: string, now: Date) {
  const modified = items.filter((item): item is AccountingCorrection & { bankTransactionId: string } =>
    item.action === "MODIFIED" && item.bankTransactionId !== null && item.bankTransactionId.length > 0);
  if (!modified.length) return;
  const cutover = accountingCutoverDate();
  const ids = modified.map(item => item.bankTransactionId);
  const matchedSettlements = await settlementReservationState(tx, ids);
  const settledBankIds = new Set(matchedSettlements.filter(settlement => settlement.status === "POSTED" && settlement.postingJournalId
    && !settlement.relFkAccSettlementJournal?.revFkAccJournalReversal).map(settlement => settlement.bankTransactionId));
  const rows = await tx.bankTransaction.findMany({ where: { id: { in: ids }, status: "FINALIZED",
    sourceType: "BANK", transactionDate: { gte: cutover }, reconciliationExcludedAt: null }, include: accountingSourceInclude });
  const journals = await tx.accountingJournal.findMany({ where: { bankTransactionId: { in: ids } },
    include: { lines: { orderBy: { lineNo: "asc" } }, revFkAccJournalReversal: { select: { id: true } } }, orderBy: [{ postedAt: "asc" }, { createdAt: "asc" }, { id: "asc" }] });
  let accounts: Accounts | undefined;
  for (const item of modified) {
    if (settledBankIds.has(item.bankTransactionId)) continue;
    if (journals.some(j => j.sourceEventKey === `CORRECTION_RECLASSIFICATION:${item.id}`)) continue;
    const row = rows.find(r => r.id === item.bankTransactionId);
    const history = journals.filter(j => j.bankTransactionId === item.bankTransactionId);
    const original = history.find(j => j.journalType === "RECOGNITION" && !j.revFkAccJournalReversal);
    if (!row || !original) continue;
    const previous = history.at(-1)?.lines.find(line => line.accountCodeSnapshot === "4110" && line.credit.greaterThan(0));
    const originalRevenue = original.lines.find(line => line.accountCodeSnapshot === "4110" && line.credit.greaterThan(0));
    if (!previous || !originalRevenue) throw new Error("Accounting recognition evidence is incomplete.");
    const previousDimension = bankAccountingDimension(previous);
    if (!previousDimension) throw new Error("Accounting bank recognition evidence is incomplete.");
    const lines = reclassificationLines(originalRevenue.credit.toFixed(2), previousDimension, mapAccountingDimension(row));
    if (!lines.length) continue;
    accounts ??= await postingAccounts(tx);
    await persistJournal(tx, accounts, {
      journalType: "RECLASSIFICATION", bankTransactionId: row.id, correctionItemId: item.id,
      relatedJournalId: original.id, accountingDate: original.accountingDate, postedAt: now, postedById: userId,
      descriptionSnapshot: "Approved Event/Campaign correction", lines });
  }
}
