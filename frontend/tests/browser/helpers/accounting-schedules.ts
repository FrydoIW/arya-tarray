import type { Page } from '@playwright/test';
import { allCoreGrants, ids as core, setupCoreBrowser } from './accounting-core';
import { browserActor, fiscalYear } from './accounting-workspace';
import type { ApprovalDetail } from '../../../src/features/accounting/core/types';
import type { Accrual, Schedule, SchedulePeriod } from '../../../src/features/accounting/schedules/types';

const uuid = (n: number) => '34000000-0000-4000-8000-' + String(n).padStart(12, '0');
export const ids = {
  expense: uuid(1), income: uuid(2), prepaid: uuid(3), deferred: uuid(4), liability: uuid(5), asset: uuid(6),
  ap: uuid(7), ar: uuid(8), setup: uuid(9), accrualApproval: uuid(10), periodApproval: uuid(11), reversal: uuid(12),
  adjustment: uuid(13), apControl: uuid(14), vendor: uuid(15), sourceLine: uuid(16), recognition: uuid(17),
  requester: core.requester, journal: core.journal, expenseAccount: core.expense, incomeAccount: core.income,
  november: fiscalYear.revFkAccPeriodFy[1].id, december: fiscalYear.revFkAccPeriodFy[2].id,
};
export const grants = [...allCoreGrants, 'ACCOUNTING_AP_MANAGE', 'ACCOUNTING_AR_MANAGE'];
const accountingDate = '2026-11-09';
const postedJournal = { id: ids.journal, journalNumber: 'JRN-SYNTHETIC-34', sourceKind: 'AP_DOCUMENT', accountingDate, revFkAccJournalReversal: null };
type Options = { grants?: string[]; draft?: boolean; approved?: boolean; ownApproval?: boolean; stale?: boolean; closed?: boolean; delay?: number };

export async function setupSchedules(page: Page, options: Options = {}) {
  const base = await setupCoreBrowser(page, options.grants ?? grants, { closed: options.closed });
  const liability = { ...base.state.accounts[0], id: ids.liability, code: '2150', name: 'Accrued liabilities', accountType: 'LIABILITY' as const, normalBalance: 'CREDIT' as const };
  base.state.accounts.push(liability, { ...liability, id: ids.apControl, code: '2110', name: 'AP control' },
    { ...base.state.accounts[0], id: ids.asset, code: '1250', name: 'Accrued assets' });
  const { journal } = base.state;
  journal.lines[0] = { ...journal.lines[0], id: ids.sourceLine, accountId: ids.asset };
  journal.lines[1] = { ...journal.lines[1], id: uuid(40), accountId: ids.liability };
  const makeAccrual = (expense: boolean): Accrual => {
    const metadata = {
      kind: expense ? 'ACCRUED_EXPENSE' as const : 'ACCRUED_INCOME' as const, serviceStart: '2026-11-01', serviceEnd: '2026-11-30',
      supportingEvidence: expense ? 'Synthetic approved service acceptance' : 'Synthetic earned income evidence',
      policyReference: 'Synthetic policy reference 34', recognitionBasis: 'Synthetic earned right to recognition',
      scheduledReversalOn: expense ? '2026-11-18' : null,
    };
    const draft = expense && options.draft;
    return {
      id: expense ? ids.expense : ids.income, revision: options.stale ? 2 : 1, createdById: browserActor.id, status: draft ? 'DRAFT' : 'POSTED',
      sourceReference: expense ? 'EXP-34-SYNTH' : 'INC-34-SYNTH', accountingDate, accrualMetadata: metadata, metadata,
      postedJournalId: draft ? null : ids.journal, postedJournal: draft ? null : postedJournal,
      recognition: { id: uuid(20), accountId: expense ? ids.expenseAccount : ids.incomeAccount, debit: expense ? '8000000.00' : '0.00', credit: expense ? '0.00' : '8000000.00', counterpartyId: ids.vendor },
      balance: { id: uuid(21), accountId: expense ? ids.liability : ids.asset, debit: expense ? '0.00' : '8000000.00', credit: expense ? '8000000.00' : '0.00', counterpartyId: ids.vendor },
      originalAmount: '8000000.00', recognized: draft ? '0.00' : '8000000.00', cleared: draft ? '0.00' : '3000000.00', remaining: draft ? '0.00' : '5000000.00',
      reconciliation: draft ? 'UNPOSTED' : 'OUTSTANDING', relatedRecordsLimit: 240, adjustments: [], approvalHistory: [],
      controlReconciliation: { generalLedger: '5000000.00', subledger: '5000000.00', reconciled: true, variance: '0.00' },
      clearingDocuments: draft ? [] : [{ id: expense ? ids.ap : ids.ar, documentKind: expense ? 'PAYABLE' : 'RECEIVABLE', documentNumber: expense ? 'AP-SYNTHETIC-34' : 'AR-SYNTHETIC-34', recognitionJournalId: ids.journal, status: 'RECOGNIZED' }],
    };
  };
  const expense = makeAccrual(true), income = makeAccrual(false);
  const makeSchedule = (prepaid: boolean): Schedule => {
    const id = prepaid ? ids.prepaid : ids.deferred;
    return {
      id, revision: 1, createdById: browserActor.id, status: prepaid ? 'DRAFT' : 'ACTIVE',
      scheduleReference: prepaid ? 'PRE-SYNTHETIC-34' : 'DEF-SYNTHETIC-34', scheduleKind: prepaid ? 'PREPAYMENT' : 'DEFERRED_INCOME',
      allocationMethod: 'MONTHLY_EQUAL', startDate: '2026-11-01', endDate: '2026-12-31', plannedAmount: '8000000.00',
      policyEvidence: 'Synthetic schedule policy evidence', recognitionBasis: 'Synthetic monthly recognition basis', policyStatus: prepaid ? 'PENDING_INDEPENDENT_REVIEW' : 'REVIEWED',
      recognitionAccountId: prepaid ? ids.expenseAccount : ids.incomeAccount, balanceAccountId: prepaid ? ids.asset : ids.liability,
      sourceJournalLineId: ids.sourceLine, accountingDocumentId: prepaid ? ids.ap : ids.ar,
      relFkAccScheduleSource: { id: ids.sourceLine, journalId: ids.journal, journal: { ...postedJournal, sourceKind: prepaid ? 'AP_DOCUMENT' : 'AR_DOCUMENT' } },
      terminationJournal: null, terminationJournalId: null, recognized: '0.00', terminated: '0.00', remaining: '8000000.00',
      controlReconciliation: { generalLedgerRemaining: '8000000.00', reconciled: true },
      approvalHistoryLimit: 500, approvalHistory: [], postingAutomatic: false,
      revFkAccSchedulePeriodParent: [ids.november, ids.december].map((accountingPeriodId, index) => ({
        id: uuid((prepaid ? 50 : 60) + index), accountingScheduleId: id, accountingPeriodId,
        recognitionDate: index ? '2026-12-31' : '2026-11-30', plannedAmount: '4000000.00', recognitionJournalId: null,
      })),
    };
  };
  const prepaid = makeSchedule(true), deferred = makeSchedule(false);
  const period = deferred.revFkAccSchedulePeriodParent[0];
  const approval = (id: string, requestKind: string, sourceDocumentId: string, source: unknown, requestPayload: unknown): ApprovalDetail => ({
    id, requestKind, sourceDocumentId, sourceVersion: 1, sourceDigest: 'synthetic-v1-digest',
    requestedById: options.ownApproval ? browserActor.id : ids.requester, requestedAt: accountingDate,
    status: options.approved ? 'APPROVED' : 'PENDING', decidedById: options.approved ? (options.ownApproval ? ids.requester : browserActor.id) : null,
    decidedAt: null, decisionRemark: null, appliedJournalId: null, historyLimit: 1000, source, requestPayload,
    approvers: [{ approverUserId: browserActor.id }, { approverUserId: ids.requester }], history: [],
  });
  function accrualApproval() {
    return approval(ids.accrualApproval, 'ACCRUAL_DOCUMENT', expense.id, { id: expense.id, revision: expense.revision, status: expense.status }, {
      snapshot: { id: expense.id, revision: '1', accountingDate, sourceKind: 'ACCRUAL_DOCUMENT', sourceReference: expense.sourceReference, metadata: expense.metadata, lines: [expense.recognition, expense.balance] },
    });
  }
  function scheduleApproval(schedule: Schedule, row?: SchedulePeriod, evidence = 'Synthetic signed fulfillment evidence', command = { action: 'SETUP' }) {
    return approval(row ? ids.periodApproval : ids.setup, row ? 'SCHEDULE_PERIOD' : 'SCHEDULE_' + command.action,
      row?.id ?? schedule.id, row ? { row, schedule: { id: schedule.id, revision: schedule.revision } }
        : { id: schedule.id, revision: schedule.revision }, {
        snapshot: { header: { id: schedule.id, revision: '1', kind: schedule.scheduleKind, sourceLine: schedule.sourceJournalLineId,
          recognition: schedule.recognitionAccountId, balance: schedule.balanceAccountId, amount: schedule.plannedAmount,
          start: schedule.startDate, end: schedule.endDate, method: schedule.allocationMethod, basis: schedule.recognitionBasis, policy: schedule.policyEvidence },
        command: row ? null : command, recognitionEvidence: row ? evidence : null,
        periods: (row ? [row] : schedule.revFkAccSchedulePeriodParent).map(p => ({ id: p.id, accountingPeriodId: p.accountingPeriodId, date: p.recognitionDate, amount: p.plannedAmount, journal: p.recognitionJournalId })) },
      });
  }
  const approvals = new Map([[ids.accrualApproval, accrualApproval()], [ids.setup, scheduleApproval(prepaid)], [ids.periodApproval, scheduleApproval(deferred, period)]]);
  const writes: { path: string; method: string; body: Record<string, unknown> }[] = [];
  const failures = new Map<string, { status: number; message: string }>();
  const pageOf = (rows: unknown[]) => ({ rows, total: rows.length, page: 1, pageSize: 25 });
  await page.route('**/api/accounting/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname.replace('/api/accounting/', ''), method = request.method();
    const send = (json: unknown, status = 200) => route.fulfill({ json, status });
    if (method === 'GET') {
      const failure = failures.get(path);
      if (failure) return send({ message: failure.message }, failure.status);
      if (path === 'accruals') return send(pageOf([expense, income]));
      if (path === 'schedules') return send(pageOf([prepaid, deferred]));
      if (path === 'accruals/scheduled-reversals') return send({ asOf: url.searchParams.get('asOf'), page: 1, pageSize: 25,
        rows: expense.postedJournal?.revFkAccJournalReversal ? [] : [{ id: expense.id, scheduledDate: expense.metadata.scheduledReversalOn }], postingAutomatic: false });
      if (path === 'accruals/' + ids.expense) return send(expense);
      if (path === 'accruals/' + ids.income) return send(income);
      if (path === 'schedules/' + ids.prepaid) return send(prepaid);
      if (path === 'schedules/' + ids.deferred) return send(deferred);
      if (path === 'approvals') return send(pageOf([...approvals.values()]));
      if (path.startsWith('approvals/') && approvals.has(path.split('/')[1])) return send(approvals.get(path.split('/')[1]));
      if (path === 'ap/documents/' + ids.ap || path === 'ar/documents/' + ids.ar) {
        const ap = path.startsWith('ap');
        return send({ id: ap ? ids.ap : ids.ar, documentNumber: ap ? 'AP-SYNTHETIC-34' : 'AR-SYNTHETIC-34', status: 'RECOGNIZED', financialState: 'POSTED', outstanding: '2000000.00',
          allocations: [{ id: uuid(70), allocatedAmount: '1000000.00', relFkAccAllocationSettlement: { id: uuid(71), settlementReference: 'SETTLEMENT-SYNTHETIC-34', status: 'POSTED', postingJournalId: ids.journal } }] });
      }
      return route.fallback();
    }
    const body = request.postDataJSON();
    writes.push({ method, path, body });
    const failure = failures.get(path);
    if (failure) return send({ message: failure.message }, failure.status);
    if (options.delay) await new Promise(resolve => setTimeout(resolve, options.delay));
    if (path === 'accruals' || path === 'accruals/' + ids.expense && method === 'PATCH') {
      Object.assign(expense, { ...body, metadata: body.metadata, accrualMetadata: body.metadata, status: 'DRAFT', originalAmount: body.amount,
        revision: method === 'PATCH' ? expense.revision + 1 : 1 });
      return send(expense, method === 'PATCH' ? 200 : 201);
    }
    if (path === 'accruals/' + ids.expense + '/submit') {
      const row = { ...accrualApproval(), sourceVersion: expense.revision };
      expense.approvalHistory.push(row); approvals.set(row.id, row); return send(row, 201);
    }
    if (path === 'accruals/' + ids.expense + '/adjustments') {
      const row = { ...body, id: ids.adjustment, createdById: expense.createdById, revision: 1, status: 'DRAFT', postedJournalId: null,
        accrualMetadata: { ...expense.metadata, adjustmentKind: body.adjustmentKind, reason: body.reason } };
      expense.adjustments.push(row); return send(row, 201);
    }
    if (path === 'accruals/' + ids.expense + '/scheduled-reversal') {
      const row = approval(ids.reversal, 'JOURNAL_REVERSAL', ids.journal, { original: journal, payload: { accountingDate: '2026-11-18', remark: body.remark } }, null);
      approvals.set(row.id, row); return send(row, 201);
    }
    if (path === 'schedules/preview') return send({ ...body, postingAutomatic: false, periods: body.customPeriods ?? prepaid.revFkAccSchedulePeriodParent.map(row => ({
      accountingPeriodId: row.accountingPeriodId, recognitionDate: row.recognitionDate, plannedAmount: row.plannedAmount,
    })) });
    if (path === 'schedules') return send(body.scheduleKind === 'PREPAYMENT' ? prepaid : deferred, 201);
    if (path === 'schedules/' + ids.prepaid + '/requests') {
      const row = scheduleApproval(prepaid, undefined, undefined, body.command);
      approvals.set(row.id, row); prepaid.approvalHistory.push(row); return send(row, 201);
    }
    if (path === 'schedule-periods/' + period.id + '/submit') {
      const row = scheduleApproval(deferred, period, body.recognitionEvidence);
      approvals.set(row.id, row); deferred.approvalHistory.push(row); return send(row, 201);
    }
    const row = approvals.get(path.startsWith('approvals/') ? path.split('/')[1] : body.approvalRequestId);
    if (row && path.endsWith('/decision')) {
      row.status = body.decision; row.decidedById = browserActor.id; row.decisionRemark = body.remark; return send(row);
    }
    if (row && path.endsWith('/apply')) {
      row.status = 'APPLIED'; prepaid.status = 'ACTIVE'; prepaid.policyStatus = 'REVIEWED'; return send({ financialJournalCreated: false }, 201);
    }
    if (row && path.endsWith('/post')) {
      row.status = 'APPLIED'; row.appliedJournalId = ids.recognition;
      if (row.id === ids.periodApproval) { period.recognitionJournalId = ids.recognition; deferred.recognized = '4000000.00'; deferred.remaining = '4000000.00'; }
      if (row.id === ids.reversal) expense.postedJournal = { ...postedJournal, revFkAccJournalReversal: { id: ids.recognition, journalNumber: 'REV-SYNTHETIC-34' } };
      return send({ id: ids.recognition }, 201);
    }
    return route.fallback();
  });
  return { ...base, expense, income, prepaid, deferred, period, approvals, writes, failures };
}
