import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { HttpError } from "../../../lib/http.js";
import { accountingCutoverDate, accountingDateValue } from "../accounting.domain.js";
import { requireOpenAccountingPeriod } from "../period/period-control.service.js";
import { validateLedgerLines } from "./ledger.domain.js";
import { applyJournalApproval, verifyJournalApproval } from "../approval/approval-posting.service.js";
import { requireAnnualPostingPeriod } from "../finalization/finalization-approval.service.js";
import { recordPostedLedgerAudit } from "./ledger-audit.js";

type PostedJournalLineInput = Omit<Prisma.AccountingJournalLineUncheckedCreateWithoutJournalInput,
  "debit" | "credit"> & { debit: string | Prisma.Decimal; credit: string | Prisma.Decimal };

export type PostedJournalInput = {
  approvalRequestId?: string;
  journalType: string;
  sourceKind: string;
  sourceReference: string;
  accountingDate: Date;
  postedAt?: Date;
  postedById: string;
  descriptionSnapshot: string | null;
  bankTransactionId?: string | null;
  correctionItemId?: string | null;
  relatedJournalId?: string | null;
  reversalOfJournalId?: string | null;
  lines: PostedJournalLineInput[];
};

/** Single posted-journal persistence gate; callers validate source-specific evidence and authorization. */
export async function createPostedJournalInTransaction(tx: Prisma.TransactionClient, input: PostedJournalInput) {
  validateLedgerLines(input.lines.map(line => ({ accountId: line.accountId,
    debit: line.debit.toString(), credit: line.credit.toString() })));
  if (!Number.isFinite(input.accountingDate.getTime())
    || input.accountingDate.toISOString().slice(10) !== "T00:00:00.000Z") {
    throw new HttpError(400, "Accounting date must be a valid date-only UTC value.");
  }
  if (!input.sourceKind.trim() || input.sourceKind.length > 30
    || !input.sourceReference.trim() || input.sourceReference.length > 110) {
    throw new HttpError(400, "Journal source reference is invalid.");
  }
  const sourceEventKey = `${input.sourceKind}:${input.sourceReference}`;
  if (input.accountingDate < accountingCutoverDate()) throw new HttpError(409, "Journal cannot predate Accounting cutover.");
  if (sourceEventKey.length > 150) throw new HttpError(400, "Journal source key is too long.");
  if (await tx.accountingJournal.findUnique({ where: { sourceEventKey }, select: { id: true } })) {
    throw new HttpError(409, "This source has already been posted.");
  }
  const accountingPeriodId = ["YEAR_CLOSE", "YEAR_REOPEN"].includes(input.sourceKind) ? await requireAnnualPostingPeriod(tx, input) : await requireOpenAccountingPeriod(tx, input.accountingDate);
  const approval = await verifyJournalApproval(tx, input);
  const id = randomUUID();
  try {
    const journal = await tx.accountingJournal.create({ data: {
      id, journalNumber: `JRN-${accountingDateValue(input.accountingDate).replaceAll("-", "")}-${id}`,
      journalType: input.journalType, sourceEventKey, sourceKind: input.sourceKind,
      sourceReference: input.sourceReference, accountingDate: input.accountingDate,
      accountingPeriodId, postedAt: input.postedAt ?? new Date(), postedById: input.postedById,
      descriptionSnapshot: input.descriptionSnapshot, bankTransactionId: input.bankTransactionId ?? null,
      correctionItemId: input.correctionItemId ?? null, relatedJournalId: input.relatedJournalId ?? null,
      reversalOfJournalId: input.reversalOfJournalId ?? null, lines: { create: input.lines }
    }, include: { lines: { orderBy: { lineNo: "asc" } } } });
    if (approval) await applyJournalApproval(tx, approval, journal.id, input.postedById);
    await recordPostedLedgerAudit(tx, journal.id, accountingPeriodId, input.postedById);
    return journal;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new HttpError(409, "Journal source or reversal has already been posted.");
    }
    throw error;
  }
}
