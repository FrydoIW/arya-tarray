import type { Page } from '@playwright/test';
import { allCoreGrants, ids as core, setupCoreBrowser } from './accounting-core';
import { browserActor } from './accounting-workspace';
import type { ApprovalDetail, CoreJournal } from '../../../src/features/accounting/core/types';
import type { AssetDetail, AssetJournal, AssetSnapshot, Category, ChangeDraft, ChangeInput, DepreciationSnapshot, RunDetail, RunPreview, RunRow } from '../../../src/features/accounting/assets/types';

const uuid = (n: number) => '35000000-0000-4000-8000-' + String(n).padStart(12, '0');
export const ids = {
  asset: uuid(1), second: uuid(2), category: uuid(3), accum: uuid(4), gain: uuid(5), loss: uuid(6), clearing: uuid(7),
  allowance: uuid(8), run: uuid(9), approval: uuid(10), change: uuid(11), sourceLine: uuid(12), ap: uuid(13),
  proceedsJournal: uuid(14), proceedsLine: uuid(15), depJournal: uuid(16), disposalJournal: uuid(17), journal: core.journal,
  cost: core.account, expense: core.expense, impairment: uuid(18), ar: uuid(19),
};
type Options = { grants?: string[]; draft?: boolean; approved?: boolean; own?: boolean; closed?: boolean; stale?: boolean; noPolicy?: boolean; delay?: number };
export const assetGrants = allCoreGrants;

export async function setupAssets(page: Page, options: Options = {}) {
  const base = await setupCoreBrowser(page, options.grants ?? assetGrants, { closed: options.closed });
  const { year } = base.state;
  const period = year.revFkAccPeriodFy[1];
  const accounts = base.state.accounts;
  accounts.push(
    { ...accounts[0], id: ids.accum, code: '1290', name: 'Synthetic accumulated depreciation', normalBalance: 'CREDIT', contraFlag: true },
    { ...accounts[1], id: ids.gain, code: '4190', name: 'Synthetic disposal gain' },
    { ...accounts[2], id: ids.loss, code: '6190', name: 'Synthetic disposal loss' },
    { ...accounts[1], id: ids.clearing, code: '2190', name: 'Synthetic disposal clearing', accountType: 'LIABILITY' },
    { ...accounts[0], id: ids.allowance, code: '1295', name: 'Synthetic impairment allowance', normalBalance: 'CREDIT', contraFlag: true },
    { ...accounts[2], id: ids.impairment, code: '6195', name: 'Synthetic impairment expense' },
  );
  const category: Category = {
    id: ids.category, revision: 1, categoryCode: 'EQUIP', categoryName: 'Synthetic equipment', assetAccountId: ids.cost,
    accumulatedDepreciationAccountId: ids.accum, depreciationExpenseAccountId: ids.expense, gainAccountId: ids.gain, lossAccountId: ids.loss,
    disposalClearingAccountId: ids.clearing, impairmentExpenseAccountId: ids.impairment, impairmentAllowanceAccountId: ids.allowance,
    defaultUsefulLifeMonths: 24, defaultMethod: 'STRAIGHT_LINE', activeFlag: true,
    policy: options.noPolicy ? null : { policyReference: 'Synthetic board policy evidence', capitalizationThreshold: '1000000.00',
      partialMonthPolicy: 'FULL_MONTH', impairmentEnabled: true, impairmentPolicyReference: 'Synthetic impairment policy evidence' },
  };
  const acquisition: CoreJournal = { ...base.state.journal, sourceKind: 'AP_DOCUMENT', journalNumber: 'AP-JOURNAL-35',
    lines: [{ ...base.state.journal.lines[0], id: ids.sourceLine, debit: '12000000.00', credit: '0.00' }, base.state.journal.lines[1]] };
  const consideration: CoreJournal = { ...acquisition, id: ids.proceedsJournal, sourceKind: 'AR_DOCUMENT', sourceReference: ids.ar, journalNumber: 'AR-CLEARING-35',
    lines: [{ ...acquisition.lines[1], id: ids.proceedsLine, accountId: ids.clearing, debit: '0.00', credit: '5000000.01' }] };
  const depJournal: AssetJournal = { ...acquisition, id: ids.depJournal, journalNumber: 'DEP-JOURNAL-35', accountingDate: '2026-11-30',
    journalType: 'DEPRECIATION', sourceKind: 'DEPRECIATION_RUN', lines: [
      { ...acquisition.lines[0], id: uuid(30), accountId: ids.expense, accountCodeSnapshot: '5100', accountNameSnapshot: 'Depreciation', debit: '500000.00', credit: '0.00' },
      { ...acquisition.lines[0], id: uuid(31), accountId: ids.accum, accountCodeSnapshot: '1290', accountNameSnapshot: 'Accumulated', debit: '0.00', credit: '500000.00' },
    ], revFkAccJournalReversal: null };
  const disposalJournal: AssetJournal = { ...depJournal, id: ids.disposalJournal, journalNumber: 'DISPOSAL-JOURNAL-35', sourceKind: 'ASSET_JOURNAL', journalType: 'ADJUSTMENT',
    lines: [{ ...depJournal.lines[1], id: uuid(32), accountId: ids.gain, accountCodeSnapshot: '4190', accountNameSnapshot: 'Synthetic disposal gain', credit: '800000.01' }] };
  const asset: AssetDetail = {
    id: ids.asset, status: options.draft ? 'DRAFT' : 'ACTIVE', revision: 1, createdById: browserActor.id, updatedById: browserActor.id,
    assetNumber: 'ASSET-35', assetName: 'Synthetic camera', description: 'Synthetic acquisition example', location: 'Synthetic storage',
    custodianId: null, acquiredOn: '2026-11-02', inServiceOn: '2026-11-09', depreciationStartOn: '2026-11-01', usefulLifeMonths: 24,
    residualValue: '0.00', acquisitionCost: '12000000.00', depreciationMethod: 'STRAIGHT_LINE',
    assetCategoryId: category.id, acquisitionJournalLineId: ids.sourceLine, sourceDocumentId: ids.ap, vendorId: null,
    createdAt: '2026-11-09', updatedAt: '2026-11-09', disposedOn: null, relatedLimit: 500,
    policySnapshot: { ...category.policy, supportingEvidence: 'Synthetic purchase acceptance evidence' },
    policyStatus: options.noPolicy ? 'PENDING_POLICY' : options.draft ? 'PROVIDED_FOR_REVIEW' : 'REVIEWED',
    relFkAccFixedAssetCat: category, relFkAccFixedAssetSource: { ...acquisition.lines[0], journalId: ids.journal, journal: acquisition },
    relFkAccFixedAssetDisposal: null, revFkAccDepRunAssetAsset: [], changes: [], approvalHistory: [],
    payments: [], grossCost: '12000000.00', accumulatedDepreciation: '8000000.00', impairment: '0.00',
    carryingAmount: '4000000.00', depreciationState: options.draft ? 'NOT_AUTHORIZED' : 'DEPRECIABLE',
  };
  const second = { ...asset, id: ids.second, assetNumber: 'ASSET-36', assetName: 'Synthetic projector', status: 'ACTIVE' };
  const snapshot: AssetSnapshot = {
    id: asset.id, revision: '1', status: asset.status, code: asset.assetNumber, name: asset.assetName, category: asset.assetCategoryId,
    source: asset.acquisitionJournalLineId, acquired: asset.acquiredOn, available: asset.inServiceOn, start: asset.depreciationStartOn,
    life: '24', residual: asset.residualValue, cost: '1200000000', accumulated: '800000000', impairment: '0', policy: asset.policySnapshot,
  };
  const quote: DepreciationSnapshot = { asset: snapshot, periodStart: '2026-11-01', periodEnd: '2026-11-30',
    prospectiveBasis: '400000000', expectedBefore: '0', amount: '500000.00' };
  const run: RunDetail = {
    id: ids.run, createdById: browserActor.id, revision: options.stale ? 2 : 1, status: 'DRAFT',
    runReference: 'DEPR-35', accountingPeriodId: period.id, runDate: '2026-11-30', postingJournalId: null,
    relFkAccDepRunPeriod: period, relFkAccDepRunJournal: null,
    revFkAccDepRunAssetRun: [{ id: uuid(20), fixedAssetId: ids.asset, activePeriodId: period.id, plannedAmount: quote.amount,
      assetSnapshot: quote, expenseJournalLineId: null, accumulatedJournalLineId: null }],
  };
  let approval: ApprovalDetail;
  function makeApproval(kind: string) {
    const activation = kind === 'ASSET_ACTIVATE';
    const sourceDocumentId = activation ? ids.asset : ids.run;
    const runSnapshot = { id: ids.run, period: period.id, date: '2026-11-30', revision: '1', reference: run.runReference,
      assets: [{ id: asset.id, amount: quote.amount, snapshot: quote, current: snapshot }] };
    return {
      id: ids.approval, requestKind: kind, sourceDocumentId, sourceVersion: 1, sourceDigest: 'synthetic-asset-digest-35',
      requestedById: options.own ? browserActor.id : core.requester, requestedAt: '2026-11-09', status: options.approved ? 'APPROVED' : 'PENDING',
      decidedById: options.approved ? (options.own ? core.requester : browserActor.id) : null, decidedAt: null,
      decisionRemark: null, appliedJournalId: null, approvers: [{ approverUserId: browserActor.id }, { approverUserId: core.requester }],
      history: [], historyLimit: 1000,
      source: activation ? { id: asset.id, revision: asset.revision, relFkAccFixedAssetSource: asset.relFkAccFixedAssetSource } : run,
      requestPayload: { snapshot: activation ? snapshot : runSnapshot },
    } satisfies ApprovalDetail;
  }
  approval = makeApproval('DEPRECIATION_RUN');
  let change: ChangeDraft | null = null;
  function storeChange(command: ChangeInput) {
    const draft: ChangeDraft = { id: ids.change, revision: 1, status: 'DRAFT', createdById: browserActor.id, draftNumber: 'ASSET-CHANGE-35',
      sourceKind: ['ESTIMATE', 'ADDITIONAL', 'CORRECTION', 'DEACTIVATE'].includes(command.action) ? 'ASSET_CHANGE' : 'ASSET_JOURNAL',
      fixedAssetId: ids.asset, assetMetadata: command, accountingDate: command.effectiveDate, postedJournalId: null, assetSourceLineId: null, assetCostLineId: null };
    change = draft;
    asset.changes.push({ ...draft, postedJournal: null, assetSourceLine: null, assetCostLine: null });
    return draft;
  }
  function setChangeApproval(command: ChangeInput) {
    const draft = storeChange(command);
    approval = { ...makeApproval(draft.sourceKind), sourceDocumentId: draft.id, source: { draft, command, asset },
      requestPayload: { snapshot: { id: draft.id, revision: '1', status: draft.status, command, asset: snapshot, sourceEvidence: [] } } };
  }
  let convention = 'FULL_MONTH';
  const writes: { path: string; method: string; body: Record<string, unknown> }[] = [];
  const reads: { path: string; query: URLSearchParams }[] = [];
  const failures = new Map<string, { status: number; message: string }>();
  const reconciliation = { reconciled: false, basis: 'Synthetic full-scope register versus posted GL', rows: [
    { role: 'COST', accountId: ids.cost, register: '12000000.00', generalLedger: '13000000.00', variance: '-1000000.00', reconciled: false },
  ] };
  const list = <T>(rows: T[]) => ({ rows, page: 1, pageSize: 25, total: rows.length });
  const runHeader: RunRow = { id: run.id, status: run.status, revision: run.revision, createdById: run.createdById, runReference: run.runReference,
    runDate: run.runDate, accountingPeriodId: run.accountingPeriodId, postingJournalId: null };
  await page.route('**/api/accounting/**', async route => {
    const request = route.request(), method = request.method();
    const url = new URL(request.url()), path = url.pathname.replace('/api/accounting/', ''), query = url.searchParams;
    const send = (json: unknown, status = 200) => route.fulfill({ json, status });
    const fail = failures.get(path);
    if (method === 'GET') {
      reads.push({ path, query });
      if (fail) return send({ message: fail.message }, fail.status);
      if (path === 'assets') return send(list([asset, second].filter(row => (!query.get('status') || row.status === query.get('status')) &&
        (!query.get('categoryId') || row.assetCategoryId === query.get('categoryId')) &&
        (!query.get('search') || (row.assetNumber + row.assetName).toLowerCase().includes(query.get('search')?.toLowerCase() ?? '')))));
      if (path === 'asset-categories') return send(list([category]));
      if (path === 'asset-categories/' + ids.category) return send(category);
      if (path === 'assets/' + ids.asset) return send(asset);
      if (path === 'assets/' + ids.second) return send(second);
      if (path === 'assets/' + ids.asset + '/journals') return send({ assetId: ids.asset, limit: 500, rows: [acquisition, depJournal] });
      if (path === 'assets/reconciliation') return send(reconciliation);
      if (path === 'asset-changes/' + ids.change && change) return send({ draft: change, command: change.assetMetadata, asset });
      if (path === 'depreciation-runs') return send(list([{ ...runHeader, status: run.status }]));
      if (path === 'depreciation-runs/' + ids.run) return send(run);
      if (path === 'journals/' + ids.journal) return send(acquisition);
      if (path === 'journals/' + ids.proceedsJournal) return send(consideration);
      if (path === 'journals/' + ids.depJournal) return send({ ...acquisition, ...depJournal });
      if (path === 'approvals/' + ids.approval) return send(approval);
      if (path === 'approvals') return send(list([approval]));
      return route.fallback();
    }
    const body = request.postDataJSON();
    writes.push({ path, method, body });
    if (fail) return send({ message: fail.message }, fail.status);
    if (options.delay) await new Promise(resolve => setTimeout(resolve, options.delay));
    if (path === 'asset-categories' || path === 'asset-categories/' + ids.category) {
      Object.assign(category, body); return send(category, 201);
    }
    if (path === 'assets') { Object.assign(asset, { ...body, status: 'DRAFT' }); return send(asset, 201); }
    if (path === 'depreciation-runs/preview') {
      if (asset.status === 'DISPOSED') return send({ message: 'Only an authorized active unreversed asset can be depreciated.' }, 409);
      const current = { ...quote, asset: { ...snapshot, policy: { ...snapshot.policy, partialMonthPolicy: convention } } };
      return send({ period, rows: [{ assetId: asset.id, amount: current.amount, snapshot: current }], postingAutomatic: false });
    }
    if (path === 'depreciation-runs') return send(run, 201);
    if (path === 'depreciation-runs/' + ids.run + '/submit' || path === 'assets/' + ids.asset + '/submit') {
      approval = makeApproval(path.startsWith('assets') ? 'ASSET_ACTIVATE' : 'DEPRECIATION_RUN'); return send(approval, 201);
    }
    if (path === 'approvals/' + ids.approval + '/decision') {
      approval.status = body.decision; approval.decidedById = browserActor.id; return send(approval);
    }
    if (path === 'assets/' + ids.asset + '/activate') {
      asset.status = 'ACTIVE'; approval.status = 'APPLIED'; return send({ assetId: asset.id, financialJournalCreated: false }, 201);
    }
    if (path === 'depreciation-runs/' + ids.run + '/post') {
      run.status = 'POSTED'; run.postingJournalId = depJournal.id; run.relFkAccDepRunJournal = depJournal;
      run.revFkAccDepRunAssetRun[0].expenseJournalLineId = depJournal.lines[0].id;
      run.revFkAccDepRunAssetRun[0].accumulatedJournalLineId = depJournal.lines[1].id;
      approval.status = 'APPLIED'; approval.appliedJournalId = depJournal.id; return send(depJournal, 201);
    }
    if (path === 'assets/' + ids.asset + '/changes') {
      const draft = storeChange(body);
      return send({ ...draft, policyStatus: options.noPolicy ? 'PENDING_POLICY' : 'READY_FOR_INDEPENDENT_REVIEW',
        policyReason: options.noPolicy ? 'PENDING POLICY: adopted impairment policy and explicit assessment are required.' : undefined }, 201);
    }
    if (path === 'asset-changes/' + ids.change + '/post' && change) {
      const financial = change.sourceKind === 'ASSET_JOURNAL';
      change.status = financial ? 'POSTED' : 'APPLIED';
      approval.status = 'APPLIED';
      if (!financial) return send({ financialJournalCreated: false }, 201);
      approval.appliedJournalId = disposalJournal.id;
      change.postedJournalId = disposalJournal.id;
      asset.changes[0] = { ...asset.changes[0], ...change, postedJournal: disposalJournal };
      return send(disposalJournal, 201);
    }
    return route.fallback();
  });
  return { ...base, ids, asset, run, category, period, writes, reads, failures, disposalJournal, reconciliation, setChangeApproval,
    setConvention: (value: string) => { convention = value; },
    setApprovalKind: (kind: string) => { approval = makeApproval(kind); } };
}
