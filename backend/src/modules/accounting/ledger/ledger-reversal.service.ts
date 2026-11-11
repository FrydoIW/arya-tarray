import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { HttpError } from "../../../lib/http.js";
import { createPostedJournalInTransaction } from "./posted-journal.service.js";

/** Append-only reversal. This internal operation must be called by an approved workflow. */
export async function reverseLedgerJournalInTransaction(tx: Prisma.TransactionClient, input: {
  approvalRequestId?: string;
  originalJournalId: string;
  accountingDate: Date;
  postedById: string;
}) {
  if (!Number.isFinite(input.accountingDate.getTime())
    || input.accountingDate.toISOString().slice(10) !== "T00:00:00.000Z") {
    throw new HttpError(400, "Reversal date must be a valid date-only UTC value.");
  }
  const original = await tx.accountingJournal.findUnique({ where: { id: input.originalJournalId },
    include: { lines: { orderBy: { lineNo: "asc" } } } });
  if (!original) throw new HttpError(404, "Original journal was not found.");
  if (original.journalType === "REVERSAL") throw new HttpError(409, "A reversal cannot itself be reversed automatically.");
  if (input.accountingDate < original.accountingDate) throw new HttpError(400, "Reversal cannot predate the original journal.");
  if (await tx.accountingJournal.findUnique({ where: { reversalOfJournalId: original.id }, select: { id: true } })) {
    throw new HttpError(409, "Original journal has already been reversed.");
  }
  return createPostedJournalInTransaction(tx, {
    approvalRequestId: input.approvalRequestId,
    journalType: "REVERSAL", sourceKind: "REVERSAL", sourceReference: original.id,
    accountingDate: input.accountingDate, postedById: input.postedById,
    descriptionSnapshot: `Reversal of ${original.journalNumber}`,
    relatedJournalId: original.id, reversalOfJournalId: original.id,
    lines: original.lines.map((line, index) => ({
      id: randomUUID(), lineNo: index + 1, accountId: line.accountId,
      accountCodeSnapshot: line.accountCodeSnapshot, accountNameSnapshot: line.accountNameSnapshot,
      debit: line.credit, credit: line.debit,
      bankAccountId: line.bankAccountId, bankNameSnapshot: line.bankNameSnapshot,
      bankAccountNoSnapshot: line.bankAccountNoSnapshot,
      bankAccountNameSnapshot: line.bankAccountNameSnapshot,
      accountingFundId: line.accountingFundId, fundRestrictionId: line.fundRestrictionId,
      counterpartyId: line.counterpartyId, eventCodeId: line.eventCodeId,
      eventCodeSnapshot: line.eventCodeSnapshot, eventNameSnapshot: line.eventNameSnapshot,
      eventTypeSnapshot: line.eventTypeSnapshot, eventCampaignId: line.eventCampaignId,
      campaignNameSnapshot: line.campaignNameSnapshot, memberIdentityId: line.memberIdentityId,
      donorNameSnapshot: line.donorNameSnapshot, memberId: line.memberId,
      memberCodeSnapshot: line.memberCodeSnapshot, memberNameSnapshot: line.memberNameSnapshot
    }))
  });
}
