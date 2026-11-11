import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { HttpError } from "../../../lib/http.js";
import { accountingApprovalDigest } from "./approval.domain.js";
import { accountingDateValue } from "../accounting.domain.js";
import { dateOnly } from "../period/period.schema.js";
import { aparSourceIdentity, isAparApprovalKind } from "../apar/apar-source.repository.js";
import { aparReversalContext } from "../apar/apar-posting.service.js";
import { isStage23Kind, stage23Identity } from "../schedules/schedule-approval.service.js";
import { stage23ReversalDigest } from "../schedules/schedule-reversal.service.js";
import { assetIdentity, isAssetKind } from "../assets/asset-approval.service.js";
import { assetReversalDigest } from "../assets/asset-reversal.service.js";
import { fundIdentity, isFundKind } from "../funds/fund-approval.service.js";
import { fundReversalDigest } from "../funds/fund-reversal.service.js";
import { finalIdentity, isFinalKind } from "../finalization/finalization-approval.service.js";

export const draftInclude = { lines: { orderBy: { lineNo: "asc" as const } } };
export async function loadDraft(tx: Prisma.TransactionClient, id: string) {
  const draft = await tx.accountingJournalDraft.findUnique({ where: { id }, include: draftInclude });
  if (!draft) throw new HttpError(404, "Accounting journal draft was not found.");
  return draft;
}
export function draftDigest(draft: Awaited<ReturnType<typeof loadDraft>>) {
  return accountingApprovalDigest({ id: draft.id, revision: String(draft.revision), journalType: draft.journalType,
    finalizationMetadata: draft.finalizationMetadata, bankReconciliationId: draft.bankReconciliationId,
    accrualMetadata: draft.accrualMetadata, parentAccrualDraftId: draft.parentAccrualDraftId,
    sourceKind: draft.sourceKind, sourceReference: draft.sourceReference,
    accountingDate: accountingDateValue(draft.accountingDate), description: draft.description,
    createdById: draft.createdById, lines: draft.lines.map(line => ({ accountId: line.accountId,
      lineNo: String(line.lineNo), debit: line.debit.toFixed(2), credit: line.credit.toFixed(2),
      bankAccountId: line.bankAccountId, accountingFundId: line.accountingFundId,
      fundRestrictionId: line.fundRestrictionId, counterpartyId: line.counterpartyId })) });
}
const reversalPayloadSchema = z.object({ accountingDate: dateOnly, remark: z.string().min(1).max(1000) }).strict();
export async function loadReversalSource(tx: Prisma.TransactionClient, id: string, payload: unknown) {
  const parsed = reversalPayloadSchema.safeParse(payload);
  if (!parsed.success) throw new HttpError(409, "Reversal approval payload is invalid.");
  const original = await tx.accountingJournal.findUnique({ where: { id }, include: { lines: { orderBy: { lineNo: "asc" } } } });
  if (!original) throw new HttpError(404, "Original journal was not found.");
  const digest = accountingApprovalDigest({ originalJournalId: original.id, journalType: original.journalType,
    originalAccountingDate: accountingDateValue(original.accountingDate), sourceEventKey: original.sourceEventKey,
    payload: parsed.data, aparContext: await aparReversalContext(tx, original.id), scheduleContext: await stage23ReversalDigest(tx, original.id), assetContext: await assetReversalDigest(tx, original.id), fundContext: await fundReversalDigest(tx, original.id), lines: original.lines.map(line => ({ accountId: line.accountId,
      lineNo: String(line.lineNo), debit: line.debit.toFixed(2), credit: line.credit.toFixed(2),
      bankAccountId: line.bankAccountId, accountingFundId: line.accountingFundId,
      fundRestrictionId: line.fundRestrictionId, counterpartyId: line.counterpartyId,
      eventCodeId: line.eventCodeId, eventCampaignId: line.eventCampaignId,
      memberIdentityId: line.memberIdentityId, memberId: line.memberId })) });
  return { original, payload: parsed.data, digest };
}
export async function currentApprovalDigest(tx: Prisma.TransactionClient, request: {
  requestKind: string; sourceDocumentId: string; requestPayload: unknown;
}) {
  if (isFinalKind(request.requestKind)) return (await finalIdentity(tx, request)).sourceDigest;
  if (isFundKind(request.requestKind)) return (await fundIdentity(tx, request)).sourceDigest;
  if (isAssetKind(request.requestKind)) return (await assetIdentity(tx, request)).sourceDigest;
  if (isStage23Kind(request.requestKind)) return (await stage23Identity(tx, request)).sourceDigest;
  if (isAparApprovalKind(request.requestKind)) return (await aparSourceIdentity(tx, request)).sourceDigest;
  if (["MANUAL_JOURNAL", "ADJUSTING_JOURNAL"].includes(request.requestKind)) {
    return draftDigest(await loadDraft(tx, request.sourceDocumentId));
  }
  if (request.requestKind === "JOURNAL_REVERSAL") return (await loadReversalSource(tx, request.sourceDocumentId, request.requestPayload)).digest;
  throw new HttpError(409, "This Accounting source workflow is not enabled in Stage 2.1.");
}
