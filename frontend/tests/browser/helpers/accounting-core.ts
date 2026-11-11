import type { Page } from '@playwright/test';
import { accounts as oldAccounts, browserActor, fiscalYear, reportPayload, setupAccountingBrowser } from './accounting-workspace';
import type { ApprovalDetail, CoreJournal, Draft } from '../../../src/features/accounting/core/types';

export const ids = { account: '10000000-0000-4000-8000-000000000001', income: '10000000-0000-4000-8000-000000000002', expense: '10000000-0000-4000-8000-000000000003', draft: '20000000-0000-4000-8000-000000000001', approval: '30000000-0000-4000-8000-000000000001', journal: '40000000-0000-4000-8000-000000000001', requester: '50000000-0000-4000-8000-000000000001' };
export const allCoreGrants = ['ACCOUNTING_REPORT', 'ACCOUNTING_COA_MANAGE', 'ACCOUNTING_JOURNAL_MANAGE', 'ACCOUNTING_JOURNAL_APPROVE', 'ACCOUNTING_JOURNAL_POST', 'ACCOUNTING_PERIOD_MANAGE'];
export async function setupCoreBrowser(page: Page, grants = allCoreGrants, options: { own?: boolean; approved?: boolean; closed?: boolean; postedAccount?: boolean } = {}) {
  const base = await setupAccountingBrowser(page, grants), calls: { method: string; path: string; query: URLSearchParams; body: Record<string, unknown> | null }[] = [];
  const accounts = oldAccounts.map((account, index) => ({ ...account, id: [ids.account, ids.income, ids.expense][index], _count: { lines: options.postedAccount ? 2 : 0 } }));
  const year = structuredClone(fiscalYear); if (options.closed) year.revFkAccPeriodFy[1].status = 'CLOSED';
  let draft: Draft = { id: ids.draft, draftNumber: 'DRAFT-CORE-32', journalType: 'MANUAL', sourceKind: 'MANUAL_JOURNAL', accountingDate: '2026-11-09', sourceReference: 'CORE-EVIDENCE-32', description: 'Synthetic independent review evidence', status: 'DRAFT', revision: 1, createdById: options.own ? browserActor.id : ids.requester, postedJournalId: null,
    lines: [{ accountId: ids.account, debit: '8000000.00', credit: '0.00' }, { accountId: ids.income, debit: '0.00', credit: '8000000.00' }] };
  let approval: ApprovalDetail = { id: ids.approval, requestKind: 'MANUAL_JOURNAL', sourceDocumentId: ids.draft, sourceVersion: 1, sourceDigest: 'synthetic-digest-v1', requestedById: draft.createdById, requestedAt: '2026-11-09T06:00:00Z', status: options.approved ? 'APPROVED' : 'PENDING', decidedById: options.approved ? ids.requester : null, decidedAt: null, decisionRemark: null, appliedJournalId: null,
    approvers: [{ approverUserId: browserActor.id }, { approverUserId: ids.requester }], history: [{ id: 'history-submit', action: 'SUBMIT', statusBefore: null, statusAfter: 'PENDING', actorId: draft.createdById, actionAt: '2026-11-09T06:00:00Z', sourceDigest: 'synthetic-digest-v1', remark: null }], historyLimit: 1000, requestPayload: null, source: draft };
  // Approved request must have an independent reviewer (different from requester).
  if (options.approved) approval.decidedById = options.own ? ids.requester : browserActor.id;
  const journal: CoreJournal = { id: ids.journal, journalNumber: 'JRN-CORE-32', journalType: 'MANUAL', accountingDate: '2026-11-09', postedAt: '2026-11-09T06:05:00Z', postedById: browserActor.id, accountingPeriodId: year.revFkAccPeriodFy[1].id, sourceKind: 'MANUAL_JOURNAL', sourceReference: 'CORE-EVIDENCE-32', sourceEventKey: 'MANUAL_JOURNAL:CORE-EVIDENCE-32', state: 'POSTED', descriptionSnapshot: 'Synthetic journal source', relatedJournalId: null, reversalOfJournalId: null, linkedJournals: [], bankTransaction: null,
    lines: draft.lines.map((line, index) => ({ ...line, id: `line-${index}`, lineNo: index + 1, accountCodeSnapshot: accounts[index].code, accountNameSnapshot: accounts[index].name, accountingFundId: null, bankAccountId: null })) };
  const state = { accounts, year, journal, get draft() { return draft; }, get approval() { return approval; }, replaceApproval: (value: Partial<ApprovalDetail>) => { approval = { ...approval, ...value }; } };
  await page.route('**/api/accounting/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname.replace('/api/accounting/', ''), method = request.method(), query = url.searchParams;
    const body = request.postData() ? request.postDataJSON() : null; calls.push({ method, path, query, body });
    const send = (json: unknown, status = 200) => route.fulfill({ json, status });
    if (method === 'GET') {
      if (path === 'coa') { const search = (query.get('search') ?? '').toLowerCase(), filtered = accounts.filter(row => `${row.code} ${row.name}`.toLowerCase().includes(search) && (!query.get('type') || row.accountType === query.get('type')) && (!query.get('active') || String(row.activeFlag) === query.get('active'))); const pageSize = Number(query.get('pageSize') ?? 25), number = Number(query.get('page') ?? 1); return send({ rows: filtered.slice((number - 1) * pageSize, number * pageSize), total: filtered.length, page: number, pageSize }); }
      if (path === 'periods/fiscal-years') return send([year]);
      if (path === 'journal-drafts') return send({ rows: [draft], total: 1, page: 1, pageSize: 25 });
      if (path === `journal-drafts/${ids.draft}`) return send(draft);
      if (path === 'approvals') return send({ rows: query.get('status') && query.get('status') !== approval.status ? [] : [approval], total: query.get('status') && query.get('status') !== approval.status ? 0 : 1, page: 1, pageSize: Number(query.get('pageSize') ?? 25) });
      if (path === `approvals/${ids.approval}`) return send({ ...approval, source: approval.requestKind === 'JOURNAL_REVERSAL' || ['REPORTING_POLICY', 'REPORT_SNAPSHOT', 'BANK_RECONCILIATION', 'PERIOD_CLOSE', 'PERIOD_REOPEN', 'YEAR_CLOSE', 'YEAR_REOPEN'].includes(approval.requestKind) ? approval.source : draft });
      if (path === 'reports' && query.get('view') === 'journals') return send({ ...reportPayload('journals'), rows: [{ id: ids.journal, journal: journal.journalNumber, date: journal.accountingDate, type: 'MANUAL', source: null, relatedJournal: null, debit: '8000000.00', credit: '8000000.00' }] });
      if (path === `journals/${ids.journal}`) return send(journal);
      if (path === 'general-ledger') return send({ rows: [{ ...journal.lines[0], runningBalance: '9000000.00', journal }], page: Number(query.get('page') ?? 1), pageSize: 25, total: 26, openingBalances: [{ accountId: ids.account, balance: '1000000.00' }], closingBalances: [{ accountId: ids.account, balance: '9000000.00' }], totalDebit: '8000000.00', totalCredit: '0.00' });
      if (path === 'trial-balance') return send({ rows: accounts.map((account, index) => ({ ...account, openingDebit: index === 0 ? '1000000.00' : '0.00', openingCredit: index === 1 ? '1000000.00' : '0.00', movementDebit: index === 0 ? '8000000.00' : '0.00', movementCredit: index === 1 ? '8000000.00' : '0.00', closingDebit: index === 0 ? '9000000.00' : '0.00', closingCredit: index === 1 ? '9000000.00' : '0.00' })), page: 1, pageSize: 25, total: accounts.length, asOf: query.get('to'), totalDebit: '9000000.00', totalCredit: '9000000.00', balanced: true });
      return route.fallback();
    }
    // All writes terminate here in synthetic responses. No network/database write occurs.
    if (path === 'coa' && method === 'POST') return send({ ...accounts[0], ...body, id: '60000000-0000-4000-8000-000000000001' }, 201);
    if (path.startsWith('coa/') && method === 'PATCH') return send({ ...accounts[0], ...body });
    if (path === 'journal-drafts' && method === 'POST' || path === `journal-drafts/${ids.draft}` && method === 'PATCH') { draft = { ...draft, ...body, revision: method === 'PATCH' ? draft.revision + 1 : 1, createdById: browserActor.id }; return send(draft, method === 'POST' ? 201 : 200); }
    if (path === 'approvals' && method === 'POST') { approval = { ...approval, requestedById: browserActor.id, requestKind: body.kind, sourceDocumentId: body.sourceDocumentId, status: 'PENDING', sourceVersion: draft.revision }; return send(approval, 201); }
    if (path === `approvals/${ids.approval}/decision` && method === 'POST') { approval = { ...approval, status: body.decision, decidedById: browserActor.id, decisionRemark: body.remark }; return send(approval); }
    if (path === `approvals/${ids.approval}/cancel` && method === 'POST') { approval = { ...approval, status: 'CANCELLED' }; return send(approval); }
    if (path === `approvals/${ids.approval}/post` && method === 'POST') { approval = { ...approval, status: 'APPLIED', appliedJournalId: ids.journal }; draft = { ...draft, status: 'POSTED', postedJournalId: ids.journal }; return send(journal, 201); }
    if ((path === 'periods' || path === 'periods/fiscal-years') && method === 'POST') return send({ id: '70000000-0000-4000-8000-000000000001', ...body, status: 'OPEN' }, 201);
    base.unhandled.push(`${method} ${path}`); return send({ message: 'Unsupported synthetic mutation' }, 405);
  });
  return { ...base, coreCalls: calls, state };
}
