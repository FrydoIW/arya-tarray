import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { HttpError } from "../../../lib/http.js";
import { aparTransaction } from "../apar/apar.repository.js";
import { ACCOUNTING_MANAGE, requireAccountingPermission } from "../approval/approval.repository.js";
import { invalidateRequests, applyApprovedAction } from "../approval/approval.service.js";
import { prisma } from "../../../lib/prisma.js";
import { currentBusinessDayValue } from "../../../lib/business-time.js";
import { criteriaSchema, type FundInput, type RestrictionInput, type DesignationInput, type FundMovement, type FundCommand } from "./fund.schema.js";
import { day } from "./fund.domain.js";
import { assertSource, designationCapacity, fundDates, loadDesignation, loadFund, loadFundDraft, loadRestriction, material, policyFor } from "./fund.repository.js";
export const managed = <T>(actor: string, work: (tx: Prisma.TransactionClient) => Promise<T>) => aparTransaction(async tx => { await requireAccountingPermission(tx, actor, ACCOUNTING_MANAGE); return work(tx); });
export async function applyFundSource(actor: string, id: string, approvalRequestId: string) {
  const request = await prisma.accountingApprovalRequest.findUnique({ where: { id: approvalRequestId }, select: { sourceDocumentId: true, requestKind: true } });
  if (!request || request.sourceDocumentId !== id || !["FUND_SETUP", "FUND_RESTRICTION", "FUND_DESIGNATION", "FUND_RELEASE", "FUND_COMMAND", "FUND_JOURNAL"].includes(request.requestKind)) throw new HttpError(409, "Matching fund source approval required.");
  return applyApprovedAction(actor, approvalRequestId);
}
function fundData(input: FundInput) { return { ...input, effectiveOn: day(input.effectiveOn), expiresOn: input.expiresOn ? day(input.expiresOn) : null, policy: input.policy ?? Prisma.DbNull }; }
async function validateFund(tx: Prisma.TransactionClient, input: FundInput) {
  if (input.expiresOn && input.expiresOn < input.effectiveOn) throw new HttpError(400, "Fund expiration precedes effective date.");
  if (input.eventCampaignId && !await tx.eventCampaign.count({ where: { id: input.eventCampaignId } })) throw new HttpError(400, "Campaign not found.");
}
export function createFund(actor: string, input: FundInput) { return managed(actor, async tx => {
  await validateFund(tx, input);
  return tx.accountingFund.create({ data: { ...fundData(input), createdById: actor, updatedById: actor } });
}); }
export function reviseFund(actor: string, id: string, revision: number, input: FundInput) { return managed(actor, async tx => {
  const fund = await loadFund(tx, id);
  if (fund.status !== "DRAFT" || fund.revision !== revision || fund.createdById !== actor) throw new HttpError(409, "Only the creator may revise the current draft fund.");
  await validateFund(tx, input); await invalidateRequests(tx, id, actor);
  return tx.accountingFund.update({ where: { id }, data: { ...fundData(input), revision: { increment: 1 }, updatedById: actor } });
}); }
async function restrictionData(tx: Prisma.TransactionClient, fundId: string, input: RestrictionInput, except?: string) {
  const fund = await loadFund(tx, fundId);
  if (fund.fundClass !== "DONOR_RESTRICTED") throw new HttpError(409, "Donor terms require a donor-restricted fund.");
  const criteria = criteriaSchema.parse(input.criteria);
  if (input.restrictionKind === "TIME" ? criteria.purposeCriterion !== "TIME_ONLY" : criteria.purposeCriterion === "TIME_ONLY" || !input.purposeText) throw new HttpError(400, "Explicit purpose/time terms required.");
  if (["TIME", "BOTH"].includes(input.restrictionKind) && (!input.releaseOn || input.releaseOn < input.effectiveOn)) throw new HttpError(400, "Valid donor time restriction date required.");
  if (input.eventCampaignId && fund.eventCampaignId && input.eventCampaignId !== fund.eventCampaignId) throw new HttpError(409, "Restriction campaign differs from fund program.");
  const { line } = await assertSource(tx, fund, input.sourceJournalLineId, input.originalAmount, day(input.effectiveOn), except);
  if (input.eventCampaignId && line.eventCampaignId !== input.eventCampaignId) throw new HttpError(409, "Campaign restriction must match actual contribution evidence.");
  const donorId = line.memberId ?? (line.journal.bankTransaction?.memberIdentity?.verificationStatus === "VERIFIED" ? line.journal.bankTransaction.memberIdentity.memberId : null);
  if (input.donorMemberId && input.donorMemberId !== donorId) throw new HttpError(409, "Donor must match source evidence or verified canonical identity ownership.");
  return { ...input, accountingFundId: fundId, effectiveOn: day(input.effectiveOn), releaseOn: input.releaseOn ? day(input.releaseOn) : null };
}
export function createRestriction(actor: string, fundId: string, input: RestrictionInput) { return managed(actor, async tx => {
  return tx.accountingFundRestriction.create({ data: { ...await restrictionData(tx, fundId, input), createdById: actor, updatedById: actor } });
}); }
export function reviseRestriction(actor: string, id: string, revision: number, input: RestrictionInput) { return managed(actor, async tx => {
  const row = await loadRestriction(tx, id);
  if (row.status !== "DRAFT" || row.classificationJournalId || row.revision !== revision || row.createdById !== actor) throw new HttpError(409, "Posted restriction terms require an approved adjustment; source/amount corrections require reversal.");
  const data = await restrictionData(tx, row.accountingFundId, input, id); await invalidateRequests(tx, id, actor);
  return tx.accountingFundRestriction.update({ where: { id }, data: { ...data, revision: { increment: 1 }, updatedById: actor } });
}); }
export function createDesignation(actor: string, fundId: string, input: DesignationInput) { return managed(actor, async tx => {
  await designationCapacity(tx, fundId, input.amount); await fundDates(await loadFund(tx, fundId), day(input.effectiveOn));
  return tx.accountingFundDesignation.create({ data: { ...input, effectiveOn: day(input.effectiveOn), accountingFundId: fundId, createdById: actor, updatedById: actor } });
}); }
export function createFundMovement(actor: string, fundId: string, input: FundMovement) { return managed(actor, async tx => {
  const fund = await loadFund(tx, fundId);
  if (fund.fundClass === "DONOR_RESTRICTED") throw new HttpError(409, "Use an evidenced donor restriction classification.");
  await assertSource(tx, fund, input.sourceJournalLineId, input.amount, day(input.accountingDate), undefined, input.action === "OPENING");
  const id = randomUUID();
  return tx.accountingJournalDraft.create({ data: { id, draftNumber: `FUND-${id}`, journalType: "ADJUSTMENT", sourceKind: "FUND_JOURNAL", sourceReference: input.sourceReference,
    accountingDate: day(input.accountingDate), description: input.reason, accountingFundId: fundId, fundSourceLineId: input.sourceJournalLineId, fundMetadata: input, createdById: actor } });
}); }
export function createFundCommand(actor: string, fundId: string, input: FundCommand) { return managed(actor, async tx => {
  const fund = await loadFund(tx, fundId);
  let bankId: string | null = null, parentId: string | null = null, sourceId: string | null = null;
  if (input.action === "CONDITIONAL_REVIEW") {
    if (!["CONDITIONAL_REVIEW", "CONDITIONAL_LIABILITY"].includes(fund.fundClass)) throw new HttpError(409, "A conditional review requires an explicitly conditional fund.");
    await tx.$queryRaw`SELECT bank_transaction_id FROM arya_bank_transaction WHERE bank_transaction_id=${input.bankTransactionId} FOR UPDATE`;
    const bank = await tx.bankTransaction.findUnique({ where: { id: input.bankTransactionId } });
    if (!bank || bank.sourceType !== "BANK" || bank.originalAmount.lte(0) || bank.reconciliationExcludedAt) throw new HttpError(409, "Real eligible incoming bank evidence required.");
    const settlement = await tx.accountingSettlement.count({ where: { bankTransactionId: bank.id, status: { in: ["DRAFT", "POSTED"] } } });
    if (settlement) throw new HttpError(409, "Bank evidence is already reserved by AP/AR."); bankId = bank.id;
  } else {
    if (input.action !== "REOPEN") await policyFor(tx, fund);
    if (input.action === "RESOLVE_CONDITIONAL") { bankId = input.bankTransactionId; parentId = input.parentId; sourceId = input.sourceJournalLineId; }
    if (input.action === "REOPEN_CONDITIONAL") parentId = input.parentId;
  }
  const id = randomUUID();
  return tx.accountingJournalDraft.create({ data: { id, draftNumber: `FUNDCMD-${id}`, journalType: "ADJUSTMENT", sourceKind: "FUND_COMMAND", sourceReference: input.sourceReference,
    accountingDate: day(input.accountingDate), description: input.reason, accountingFundId: fundId, fundRestrictionId: input.action === "AMEND_TERMS" ? input.restrictionId : null,
    fundDesignationId: "designationId" in input ? input.designationId : null, fundSourceLineId: sourceId, fundParentId: parentId, fundBankTransactionId: bankId,
    fundActiveBankId: input.action === "CONDITIONAL_REVIEW" ? bankId : null, fundMetadata: input, createdById: actor } });
}); }
export function cancelFundDraft(actor: string, type: "RESTRICTION" | "DESIGNATION" | "MOVEMENT", id: string, revision: number, reason: string) { return managed(actor, async tx => {
  const row = type === "RESTRICTION" ? await loadRestriction(tx, id) : type === "DESIGNATION" ? await loadDesignation(tx, id) : await loadFundDraft(tx, id);
  if (row.createdById !== actor || row.revision !== revision || row.status !== "DRAFT") throw new HttpError(409, "Only the creator may cancel a current unposted draft.");
  if (type === "MOVEMENT" && "fundActiveBankId" in row && row.fundActiveBankId) throw new HttpError(409, "An unresolved conditional bank hold requires independently approved policy resolution.");
  if (!row.accountingFundId) throw new HttpError(409, "Draft fund identity is missing.");
  const auditId = randomUUID();
  await tx.accountingJournalDraft.create({ data: { id: auditId, draftNumber: `FUNDAUDIT-${auditId}`, journalType: "ADJUSTMENT", sourceKind: "FUND_AUDIT", sourceReference: `CANCEL-${id}-v${revision}`,
    accountingFundId: row.accountingFundId, fundRestrictionId: type === "RESTRICTION" ? id : null, fundDesignationId: type === "DESIGNATION" ? id : null,
    accountingDate: day(currentBusinessDayValue()), description: reason, createdById: actor, status: "APPLIED",
    fundMetadata: material({ action: "CANCEL_UNPOSTED_DRAFT", sourceType: type, sourceDocumentId: id, reason, before: row, actorId: actor }) } });
  await invalidateRequests(tx, id, actor);
  if (type === "RESTRICTION") return tx.accountingFundRestriction.update({ where: { id }, data: { status: "CANCELLED", revision: { increment: 1 }, updatedById: actor } });
  if (type === "DESIGNATION") return tx.accountingFundDesignation.update({ where: { id }, data: { status: "CANCELLED", revision: { increment: 1 }, updatedById: actor } });
  return tx.accountingJournalDraft.update({ where: { id }, data: { status: "CANCELLED", revision: { increment: 1 }, description: reason } });
}); }
