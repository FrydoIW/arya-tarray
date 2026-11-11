import { Prisma } from "@prisma/client";
import { HttpError } from "../../../lib/http.js";
import { material } from "./fund.repository.js";
export async function fundReversalContext(tx: Prisma.TransactionClient, journalId: string) {
  const lines = await tx.accountingJournalLine.findMany({ where: { journalId }, select: { id: true } }), ids = lines.map(l => l.id);
  const [restrictions, releases, drafts, evidenceReleases, bankDecisions] = await Promise.all([
    tx.accountingFundRestriction.findMany({ where: { OR: [{ classificationJournalId: journalId }, { sourceJournalLineId: { in: ids }, status: { not: "CANCELLED" } }] }, orderBy: { id: "asc" } }),
    tx.accountingFundRelease.findMany({ where: { releaseJournalId: journalId }, orderBy: { id: "asc" } }),
    tx.accountingJournalDraft.findMany({ where: { sourceKind: "FUND_JOURNAL", OR: [{ postedJournalId: journalId }, { fundSourceLineId: { in: ids }, status: { not: "CANCELLED" } }] }, orderBy: { id: "asc" } }),
    tx.accountingFundRelease.findMany({ where: { evidenceJournalLineId: { in: ids }, activeEvidenceKey: { not: null } }, orderBy: { id: "asc" } }),
    tx.accountingJournalDraft.findMany({ where: { fundSourceLineId: { in: ids }, fundActiveBankId: { not: null } }, orderBy: { id: "asc" } })
  ]);
  return { ids, restrictions, releases, drafts, evidenceReleases, bankDecisions };
}
export const fundReversalDigest = async (tx: Prisma.TransactionClient, journalId: string) => material(await fundReversalContext(tx, journalId));
export async function validateFundReversal(tx: Prisma.TransactionClient, journalId: string, date: Date) {
  const c = await fundReversalContext(tx, journalId);
  if (c.restrictions.some(r => r.classificationJournalId !== journalId) || c.drafts.some(d => d.postedJournalId !== journalId) || c.evidenceReleases.length || c.bankDecisions.length) throw new HttpError(409, "Reverse/cancel dependent fund classifications/releases or reopen conditional decisions before reversing source evidence.");
  for (const r of c.restrictions) {
    const releases = await tx.accountingFundRelease.count({ where: { fundRestrictionId: r.id, activeEvidenceKey: { not: null } } });
    if (releases) throw new HttpError(409, "Reverse active releases before reversing the original classification.");
  }
  return c;
}
export async function applyFundReversal(tx: Prisma.TransactionClient, journalId: string, actorId: string) {
  const c = await fundReversalContext(tx, journalId);
  for (const release of c.releases) {
    await tx.accountingFundRelease.update({ where: { id: release.id }, data: { activeEvidenceKey: null } });
    await tx.accountingFundRestriction.update({ where: { id: release.fundRestrictionId }, data: { status: "ACTIVE", updatedById: actorId } });
  }
  for (const r of c.restrictions) if (r.classificationJournalId === journalId) await tx.accountingFundRestriction.update({ where: { id: r.id }, data: { status: "DRAFT", classificationJournalId: null, revision: { increment: 1 }, updatedById: actorId } });
  for (const draft of c.drafts) if (draft.postedJournalId === journalId) await tx.accountingJournalDraft.update({ where: { id: draft.id }, data: { status: "CANCELLED" } });
}
