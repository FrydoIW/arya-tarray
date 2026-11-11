import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { HttpError } from "../../../lib/http.js";
import { currentBusinessDayValue } from "../../../lib/business-time.js";
import type { LedgerJournalInput } from "../ledger/ledger.service.js";
import type { LedgerLineInput } from "../ledger/ledger.domain.js";
import { releaseInputSchema, criteriaSchema } from "./fund.schema.js";
import { assertCapacity, cents, day, eligibilityDates } from "./fund.domain.js";
import { assertSource, fundDates, loadFund, loadFundDraft, loadRestriction, movementOf, policyFor, releasedAmount, sourceLine } from "./fund.repository.js";
export type FundSource = { id?: string; requestKind: string; sourceDocumentId: string; requestPayload?: unknown };
export function releaseOf(value: unknown) {
  const parsed = releaseInputSchema.safeParse(value && typeof value === "object" && "release" in value ? value.release : null);
  if (!parsed.success) throw new HttpError(409, "Release evidence payload is missing/invalid."); return parsed.data;
}
export async function prepareRelease(tx: Prisma.TransactionClient, request: FundSource) {
  const r = await loadRestriction(tx, request.sourceDocumentId), input = releaseOf(request.requestPayload), date = day(input.accountingDate);
  await tx.$queryRaw`SELECT fund_restriction_id FROM arya_accounting_fund_restriction WHERE fund_restriction_id=${r.id} FOR UPDATE`;
  if (r.status !== "ACTIVE" || !r.classificationJournalId) throw new HttpError(409, "Only an active funded restriction may be released.");
  const fund = await loadFund(tx, r.accountingFundId), target = await loadFund(tx, input.targetFundId), policy = await policyFor(tx, fund), targetPolicy = await policyFor(tx, target);
  if (fund.fundClass !== "DONOR_RESTRICTED" || target.fundClass !== "UNRESTRICTED" || !policy.release) throw new HttpError(409, "PENDING_POLICY: approved donor-release mappings and unrestricted destination required.");
  await fundDates(fund, date); await fundDates(target, date);
  const mapping = policy.release;
  if (mapping.mode === "REVENUE_RECLASSIFICATION" ? mapping.creditAccountId !== targetPolicy.contributionAccountId : mapping.creditAccountId !== target.balanceAccountId) throw new HttpError(409, "Release credit must match the reviewed unrestricted control mapping.");
  const terms = criteriaSchema.parse(r.criteria);
  if (input.satisfactionDate > currentBusinessDayValue()) throw new HttpError(409, "Restriction satisfaction cannot be declared in the future (Asia/Jakarta business date).");
  eligibilityDates({ kind: r.restrictionKind, effectiveOn: r.effectiveOn, releaseOn: r.releaseOn, satisfactionDate: day(input.satisfactionDate), accountingDate: date, criterion: terms.purposeCriterion });
  if (terms.termsEffectiveOn && day(input.satisfactionDate) < day(terms.termsEffectiveOn)) throw new HttpError(409, "Evidence predates the approved current terms.");
  const classification = await tx.accountingJournal.findUnique({ where: { id: r.classificationJournalId }, include: { revFkAccJournalReversal: true } });
  if (!classification || classification.revFkAccJournalReversal || classification.accountingDate > date) throw new HttpError(409, "Restriction classification evidence is unavailable or later than release.");
  const source = await sourceLine(tx, r.sourceJournalLineId);
  const priorRelease = await tx.accountingFundRelease.findFirst({ where: { fundRestrictionId: r.id }, orderBy: { releaseDate: "desc" }, include: { relFkAccFundReleaseJournal: { include: { revFkAccJournalReversal: true } } } });
  if (priorRelease && (date < priorRelease.releaseDate || priorRelease.relFkAccFundReleaseJournal.revFkAccJournalReversal && date < priorRelease.relFkAccFundReleaseJournal.revFkAccJournalReversal.accountingDate)) throw new HttpError(409, "Release cannot predate prior release/reversal activity.");
  assertCapacity(cents(r.originalAmount), await releasedAmount(tx, r.id), cents(input.amount));
  const resources = await tx.$queryRaw<{ amount: Prisma.Decimal }[]>`SELECT COALESCE(SUM(l.credit-l.debit),0) AS amount FROM arya_accounting_journal_line l JOIN arya_accounting_account a ON a.accounting_account_id=l.accounting_account_id WHERE l.fund_restriction_id=${r.id} AND a.account_type IN ('NET_ASSET','REVENUE','EXPENSE')`;
  if (cents(resources[0]?.amount ?? "0") < cents(r.originalAmount) - await releasedAmount(tx, r.id)) throw new HttpError(409, "Restriction GL resources differ from remaining terms; review direct expense/dimension entries before release.");
  const balance = await tx.accountingJournalLine.aggregate({ where: { accountingFundId: fund.id, fundRestrictionId: r.id, accountId: mapping.debitAccountId, journal: { accountingDate: { lte: date } } }, _sum: { debit: true, credit: true } });
  assertCapacity(cents(balance._sum.credit ?? "0") - cents(balance._sum.debit ?? "0"), 0n, cents(input.amount));
  let evidenceKey: string, evidenceJournalId: string | null = null;
  if (["EXPENSE_INCURRED", "CAPITAL_ACQUIRED"].includes(terms.purposeCriterion)) {
    if (!input.evidenceJournalLineId) throw new HttpError(409, "Actual posted expense/capital evidence is required by the donor terms.");
    const evidence = await sourceLine(tx, input.evidenceJournalLineId);
    const expected = terms.purposeCriterion === "EXPENSE_INCURRED" ? "EXPENSE" : "ASSET";
    if (evidence.account.accountType !== expected || evidence.account.contraFlag || cents(evidence.debit) <= 0n || cents(evidence.credit) !== 0n
      || evidence.accountingFundId !== target.id || evidence.fundRestrictionId || evidence.journal.accountingDate > day(input.satisfactionDate)
      || r.eventCampaignId && evidence.eventCampaignId !== r.eventCampaignId) throw new HttpError(409, "Evidence must satisfy the selected donor criterion and belong to the destination unrestricted fund/program.");
    const used = await tx.accountingFundRelease.aggregate({ where: { evidenceJournalLineId: evidence.id, activeEvidenceKey: { not: null } }, _sum: { amount: true } });
    if (terms.purposeCriterion === "CAPITAL_ACQUIRED" && !await tx.accountingFixedAsset.count({ where: { acquisitionJournalLineId: evidence.id, status: "ACTIVE" } })) throw new HttpError(409, "Capital eligibility requires the existing independently activated fixed-asset register source.");
    assertCapacity(cents(evidence.debit), cents(used._sum.amount ?? "0"), cents(input.amount));
    evidenceKey = `LINE:${evidence.id}`; evidenceJournalId = evidence.journalId;
  } else {
    if (input.evidenceJournalLineId) throw new HttpError(409, "Use explicit external milestone/time evidence for these donor criteria.");
    evidenceKey = `REF:${createHash("sha256").update(input.evidenceReference.trim().toLowerCase()).digest("hex")}`;
  }
  if (await tx.accountingFundRelease.count({ where: { OR: [{ releaseReference: input.releaseReference }, { fundRestrictionId: r.id, activeEvidenceKey: evidenceKey }] } })) throw new HttpError(409, "Release reference/evidence has already been used.");
  return { r, input, fund, target, mapping, evidenceKey, evidenceJournalId, source };
}
export type FundPostingPlan = { expected: LedgerJournalInput; restrictionId?: string; draftId?: string; release?: Awaited<ReturnType<typeof prepareRelease>> };
export async function prepareFundPosting(tx: Prisma.TransactionClient, request: FundSource, actorId: string): Promise<FundPostingPlan> {
  const base = { approvalRequestId: request.id, postedById: actorId };
  if (request.requestKind === "FUND_RELEASE") {
    const p = await prepareRelease(tx, request), { r, input, fund, target, mapping } = p;
    const common = { eventCampaignId: r.eventCampaignId, memberId: r.donorMemberId };
    return { release: p, expected: { ...base, journalType: "FUND_RELEASE", sourceKind: "FUND_RELEASE", sourceReference: input.releaseReference,
      accountingDate: day(input.accountingDate), descriptionSnapshot: input.releaseReason, relatedJournalId: r.classificationJournalId,
      lines: [{ accountId: mapping.debitAccountId, debit: input.amount, credit: "0.00", accountingFundId: fund.id, fundRestrictionId: r.id, ...common },
        { accountId: mapping.creditAccountId, debit: "0.00", credit: input.amount, accountingFundId: target.id, ...common }] } };
  }
  let fundId: string, sourceId: string, amount: string, date: Date, ref: string, reason: string, restrictionId: string | undefined, draftId: string | undefined, opening = false;
  if (request.requestKind === "FUND_RESTRICTION") {
    const r = await loadRestriction(tx, request.sourceDocumentId);
    if (r.status !== "DRAFT" || r.classificationJournalId || !r.effectiveOn) throw new HttpError(409, "Restriction is not an unposted draft.");
    fundId = r.accountingFundId; sourceId = r.sourceJournalLineId; amount = r.originalAmount.toFixed(2); date = r.effectiveOn; ref = `${r.id}:v${r.revision}`; reason = r.termsEvidence; restrictionId = r.id;
  } else if (request.requestKind === "FUND_JOURNAL") {
    const draft = await loadFundDraft(tx, request.sourceDocumentId), input = movementOf(draft);
    if (draft.sourceKind !== "FUND_JOURNAL" || draft.status !== "DRAFT" || !draft.accountingFundId || draft.fundSourceLineId !== input.sourceJournalLineId) throw new HttpError(409, "Fund journal is not current/postable.");
    fundId = draft.accountingFundId; sourceId = input.sourceJournalLineId; amount = input.amount; date = draft.accountingDate; ref = draft.id; reason = input.reason; opening = input.action === "OPENING"; draftId = draft.id;
  } else throw new HttpError(409, "Nonfinancial fund commands must use approved action application.");
  const fund = await loadFund(tx, fundId), { line, policy } = await assertSource(tx, fund, sourceId, amount, date, restrictionId ?? draftId, opening);
  if (restrictionId ? fund.fundClass !== "DONOR_RESTRICTED" : fund.fundClass === "DONOR_RESTRICTED" || opening && fund.fundClass !== "UNRESTRICTED") throw new HttpError(409, "Restricted contributions require explicit donor restriction evidence; opening supports unrestricted controls.");
  const targetAccount = opening ? fund.balanceAccountId : policy.contributionAccountId;
  if (!targetAccount) throw new HttpError(409, "Control mapping missing.");
  const dims = { eventCodeId: line.eventCodeId, eventCampaignId: line.eventCampaignId, memberIdentityId: line.memberIdentityId, memberId: line.memberId, counterpartyId: line.counterpartyId };
  const lines: LedgerLineInput[] = [
    { accountId: line.accountId, debit: amount, credit: "0.00", ...dims },
    { accountId: targetAccount, debit: "0.00", credit: amount, accountingFundId: fundId, fundRestrictionId: restrictionId ?? null, ...dims }
  ];
  return { restrictionId, draftId, expected: { ...base, journalType: "RECLASSIFICATION", sourceKind: restrictionId ? "FUND_RESTRICTION" : opening ? "FUND_OPENING" : "FUND_CLASSIFY", sourceReference: ref,
    accountingDate: date, descriptionSnapshot: reason, relatedJournalId: line.journalId, lines } };
}
export async function applyFundPosting(tx: Prisma.TransactionClient, plan: FundPostingPlan, journalId: string, actorId: string) {
  if (plan.restrictionId) await tx.accountingFundRestriction.update({ where: { id: plan.restrictionId }, data: { status: "ACTIVE", classificationJournalId: journalId, updatedById: actorId } });
  if (plan.release) {
    const { r, input, evidenceKey } = plan.release;
    await tx.accountingFundRelease.create({ data: { fundRestrictionId: r.id, releaseReference: input.releaseReference, releaseDate: day(input.accountingDate), releaseReason: input.releaseReason,
      releaseJournalId: journalId, createdById: actorId, amount: input.amount, satisfactionDate: day(input.satisfactionDate), eligibilityEvidence: input.eligibilityEvidence,
      evidenceReference: input.evidenceReference, evidenceKey, activeEvidenceKey: evidenceKey, evidenceJournalLineId: input.evidenceJournalLineId, targetFundId: input.targetFundId } });
    if (await releasedAmount(tx, r.id) === cents(r.originalAmount)) await tx.accountingFundRestriction.update({ where: { id: r.id }, data: { status: "SATISFIED", updatedById: actorId } });
  }
}
