import { expect, test } from '@playwright/test';
import { fiscalYear } from './helpers/accounting-workspace';
import { reportIds, setupFinancialReportsBrowser } from './helpers/accounting-financial-reports';

const base = `fiscalYearId=${fiscalYear.id}&from=2026-10-01&to=2026-12-31`;
const financialReports = (statement = 'position', extra = '') => `/accounting/financial-reports?statement=${statement}&${base}${extra}`;

test('Stage38 financial position shows backend posted-GL hierarchy, totals and equation without frontend adjustment', async ({ page }) => {
  const f = await setupFinancialReportsBrowser(page);
  await page.goto(financialReports());
  await expect(page.getByRole('heading', { name: 'Statement of Financial Position', exact: true })).toBeVisible();
  await expect(page.getByText('DRAFT_VERIFIED').first()).toBeVisible();
  await expect(page.getByText('Backend official flag: false')).toBeVisible();
  const region = page.getByRole('region', { name: 'Statement of financial position' });
  await expect(region).toContainText('Current assets');
  await expect(region).toContainText('Total assets');
  await expect(region).toContainText('Rp 22.000.000,00');
  await expect(region).toContainText('Total liabilities');
  await expect(region).toContainText('Rp 5.000.000,00');
  await expect(region).toContainText('Total net assets');
  await expect(region).toContainText('Rp 17.000.000,00');
  await expect(region).toContainText('assets − liabilities − total net assets');
  await expect(region).toContainText('Rp 0,00 · Balanced');
  await expect(page.getByText('2026-10-01 – 2026-12-31').first()).toBeVisible();
  await expect(page.getByRole('link', { name: /1110 · Cash and cash equivalents/ })).toHaveAttribute('href', new RegExp(`accountId=${reportIds.bank}`));
  const call = f.calls.find(item => item.path === 'financial-statements');
  expect(call?.query.get('from')).toBe('2026-10-01');
  expect(call?.query.get('to')).toBe('2026-12-31');
  expect(f.errors).toEqual([]);
});

test('Stage38 comprehensive income uses backend functional classes and never derives income from bank receipts', async ({ page }) => {
  const f = await setupFinancialReportsBrowser(page);
  await page.goto(financialReports());
  await page.getByRole('link', { name: 'Comprehensive Income', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Statement of Comprehensive Income', exact: true })).toBeVisible();
  const region = page.getByRole('region', { name: 'Statement of comprehensive income' });
  await expect(region).toContainText('Contributions');
  await expect(region).toContainText('Program expenses');
  await expect(region).toContainText('Recognized income');
  await expect(region).toContainText('Rp 20.000.000,00');
  await expect(region).toContainText('Recognized expenses');
  await expect(region).toContainText('Rp 5.000.000,00');
  await expect(region).toContainText('Surplus / deficit');
  await expect(region).toContainText('Rp 15.000.000,00');
  await expect(page.getByText('Closing journals and their reversals are excluded from this income statement by the backend.')).toBeVisible();
  expect(f.calls.every(call => call.method === 'GET')).toBe(true);
  expect(f.errors).toEqual([]);
});

test('Stage38 changes in net assets keeps restricted and unrestricted resources distinct', async ({ page }) => {
  const f = await setupFinancialReportsBrowser(page);
  await page.goto(financialReports('net-assets'));
  await expect(page.getByRole('heading', { name: 'Statement of Changes in Net Assets', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Current period', exact: true })).toBeVisible();
  await expect(page.getByText('Net assets without donor restrictions')).toBeVisible();
  await expect(page.getByText('Net assets with donor restrictions')).toBeVisible();
  const region = page.getByRole('region', { name: 'Current period' });
  await expect(region).toContainText('Rp 2.000.000,00');
  await expect(region).toContainText('Rp 15.000.000,00');
  await expect(region).toContainText('Rp 17.000.000,00');
  await expect(page.getByText(/do not create new total net assets/)).toBeVisible();
  await expect(page.getByText(/Internal management designations are a subset of unrestricted resources/)).toBeVisible();
  expect(f.errors).toEqual([]);
});

test('Stage38 direct cash flow shows backend activities, reconciliation difference and journal drilldown', async ({ page }) => {
  const f = await setupFinancialReportsBrowser(page);
  await page.goto(financialReports('cash-flows'));
  await expect(page.getByRole('heading', { name: 'Statement of Cash Flows', exact: true })).toBeVisible();
  await expect(page.getByText('Method: DIRECT')).toBeVisible();
  const region = page.getByRole('region', { name: 'Statement of cash flows' });
  await expect(region).toContainText('Operating activities');
  await expect(region).toContainText('Rp 20.000.000,00');
  await expect(region).toContainText('Investing activities');
  await expect(region).toContainText('Financing activities');
  await expect(region).toContainText('Opening cash / cash equivalents');
  await expect(region).toContainText('Closing cash / cash equivalents');
  await expect(region).toContainText('Backend classification difference');
  await expect(page.getByRole('region', { name: 'Cash-flow source journals' })).toContainText('OPERATING');
  await expect(page.getByRole('link', { name: reportIds.journal, exact: true })).toHaveAttribute('href', `/accounting/journals?journalId=${reportIds.journal}`);
  expect(f.errors).toEqual([]);
});

test('Stage38 PENDING_POLICY and UNVERIFIED reports remain qualified, never official or VERIFIED', async ({ page }) => {
  const f = await setupFinancialReportsBrowser(page, undefined, { unverified: true });
  await page.goto(financialReports());
  await expect(page.getByText('UNVERIFIED').first()).toBeVisible();
  await expect(page.getByText('Backend official flag: false')).toBeVisible();
  await expect(page.getByText(/DRAFT \/ UNVERIFIED/)).toBeVisible();
  await expect(page.getByText('PENDING_POLICY: no independently adopted reporting policy for fiscal year.')).toBeVisible();
  await expect(page.getByText(/UNMAPPED_ACTIVE_POSTING_ACCOUNT/)).toBeVisible();
  await expect(page.getByText('DRAFT_VERIFIED')).toHaveCount(0);
  await expect(page.getByText('VERIFIED', { exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Cash Flows', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Statement of cash flows' })).toContainText('Not supplied');
  await expect(page.getByText(/The backend did not return a DIRECT cash-flow method/)).toBeVisible();
  expect(f.calls.every(call => call.method === 'GET')).toBe(true);
  expect(f.errors).toEqual([]);
});

test('Stage38 comparative period values are shown only when the backend returns a comparative report', async ({ page }) => {
  const f = await setupFinancialReportsBrowser(page, undefined, { comparative: true });
  await page.goto(financialReports('position', '&comparativeFrom=2025-10-01&comparativeTo=2025-12-31'));
  const region = page.getByRole('region', { name: 'Statement of financial position' });
  await expect(region).toContainText('Comparative period');
  await expect(region).toContainText('Rp 18.000.000,00');
  await expect(region).toContainText('Rp 14.000.000,00');
  await expect(page.getByText(/Comparative report is DRAFT_VERIFIED/)).toHaveCount(0);
  expect(f.calls.find(item => item.path === 'financial-statements')?.query.get('comparativeFrom')).toBe('2025-10-01');
  expect(f.errors).toEqual([]);
});

test('Stage38 unavailable comparative report is explicit and no comparative values are invented', async ({ page }) => {
  const f = await setupFinancialReportsBrowser(page, undefined, { comparativeUnavailable: true });
  await page.goto(financialReports('position', '&comparativeFrom=2024-10-01&comparativeTo=2024-12-31'));
  await expect(page.getByText(/Comparative report is UNVERIFIED/)).toBeVisible();
  await expect(page.getByText('Comparative fiscal year/policy not available.')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Statement of financial position' })).not.toContainText('Rp 18.000.000,00');
  expect(f.errors).toEqual([]);
});

test('Stage38 scope uses exact selected period dates and rejects out-of-year dates without fallback', async ({ page }) => {
  const f = await setupFinancialReportsBrowser(page);
  await page.goto('/accounting/financial-reports?statement=position');
  await expect(page.getByLabel('Fiscal year')).toHaveValue(fiscalYear.id);
  await expect(page.getByLabel('From date')).toHaveValue('2026-01-01');
  await expect(page.getByLabel('To date')).toHaveValue('2026-12-31');
  await page.getByLabel('Accounting period').selectOption(fiscalYear.revFkAccPeriodFy[1].id);
  await expect(page.getByLabel('From date')).toHaveValue('2026-11-01');
  await expect(page.getByLabel('To date')).toHaveValue('2026-11-30');
  await expect.poll(() => f.calls.some(call => call.path === 'financial-statements' && call.query.get('from') === '2026-11-01' && call.query.get('to') === '2026-11-30')).toBe(true);
  await expect(page.getByText(/Selected period 2026-11/)).toBeVisible();
  await page.getByLabel('From date').fill('2025-01-01');
  await expect(page.getByText(/must stay inside the selected fiscal year/)).toBeVisible();
  expect(f.errors).toEqual([]);
});

test('Stage38 exports use the existing DRAFT CSV/XLSX backend contract and exact report dates', async ({ page }) => {
  const f = await setupFinancialReportsBrowser(page);
  await page.goto(financialReports());
  await expect(page.getByRole('heading', { name: 'Statement of Financial Position', exact: true })).toBeVisible();
  for (const [label, format] of [['Export DRAFT Summary + TB (CSV)', 'csv'], ['Export DRAFT Summary + TB (XLSX)', 'xlsx']] as const) {
    const wait = page.waitForEvent('download');
    await page.getByRole('button', { name: label, exact: true }).click();
    expect((await wait).suggestedFilename()).toBe(`AryaTarray-financial-DRAFT-2026-12-31.${format}`);
    const call = f.calls.find(item => item.path === 'financial-statements/export' && item.query.get('format') === format);
    expect(call?.query.get('from')).toBe('2026-10-01');
    expect(call?.query.get('to')).toBe('2026-12-31');
  }
  expect(f.errors).toEqual([]);
});

test('Stage38 export labels and DRAFT scope disclosure appear on every statement tab', async ({ page }) => {
  const f = await setupFinancialReportsBrowser(page);
  await page.goto(financialReports());
  const views: Array<[string, string]> = [
    ['Financial Position', 'Statement of Financial Position'],
    ['Comprehensive Income', 'Statement of Comprehensive Income'],
    ['Changes in Net Assets', 'Statement of Changes in Net Assets'],
    ['Cash Flows', 'Statement of Cash Flows'],
    ['Supporting Schedules', 'Accounting policy & adopted mappings']
  ];
  for (const [tab, heading] of views) {
    await page.getByRole('link', { name: tab, exact: true }).click();
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export DRAFT Summary + TB (CSV)', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export DRAFT Summary + TB (XLSX)', exact: true })).toBeVisible();
    await expect(page.getByText(/contains only the DRAFT financial summary/)).toBeVisible();
    await expect(page.getByText('This export is not an official financial statement.')).toBeVisible();
  }
  expect(f.errors).toEqual([]);
});

test('Stage38 export backend errors are displayed without claiming success', async ({ page }) => {
  const f = await setupFinancialReportsBrowser(page);
  await page.goto(financialReports());
  await expect(page.getByRole('button', { name: 'Export DRAFT Summary + TB (CSV)', exact: true })).toBeEnabled();
  await page.route('**/api/accounting/financial-statements/export**', route => route.fulfill({ status: 503, json: { message: 'Synthetic export service unavailable' } }));
  await page.getByRole('button', { name: 'Export DRAFT Summary + TB (CSV)', exact: true }).click();
  await expect(page.locator('.ui-alert-error')).toContainText('Synthetic export service unavailable');
  expect(f.errors).toEqual([]);
});

test('Stage38 supporting schedules show adopted policy, account mappings and source subledger controls', async ({ page }) => {
  const f = await setupFinancialReportsBrowser(page);
  await page.goto(financialReports('supporting-schedules'));
  await expect(page.getByRole('heading', { name: 'Accounting policy & adopted mappings', exact: true })).toBeVisible();
  await expect(page.getByText('Synthetic adopted policy FY2026').first()).toBeVisible();
  await expect(page.getByText('Reviewed nonprofit accrual framework')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Statement mappings by account' })).toContainText('1110 · Bank BCA');
  await expect(page.getByRole('region', { name: 'Statement mappings by account' })).toContainText('Cash equivalent');
  for (const name of ['Accounts payable', 'Accounts receivable', 'Fixed assets', 'Accruals & prepayments', 'Fund accounting']) await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await expect(page.getByText('REQUIRES_PROFESSIONAL_REVIEW_NOT_AUTOMATICALLY_APPROVED. Narrative accounting policies, judgments and formal disclosures require professional preparation and approval. No fictional policy text is generated here.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open Fund Accounting', exact: true })).toHaveAttribute('href', '/accounting/funds');
  expect(f.calls.some(item => item.path === 'financial-statements/supporting-schedules')).toBe(true);
  expect(f.errors).toEqual([]);
});

test('Stage38 unmapped active accounts remain visible in supporting mappings and report exceptions', async ({ page }) => {
  const f = await setupFinancialReportsBrowser(page, undefined, { unverified: true });
  await page.goto(financialReports('supporting-schedules'));
  await expect(page.getByRole('heading', { name: 'Accounting policy & adopted mappings', exact: true })).toBeVisible();
  await expect(page.getByText('PENDING_POLICY. No independently adopted reporting policy was returned.')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Statement mappings by account' })).toContainText('5190 · Unmapped programme cost');
  await expect(page.getByRole('region', { name: 'Statement mappings by account' }).getByText('UNMAPPED', { exact: true })).toBeVisible();
  expect(f.errors).toEqual([]);
});

test('Stage38 GL and Trial Balance drill-down links preserve the scope and account', async ({ page }) => {
  const f = await setupFinancialReportsBrowser(page);
  await page.goto(financialReports());
  await expect(page.getByRole('link', { name: 'Open Trial Balance', exact: true })).toHaveAttribute('href', new RegExp(`from=2026-10-01.*to=2026-12-31.*fiscalYearId=${fiscalYear.id}`));
  await expect(page.getByRole('link', { name: /1110 · Cash and cash equivalents/ })).toHaveAttribute('href', new RegExp(`from=2026-10-01.*to=2026-12-31.*accountId=${reportIds.bank}`));
  expect(f.errors).toEqual([]);
});

test('Stage38 report-only access can read and export but receives no posting, approval or closing controls', async ({ page }) => {
  const f = await setupFinancialReportsBrowser(page, ['ACCOUNTING_REPORT']);
  await page.goto(financialReports());
  await expect(page.getByRole('heading', { name: 'Statement of Financial Position', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export DRAFT Summary + TB (CSV)', exact: true })).toBeEnabled();
  await expect(page.locator('.page-stage').getByRole('button', { name: /Approve|Post|Close|Create|Submit/ })).toHaveCount(0);
  expect(f.calls.every(call => call.method === 'GET')).toBe(true);
  expect(f.errors).toEqual([]);
});

test('Stage38 forbidden report access is explicit and does not display a report', async ({ page }) => {
  const f = await setupFinancialReportsBrowser(page, undefined, { forbidden: true });
  await page.goto(financialReports());
  await expect(page.getByText('Additional access required', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Statement of Financial Position', exact: true })).toHaveCount(0);
  expect(f.errors).toEqual([]);
});

test('Stage38 transient reporting failure keeps an explicit error and retry reloads the report', async ({ page }) => {
  const f = await setupFinancialReportsBrowser(page, undefined, { failOnce: true });
  await page.goto(financialReports());
  await expect(page.getByText('Financial reporting temporarily unavailable')).toBeVisible();
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Statement of Financial Position', exact: true })).toBeVisible();
  expect(f.calls.filter(item => item.path === 'financial-statements').length).toBeGreaterThanOrEqual(2);
  expect(f.errors).toEqual([]);
});

test('Stage38 workspace navigation and Overview expose Financial Statements inside the existing Accounting shell', async ({ page }) => {
  const f = await setupFinancialReportsBrowser(page);
  await page.goto('/accounting');
  await page.getByRole('navigation', { name: 'Accounting workspace' }).getByRole('link', { name: 'Financial Statements', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Financial Statements', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Statement of Financial Position', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Financial Statements', exact: true })).toHaveAttribute('aria-selected', 'true');
  expect(f.errors).toEqual([]);
});

for (const [name, width, height] of [['desktop', 1440, 1000], ['tablet', 900, 1100], ['mobile', 390, 844]] as const) {
  test(`Stage38 ${name} financial statements stay inside the existing responsive Accounting shell`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    const f = await setupFinancialReportsBrowser(page);
    await page.goto(financialReports());
    await expect(page.getByRole('navigation', { name: 'Accounting workspace' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Statement of Financial Position', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    if (name === 'mobile') {
      const region = page.getByRole('region', { name: 'Statement of financial position' });
      expect(await region.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
    }
    await page.screenshot({ path: testInfo.outputPath(`stage38-financial-position-${name}.png`), fullPage: true, animations: 'disabled' });
    expect(f.errors).toEqual([]);
  });
}

test('Stage38 empty fiscal configuration is an explicit state without an invented reporting period', async ({ page }) => {
  const f = await setupFinancialReportsBrowser(page);
  await page.route('**/api/accounting/periods/fiscal-years', route => route.fulfill({ json: [] }));
  await page.goto('/accounting/financial-reports?statement=position');
  await expect(page.getByText('No fiscal year available', { exact: true })).toBeVisible();
  expect(f.calls.some(item => item.path === 'financial-statements')).toBe(false);
  expect(f.errors).toEqual([]);
});
