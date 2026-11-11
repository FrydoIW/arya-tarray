import { Prisma } from "@prisma/client";
import { HttpError } from "../../../lib/http.js";
import { assertAccountingApprovalForPosting } from "../approval/approval.domain.js";
import { ACCOUNTING_APPROVE, ACCOUNTING_POST, appendApprovalHistory, approvalEvidence, hasAccountingPermission, loadApproval } from "../approval/approval.repository.js";
import { requireOpenAccountingPeriod } from "../period/period-control.service.js";
import { invalidateRequests } from "../approval/approval.service.js";
import { criteriaSchema } from "./fund.schema.js";
import { cents, day, money } from "./fund.domain.js";
import { commandOf, designationCapacity, digest, fundDates, loadDesignation, loadFund, loadFundDraft, loadRestriction, material, policyFor, releasedAmount, sourceLine } from "./fund.repository.js";
import { prepareFundPosting, releaseOf, type FundSource } from "./fund-posting.service.js";
export const isFundKind = (k: string) => ["FUND_SETUP", "FUND_RESTRICTION", "FUND_DESIGNATION", "FUND_RELEASE", "FUND_COMMAND", "FUND_JOURNAL"].includes(k);
export const nonfinancialFund = (k: string) => ["FUND_SETUP", "FUND_DESIGNATION", "FUND_COMMAND"].includes(k);
/** Historical reads must remain available after evidence is reversed; posting identities stay strict. */
export async function fundSourceView(tx: Prisma.TransactionClient, request: FundSource) {
  const current = request.requestKind === "FUND_SETUP" ? await loadFund(tx, request.sourceDocumentId)
    : ["FUND_RESTRICTION", "FUND_RELEASE"].includes(request.requestKind) ? await loadRestriction(tx, request.sourceDocumentId)
    : request.requestKind === "FUND_DESIGNATION" ? await loadDesignation(tx, request.sourceDocumentId) : await loadFundDraft(tx, request.sourceDocumentId);
  return { current, reviewedPayload: request.requestPayload ?? null };
}
export async function fundIdentity(tx: Prisma.TransactionClient, request: FundSource) {
  const k = request.requestKind, id = request.sourceDocumentId;
  if (k === "FUND_SETUP") {
    const f = await loadFund(tx, id), value = material(f);
    return { material: value, sourceDigest: digest(value), sourceVersion: f.revision, requesterId: f.createdById, accountingDate: f.effectiveOn, sourceLink: { accountingFundId: id } };
  }
  if (k === "FUND_RESTRICTION" || k === "FUND_RELEASE") {
    const r = await loadRestriction(tx, id), fund = await loadFund(tx, r.accountingFundId), source = await sourceLine(tx, r.sourceJournalLineId, false);
    const release = k === "FUND_RELEASE" ? releaseOf(request.requestPayload) : null;
    const evidence = release?.evidenceJournalLineId ? await sourceLine(tx, release.evidenceJournalLineId, false) : null;
    const value = material({ restriction: r, fund, source, release, remaining: money(cents(r.originalAmount) - await releasedAmount(tx, id)),
      releasedCents: String(await releasedAmount(tx, id)), evidence, target: release ? await loadFund(tx, release.targetFundId) : null });
    return { material: value, sourceDigest: digest(value), sourceVersion: r.revision, requesterId: r.createdById,
      accountingDate: release ? day(release.accountingDate) : r.effectiveOn ?? source.journal.accountingDate,
      sourceLink: { fundRestrictionId: id, ...(release?.evidenceJournalLineId ? { releaseEvidenceLineId: release.evidenceJournalLineId } : {}) } };
  }
  if (k === "FUND_DESIGNATION") {
    const d = await loadDesignation(tx, id), value = material({ designation: d, fund: await loadFund(tx, d.accountingFundId) });
    return { material: value, sourceDigest: digest(value), sourceVersion: d.revision, requesterId: d.createdById, accountingDate: d.effectiveOn, sourceLink: { fundDesignationId: id } };
  }
  const d = await loadFundDraft(tx, id);
  if (d.sourceKind !== k) throw new HttpError(409, "Fund approval source kind mismatch.");
  const f = d.accountingFundId ? await loadFund(tx, d.accountingFundId) : null;
  const value = material({ draft: d, fund: f, restriction: d.fundRestrictionId ? await loadRestriction(tx, d.fundRestrictionId) : null,
    designation: d.fundDesignationId ? await loadDesignation(tx, d.fundDesignationId) : null,
    parent: d.fundParentId ? await loadFundDraft(tx, d.fundParentId) : null,
    source: d.fundSourceLineId ? await sourceLine(tx, d.fundSourceLineId, false) : null,
    bank: d.fundBankTransactionId ? await tx.bankTransaction.findUnique({ where: { id: d.fundBankTransactionId } }) : null });
  return { material: value, sourceDigest: digest(value), sourceVersion: d.revision, requesterId: d.createdById, accountingDate: d.accountingDate, sourceLink: { journalDraftId: id } };
}
export async function validateFundCommand(tx: Prisma.TransactionClient, id: string) {
  const d = await loadFundDraft(tx, id), c = commandOf(d);
  if (d.status !== "DRAFT" || !d.accountingFundId) throw new HttpError(409, "Fund command is no longer current.");
  const f = await loadFund(tx, d.accountingFundId);
  if (c.action === "CONDITIONAL_REVIEW") throw new HttpError(409, "PENDING_POLICY: preserve the bank hold until an explicit evidence-based resolution is approved.");
  if (c.action === "REOPEN") { if (f.status !== "CLOSED") throw new HttpError(409, "Only a closed fund can reopen."); await policyFor(tx, f, false); }
  else { await policyFor(tx, f); await fundDates(f, d.accountingDate); }
  if (c.action === "CLOSE") {
    const open = await tx.accountingFundRestriction.count({ where: { accountingFundId: f.id, status: { in: ["DRAFT", "ACTIVE"] } } });
    const designated = await tx.accountingFundDesignation.count({ where: { accountingFundId: f.id, status: { in: ["DRAFT", "ACTIVE"] } } });
    if (open || designated) throw new HttpError(409, "Resolve open restrictions/designations before closing this fund.");
  }
  if (c.action === "AMEND_TERMS") {
    const r = await loadRestriction(tx, c.restrictionId), criteria = criteriaSchema.parse(c.criteria);
    if (r.accountingFundId !== f.id || !["ACTIVE", "SATISFIED"].includes(r.status) || !criteria.termsEffectiveOn || day(criteria.termsEffectiveOn) < d.accountingDate
      || r.restrictionKind === "TIME" && criteria.purposeCriterion !== "TIME_ONLY" || r.restrictionKind !== "TIME" && (criteria.purposeCriterion === "TIME_ONLY" || !c.purposeText)
      || ["TIME", "BOTH"].includes(r.restrictionKind) && (!c.releaseOn || !r.effectiveOn || day(c.releaseOn) < r.effectiveOn)) throw new HttpError(409, "Term amendments require prospective explicit donor evidence and matching restriction kind.");
  }
  if ("designationId" in c) {
    const designation = await loadDesignation(tx, c.designationId);
    if (designation.accountingFundId !== f.id || designation.status !== "ACTIVE") throw new HttpError(409, "An active designation in this fund is required.");
    if (c.action === "DESIGNATION_ADJUST") await designationCapacity(tx, f.id, c.amount, designation.id);
  }
  if (c.action === "RESOLVE_CONDITIONAL") {
    const parent = await loadFundDraft(tx, c.parentId), original = commandOf(parent);
    if (original.action !== "CONDITIONAL_REVIEW" || parent.status !== "DRAFT" || parent.fundActiveBankId !== c.bankTransactionId || d.fundBankTransactionId !== c.bankTransactionId
      || d.fundSourceLineId !== c.sourceJournalLineId || d.fundParentId !== parent.id) throw new HttpError(409, "Conditional bank review is not the current reserved parent.");
    await tx.$queryRaw`SELECT bank_transaction_id FROM arya_bank_transaction WHERE bank_transaction_id=${c.bankTransactionId} FOR UPDATE`;
    const bank = await tx.bankTransaction.findUnique({ where: { id: c.bankTransactionId }, include: { statementUpload: true } }), source = await sourceLine(tx, c.sourceJournalLineId);
    const policy = await policyFor(tx, f), type = f.fundClass === "CONDITIONAL_LIABILITY" ? "LIABILITY" : "REVENUE";
    if (!bank || bank.sourceType !== "BANK" || bank.originalAmount.lte(0) || bank.reconciliationExcludedAt || source.account.accountType !== type || source.accountId !== policy.contributionAccountId
      || cents(source.credit) !== cents(bank.originalAmount) || cents(source.debit) !== 0n || source.journal.accountingDate > d.accountingDate) throw new HttpError(409, "Resolution requires actual full bank amount and correctly classified posted policy evidence.");
    const debits = await tx.accountingJournalLine.findMany({ where: { journalId: source.journalId, bankAccountId: bank.statementUpload.bankAccountId, account: { accountType: "ASSET", contraFlag: false } } });
    if (debits.reduce((n, l) => n + cents(l.debit) - cents(l.credit), 0n) !== cents(bank.originalAmount)) throw new HttpError(409, "Resolution has no matching actual cash/bank journal evidence.");
    const bankJournals = await tx.accountingJournal.count({ where: { bankTransactionId: bank.id, journalType: "RECOGNITION", revFkAccJournalReversal: { is: null }, id: { not: source.journalId } } });
    const usedElsewhere = await tx.accountingJournalDraft.count({ where: { fundSourceLineId: source.id, fundActiveBankId: { not: null }, id: { not: d.id } } });
    if (bankJournals || usedElsewhere) throw new HttpError(409, "Another active bank recognition/decision already exists; resolve without double recognition.");
  }
  if (c.action === "REOPEN_CONDITIONAL") {
    const parent = await loadFundDraft(tx, c.parentId), p = commandOf(parent);
    if (p.action !== "RESOLVE_CONDITIONAL" || parent.accountingFundId !== f.id || parent.status !== "APPLIED" || !parent.fundActiveBankId || !parent.fundSourceLineId) throw new HttpError(409, "Active resolved conditional decision in this fund required.");
    const restrictions = await tx.accountingFundRestriction.count({ where: { sourceJournalLineId: parent.fundSourceLineId, status: { not: "CANCELLED" } } });
    const movements = await tx.accountingJournalDraft.count({ where: { fundSourceLineId: parent.fundSourceLineId, sourceKind: "FUND_JOURNAL", status: { not: "CANCELLED" } } });
    if (restrictions || movements) throw new HttpError(409, "Reverse/cancel dependent fund classifications before reopening conditional review.");
  }
  return { d, c, f };
}
export async function validateFundRequest(tx: Prisma.TransactionClient, request: FundSource) {
  if (request.requestKind === "FUND_SETUP") { const f = await loadFund(tx, request.sourceDocumentId); if (f.status !== "DRAFT") throw new HttpError(409, "Only a draft fund may activate."); await policyFor(tx, f, false); return; }
  if (request.requestKind === "FUND_DESIGNATION") { const d = await loadDesignation(tx, request.sourceDocumentId); if (d.status !== "DRAFT") throw new HttpError(409, "Designation is not draft."); await designationCapacity(tx, d.accountingFundId, d.amount.toFixed(2), d.id); return; }
  if (request.requestKind === "FUND_COMMAND") return validateFundCommand(tx, request.sourceDocumentId);
  return prepareFundPosting(tx, request, "validation-only");
}
export async function applyFundCommand(tx: Prisma.TransactionClient, actor: string, id: string) {
  const request = await loadApproval(tx, id), identity = await fundIdentity(tx, request), ev = approvalEvidence(request);
  if (!nonfinancialFund(request.requestKind)) throw new HttpError(409, "Financial fund events require the GL engine.");
  assertAccountingApprovalForPosting({ request: ev, kind: ev.kind, sourceDocumentId: request.sourceDocumentId, sourceVersion: identity.sourceVersion,
    currentDigest: identity.sourceDigest, hasPostingPermission: await hasAccountingPermission(tx, actor, ACCOUNTING_POST) });
  if (!request.decidedById || !await hasAccountingPermission(tx, request.decidedById, ACCOUNTING_APPROVE)) throw new HttpError(409, "Fund approver is no longer authorized.");
  await requireOpenAccountingPeriod(tx, identity.accountingDate); await validateFundRequest(tx, request);
  if (request.requestKind === "FUND_SETUP") await tx.accountingFund.update({ where: { id: request.sourceDocumentId }, data: { status: "ACTIVE", updatedById: actor } });
  else if (request.requestKind === "FUND_DESIGNATION") await tx.accountingFundDesignation.update({ where: { id: request.sourceDocumentId }, data: { status: "ACTIVE", approvedAt: request.decidedAt, approvedById: request.decidedById, updatedById: actor } });
  else {
    const { d, c, f } = await validateFundCommand(tx, request.sourceDocumentId);
    if (c.action === "CLOSE" || c.action === "REOPEN") await tx.accountingFund.update({ where: { id: f.id }, data: { status: c.action === "CLOSE" ? "CLOSED" : "ACTIVE", revision: { increment: 1 }, updatedById: actor } });
    if (c.action === "AMEND_TERMS") {
      await tx.accountingFundRestriction.update({ where: { id: c.restrictionId }, data: { purposeText: c.purposeText, releaseOn: c.releaseOn ? day(c.releaseOn) : null, termsEvidence: c.termsEvidence, criteria: c.criteria, revision: { increment: 1 }, updatedById: actor } });
      await invalidateRequests(tx, c.restrictionId, actor);
    }
    if (c.action === "DESIGNATION_ADJUST") await tx.accountingFundDesignation.update({ where: { id: c.designationId }, data: { amount: c.amount, purposeText: c.purposeText, revision: { increment: 1 }, approvedById: request.decidedById, approvedAt: request.decidedAt, updatedById: actor } });
    if (c.action === "DESIGNATION_RELEASE" || c.action === "DESIGNATION_CANCEL") await tx.accountingFundDesignation.update({ where: { id: c.designationId }, data: { status: c.action === "DESIGNATION_RELEASE" ? "RELEASED" : "CANCELLED", revision: { increment: 1 }, updatedById: actor } });
    if (c.action === "RESOLVE_CONDITIONAL") {
      await tx.accountingJournalDraft.update({ where: { id: c.parentId }, data: { status: "APPLIED", fundActiveBankId: null } });
      await tx.accountingJournalDraft.update({ where: { id: d.id }, data: { status: "APPLIED", fundActiveBankId: c.bankTransactionId } });
    } else if (c.action === "REOPEN_CONDITIONAL") {
      const resolved = await loadFundDraft(tx, c.parentId), resolvedCommand = commandOf(resolved);
      if (resolvedCommand.action !== "RESOLVE_CONDITIONAL") throw new HttpError(409, "Resolution source mismatch.");
      await tx.accountingJournalDraft.update({ where: { id: resolved.id }, data: { status: "CANCELLED", fundActiveBankId: null } });
      await tx.accountingJournalDraft.update({ where: { id: resolvedCommand.parentId }, data: { status: "DRAFT", fundActiveBankId: resolvedCommand.bankTransactionId } });
      await tx.accountingJournalDraft.update({ where: { id: d.id }, data: { status: "APPLIED" } });
    } else await tx.accountingJournalDraft.update({ where: { id: d.id }, data: { status: "APPLIED" } });
  }
  const changed = await tx.accountingApprovalRequest.updateMany({ where: { id, status: "APPROVED", sourceDigest: request.sourceDigest }, data: { status: "APPLIED", appliedById: actor, appliedAt: new Date() } });
  if (changed.count !== 1) throw new HttpError(409, "Approval already applied or changed.");
  await appendApprovalHistory(tx, { approvalRequestId: id, actorId: actor, action: "APPLY", statusBefore: "APPROVED", statusAfter: "APPLIED", sourceDigest: request.sourceDigest });
  return { approvalRequestId: id, financialJournalCreated: false, action: request.requestKind };
}
