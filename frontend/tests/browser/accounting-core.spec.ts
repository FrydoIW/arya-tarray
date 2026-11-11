import { expect, test } from '@playwright/test';
import { allCoreGrants, ids, setupCoreBrowser } from './helpers/accounting-core';
import { fiscalYear } from './helpers/accounting-workspace';

test.setTimeout(90_000);
const reviewer = ['ACCOUNTING_REPORT', 'ACCOUNTING_JOURNAL_APPROVE'];
const manager = ['ACCOUNTING_REPORT', 'ACCOUNTING_JOURNAL_MANAGE'];

test('Stage32 COA reads actual catalog, filters server-side, shows detail and withholds management from report users', async ({ page }) => {
  const f = await setupCoreBrowser(page, ['ACCOUNTING_REPORT']); await page.goto('/accounting/coa');
  await expect(page.getByRole('table')).toContainText('5100'); await expect(page.getByRole('button', { name: 'Create account', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Details 1110' }).click(); await expect(page.getByRole('dialog')).toContainText('Normal balance'); await page.keyboard.press('Escape');
  await page.getByLabel('Search accounts').fill('5100'); await expect(page.getByRole('table')).not.toContainText('4110');
  expect(f.coreCalls.some(call => call.path === 'coa' && call.query.get('search') === '5100')).toBe(true);
  await page.getByLabel('Search accounts').fill(''); await page.getByLabel('Filter account type').selectOption('REVENUE'); await expect(page.getByRole('table')).toContainText('4110'); await expect(page.getByRole('table')).not.toContainText('5100');
  expect(f.errors).toEqual([]); expect(f.coreCalls.every(call => call.method === 'GET')).toBe(true);
});

test('Stage32 COA empty, API error/retry and forbidden states never invent rows', async ({ page }) => {
  await setupCoreBrowser(page); let attempts = 0;
  await page.route('**/api/accounting/coa?*', route => ++attempts === 1 ? route.fulfill({ status: 503, json: { message: 'Catalog offline' } }) : route.fulfill({ json: { rows: [], total: 0, page: 1, pageSize: 25 } }));
  await page.goto('/accounting/coa'); await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toContainText('Catalog offline'); await page.getByRole('button', { name: 'Retry', exact: true }).click(); await expect(page.getByText('No records available', { exact: true })).toBeVisible();
  await page.route('**/api/accounting/coa?*', route => route.fulfill({ status: 403, json: { message: 'Forbidden' } })); await page.getByRole('button', { name: 'Refresh', exact: true }).click(); await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toContainText('Additional access required');
});

test('Stage32 account create requires valid fields, confirms payload, preserves form on backend rejection', async ({ page }) => {
  const f = await setupCoreBrowser(page); let attempts = 0;
  await page.route('**/api/accounting/coa', async route => { if (route.request().method() === 'POST' && ++attempts === 1) return route.fulfill({ status: 409, json: { message: 'Account code already exists' } }); return route.fallback(); });
  await page.goto('/accounting/coa'); await page.getByRole('button', { name: 'Create account', exact: true }).click();
  const dialog = page.getByRole('dialog'); await dialog.getByRole('button', { name: 'Review account changes' }).click(); expect(f.coreCalls.filter(call => call.method === 'POST')).toHaveLength(0);
  await page.getByLabel('Account code', { exact: true }).fill('5200'); await page.getByLabel('Account name', { exact: true }).fill('Reviewed synthetic expense'); await page.getByRole('combobox', { name: 'Account type', exact: true }).selectOption('EXPENSE');
  await dialog.getByRole('button', { name: 'Review account changes' }).click(); await dialog.getByRole('button', { name: 'Confirm save account' }).click(); await expect(dialog.getByRole('alert')).toContainText('Account code already exists'); await expect(page.getByLabel('Account name', { exact: true })).toHaveValue('Reviewed synthetic expense');
  await dialog.getByRole('button', { name: 'Confirm save account' }).click(); await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Account saved successfully' })).toBeVisible();
  expect(f.coreCalls.find(call => call.path === 'coa' && call.method === 'POST')?.body).toMatchObject({ code: '5200', accountType: 'EXPENSE', normalBalance: 'DEBIT', postingFlag: true });
});

test('Stage32 posted-account editing permits only active flag and never sends historical classification changes', async ({ page }) => {
  const f = await setupCoreBrowser(page, allCoreGrants, { postedAccount: true }); await page.goto('/accounting/coa'); await page.getByRole('button', { name: 'Edit 1110', exact: true }).click();
  const dialog = page.getByRole('dialog'); await expect(page.getByLabel('Account name', { exact: true })).toBeDisabled(); await expect(page.getByRole('combobox', { name: 'Normal balance', exact: true })).toBeDisabled();
  await page.getByLabel('Active account', { exact: true }).uncheck(); await dialog.getByRole('button', { name: 'Review account changes' }).click(); await dialog.getByRole('button', { name: 'Confirm save account' }).click(); await expect(dialog).toHaveCount(0);
  expect(f.coreCalls.find(call => call.method === 'PATCH')?.body).toEqual({ activeFlag: false });
});

test('Stage32 unposted account update follows strict PATCH and immutable code/type', async ({ page }) => {
  const f = await setupCoreBrowser(page); await page.goto('/accounting/coa'); await page.getByRole('button', { name: 'Edit 1110', exact: true }).click();
  await expect(page.getByLabel('Account code', { exact: true })).toBeDisabled(); await expect(page.getByRole('combobox', { name: 'Account type', exact: true })).toBeDisabled();
  await page.getByLabel('Account name', { exact: true }).fill('Reviewed catalog bank'); await page.getByRole('button', { name: 'Review account changes' }).click(); await page.getByRole('button', { name: 'Confirm save account' }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  const body = f.coreCalls.find(call => call.method === 'PATCH')?.body; expect(body).toMatchObject({ name: 'Reviewed catalog bank' }); expect(body).not.toHaveProperty('code'); expect(body).not.toHaveProperty('accountType');
});

test('Stage32 journals show immutable posted detail, exact amounts, source and period metadata, server filters', async ({ page }) => {
  const f = await setupCoreBrowser(page, ['ACCOUNTING_REPORT']); await page.goto('/accounting/journals'); await page.getByLabel('Journal number search').fill('CORE'); await expect.poll(() => f.coreCalls.some(call => call.path === 'reports' && call.query.get('journalNumber') === 'CORE')).toBe(true);
  await page.getByRole('button', { name: 'JRN-CORE-32', exact: true }).click(); const dialog = page.getByRole('dialog'); await expect(dialog).toContainText('Rp 8.000.000,00'); await expect(dialog).toContainText('MANUAL_JOURNAL:CORE-EVIDENCE-32'); await expect(dialog).toContainText(fiscalYear.revFkAccPeriodFy[1].id);
  await expect(dialog.getByRole('button', { name: /Edit|Delete|Revise/ })).toHaveCount(0); await expect(dialog).toContainText('Non-bank journal'); expect(f.errors).toEqual([]);
});

test('Stage32 manual draft validates exact balance, saves then separately requests independent approval', async ({ page }) => {
  const f = await setupCoreBrowser(page, manager, { own: true }); await page.goto('/accounting/journals'); await page.getByRole('button', { name: 'Create journal draft', exact: true }).click();
  let dialog = page.getByRole('dialog'); await page.getByLabel('Source reference', { exact: true }).fill('BROWSER-EXACT-32'); await page.getByRole('combobox', { name: 'Line 1 account', exact: true }).selectOption(ids.account); await page.getByRole('combobox', { name: 'Line 2 account', exact: true }).selectOption(ids.income);
  await page.getByLabel('Line 1 debit', { exact: true }).fill('8000000.01'); await page.getByLabel('Line 2 credit', { exact: true }).fill('8000000.00'); await dialog.getByRole('button', { name: 'Review draft', exact: true }).click(); await expect(dialog.getByRole('alert')).toContainText('balance exactly'); expect(f.coreCalls.some(call => call.method === 'POST')).toBe(false);
  await page.getByLabel('Line 2 credit', { exact: true }).fill('8000000.01'); await dialog.getByRole('button', { name: 'Review draft', exact: true }).click(); await dialog.getByRole('button', { name: 'Confirm save draft' }).click();
  dialog = page.getByRole('dialog'); await expect(dialog).toContainText('BROWSER-EXACT-32'); expect(f.coreCalls.filter(call => call.path === 'approvals' && call.method === 'POST')).toHaveLength(0);
  await dialog.getByRole('button', { name: 'Request approval', exact: true }).click(); await page.getByRole('button', { name: 'Confirm approval request', exact: true }).click(); await expect(page.getByRole('link', { name: 'Open approval request', exact: true })).toBeVisible();
  const created = f.coreCalls.find(call => call.path === 'journal-drafts' && call.method === 'POST'); expect(created?.body?.lines).toEqual(expect.arrayContaining([expect.objectContaining({ debit: '8000000.01', credit: '0.00' })]));
  expect(f.coreCalls.find(call => call.path === 'approvals' && call.method === 'POST')?.body).toMatchObject({ kind: 'MANUAL_JOURNAL', sourceDocumentId: ids.draft, expectedRevision: 1 }); expect(f.coreCalls.some(call => call.path.endsWith('/post'))).toBe(false);
});

test('Stage32 draft revision sends expectedRevision, supersession remains backend-owned and stale failures retain input', async ({ page }) => {
  const f = await setupCoreBrowser(page, manager, { own: true }); await page.goto('/accounting/journals'); await page.getByRole('button', { name: 'My drafts', exact: true }).click(); await page.getByRole('button', { name: 'DRAFT-CORE-32', exact: true }).click(); await page.getByRole('button', { name: 'Revise draft', exact: true }).click();
  await page.getByLabel('Source reference', { exact: true }).fill('REVISED-32'); await page.getByRole('button', { name: 'Review draft', exact: true }).click(); await page.getByRole('button', { name: 'Confirm save draft', exact: true }).click(); await expect(page.getByRole('dialog')).toContainText('Revision 2');
  expect(f.coreCalls.find(call => call.method === 'PATCH')?.body).toMatchObject({ expectedRevision: 1, sourceReference: 'REVISED-32' });
  await page.getByRole('button', { name: 'Revise draft', exact: true }).click(); await page.route(`**/api/accounting/journal-drafts/${ids.draft}`, route => route.request().method() === 'PATCH' ? route.fulfill({ status: 409, json: { message: 'Draft revision changed' } }) : route.fallback());
  await page.getByLabel('Source reference', { exact: true }).fill('KEEP-THIS-INPUT'); await page.getByRole('button', { name: 'Review draft', exact: true }).click(); await page.getByRole('button', { name: 'Confirm save draft', exact: true }).click(); await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toContainText('Draft revision changed'); await expect(page.getByLabel('Source reference', { exact: true })).toHaveValue('KEEP-THIS-INPUT');
});

test('Stage32 CLOSED period blocks draft submission without writing an API mutation', async ({ page }) => {
  const f = await setupCoreBrowser(page, manager, { closed: true }); await page.goto('/accounting/journals'); await page.getByRole('button', { name: 'Create journal draft', exact: true }).click(); await page.getByLabel('Source reference', { exact: true }).fill('CLOSED-BLOCK'); await page.getByRole('button', { name: 'Review draft', exact: true }).click(); await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toContainText('not OPEN'); expect(f.coreCalls.some(call => call.method !== 'GET')).toBe(false);
});

test('Stage32 independent reviewer sees source context, confirms approval and prevents duplicate submit', async ({ page }) => {
  const f = await setupCoreBrowser(page, reviewer); await page.route(`**/api/accounting/approvals/${ids.approval}/decision`, async route => { await new Promise(resolve => setTimeout(resolve, 400)); return route.fallback(); });
  await page.goto(`/accounting/approvals?id=${ids.approval}`); await expect(page.getByRole('table', { name: '' }).first()).toBeVisible(); await expect(page.getByText('synthetic-digest-v1', { exact: true }).first()).toBeVisible(); await expect(page.getByRole('region', { name: 'Approval source journal lines' })).toContainText('Rp 8.000.000,00');
  await page.getByRole('button', { name: 'Approve request', exact: true }).click(); const confirm = page.getByRole('button', { name: 'Confirm Accounting action', exact: true }); await confirm.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); }); await expect(page.getByRole('status').filter({ hasText: 'confirmed by backend' })).toBeVisible(); await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(f.coreCalls.filter(call => call.path.endsWith('/decision'))).toHaveLength(1); expect(f.state.approval.status).toBe('APPROVED'); await expect(page.getByRole('button', { name: 'Post approved journal', exact: true })).toHaveCount(0);
});

test('Stage32 reviewer rejection carries reason and only succeeds after backend acknowledgement', async ({ page }) => {
  const f = await setupCoreBrowser(page, reviewer); await page.goto(`/accounting/approvals?id=${ids.approval}`); await page.getByLabel('Decision / cancellation remark', { exact: true }).fill('Supporting evidence is incomplete'); await page.getByRole('button', { name: 'Reject request', exact: true }).click(); await expect(page.getByRole('dialog')).toContainText('will not authorize posting'); await page.getByRole('button', { name: 'Confirm Accounting action', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(f.coreCalls.find(call => call.path.endsWith('/decision'))?.body).toEqual({ decision: 'REJECTED', remark: 'Supporting evidence is incomplete' });
});

test('Stage32 requester cannot self-approve/reject even with approval grant', async ({ page }) => {
  const f = await setupCoreBrowser(page, allCoreGrants, { own: true }); await page.goto(`/accounting/approvals?id=${ids.approval}`); await expect(page.getByText(/cannot approve or reject your own request/)).toBeVisible(); await expect(page.getByRole('button', { name: 'Approve request', exact: true })).toHaveCount(0); await expect(page.getByRole('button', { name: 'Reject request', exact: true })).toHaveCount(0); expect(f.coreCalls.some(call => call.method !== 'GET')).toBe(false);
});

test('Stage32 stale source revision disables decision and backend digest conflict remains visible without success', async ({ page }) => {
  const f = await setupCoreBrowser(page, reviewer); f.state.draft.revision = 2; await page.goto(`/accounting/approvals?id=${ids.approval}`); await expect(page.getByRole('button', { name: 'Approve request', exact: true })).toBeDisabled(); await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toContainText('Source version is stale');
  f.state.draft.revision = 1; await page.getByRole('button', { name: 'Refresh request', exact: true }).click(); await expect(page.getByRole('button', { name: 'Approve request', exact: true })).toBeEnabled();
  await page.route(`**/api/accounting/approvals/${ids.approval}/decision`, route => route.fulfill({ status: 409, json: { message: 'Accounting document changed after approval was requested; submit a new version.' } })); await page.getByLabel('Decision / cancellation remark', { exact: true }).fill('Keep review note'); await page.getByRole('button', { name: 'Approve request', exact: true }).click(); await page.getByRole('button', { name: 'Confirm Accounting action', exact: true }).click(); await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toContainText('document changed'); await expect(page.getByRole('status')).toHaveCount(0); await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.getByLabel('Decision / cancellation remark', { exact: true })).toHaveValue('Keep review note');
});

test('Stage32 authorized posting is distinct from approval and refreshes APPLIED result', async ({ page }) => {
  const f = await setupCoreBrowser(page, ['ACCOUNTING_REPORT', 'ACCOUNTING_JOURNAL_POST'], { approved: true }); await page.goto(`/accounting/approvals?id=${ids.approval}`); await expect(page.getByRole('button', { name: 'Approve request', exact: true })).toHaveCount(0); await page.getByRole('button', { name: 'Post approved journal', exact: true }).click(); await expect(page.getByRole('dialog')).toContainText('immutable Accounting journal evidence'); await page.getByRole('button', { name: 'Confirm Accounting action', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.locator('.ui-status-badge').filter({ hasText: /^APPLIED$/ })).toBeVisible(); expect(f.coreCalls.filter(call => call.path.endsWith('/post'))).toHaveLength(1); await expect(page.getByRole('button', { name: 'Post approved journal', exact: true })).toBeDisabled();
});

test('Stage32 CLOSED period rejects posting in UI; revoked backend permission errors do not claim success', async ({ page }) => {
  const f = await setupCoreBrowser(page, allCoreGrants, { approved: true, closed: true }); await page.goto(`/accounting/approvals?id=${ids.approval}`); await expect(page.getByRole('button', { name: 'Post approved journal', exact: true })).toBeDisabled(); await expect(page.getByText(/fiscal year or accounting period is not OPEN/)).toBeVisible(); expect(f.coreCalls.some(call => call.path.endsWith('/post'))).toBe(false);
  f.state.year.revFkAccPeriodFy[1].status = 'OPEN'; await page.reload(); await expect(page.getByRole('button', { name: 'Post approved journal', exact: true })).toBeEnabled(); await page.route(`**/api/accounting/approvals/${ids.approval}/post`, route => route.fulfill({ status: 403, json: { message: 'Posting permission revoked' } })); await page.getByRole('button', { name: 'Post approved journal', exact: true }).click(); await page.getByRole('button', { name: 'Confirm Accounting action', exact: true }).click(); await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toContainText('Posting permission revoked'); await expect(page.getByRole('status')).toHaveCount(0);
});

test('Stage32 approval cancellation requires a reason and retains audit/history view', async ({ page }) => {
  const f = await setupCoreBrowser(page, manager, { own: true }); await page.goto(`/accounting/approvals?id=${ids.approval}`); await expect(page.getByRole('button', { name: 'Cancel request', exact: true })).toBeDisabled(); await page.getByLabel('Decision / cancellation remark', { exact: true }).fill('Replace with reviewed supporting evidence'); await page.getByRole('button', { name: 'Cancel request', exact: true }).click(); await page.getByRole('button', { name: 'Confirm Accounting action', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.locator('.ui-status-badge').filter({ hasText: /^CANCELLED$/ })).toBeVisible(); await page.getByLabel('Approval status').selectOption(''); await expect(page.getByRole('region', { name: 'Approval history' })).toContainText('SUBMIT'); expect(f.coreCalls.find(call => call.path.endsWith('/cancel'))?.body).toMatchObject({ remark: 'Replace with reviewed supporting evidence' });
});

test('Stage32 reversal requests retain original journal and use independent approval endpoint', async ({ page }) => {
  const f = await setupCoreBrowser(page, manager); await page.goto('/accounting/journals'); await page.getByRole('button', { name: 'JRN-CORE-32', exact: true }).click(); await page.getByLabel('Reversal reason', { exact: true }).fill('Correct original recognition evidence'); await page.getByRole('button', { name: 'Review reversal request', exact: true }).click(); await page.getByRole('button', { name: 'Confirm reversal request', exact: true }).click(); await expect(page.getByRole('link', { name: 'Open reversal approval request' })).toBeVisible(); expect(f.coreCalls.find(call => call.path === 'approvals' && call.method === 'POST')?.body).toMatchObject({ kind: 'JOURNAL_REVERSAL', sourceDocumentId: ids.journal, accountingDate: '2026-11-09' }); expect(f.state.journal.journalNumber).toBe('JRN-CORE-32'); expect(f.coreCalls.some(call => call.method === 'DELETE')).toBe(false);
});

test('Stage32 General Ledger supports full dynamic account choice, period scope, backend balances, pagination and journal drilldown', async ({ page }) => {
  const f = await setupCoreBrowser(page, ['ACCOUNTING_REPORT']); await page.goto('/accounting/general-ledger'); await expect(page.getByRole('region', { name: 'General Ledger lines' })).toContainText('Rp 9.000.000,00'); await page.getByRole('combobox', { name: 'Ledger account', exact: true }).selectOption(ids.expense); await expect.poll(() => f.coreCalls.some(call => call.path === 'general-ledger' && call.query.get('accountId') === ids.expense)).toBe(true);
  await page.getByRole('combobox', { name: 'Fiscal year', exact: true }).selectOption(fiscalYear.id); await page.getByRole('combobox', { name: 'Accounting period', exact: true }).selectOption(fiscalYear.revFkAccPeriodFy[1].id); await expect(page.getByLabel('From date', { exact: true })).toHaveValue('2026-11-01'); await expect.poll(() => f.coreCalls.some(call => call.path === 'general-ledger' && call.query.get('accountingPeriodId') === fiscalYear.revFkAccPeriodFy[1].id)).toBe(true);
  await page.getByRole('button', { name: 'Next', exact: true }).last().click(); await expect.poll(() => f.coreCalls.some(call => call.path === 'general-ledger' && call.query.get('page') === '2')).toBe(true); await page.getByRole('button', { name: 'JRN-CORE-32', exact: true }).click(); await expect(page.getByRole('dialog')).toContainText('CORE-EVIDENCE-32'); expect(f.errors).toEqual([]);
});

test('Stage32 Trial Balance uses backend cumulative totals, never VERIFIED, and preserves account/date drilldown to GL', async ({ page }) => {
  const f = await setupCoreBrowser(page, ['ACCOUNTING_REPORT']); await page.goto('/accounting/trial-balance'); await expect(page.getByText('Backend totals balanced', { exact: true })).toBeVisible(); await expect(page.getByText(/not sums of this page/)).toBeVisible(); await expect(page.getByText('VERIFIED', { exact: true })).toHaveCount(0); await expect(page.getByRole('region', { name: 'Trial Balance accounts' })).toContainText('Rp 9.000.000,00');
  await page.getByRole('link', { name: '5100 · Catalog program expense', exact: true }).click(); await expect(page.getByRole('heading', { name: 'General Ledger', exact: true })).toBeVisible(); await expect(page.getByRole('combobox', { name: 'Ledger account', exact: true })).toHaveValue(ids.expense); expect(f.coreCalls.some(call => call.path === 'general-ledger' && call.query.get('accountId') === ids.expense)).toBe(true);
});

test('Stage32 exact Decimal display retains cents beyond JavaScript Number safe integer range', async ({ page }) => {
  await setupCoreBrowser(page); await page.route('**/api/accounting/general-ledger?*', route => route.fulfill({ json: { rows: [], total: 0, page: 1, pageSize: 25, openingBalances: [], closingBalances: [], totalDebit: '123456789012345678.12', totalCredit: '123456789012345678.13' } })); await page.goto('/accounting/general-ledger'); await expect(page.getByText('Period debit: Rp 123.456.789.012.345.678,12', { exact: true })).toBeVisible(); await expect(page.getByText('Period credit: Rp 123.456.789.012.345.678,13', { exact: true })).toBeVisible();
});

test('Stage32 fiscal display warns CLOSED, does not offer closing/cutover changes and gates creation', async ({ page }) => {
  const f = await setupCoreBrowser(page, ['ACCOUNTING_REPORT'], { closed: true }); await page.goto('/accounting/periods'); await expect(page.getByRole('table')).toContainText('CLOSED'); await expect(page.getByRole('table')).toContainText('Blocked'); await expect(page.getByRole('button', { name: /Create|Close period|Reopen/ })).toHaveCount(0); await expect(page.getByText(/Closing and reopening use the separate Stage 3.7 workspace/)).toBeVisible(); await expect(page.getByRole('link', { name: 'Open Reconciliation & Closing' })).toBeVisible(); expect(f.coreCalls.every(call => call.method === 'GET')).toBe(true);
});

test('Stage32 fiscal creation is explicit, validates dates and confirms exact year/period payload', async ({ page }) => {
  const f = await setupCoreBrowser(page); await page.goto('/accounting/periods'); await page.getByRole('button', { name: 'Create fiscal year', exact: true }).click(); await page.getByLabel('Fiscal year code', { exact: true }).fill('FY2027-SYNTHETIC'); await page.getByLabel('Start date', { exact: true }).fill('2027-12-31'); await page.getByLabel('End date', { exact: true }).fill('2027-01-01'); await page.getByRole('button', { name: 'Review fiscal configuration', exact: true }).click(); await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toContainText('valid date range');
  await page.getByLabel('Start date', { exact: true }).fill('2027-01-01'); await page.getByLabel('End date', { exact: true }).fill('2027-12-31'); await page.getByRole('button', { name: 'Review fiscal configuration', exact: true }).click(); await page.getByRole('button', { name: 'Confirm fiscal configuration', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0); expect(f.coreCalls.find(call => call.path === 'periods/fiscal-years' && call.method === 'POST')?.body).toEqual({ yearCode: 'FY2027-SYNTHETIC', startDate: '2027-01-01', endDate: '2027-12-31' });
  await page.getByRole('button', { name: 'Create period', exact: true }).click(); await page.getByLabel('Period code', { exact: true }).fill('2026-SYNTHETIC'); await page.getByRole('combobox', { name: 'Parent fiscal year', exact: true }).selectOption(fiscalYear.id); await page.getByLabel('Period number', { exact: true }).fill('9'); await page.getByLabel('Start date', { exact: true }).fill('2026-09-01'); await page.getByLabel('End date', { exact: true }).fill('2026-09-30'); await page.getByRole('button', { name: 'Review fiscal configuration', exact: true }).click(); await page.getByRole('button', { name: 'Confirm fiscal configuration', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0); expect(f.coreCalls.find(call => call.path === 'periods' && call.method === 'POST')?.body).toMatchObject({ periodNo: 9, fiscalYearId: fiscalYear.id });
});

test('Stage32 all new routes require report grant; report-only approval access sends no protected queue request', async ({ page }) => {
  const f = await setupCoreBrowser(page, []); for (const route of ['coa', 'journals', 'approvals', 'general-ledger', 'trial-balance', 'periods']) { await page.goto(`/accounting/${route}`); await expect(page.getByRole('heading', { name: 'Access denied', exact: true })).toBeVisible(); } expect(f.coreCalls).toHaveLength(0);
});

test('Stage32 report-only and obsolete alias grants do not unlock Accounting approval reads or writes', async ({ page }) => {
  const f = await setupCoreBrowser(page, ['ACCOUNTING_REPORT', 'ACCOUNTING_APPROVE']); await page.goto(`/accounting/approvals?id=${ids.approval}`);
  await expect(page.getByRole('heading', { name: 'Additional Accounting access required', exact: true })).toBeVisible(); expect(f.coreCalls).toHaveLength(0); await expect(page.getByRole('button', { name: /Approve request|Post approved journal/ })).toHaveCount(0);
});

test('Stage32/37 finalization approval with incomplete source context stays fail-closed', async ({ page }) => {
  const f = await setupCoreBrowser(page); f.state.replaceApproval({ requestKind: 'REPORTING_POLICY', source: { current: null, reviewedPayload: null } }); await page.goto(`/accounting/approvals?id=${ids.approval}`); await expect(page.getByRole('heading', { name: 'Frozen finalization source' })).toBeVisible(); await expect(page.getByRole('button', { name: 'Approve request', exact: true })).toBeDisabled(); await expect(page.getByRole('button', { name: 'Reject request', exact: true })).toBeDisabled(); await expect(page.getByRole('button', { name: 'Apply approved command', exact: true })).toBeDisabled(); expect(f.coreCalls.every(call => call.method === 'GET')).toBe(true);
});

test('Stage32 fiscal API failure blocks posting, exposes retry and cannot be mistaken for a closed/verified result', async ({ page }) => {
  const f = await setupCoreBrowser(page, allCoreGrants, { approved: true }); let calls = 0;
  await page.route('**/api/accounting/periods/fiscal-years', route => ++calls === 1 ? route.fulfill({ status: 503, json: { message: 'Fiscal context unavailable' } }) : route.fallback()); await page.goto(`/accounting/approvals?id=${ids.approval}`); await expect(page.getByRole('button', { name: 'Post approved journal', exact: true })).toBeDisabled(); await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toContainText('Fiscal context unavailable'); await page.getByRole('button', { name: 'Retry', exact: true }).click(); await expect(page.getByRole('button', { name: 'Post approved journal', exact: true })).toBeEnabled(); expect(f.coreCalls.some(call => call.method !== 'GET')).toBe(false);
});

test('Stage32 late core ledger reads cannot overwrite the latest account filter', async ({ page }) => {
  const f = await setupCoreBrowser(page, ['ACCOUNTING_REPORT']); await page.route('**/api/accounting/general-ledger?*', async route => { const latest = new URL(route.request().url()).searchParams.get('accountId') === ids.income; if (!latest) await new Promise(resolve => setTimeout(resolve, 800)); await route.fulfill({ json: { rows: [], total: 0, page: 1, pageSize: 25, openingBalances: [], closingBalances: [], totalDebit: latest ? '200.02' : '100.01', totalCredit: '0.00' } }).catch(() => undefined); });
  await page.goto('/accounting/general-ledger'); await page.getByRole('combobox', { name: 'Ledger account', exact: true }).selectOption(ids.income); await expect(page.getByText('Period debit: Rp 200,02', { exact: true })).toBeVisible(); await page.waitForTimeout(900); await expect(page.getByText('Period debit: Rp 100,01', { exact: true })).toHaveCount(0); expect(f.errors).toEqual([]);
});

for (const [name, width, height] of [['desktop', 1440, 1000], ['tablet', 900, 1100], ['mobile', 390, 844]] as const) {
  test(`Stage32 ${name} core layout, shared navigation, workspace tabs and readable wide table scrolling`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height }); const f = await setupCoreBrowser(page); await page.goto('/accounting/coa'); await expect(page.getByRole('table')).toBeVisible(); await page.screenshot({ path: testInfo.outputPath(`core-coa-${name}.png`), fullPage: true, animations: 'disabled' });
    await page.getByRole('navigation', { name: 'Accounting workspace', exact: true }).getByRole('link', { name: 'General Ledger', exact: true }).click(); await expect(page.getByRole('heading', { name: 'General Ledger', exact: true })).toBeVisible(); await expect(page.getByRole('tab', { name: 'General Ledger', exact: true })).toHaveAttribute('aria-selected', 'true'); await expect(page.getByRole('region', { name: 'General Ledger lines' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    if (name === 'mobile') { const table = page.getByRole('region', { name: 'General Ledger lines' }); expect(await table.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true); await table.focus(); await page.keyboard.press('ArrowRight'); }
    await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); window.scrollTo(0, 0); });
    await page.screenshot({ path: testInfo.outputPath(`core-ledger-${name}.png`), fullPage: true, animations: 'disabled' }); await page.getByRole('tab', { name: 'Chart of Accounts', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Chart of Accounts', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Create account', exact: true }).click(); await expect(page.getByRole('dialog')).toBeVisible(); await page.keyboard.press('Tab'); expect(await page.getByRole('dialog').evaluate(element => element.contains(document.activeElement))).toBe(true); await page.screenshot({ path: testInfo.outputPath(`core-account-form-${name}.png`), fullPage: true, animations: 'disabled' }); await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.goto(`/accounting/approvals?id=${ids.approval}`); await expect(page.getByRole('region', { name: 'Approval source journal lines' })).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true); await page.screenshot({ path: testInfo.outputPath(`core-approval-${name}.png`), fullPage: true, animations: 'disabled' }); expect(f.errors).toEqual([]); expect(f.unhandled).toEqual([]);
  });
}
