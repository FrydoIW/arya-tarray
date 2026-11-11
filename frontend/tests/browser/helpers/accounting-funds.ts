import type { Page } from '@playwright/test';
import { allCoreGrants, ids as core, setupCoreBrowser } from './accounting-core';
import { browserActor } from './accounting-workspace';
import type { ApprovalDetail } from '../../../src/features/accounting/core/types';
import type { ContributionSource, DesignationDetail, Fund, FundDetail, FundJournal, FundMetrics, FundMovementDetail, FundReconciliation, FundRelease, RestrictionDetail } from '../../../src/features/accounting/funds/types';

const uuid = (n: number) => '36000000-0000-4000-8000-' + String(n).padStart(12, '0');
export const ids = { unrestricted: uuid(1), restricted: uuid(2), conditional: uuid(3), restriction: uuid(4), designation: uuid(5), movement: uuid(6),
  sourceLine: uuid(7), sourceJournal: uuid(8), releaseJournal: uuid(9), approval: uuid(10), targetAccount: uuid(11), reviewer: core.requester,
  evidenceLine: uuid(12), campaign: uuid(13), member: uuid(14), bank: uuid(15), release: uuid(16), command: uuid(17) };
export const fundGrants = allCoreGrants;
type Options = { grants?: string[]; approved?: boolean; own?: boolean; closed?: boolean; stale?: boolean; delay?: number; draftFund?: boolean };

export async function setupFunds(page: Page, options: Options = {}) {
  const base = await setupCoreBrowser(page, options.grants ?? fundGrants, { closed: options.closed });
  const policy = { policyReference: 'Synthetic adopted fund policy evidence', contributionAccountId: core.account,
    conditionalObligationEvidence: null, release: null };
  const unrestricted: FundDetail = { id: ids.unrestricted, fundCode: 'GENERAL', fundName: 'Synthetic unrestricted fund', description: 'Synthetic general resources',
    fundClass: 'UNRESTRICTED', balanceAccountId: ids.targetAccount, eventCampaignId: null, effectiveOn: '2026-01-01', expiresOn: null,
    sourceReference: 'SYNTHETIC-BOARD-POLICY', policy, status: options.draftFund ? 'DRAFT' : 'ACTIVE', revision: options.stale ? 2 : 1,
    createdById: browserActor.id, updatedById: browserActor.id, createdAt: '2026-01-01', updatedAt: '2026-11-01', policyStatus: 'APPROVED_POLICY', history: [], historyLimit: 100 };
  const restricted: FundDetail = { ...unrestricted, id: ids.restricted, fundCode: 'PROGRAM-A', fundName: 'Synthetic donor-restricted program',
    fundClass: 'DONOR_RESTRICTED', eventCampaignId: ids.campaign, policy: { ...policy, release: { mode: 'REVENUE_RECLASSIFICATION', debitAccountId: core.account, creditAccountId: core.expense } }, revision: 1 };
  const conditional: FundDetail = { ...unrestricted, id: ids.conditional, fundCode: 'CONDITIONAL', fundName: 'Synthetic conditional funding',
    fundClass: 'CONDITIONAL_REVIEW', policy: null, policyStatus: 'PENDING_POLICY', status: 'DRAFT', revision: 1 };
  const source: ContributionSource = { id: ids.sourceLine, journalId: ids.sourceJournal, sourceKind: 'FINALIZED_BANK_TRANSACTION', accountingDate: '2026-11-02',
    bankTransactionId: ids.bank, eventCodeId: null, eventCampaignId: ids.campaign, memberIdentityId: null, historicalMemberId: ids.member,
    accountType: 'REVENUE', originalAmount: '20000000.00', reservedOrClassifiedAmount: '0.00', unallocatedAmount: '20000000.00' };
  const restriction: RestrictionDetail = { id: ids.restriction, accountingFundId: ids.restricted, sourceJournalLineId: ids.sourceLine,
    originalAmount: '20000000.00', donorMemberId: ids.member, restrictionKind: 'BOTH', purposeText: 'Synthetic donor purpose for program services',
    effectiveOn: '2026-11-02', releaseOn: '2026-11-10', supportingReference: 'DONOR-TERMS-36', termsEvidence: 'Synthetic signed donor terms evidence',
    criteria: { purposeCriterion: 'EXPENSE_INCURRED', eligibilityTerms: 'Synthetic eligible program expenditure terms', termsEffectiveOn: '2026-11-02' },
    eventCampaignId: ids.campaign, status: 'ACTIVE', classificationJournalId: ids.sourceJournal, revision: options.stale ? 2 : 1,
    createdById: browserActor.id, updatedById: browserActor.id, createdAt: '2026-11-02', updatedAt: '2026-11-02', releasedAmount: '7000000.00', remainingAmount: '13000000.00', history: [], historyLimit: 100 };
  const designation: DesignationDetail = { id: ids.designation, accountingFundId: ids.unrestricted, designationReference: 'BOARD-36',
    purposeText: 'Synthetic management designation evidence', amount: '5000000.00', effectiveOn: '2026-11-01', status: 'ACTIVE', revision: 1,
    approvedAt: '2026-11-02', approvedById: ids.reviewer, createdById: browserActor.id, updatedById: browserActor.id, createdAt: '2026-11-01', history: [], historyLimit: 100 };
  const movement: FundMovementDetail = { id: ids.movement, accountingFundId: ids.unrestricted, fundRestrictionId: null, fundDesignationId: null,
    accountingDate: '2026-11-02', sourceKind: 'FUND_JOURNAL', sourceReference: 'CLASSIFY-36', description: 'Synthetic explicit fund classification evidence',
    status: 'DRAFT', revision: 1, createdById: browserActor.id, postedJournalId: null,
    fundMetadata: { action: 'CLASSIFY', sourceJournalLineId: ids.sourceLine, amount: '7000000.00', accountingDate: '2026-11-02', sourceReference: 'CLASSIFY-36', reason: 'Synthetic explicit fund classification evidence' }, history: [], historyLimit: 100 };
  const release: FundRelease = { id: ids.release, fundRestrictionId: ids.restriction, releaseReference: 'RELEASE-36-OLD', releaseDate: '2026-11-05',
    releaseReason: 'Synthetic previously approved partial release', releaseJournalId: ids.releaseJournal, createdById: ids.reviewer, createdAt: '2026-11-05', amount: '7000000.00',
    satisfactionDate: '2026-11-05', eligibilityEvidence: 'Synthetic posted expense evidence', evidenceReference: 'EXPENSE-EVIDENCE-OLD', evidenceJournalLineId: ids.evidenceLine,
    targetFundId: ids.unrestricted, activeEvidenceKey: 'LINE:' + ids.evidenceLine };
  const journal: FundJournal = { id: ids.releaseJournal, journalNumber: 'FUND-REL-36', accountingDate: '2026-11-05', journalType: 'FUND_RELEASE', sourceKind: 'FUND_RELEASE', sourceReference: release.releaseReference, reversalOfJournalId: null };
  const metrics: FundMetrics = { fundId: ids.restricted, fundClass: 'DONOR_RESTRICTED', scope: 'CURRENT_POSTED_GL_INCLUDING_REVERSALS',
    recognizedContributionClassifications: '20000000.00', classifiedConditionalLiabilityContributions: '0.00', openingNetAssetClassifications: '0.00', accountingNetAssets: '0.00',
    netRevenueIncludingReclassifications: '13000000.00', recognizedExpenses: '7000000.00', economicNetResources: '13000000.00', liabilityControlNet: '0.00',
    restrictedOriginalAmount: '20000000.00', eligibleReleasedAmount: '7000000.00', unreleasedRestrictions: '13000000.00', internalDesignations: '0.00', managementAvailableNetResources: null,
    actualFundTaggedBankCash: '0.00', cashAttribution: 'Fund reclassification does not retag original bank cash.', relatedEligibleRecognizedExpenses: '7000000.00', commitments: null,
    commitmentStatus: 'UNKNOWN_NOT_INFERRED_FROM_SUBSCRIPTIONS_OR_CAMPAIGN_TARGETS', campaignWallet: '25000000.00', walletScope: 'OPERATIONAL_CAMPAIGN_ALL_PARTICIPANTS_NOT_A_FUND_GL_BALANCE' };
  const reconciliation: FundReconciliation = { metrics, exceptions: [{ code: 'OPERATIONAL_SCOPE_DIFFERENCE', reason: 'Campaign wallet cannot be substituted for GL resources/cash.' }],
    reviewRequests: [], reviewRequestsLimit: 100, invalidAttemptHandling: 'Invalid/duplicate proposals return 409 before persistence.', exceptionsTruncated: false, automaticAdjustments: false, status: 'REVIEW_REQUIRED' };
  let releaseProposal = { amount: '7000000.00', releaseReference: 'RELEASE-36', accountingDate: '2026-11-10', satisfactionDate: '2026-11-10', targetFundId: ids.unrestricted,
    releaseReason: 'Synthetic eligible partial donor release', eligibilityEvidence: 'Synthetic actual program expenditure evidence', evidenceReference: 'EXPENSE-EVIDENCE-36', evidenceJournalLineId: ids.evidenceLine };
  const snapshot = () => ({ restriction: { ...restriction, history: undefined, historyLimit: undefined }, fund: restricted,
    source: { ...source, journal: { id: source.journalId, accountingDate: source.accountingDate, sourceKind: source.sourceKind } }, release: releaseProposal,
    remaining: restriction.remainingAmount, releasedCents: '700000000', evidence: { id: ids.evidenceLine, debit: '7000000.00', credit: '0.00', journal: { id: core.journal } }, target: unrestricted });
  let approval: ApprovalDetail = { id: ids.approval, requestKind: 'FUND_RELEASE', sourceDocumentId: ids.restriction, sourceVersion: 2, sourceDigest: 'synthetic-fund-digest-36',
    requestedById: options.own ? browserActor.id : ids.reviewer, requestedAt: '2026-11-10', status: options.approved ? 'APPROVED' : 'PENDING',
    decidedById: options.approved ? browserActor.id : null, decidedAt: options.approved ? '2026-11-10' : null, decisionRemark: null, appliedJournalId: null,
    approvers: [{ approverUserId: browserActor.id }, { approverUserId: ids.reviewer }], history: [], historyLimit: 1000,
    source: { current: restriction, reviewedPayload: { release: releaseProposal, snapshot: snapshot() } }, requestPayload: { release: releaseProposal, snapshot: snapshot() } };
  const writes: { path: string; method: string; body: Record<string, unknown> }[] = [], reads: { path: string; query: URLSearchParams }[] = [];
  const failures = new Map<string, { status: number; message: string }>();
  const funds: Fund[] = [unrestricted, restricted, conditional];
  const list = <T>(rows: T[], query?: URLSearchParams) => ({ rows, page: Number(query?.get('page') ?? 1), pageSize: Number(query?.get('pageSize') ?? 25), total: rows.length });
  function setApproval(kind: string, sourceId: string, current: Record<string, unknown>, material: Record<string, unknown>, version = 1) {
    approval = { ...approval, requestKind: kind, sourceDocumentId: sourceId, sourceVersion: version, status: options.approved ? 'APPROVED' : 'PENDING',
      requestedById: options.own ? browserActor.id : ids.reviewer, decidedById: options.approved ? browserActor.id : null,
      source: { current, reviewedPayload: { snapshot: material } }, requestPayload: { snapshot: material } };
  }
  await page.route('**/api/accounting/**', async route => {
    const request = route.request(), method = request.method(), url = new URL(request.url());
    const path = url.pathname.replace('/api/accounting/', ''), query = url.searchParams;
    const send = (json: unknown, status = 200) => route.fulfill({ json, status });
    const failure = failures.get(path);
    if (method === 'GET') {
      reads.push({ path, query }); if (failure) return send({ message: failure.message }, failure.status);
      if (path === 'funds') { const q = (query.get('search') ?? '').toLowerCase(), status = query.get('status'); return send(list(funds.filter(f => (!q || (f.fundCode + f.fundName).toLowerCase().includes(q)) && (!status || f.status === status)), query)); }
      if (path === 'funds/' + ids.unrestricted) return send(unrestricted);
      if (path === 'funds/' + ids.restricted) return send(restricted);
      if (path === 'funds/' + ids.conditional) return send(conditional);
      if (path === 'fund-contribution-sources') return send({ ...list([source], query), classificationStatus: 'REVIEW_REQUIRED_EXPLICIT_POLICY_AND_SOURCE_EVIDENCE', recognitionCreated: false });
      if (path === `funds/${ids.restricted}/restrictions`) return send(list([restriction], query));
      if (path === `funds/${ids.unrestricted}/designations`) return send(list([designation], query));
      if (path === `funds/${ids.unrestricted}/movements`) return send(list([movement], query));
      if (path === `funds/${ids.restricted}/movements`) return send(list([], query));
      if (path === 'fund-restrictions/' + ids.restriction) return send(restriction);
      if (path === 'fund-designations/' + ids.designation) return send(designation);
      if (path === 'fund-movements/' + ids.movement || path === 'fund-movements/' + ids.command) return send({ ...movement, id: path.endsWith(ids.command) ? ids.command : ids.movement, sourceKind: path.endsWith(ids.command) ? 'FUND_COMMAND' : movement.sourceKind });
      if (path.endsWith('/releases')) return send(list([release], query));
      if (path.endsWith('/journals')) return send(list([journal], query));
      if (path.endsWith('/balances') || path.endsWith('/utilization')) return send({ ...metrics, fundId: path.split('/')[1] });
      if (path.endsWith('/reconciliation')) return send(reconciliation);
      if (path === 'approvals/' + ids.approval) return send(approval);
      if (path === 'approvals') return send(list([approval], query));
      return route.fallback();
    }
    const body = (request.postDataJSON() ?? {}) as Record<string, unknown>; writes.push({ path, method, body });
    if (failure) return send({ message: failure.message }, failure.status);
    if (options.delay) await new Promise(resolve => setTimeout(resolve, options.delay));
    if (path === 'funds') { Object.assign(unrestricted, body, { status: 'DRAFT' }); return send(unrestricted, 201); }
    if (path === 'funds/' + ids.unrestricted && method === 'PATCH') { Object.assign(unrestricted, body); unrestricted.revision += 1; return send(unrestricted); }
    if (path === `funds/${ids.restricted}/restrictions`) { Object.assign(restriction, body, { status: 'DRAFT', releasedAmount: '0.00', remainingAmount: body.originalAmount }); return send(restriction, 201); }
    if (path === 'fund-restrictions/' + ids.restriction && method === 'PATCH') { Object.assign(restriction, body); restriction.revision += 1; return send(restriction); }
    if (path === `funds/${ids.unrestricted}/designations`) { Object.assign(designation, body, { status: 'DRAFT' }); return send(designation, 201); }
    if (path === `funds/${ids.unrestricted}/movements`) { Object.assign(movement, { fundMetadata: body, accountingDate: body.accountingDate, sourceReference: body.sourceReference, description: body.reason }); return send(movement, 201); }
    if (path === `funds/${ids.unrestricted}/commands`) return send({ ...movement, id: ids.command, sourceKind: 'FUND_COMMAND', fundMetadata: body, sourceReference: String(body.sourceReference) }, 201);
    if (path === 'fund-restrictions/' + ids.restriction + '/releases') {
      releaseProposal = body as typeof releaseProposal; approval = { ...approval, status: 'PENDING', requestPayload: { release: releaseProposal, snapshot: snapshot() }, source: { current: restriction, reviewedPayload: { release: releaseProposal } } }; return send(approval, 201);
    }
    if (path.endsWith('/submit')) {
      if (path.startsWith('funds/')) setApproval('FUND_SETUP', ids.unrestricted, unrestricted, unrestricted, unrestricted.revision);
      else if (path.startsWith('fund-restrictions/')) setApproval('FUND_RESTRICTION', ids.restriction, restriction, snapshot(), restriction.revision);
      else if (path.startsWith('fund-designations/')) setApproval('FUND_DESIGNATION', ids.designation, designation, { designation, fund: unrestricted }, designation.revision);
      else setApproval(String(body.kind), ids.movement, movement, { draft: movement, fund: unrestricted }, movement.revision);
      return send(approval, 201);
    }
    if (path === 'approvals/' + ids.approval + '/decision') { approval.status = String(body.decision); approval.decidedById = browserActor.id; return send(approval); }
    if (path.endsWith('/apply')) {
      approval.status = 'APPLIED'; if (['FUND_RELEASE', 'FUND_RESTRICTION', 'FUND_JOURNAL'].includes(approval.requestKind)) approval.appliedJournalId = ids.releaseJournal;
      return send(approval.appliedJournalId ? journal : { approvalRequestId: ids.approval, financialJournalCreated: false }, 201);
    }
    if (path.endsWith('/cancel')) return send({ ...movement, status: 'CANCELLED' });
    return route.fallback();
  });
  return { ...base, funds, unrestricted, restricted, conditional, restriction, designation, movement, source, metrics, reconciliation, approval: () => approval,
    writes, reads, failures, setApproval, setSourceKind: (kind: string) => { source.sourceKind = kind; } };
}
