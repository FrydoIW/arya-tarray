import type { Page } from '@playwright/test';
import type { ApprovalDetail } from '../../../src/features/accounting/core/types';
import type { Counterparty, DocumentDetail, DocumentInput, SettlementDetail, SettlementInput, Side } from '../../../src/features/accounting/apar/types';
import { accounts as basicAccounts, browserActor } from './accounting-workspace';
import { allCoreGrants, ids, setupCoreBrowser } from './accounting-core';

const uuid = (number: number) => '83000000-0000-4000-8000-' + String(number).padStart(12, '0');
export const aparIds = {
  party: uuid(1), bank: uuid(2), mutation: uuid(3), wrongBankRow: uuid(4), liability: uuid(5),
  receivable: uuid(6), reviewer: uuid(7), statement: uuid(8), postedPayment: uuid(9)
};
export const aparGrants = [...allCoreGrants, 'ACCOUNTING_AP_MANAGE', 'ACCOUNTING_AR_MANAGE', 'ACCOUNTING_SETTLEMENT_MATCH', 'RECON_TRANSACTION_INQUIRY'];
export const sourceDate = '2026-11-09';
export const routes = { ap: '/accounting/payables', ar: '/accounting/receivables' };
export const postedId = (side: Side, second = false) => uuid((side === 'ap' ? 20 : 30) + (second ? 1 : 0));
const toCents = (value: string) => {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, '0'));
};
const money = (value: bigint) => String(value / BigInt(100)) + '.' + String(value % BigInt(100)).padStart(2, '0');
const documentKind = (side: Side) => side === 'ap' ? 'PAYABLE' : 'RECEIVABLE';
const requestKind = (side: Side) => side === 'ap' ? 'AP_INVOICE' : 'AR_DOCUMENT';

export async function setupAparBrowser(page: Page, grants = aparGrants) {
  const core = await setupCoreBrowser(page, grants);
  let actor = { ...browserActor, menuCodes: grants };
  let nextId = 100;
  const party: Counterparty = {
    id: aparIds.party, counterpartyCode: 'SHARED-33', displayName: 'Fixture Vendor and Debtor',
    counterpartyType: 'BOTH', memberId: null, activeFlag: true
  };
  const bank = { id: aparIds.bank, accountName: 'Fixture IDR bank', currencyCode: 'IDR' };
  const accounts = [
    ...core.state.accounts,
    { ...basicAccounts[0], id: aparIds.liability, code: '2100', name: 'Payables control', accountType: 'LIABILITY', normalBalance: 'CREDIT' },
    { ...basicAccounts[0], id: aparIds.receivable, code: '1200', name: 'Receivables control' }
  ];
  const parties = new Map([[party.id, party]]);
  const documents = new Map<string, DocumentDetail>();
  const settlements = new Map<string, SettlementDetail>();
  const approvals = new Map<string, ApprovalDetail>();
  const calls: { path: string; method: string; query: URLSearchParams; body: Record<string, unknown> }[] = [];
  const failures = new Map<string, { status: number; message: string }>();
  const getDocument = (id: string) => documents.get(id)!;
  const getSettlement = (id: string) => settlements.get(id)!;
  const getApproval = (id: string) => approvals.get(id)!;

  function makeDocument(side: Side, id: string, input: DocumentInput, recognized: boolean) {
    const total = money(input.lines.reduce((sum, line) => sum + toCents(line.amount), BigInt(0)));
    const row: DocumentDetail = {
      ...input, id, documentKind: documentKind(side), createdById: actor.id, revision: 1,
      status: recognized ? 'RECOGNIZED' : 'DRAFT', originalAmount: total, outstanding: recognized ? total : '0.00',
      recognitionJournalId: recognized ? ids.journal : null, financialState: recognized ? 'POSTED' : 'UNPOSTED',
      relFkAccDocCounterparty: parties.get(input.counterpartyId) ?? party, controlAccount: { code: side === 'ap' ? '2100' : '1200', name: 'Fixture control' },
      lines: input.lines.map((line, index) => ({ ...line, id: uuid(nextId++), lineNo: index + 1 })),
      allocations: [], adjustments: [], approvals: [], relatedRecordsLimit: 500
    };
    documents.set(id, row);
    return row;
  }
  for (const side of ['ap', 'ar'] as const) {
    for (const second of [false, true]) {
      makeDocument(side, postedId(side, second), {
        accrualDraftId: null, documentNumber: side.toUpperCase() + (second ? '-002' : '-001'), counterpartyId: party.id,
        controlAccountId: side === 'ap' ? aparIds.liability : aparIds.receivable, documentDate: sourceDate,
        accountingDate: sourceDate, dueDate: sourceDate, sourceReference: 'FIXTURE-33', recognitionBasis: 'Evidence of a delivered and accepted contract.',
        lines: [{ accountingAccountId: side === 'ap' ? ids.expense : ids.income, description: 'Delivered service',
          amount: second ? '2000000.00' : side === 'ap' ? '8000000.00' : '10000000.00', accountingFundId: null, eventCampaignId: null }]
      }, true);
    }
  }
  function makeSettlement(side: Side, id: string, input: SettlementInput): SettlementDetail {
    const row: SettlementDetail = {
      ...input, id, settlementKind: documentKind(side), status: 'DRAFT', revision: 1, createdById: actor.id,
      postingJournalId: null, reconciliationState: 'DRAFT', bankAccount: bank, bankGlAccount: { id: ids.account, code: '1110', name: 'Bank GL' },
      relFkAccSettlementCp: parties.get(input.counterpartyId) ?? party, relFkAccSettlementBank: null,
      allocations: input.allocations.map(item => ({ ...item, id: uuid(nextId++) }))
    };
    settlements.set(id, row);
    return row;
  }
  const awaiting = makeSettlement('ap', aparIds.postedPayment, {
    settlementReference: 'BANK-AWAITING-33', sourceReference: 'PAY-ADVICE-33', counterpartyId: party.id,
    bankAccountId: bank.id, bankGlAccountId: ids.account, settlementDate: sourceDate, amount: '3000000.00',
    bankTransactionId: null, allocations: [{ accountingDocumentId: postedId('ap'), allocatedAmount: '3000000.00' }]
  });
  Object.assign(awaiting, { status: 'POSTED', postingJournalId: ids.journal, reconciliationState: 'AWAITING_STATEMENT' });

  function createApproval(kind: string, id: string, version: number, requestPayload: unknown = null) {
    const reviewer = actor.id === aparIds.reviewer ? browserActor.id : aparIds.reviewer;
    const row: ApprovalDetail = {
      id: uuid(nextId++), requestKind: kind, sourceDocumentId: id, sourceVersion: version,
      sourceDigest: 'synthetic-apar-digest-' + version, requestedById: actor.id, requestedAt: sourceDate,
      status: 'PENDING', decidedById: null, decidedAt: null, decisionRemark: null, appliedJournalId: null,
      approvers: [{ approverUserId: reviewer }], history: [], historyLimit: 1000, source: null, requestPayload
    };
    approvals.set(row.id, row);
    documents.get(id)?.approvals.push(row);
    return row;
  }
  function approvalView(row: ApprovalDetail) {
    if (row.requestKind === 'JOURNAL_REVERSAL') return row;
    const document = documents.get(row.sourceDocumentId);
    const settlement = settlements.get(row.sourceDocumentId);
    return {
      ...row,
      source: document ? { document: { ...document, revFkAccDocLineDoc: document.lines }, adjustment: row.requestPayload }
        : settlement ? { settlement: { ...settlement, revFkAccAllocationSettlement: settlement.allocations } } : null
    };
  }

  await page.route('**/api/auth/me', route => route.fulfill({ json: actor }));
  await page.route('**/api/reconciliation/transaction-inquiry/workspace?*', route => {
    const query = new URL(route.request().url()).searchParams;
    calls.push({ path: 'bank-inquiry', method: 'GET', query, body: {} });
    return route.fulfill({ json: {
      transactions: [
        { id: aparIds.mutation, referenceNo: 'IMPORTED-DEBIT-33', sourceType: 'BANK', transactionDate: sourceDate, originalAmount: '-3000000.00', status: 'CHECK', bankAccount: bank },
        { id: aparIds.wrongBankRow, referenceNo: 'WRONG-DIRECTION-33', sourceType: 'BANK', transactionDate: sourceDate, originalAmount: '3000000.00', status: 'CHECK', bankAccount: bank }
      ], pagination: { page: 1, pageSize: 25, total: 2, totalPages: 1 }
    } });
  });
  await page.route('**/api/reconciliation/transaction-inquiry/' + aparIds.mutation, route => {
    calls.push({ path: 'bank-inquiry-detail', method: route.request().method(), query: new URLSearchParams(), body: {} });
    return route.fulfill({ json: { history: [
      { id: uuid(92), fieldName: 'accounting_settlement_active', oldValue: null, newValue: aparIds.postedPayment,
        remark: 'Recorded exact imported debit evidence.', changedAt: sourceDate, changedBy: { id: actor.id, fullName: actor.fullName } },
      { id: uuid(93), fieldName: 'accounting_settlement_active', oldValue: null, newValue: uuid(94),
        remark: 'Unrelated settlement evidence.', changedAt: sourceDate, changedBy: { id: actor.id, fullName: actor.fullName } }
    ] } });
  });
  await page.route('**/api/accounting/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const query = url.searchParams;
    const method = request.method();
    const path = url.pathname.replace('/api/accounting/', '');
    const body = (request.postData() ? request.postDataJSON() : {}) as Record<string, unknown>;
    const send = (json: unknown, status = 200) => route.fulfill({ json, status });
    calls.push({ path, method, query, body });
    const failure = failures.get(method + ' ' + path);
    if (failure) return send({ message: failure.message }, failure.status);
    const pageSize = Number(query.get('pageSize') ?? 25);
    const pageNo = Number(query.get('page') ?? 1);
    const paged = <T>(rows: T[]) => ({ rows: rows.slice((pageNo - 1) * pageSize, pageNo * pageSize), total: rows.length, page: pageNo, pageSize });
    if (path === 'coa' && method === 'GET') return send(paged(accounts));
    if (path === 'options' && method === 'GET') return send({ banks: [{ id: bank.id, label: bank.accountName }], campaigns: [], events: [], members: [] });
    if (path === 'funds' && method === 'GET') return send(paged([]));
    const [side, group, id, action] = path.split('/');
    if (side === 'counterparties') {
      if (method === 'GET') return send(group ? parties.get(group) : paged([...parties.values()].filter(row => row.displayName.includes(query.get('search') ?? ''))));
      const row = (group ? { ...parties.get(group), ...body } : { ...body, id: uuid(nextId++) }) as Counterparty;
      parties.set(row.id, row);
      return send(row, group ? 200 : 201);
    }
    if (side === 'approvals') {
      if (!group && method === 'GET') return send(paged([...approvals.values()].filter(row => !query.get('status') || row.status === query.get('status'))));
      const row = approvals.get(group);
      if (!row) return route.fallback();
      if (method === 'GET') return send(approvalView(row));
      if (id === 'decision') {
        if (row.requestedById === actor.id || !actor.menuCodes.includes('ACCOUNTING_JOURNAL_APPROVE')) return send({ message: 'Independent reviewer required.' }, 403);
        Object.assign(row, { status: body.decision, decidedById: actor.id, decisionRemark: body.remark, decidedAt: sourceDate });
        return send(approvalView(row));
      }
      if (id === 'post') { Object.assign(row, { status: 'APPLIED', appliedJournalId: ids.journal }); return send(core.state.journal, 201); }
      if (id === 'cancel') { row.status = 'CANCELLED'; return send(approvalView(row)); }
    }
    if (side !== 'ap' && side !== 'ar') return route.fallback();
    const selectRows = <T extends { counterpartyId: string; status: string }>(rows: T[]) => rows.filter(row =>
      (!query.get('counterpartyId') || row.counterpartyId === query.get('counterpartyId')) && (!query.get('status') || row.status === query.get('status')));
    if ((group === 'outstanding' || group === 'aging') && method === 'GET') {
      const rows = selectRows([...documents.values()].filter(row => row.documentKind === documentKind(side)
        && row.financialState === 'POSTED' && row.outstanding !== '0.00')).map(row => ({
        ...row, adjustmentAmount: '0.00', settledAmount: money(toCents(row.originalAmount) - toCents(row.outstanding)), agingBucket: 'CURRENT'
      }));
      const total = money(rows.reduce((sum, row) => sum + toCents(row.outstanding), BigInt(0)));
      return send({ ...paged(rows), asOf: query.get('asOf'), counterpartyId: query.get('counterpartyId') ?? undefined,
        outstanding: total, negativeBalanceCount: 0, aging: { current: total, days1To30: '0.00', days31To60: '0.00', days61To90: '0.00', over90: '0.00' } });
    }
    if (group !== 'documents' && group !== 'settlements') return send({ message: 'Unexpected synthetic route' }, 404);
    const isDocument = group === 'documents';
    if (method === 'GET') {
      if (id) {
        const row = isDocument ? documents.get(id) : settlements.get(id);
        return row ? send(row) : send({ message: 'Source not found.' }, 404);
      }
      return isDocument ? send(paged(selectRows([...documents.values()].filter(row =>
        row.documentKind === documentKind(side) && row.documentNumber.includes(query.get('search') ?? '')))))
        : send(paged(selectRows([...settlements.values()].filter(row => row.settlementKind === documentKind(side)))));
    }
    if (!id || method === 'PATCH') {
      const previous = isDocument ? documents.get(id) : settlements.get(id);
      const key = id || uuid(nextId++);
      const row = isDocument ? makeDocument(side, key, body as unknown as DocumentInput, false)
        : makeSettlement(side, key, body as unknown as SettlementInput);
      if (previous) row.revision = previous.revision + 1;
      return send(row, previous ? 200 : 201);
    }
    const row = isDocument ? getDocument(id) : getSettlement(id);
    if (action === 'submit') return send(createApproval(isDocument ? requestKind(side) : 'SETTLEMENT', id, Number(body.expectedRevision)), 201);
    if (action === 'adjustments') return send(createApproval('AR_ADJUSTMENT', id, 1, body), 201);
    if (action === 'reversal-requests') {
      const approval = createApproval('JOURNAL_REVERSAL', ids.journal, 1, body);
      approval.source = { original: { ...core.state.journal, sourceKind: side.toUpperCase() + (isDocument ? '_DOCUMENT' : '_SETTLEMENT'), sourceReference: id }, payload: body };
      return send(approval, 201);
    }
    if (action === 'cancel') { row.status = 'VOID'; return send({ id, status: 'VOID', financialJournalCreated: false }); }
    if (action === 'post') {
      const approval = getApproval(String(body.approvalRequestId));
      if (!actor.menuCodes.includes('ACCOUNTING_JOURNAL_POST')) return send({ message: 'Post grant required.' }, 403);
      if (approval.status !== 'APPROVED' || approval.sourceDocumentId !== row.id) return send({ message: 'Current independent approval required.' }, 409);
      Object.assign(approval, { status: 'APPLIED', appliedJournalId: ids.journal });
      if (isDocument) Object.assign(row, { status: 'RECOGNIZED', financialState: 'POSTED', outstanding: getDocument(id).originalAmount, recognitionJournalId: ids.journal });
      else {
        const settlement = getSettlement(id);
        Object.assign(settlement, { status: 'POSTED', reconciliationState: 'AWAITING_STATEMENT', postingJournalId: ids.journal });
        for (const allocation of settlement.allocations) {
          const doc = getDocument(allocation.accountingDocumentId);
          doc.outstanding = money(toCents(doc.outstanding) - toCents(allocation.allocatedAmount));
          doc.allocations.push({ ...allocation, relFkAccAllocationSettlement: settlement });
        }
      }
      return send(core.state.journal, 201);
    }
    if (action === 'match') {
      if (body.bankTransactionId !== aparIds.mutation) return send({ message: 'Imported transaction is ineligible.' }, 409);
      const settlement = getSettlement(id);
      Object.assign(settlement, { bankTransactionId: aparIds.mutation, reconciliationState: 'MATCHED_PENDING_FINALIZATION',
        relFkAccSettlementBank: { id: aparIds.mutation, referenceNo: 'IMPORTED-DEBIT-33', transactionDate: sourceDate,
          originalAmount: '-3000000.00', status: 'CHECK', statementUpload: { id: aparIds.statement, status: 'CHECK', fileName: 'fixture-statement' } } });
      return send(settlement);
    }
    return send({ message: 'Unhandled synthetic AP/AR action.' }, 405);
  });
  return { ...core, calls, failures, documents, settlements, approvals, parties,
    setActor: (id: string, menuCodes = grants) => { actor = { ...actor, id, menuCodes }; },
    createApproval
  };
}
