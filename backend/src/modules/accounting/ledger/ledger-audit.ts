import { Prisma } from "@prisma/client";
import { material, digest } from "../funds/fund.repository.js";
export const auditedJournalSelect = { id: true, journalNumber: true, journalType: true, sourceEventKey: true, accountingDate: true, accountingPeriodId: true,
  postedAt: true, postedById: true, descriptionSnapshot: true, bankTransactionId: true, sourceKind: true, sourceReference: true, correctionItemId: true, relatedJournalId: true, reversalOfJournalId: true,
  lines: { orderBy: { lineNo: "asc" as const }, select: { id: true, lineNo: true, accountId: true, accountCodeSnapshot: true, accountNameSnapshot: true, debit: true, credit: true, bankAccountId: true,
    bankNameSnapshot: true, bankAccountNoSnapshot: true, bankAccountNameSnapshot: true, accountingFundId: true, fundRestrictionId: true, counterpartyId: true, eventCodeId: true, eventCodeSnapshot: true, eventNameSnapshot: true, eventTypeSnapshot: true,
    eventCampaignId: true, campaignNameSnapshot: true, memberIdentityId: true, donorNameSnapshot: true, memberId: true, memberCodeSnapshot: true, memberNameSnapshot: true } } } satisfies Prisma.AccountingJournalSelect;
export async function recordPostedLedgerAudit(tx: Prisma.TransactionClient, journalId: string, fiscalPeriodId: string, actor: string) {
  const journal = await tx.accountingJournal.findUnique({ where: { id: journalId }, select: auditedJournalSelect });
  if (!journal) throw Error("Posted journal missing from audit transaction");
  await tx.accountingJournalDraft.create({ data: { sourceKind: "FINALIZATION_AUDIT", sourceReference: `JRNAUDIT-${journalId}`, draftNumber: `JRNAUDIT-${journalId}`, journalType: "ADJUSTMENT", accountingDate: journal.accountingDate,
    accountingPeriodId: fiscalPeriodId, status: "APPLIED", createdById: actor, finalizationMetadata: material({ action: "POSTED_LEDGER_SEAL_V1", journalId, sha256: digest(journal) }) } });
}
export type AuditedJournal = Prisma.AccountingJournalGetPayload<{ select: typeof auditedJournalSelect }>;
type Seal = { sourceReference: string; finalizationMetadata: Prisma.JsonValue };
export type LedgerAuditReader = {
  count: () => Promise<number>;
  journalsAfter: (cursor: string | undefined, take: number) => Promise<AuditedJournal[]>;
  sealsFor: (journalIds: string[]) => Promise<Seal[]>;
};
export const LEDGER_AUDIT_BATCH_SIZE = 200;
/** Reader operations must share one consistent transaction snapshot; no partial scan may PASS. */
export async function verifyLedgerAuditBatches(reader: LedgerAuditReader) {
  const total = await reader.count(), exceptions: { id: string; reason: string }[] = [];
  let checked = 0, exceptionCount = 0, cursor: string | undefined;
  function fail(id: string, reason: string) { exceptionCount++; if (exceptions.length < 100) exceptions.push({ id, reason }); }
  for (;;) {
    const rows = await reader.journalsAfter(cursor, LEDGER_AUDIT_BATCH_SIZE);
    let previous = cursor;
    if (rows.length > LEDGER_AUDIT_BATCH_SIZE || rows.some(row => {
      const invalid = previous !== undefined && row.id.toLowerCase() <= previous.toLowerCase(); previous = row.id; return invalid;
    })) { fail("SCOPE", "AUDIT_KEYSET_BOUNDARY_INVALID"); break; }
    if (!rows.length) break;
    const seals = await reader.sealsFor(rows.map(r => r.id)), byId = new Map<string, Prisma.JsonValue>();
    for (const seal of seals) {
      const id = seal.sourceReference.slice(9);
      if (byId.has(id)) fail(id, "POSTED_JOURNAL_SEAL_DUPLICATE");
      byId.set(id, seal.finalizationMetadata);
    }
    for (const row of rows) {
      const seal = byId.get(row.id), hash = seal && typeof seal === "object" && !Array.isArray(seal) ? seal.sha256 : null;
      if (!hash || hash !== digest(row)) fail(row.id, hash ? "POSTED_JOURNAL_CONTENT_CHANGED" : "POSTED_JOURNAL_SEAL_MISSING");
      checked++;
    }
    cursor = rows.at(-1)?.id;
    if (rows.length < LEDGER_AUDIT_BATCH_SIZE) break;
  }
  if (checked !== total || await reader.count() !== total) fail("SCOPE", "AUDIT_COVERAGE_COUNT_MISMATCH");
  return { valid: exceptionCount === 0, checked, total, exceptionCount, exceptions, exceptionsTruncated: exceptionCount > exceptions.length };
}
/** Existing report/closing callers supply a Serializable transaction (RepeatableRead is also snapshot-safe). */
export function verifyPostedLedgerAudits(tx: Prisma.TransactionClient, to: Date) {
  return verifyLedgerAuditBatches({
    count: () => tx.accountingJournal.count({ where: { accountingDate: { lte: to } } }),
    journalsAfter: (cursor, take) => tx.accountingJournal.findMany({ where: { accountingDate: { lte: to }, id: cursor ? { gt: cursor } : undefined }, select: auditedJournalSelect, take, orderBy: { id: "asc" } }),
    sealsFor: ids => tx.accountingJournalDraft.findMany({ where: { sourceKind: "FINALIZATION_AUDIT", sourceReference: { in: ids.map(id => `JRNAUDIT-${id}`) } }, select: { sourceReference: true, finalizationMetadata: true }, take: ids.length + 1 })
  });
}
