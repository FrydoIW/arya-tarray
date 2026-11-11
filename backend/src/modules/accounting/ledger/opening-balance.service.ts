import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { HttpError } from "../../../lib/http.js";
import { prisma } from "../../../lib/prisma.js";
import { accountingCutoverDate } from "../accounting.domain.js";
import { postLedgerJournalInTransaction } from "./ledger.service.js";
import type { LedgerLineInput } from "./ledger.domain.js";

export type OpeningBalanceInput = {
  fiscalYearId: string;
  batchReference: string;
  sourceReference: string;
  effectiveOn: Date;
  createdById: string;
  lines: LedgerLineInput[];
};

/** Internal posting seam; opening evidence and authorization belong to the calling workflow. */
export async function postOpeningBalanceInTransaction(tx: Prisma.TransactionClient, input: OpeningBalanceInput) {
  const cutover = accountingCutoverDate();
  if (input.effectiveOn < cutover) throw new HttpError(409, "Opening balance cannot predate Accounting cutover.");
  if (!input.batchReference.trim() || input.batchReference.length > 100
    || !input.sourceReference.trim() || input.sourceReference.length > 255) {
    throw new HttpError(400, "Opening batch requires a valid reference and supporting source.");
  }
  if (!Number.isFinite(input.effectiveOn.getTime())
    || input.effectiveOn.toISOString().slice(10) !== "T00:00:00.000Z") {
    throw new HttpError(400, "Opening date must be a valid date-only UTC value.");
  }
  const year = await tx.accountingFiscalYear.findUnique({ where: { id: input.fiscalYearId },
    select: { startDate: true, endDate: true, status: true } });
  if (!year) throw new HttpError(404, "Fiscal year was not found.");
  if (year.status !== "OPEN" || input.effectiveOn < year.startDate || input.effectiveOn > year.endDate) {
    throw new HttpError(409, "Opening date must fall in the open fiscal year.");
  }
  if (await tx.accountingOpeningBatch.findUnique({ where: { batchReference: input.batchReference }, select: { id: true } })) {
    throw new HttpError(409, "Opening batch has already been posted.");
  }
  const accountIds = [...new Set(input.lines.map(line => line.accountId))];
  const accounts = await tx.accountingAccount.findMany({ where: { id: { in: accountIds } },
    select: { id: true, accountType: true } });
  if (accounts.length !== accountIds.length || accounts.some(account =>
    !["ASSET", "LIABILITY", "NET_ASSET"].includes(account.accountType))) {
    throw new HttpError(400, "Opening balances may use only balance-sheet accounts.");
  }
  const journal = await postLedgerJournalInTransaction(tx, {
    journalType: "OPENING", sourceKind: "OPENING_BATCH", sourceReference: input.batchReference,
    accountingDate: input.effectiveOn, descriptionSnapshot: input.sourceReference,
    postedById: input.createdById, lines: input.lines
  });
  try {
    const batch = await tx.accountingOpeningBatch.create({ data: {
      id: randomUUID(), fiscalYearId: input.fiscalYearId, batchReference: input.batchReference,
      sourceReference: input.sourceReference, effectiveOn: input.effectiveOn,
      journalId: journal.id, createdById: input.createdById
    } });
    return { batch, journal };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new HttpError(409, "Opening batch has already been posted.");
    }
    throw error;
  }
}

export function postOpeningBalance(input: OpeningBalanceInput) {
  return prisma.$transaction(tx => postOpeningBalanceInTransaction(tx, input),
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 });
}
