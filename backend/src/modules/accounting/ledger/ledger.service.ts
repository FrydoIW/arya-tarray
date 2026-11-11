import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { HttpError } from "../../../lib/http.js";
import { prisma } from "../../../lib/prisma.js";
import { validateLedgerLines, type LedgerLineInput } from "./ledger.domain.js";
import { activeFundsByIds, bankAccountsByIds, counterpartyIds, postingAccountsByIds, restrictionsByIds } from "./ledger.repository.js";
import { createPostedJournalInTransaction } from "./posted-journal.service.js";

export type LedgerJournalInput = {
  approvalRequestId?: string;
  journalType: "RECOGNITION" | "RECLASSIFICATION" | "OPENING" | "ACCRUAL" | "ADJUSTMENT"
    | "REVERSAL" | "DEPRECIATION" | "PAYMENT" | "RECEIPT" | "CLOSING" | "FUND_RELEASE" | "MANUAL";
  sourceKind: string;
  sourceReference: string;
  accountingDate: Date;
  descriptionSnapshot: string | null;
  postedById: string;
  bankTransactionId?: string | null;
  correctionItemId?: string | null;
  relatedJournalId?: string | null;
  reversalOfJournalId?: string | null;
  lines: LedgerLineInput[];
};

/** The caller owns the transaction when posting beside a source document. */
export async function postLedgerJournalInTransaction(tx: Prisma.TransactionClient, input: LedgerJournalInput) {
  validateLedgerLines(input.lines);
  const accountIds = [...new Set(input.lines.map(line => line.accountId))];
  const bankIds = [...new Set(input.lines.flatMap(line => line.bankAccountId ? [line.bankAccountId] : []))];
  const restrictionIds = [...new Set(input.lines.flatMap(line => line.fundRestrictionId ? [line.fundRestrictionId] : []))];
  const fundIds = [...new Set(input.lines.flatMap(line => line.accountingFundId ? [line.accountingFundId] : []))];
  const cpIds = [...new Set(input.lines.flatMap(line => line.counterpartyId ? [line.counterpartyId] : []))];
  const [accounts, banks, restrictions, funds, counterparties] = await Promise.all([
    postingAccountsByIds(tx, accountIds), bankAccountsByIds(tx, bankIds),
    restrictionsByIds(tx, restrictionIds), activeFundsByIds(tx, fundIds), counterpartyIds(tx, cpIds)
  ]);
  const accountById = new Map(accounts.map(account => [account.id, account]));
  const bankById = new Map(banks.map(bank => [bank.id, bank]));
  const restrictionById = new Map(restrictions.map(restriction => [restriction.id, restriction]));
  const activeFundIds = new Set(funds.map(fund => fund.id));
  const activeCounterparties = new Set(counterparties.map(counterparty => counterparty.id));
  const lines = input.lines.map((line, index) => {
    const account = accountById.get(line.accountId);
    if (!account || !account.activeFlag || !account.postingFlag) {
      throw new HttpError(409, "Every journal line must use an active posting account.");
    }
    const bank = line.bankAccountId ? bankById.get(line.bankAccountId) : null;
    if (line.bankAccountId && (!bank || !bank.activeFlag)) throw new HttpError(409, "Bank account is unavailable.");
    if (line.accountingFundId && !activeFundIds.has(line.accountingFundId)) {
      throw new HttpError(409, "Accounting fund is unavailable.");
    }
    const restriction = line.fundRestrictionId ? restrictionById.get(line.fundRestrictionId) : null;
    const draftClassification = restriction?.status === "DRAFT" && input.sourceKind === "FUND_RESTRICTION" && input.approvalRequestId;
    if (line.fundRestrictionId && (!restriction || restriction.status !== "ACTIVE" && !draftClassification
      || restriction.accountingFundId !== line.accountingFundId)) {
      throw new HttpError(409, "Fund restriction does not belong to the active fund.");
    }
    if (line.counterpartyId && !activeCounterparties.has(line.counterpartyId)) {
      throw new HttpError(409, "Counterparty is unavailable.");
    }
    return {
      id: randomUUID(), lineNo: index + 1, accountId: account.id,
      accountCodeSnapshot: account.code, accountNameSnapshot: account.name,
      debit: new Prisma.Decimal(line.debit), credit: new Prisma.Decimal(line.credit),
      bankAccountId: bank?.id ?? null, bankNameSnapshot: bank?.bankName ?? null,
      bankAccountNoSnapshot: bank?.accountNo ?? null, bankAccountNameSnapshot: bank?.accountName ?? null,
      accountingFundId: line.accountingFundId ?? null, fundRestrictionId: line.fundRestrictionId ?? null,
      counterpartyId: line.counterpartyId ?? null, eventCodeId: line.eventCodeId ?? null,
      eventCampaignId: line.eventCampaignId ?? null, memberIdentityId: line.memberIdentityId ?? null,
      memberId: line.memberId ?? null
    };
  });
  return createPostedJournalInTransaction(tx, { ...input, lines });
}

export function postLedgerJournal(input: LedgerJournalInput) {
  return prisma.$transaction(tx => postLedgerJournalInTransaction(tx, input),
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 });
}
