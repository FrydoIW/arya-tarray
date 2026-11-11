import type { Page } from '@playwright/test';
import { allCoreGrants, setupCoreBrowser } from './accounting-core';
import { fiscalYear, browserActor } from './accounting-workspace';
import type { ControlReconciliation } from '../../../src/features/accounting/finalization/types';
import type { FinancialReport, ReportMapping, ReportingPolicy, SupportingSchedules } from '../../../src/features/accounting/reporting/types';

export const reportIds = {
  bank: '90000000-0000-4000-8000-000000000001',
  prepaid: '90000000-0000-4000-8000-000000000002',
  payable: '90000000-0000-4000-8000-000000000003',
  permanentNetAssets: '90000000-0000-4000-8000-000000000004',
  revenue: '90000000-0000-4000-8000-000000000005',
  programExpense: '90000000-0000-4000-8000-000000000006',
  unmappedExpense: '90000000-0000-4000-8000-000000000007',
  journal: '90000000-0000-4000-8000-000000000008',
  policy: '90000000-0000-4000-8000-000000000009'
};
const mappings: Record<string, ReportMapping> = {
  [reportIds.bank]: { section: 'CURRENT_ASSETS', statementLine: 'Cash and cash equivalents', incomeClass: null, netAssetClass: null, cashEquivalent: true, cashFlowActivity: 'OPERATING' },
  [reportIds.prepaid]: { section: 'CURRENT_ASSETS', statementLine: 'Prepayments', incomeClass: null, netAssetClass: null, cashEquivalent: false, cashFlowActivity: null },
  [reportIds.payable]: { section: 'CURRENT_LIABILITIES', statementLine: 'Accounts payable', incomeClass: null, netAssetClass: null, cashEquivalent: false, cashFlowActivity: null },
  [reportIds.permanentNetAssets]: { section: 'NET_ASSETS', statementLine: 'Permanent net assets', incomeClass: null, netAssetClass: 'UNRESTRICTED', cashEquivalent: false, cashFlowActivity: null },
  [reportIds.revenue]: { section: 'INCOME', statementLine: 'Contributions', incomeClass: 'CONTRIBUTIONS', netAssetClass: 'UNRESTRICTED', cashEquivalent: false, cashFlowActivity: null },
  [reportIds.programExpense]: { section: 'EXPENSES', statementLine: 'Program expenses', incomeClass: 'PROGRAM', netAssetClass: 'UNRESTRICTED', cashEquivalent: false, cashFlowActivity: null }
};
const row = (id: string, code: string, name: string, accountType: string, normalBalance: string, debit: string, credit: string, mapped: boolean) => ({
  id, code, name, accountType, normalBalance, activeFlag: true, postingFlag: true, contraFlag: false,
  mapping: mapped ? mappings[id] ?? null : null,
  openingDebit: '0.00', openingCredit: '0.00', debit, credit,
  closingDebit: debit === '0.00' ? '0.00' : debit, closingCredit: credit === '0.00' ? '0.00' : credit,
  signedClosingDebit: (BigInt(debit.replace('.', '')) - BigInt(credit.replace('.', ''))).toString().replace(/(\d+)(\d{2})$/, '$1.$2')
});
const trialRows = (unmapped: boolean) => [
  row(reportIds.bank, '1110', 'Bank BCA', 'ASSET', 'DEBIT', '20000000.00', '0.00', true),
  row(reportIds.prepaid, '1120', 'Prepaid program costs', 'ASSET', 'DEBIT', '2000000.00', '0.00', true),
  row(reportIds.payable, '2110', 'Accounts payable', 'LIABILITY', 'CREDIT', '0.00', '5000000.00', true),
  row(reportIds.permanentNetAssets, '3110', 'Permanent unrestricted net assets', 'NET_ASSET', 'CREDIT', '0.00', '2000000.00', true),
  row(reportIds.revenue, '4110', 'Contribution income', 'REVENUE', 'CREDIT', '0.00', '20000000.00', true),
  row(reportIds.programExpense, '5100', 'Program expense', 'EXPENSE', 'DEBIT', unmapped ? '4000000.00' : '5000000.00', '0.00', true),
  ...(unmapped ? [row(reportIds.unmappedExpense, '5190', 'Unmapped programme cost', 'EXPENSE', 'DEBIT', '1000000.00', '0.00', false)] : [])
];
const journalSource = { journalId: reportIds.journal, cashMovement: '20000000.00', allocations: [{ activity: 'OPERATING', amount: '20000000.00', sourceId: reportIds.revenue }] };

function reportFor(scope: FinancialReport['scope'], options: { unverified?: boolean; comparative?: boolean } = {}): FinancialReport {
  const unverified = Boolean(options.unverified);
  const exceptions = unverified ? [
    'PENDING_POLICY: no independently adopted reporting policy for fiscal year.',
    `UNMAPPED_ACCOUNT:${reportIds.unmappedExpense}:5190`,
    `UNMAPPED_ACTIVE_POSTING_ACCOUNT:${reportIds.unmappedExpense}`,
    'CASH_FLOW_UNVERIFIED'
  ] : [];
  const cashFlows = unverified ? {
    status: 'PENDING_POLICY', method: null, opening: null, closing: null, netMovement: null, difference: null, activities: null,
    exceptions: ['Explicit cash-equivalent accounts and DIRECT policy required.'], sources: []
  } : {
    status: 'VERIFIED', method: 'DIRECT', opening: '0.00', closing: '20000000.00', netMovement: '20000000.00', difference: '0.00',
    activities: { OPERATING: '20000000.00', INVESTING: '0.00', FINANCING: '0.00' }, exceptions: [], sources: [journalSource]
  };
  return {
    scope: { ...scope, ...(options.comparative ? { comparativeFrom: '2025-10-01', comparativeTo: '2025-12-31' } : {}) },
    status: unverified ? 'UNVERIFIED' : 'DRAFT_VERIFIED', official: false, fiscalYearRevision: 1, policyId: reportIds.policy,
    policyReference: unverified ? null : 'Synthetic adopted policy FY2026',
    exceptions,
    trialBalance: { balanced: true, difference: '0.00', periodDebit: '27000000.00', periodCredit: '27000000.00', rows: trialRows(unverified) },
    financialPosition: {
      assets: '22000000.00', liabilities: '5000000.00', permanentNetAssets: '2000000.00', undistributedSurplusDeficit: '15000000.00',
      totalNetAssets: '17000000.00', difference: '0.00', balanced: true, netAssetClasses: { UNRESTRICTED: '17000000.00', RESTRICTED: '0.00' },
      lines: [
        { accountId: reportIds.bank, section: 'CURRENT_ASSETS', line: 'Cash and cash equivalents', amount: '20000000.00' },
        { accountId: reportIds.prepaid, section: 'CURRENT_ASSETS', line: 'Prepayments', amount: '2000000.00' },
        { accountId: reportIds.payable, section: 'CURRENT_LIABILITIES', line: 'Accounts payable', amount: '5000000.00' },
        { accountId: reportIds.permanentNetAssets, section: 'NET_ASSETS', line: 'Permanent unrestricted net assets', amount: '2000000.00' }
      ],
      undistributedSurplusLine: { section: 'NET_ASSETS', amount: '15000000.00' }
    },
    comprehensiveIncome: {
      surplusDeficit: '15000000.00', categories: { CONTRIBUTIONS: '20000000.00', PROGRAM: '4000000.00', ...(unverified ? { UNMAPPED: '1000000.00' } : { OTHER_EXPENSE: '1000000.00' }) },
      recognizedIncome: '20000000.00', recognizedExpenses: '5000000.00',
      incomeCategories: { CONTRIBUTIONS: '20000000.00' }, expenseCategories: { PROGRAM: '4000000.00', ...(unverified ? { UNMAPPED: '1000000.00' } : { OTHER_EXPENSE: '1000000.00' }) },
      closingEntriesExcluded: true
    },
    changesInNetAssets: {
      UNRESTRICTED: { opening: '2000000.00', surplusDeficit: '15000000.00', otherMovements: '0.00', closing: '17000000.00', rollforwardDifference: '0.00' },
      RESTRICTED: { opening: '0.00', surplusDeficit: '0.00', otherMovements: '0.00', closing: '0.00', rollforwardDifference: '0.00' }
    },
    cashFlows,
    ledgerFingerprint: 'synthetic-financial-report-ledger-fingerprint',
    basis: 'POSTED_GL_ONLY; source subledgers classify/reconcile rather than add report amounts.',
    comparative: null
  };
}
function comparativeReport(): FinancialReport {
  const base = reportFor({ fiscalYearId: '00000000-0000-4000-8000-000000002025', from: '2025-10-01', to: '2025-12-31' });
  return {
    ...base,
    status: 'DRAFT_VERIFIED',
    financialPosition: {
      ...base.financialPosition, assets: '18000000.00', liabilities: '4000000.00', permanentNetAssets: '2000000.00',
      undistributedSurplusDeficit: '12000000.00', totalNetAssets: '14000000.00', netAssetClasses: { UNRESTRICTED: '14000000.00' },
      lines: base.financialPosition.lines.map(line => line.accountId === reportIds.bank ? { ...line, amount: '16000000.00' } : line.accountId === reportIds.prepaid ? { ...line, amount: '2000000.00' } : line)
    },
    comprehensiveIncome: { ...base.comprehensiveIncome, surplusDeficit: '12000000.00', recognizedIncome: '16000000.00', recognizedExpenses: '4000000.00', categories: { CONTRIBUTIONS: '16000000.00', PROGRAM: '4000000.00' }, incomeCategories: { CONTRIBUTIONS: '16000000.00' }, expenseCategories: { PROGRAM: '4000000.00' } },
    changesInNetAssets: { UNRESTRICTED: { opening: '2000000.00', surplusDeficit: '12000000.00', otherMovements: '0.00', closing: '14000000.00', rollforwardDifference: '0.00' } },
    cashFlows: { ...base.cashFlows, opening: '0.00', closing: '16000000.00', netMovement: '16000000.00', activities: { OPERATING: '16000000.00', INVESTING: '0.00', FINANCING: '0.00' } },
    comparative: null
  };
}
const control = (scope: string): ControlReconciliation => ({
  scope, asOf: '2026-12-31', controlAccounts: [reportIds.bank],
  rows: [{ accountId: reportIds.bank, subledger: '5000000.00', generalLedger: '5000000.00', difference: '0.00' }],
  subledgerTotal: '5000000.00', glTotal: '5000000.00', difference: '0.00', status: 'BALANCED', severity: 'NONE',
  exceptions: [{ code: 'NOT_APPLICABLE', severity: 'WARNING', reason: 'Synthetic support evidence for UI verification only.' }],
  evidence: 'Actual posted source references; no balancing adjustment.'
});
function policy(): ReportingPolicy {
  return {
    policyReference: 'Synthetic adopted policy FY2026', frameworkReference: 'Reviewed nonprofit accrual framework',
    cashFlowMethod: 'DIRECT', materiality: 'STRICT_ZERO', cutoverCoverageEvidence: 'Reviewed cutover evidence',
    openingBalanceEvidence: 'Reviewed opening balance evidence',
    mappings: Object.entries(mappings).map(([accountId, mapping]) => ({ accountId, ...mapping })),
    bankAccounts: [{ bankAccountId: reportIds.bank, glAccountId: reportIds.bank, openingEvidence: 'Reviewed bank opening evidence' }],
    controls: { payable: [reportIds.payable], receivable: [] },
    annual: { policyReference: 'Synthetic annual closing mapping', unrestrictedAccountId: reportIds.permanentNetAssets, restrictedAccountId: reportIds.permanentNetAssets }
  };
}
export async function setupFinancialReportsBrowser(page: Page, grants = allCoreGrants, options: {
  unverified?: boolean; comparative?: boolean; comparativeUnavailable?: boolean; forbidden?: boolean; failOnce?: boolean;
} = {}) {
  const base = await setupCoreBrowser(page, grants);
  const calls: Array<{ method: string; path: string; query: URLSearchParams; body: Record<string, unknown> | null }> = [];
  let attempts = 0;
  const report = reportFor({ fiscalYearId: fiscalYear.id, from: '2026-10-01', to: '2026-12-31' }, { unverified: options.unverified });
  if (options.comparative) report.comparative = comparativeReport();
  if (options.comparativeUnavailable) report.comparative = { status: 'UNVERIFIED', exceptions: ['Comparative fiscal year/policy not available.'] };
  const schedules: SupportingSchedules = { scope: report.scope, policy: options.unverified ? null : policy(), subledgers: { asOf: '2026-12-31', ap: control('PAYABLE'), ar: control('RECEIVABLE'), assets: control('FIXED_ASSETS_COST_CONTRA_IMPAIRMENT_DEPRECIATION'), accruals: control('ACCRUAL_PREPAYMENT_DEFERRED'), funds: { scope: 'FUND_RESTRICTIONS', asOf: '2026-12-31', status: 'BALANCED', truncated: false, controls: [{ fundId: 'fund-restricted', classified: '20000000.00', released: '5000000.00', remaining: '15000000.00', glNetResources: '15000000.00', difference: '0.00' }], conditionalControls: [], internalDesignations: [{ fundId: 'fund-unrestricted', designated: '1000000.00', managementAvailable: '16000000.00', financialJournalCreated: false }], exceptions: [], financialSource: 'POSTED_GL_AND_ACTUAL_RELEASE_EVIDENCE; wallets/designations are not additive net assets.' }, status: 'VERIFIED' }, report, narrativeStatus: 'REQUIRES_PROFESSIONAL_REVIEW_NOT_AUTOMATICALLY_APPROVED' };
  await page.route('**/api/accounting/financial-statements**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname.replace('/api/accounting/', ''), method = request.method(), query = url.searchParams;
    calls.push({ method, path, query, body: request.postData() ? request.postDataJSON() : null });
    if (method !== 'GET') return route.fulfill({ status: 405, json: { message: 'Synthetic financial report fixture only permits reads.' } });
    if (options.forbidden) return route.fulfill({ status: 403, json: { message: 'Accounting report access denied' } });
    if (options.failOnce && ++attempts === 1) return route.fulfill({ status: 503, json: { message: 'Financial reporting temporarily unavailable' } });
    if (path === 'financial-statements/export') {
      const format = query.get('format') === 'csv' ? 'csv' : 'xlsx', to = query.get('to') ?? '2026-12-31';
      return route.fulfill({ headers: { 'Content-Disposition': `attachment; filename="AryaTarray-financial-DRAFT-${to}.${format}"`, 'Access-Control-Expose-Headers': 'Content-Disposition' }, body: `Synthetic financial report ${format} DRAFT export` });
    }
    const requestedScope = {
      ...report.scope,
      from: query.get('from') ?? report.scope.from,
      to: query.get('to') ?? report.scope.to,
      ...(query.get('comparativeFrom') && query.get('comparativeTo') ? { comparativeFrom: query.get('comparativeFrom')!, comparativeTo: query.get('comparativeTo')! } : {})
    };
    if (path === 'financial-statements/supporting-schedules') return route.fulfill({ json: { ...schedules, scope: requestedScope, report: { ...report, scope: requestedScope } } });
    if (path === 'financial-statements') return route.fulfill({ json: { ...report, scope: requestedScope } });
    return route.fallback();
  });
  return { ...base, calls, report, schedules, actor: browserActor };
}
