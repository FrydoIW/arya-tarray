import { expect, test } from '@playwright/test';
import { setupFinalizationBrowser, finalIds } from './helpers/accounting-finalization';
import { setupCoreBrowser, ids } from './helpers/accounting-core';
import { browserActor } from './helpers/accounting-workspace';

test('Stage37 reconciliation shows backend AP, AR, asset, accrual and fund controls without frontend balancing claims', async ({ page }) => {
  const f = await setupFinalizationBrowser(page); await page.goto('/accounting/reconciliation');
  for (const heading of ['Accounts Payable', 'Accounts Receivable', 'Fixed Assets', 'Accruals & prepayments', 'Fund accounting', 'Bank-to-GL']) await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  await expect(page.getByText('Rp 5.000.000,00').first()).toBeVisible(); await expect(page.getByText('Rp 6.000.000,00').first()).toBeVisible(); await expect(page.getByText(/wallets\/designations are not additive net assets/)).toBeVisible(); expect(f.errors).toEqual([]);
});

test('Stage37 subledger differences remain UNVERIFIED with source exception and exact cutoff', async ({ page }) => {
  const f = await setupFinalizationBrowser(page, undefined, { unverified: true }); await page.goto('/accounting/reconciliation/subledgers');
  await expect(page.getByText('UNVERIFIED').first()).toBeVisible(); await expect(page.getByText('CONTROL_DIFFERENCE')).toBeVisible(); await expect(page.getByText('Rp 100.000,00').first()).toBeVisible();
  await page.getByLabel('As-of date').fill('2026-11-29'); await expect.poll(() => f.calls.length).toBe(0); // read-only API calls are handled by the synthetic fixture and never mutate.
});

test('Stage37 conditional fund policy is explicit and never upgraded to VERIFIED', async ({ page }) => {
  await setupFinalizationBrowser(page, undefined, { pendingPolicy: true }); await page.goto('/accounting/reconciliation'); await expect(page.getByText('PENDING_FUND_POLICY')).toBeVisible(); await expect(page.getByText(/separate concepts/)).toBeVisible();
});

test('Stage37 bank detail displays statement rollforward, GL, timing, matches and source fingerprint', async ({ page }) => {
  const f = await setupFinalizationBrowser(page, undefined, { unverified: true }); await page.goto(`/accounting/reconciliation/bank?id=${finalIds.bank}`);
  await expect(page.getByRole('heading', { name: 'Bank reconciliation detail' })).toBeVisible(); await expect(page.getByRole('region', { name: 'Bank timing differences' })).toContainText('OUTSTANDING_PAYMENT'); await expect(page.getByRole('region', { name: 'Bank reconciliation matches' })).toContainText('Rp 3.900.000,00'); await expect(page.getByText('synthetic-finalization-fingerprint')).toBeVisible(); await expect(page.getByText('UNMATCHED_BANK_MOVEMENT')).toBeVisible(); expect(f.errors).toEqual([]);
});

test('Stage37 unresolved bank difference blocks sign-off but permits reviewed exact matching', async ({ page }) => {
  const f = await setupFinalizationBrowser(page, undefined, { unverified: true }); await page.goto(`/accounting/reconciliation/bank?id=${finalIds.bank}`); await expect(page.getByRole('button', { name: 'Submit sign-off' })).toBeDisabled();
  await page.getByLabel('Unmatched bank evidence / active match').selectOption(finalIds.bankTransaction); await page.getByLabel('Unmatched GL line').selectOption(finalIds.glLine); await page.getByLabel('Match amount').fill('100000.00'); await page.getByLabel('Matching / adjustment evidence').fill('Reviewed source allocation evidence'); await page.getByRole('button', { name: 'Match evidence' }).click(); await page.getByRole('button', { name: 'Confirm controlled action' }).click(); await expect.poll(() => f.calls.some(call => call.path.endsWith('/matches'))).toBe(true); expect(f.calls.find(call => call.path.endsWith('/matches'))?.body).toEqual({ bankTransactionId: finalIds.bankTransaction, journalLineId: finalIds.glLine, amount: '100000.00', evidence: 'Reviewed source allocation evidence' });
});

test('Stage37 VERIFIED bank sign-off submits exact revision once and navigates to existing operational evidence', async ({ page }) => {
  const f = await setupFinalizationBrowser(page); await page.goto(`/accounting/reconciliation/bank?id=${finalIds.bank}`); await page.getByRole('button', { name: 'Submit sign-off' }).click(); await expect(page.getByRole('dialog')).toContainText('source fingerprint'); await page.getByRole('button', { name: 'Confirm controlled action' }).click(); await expect.poll(() => f.calls.filter(call => call.path.endsWith('/submit')).length).toBe(1); expect(f.calls.find(call => call.path.endsWith('/submit'))?.body).toEqual({ expectedRevision: 1 }); await expect(page.getByRole('link', { name: 'Transaction Inquiry' })).toHaveAttribute('href', '/reconciliation/transaction-inquiry');
});

test('Stage37 bank creation is explicit evidence configuration and does not create transactions or post journals', async ({ page }) => {
  const f = await setupFinalizationBrowser(page); await page.goto('/accounting/reconciliation/bank'); await page.getByRole('button', { name: 'Create reconciliation' }).click(); await expect(page.getByRole('dialog')).toContainText('never creates a bank transaction or posts a journal'); await expect(page.getByLabel('Statement opening balance')).toBeVisible(); await expect(page.getByRole('button', { name: 'Confirm creation' })).toHaveCount(0); expect(f.calls).toHaveLength(0);
});

test('Stage37 ready monthly close shows individual checklist and integrity controls', async ({ page }) => {
  const f = await setupFinalizationBrowser(page); await page.goto('/accounting/closing'); await expect(page.getByRole('region', { name: 'Pre-close checklist' })).toContainText('PENDING_APPROVALS'); await expect(page.getByRole('region', { name: 'Financial integrity controls' })).toContainText('BANK_RECONCILIATION_REVIEW'); await expect(page.getByText('READY').first()).toBeVisible(); await expect(page.getByRole('button', { name: 'Submit closing approval' })).toBeDisabled(); expect(f.errors).toEqual([]);
});

test('Stage37 close request preserves form input, confirms freeze and submits reason/evidence only', async ({ page }) => {
  const f = await setupFinalizationBrowser(page); await page.goto('/accounting/closing'); await page.getByLabel('Closing reason').fill('Reviewed November close package'); await page.getByLabel('Supporting evidence reference').fill('Evidence binder November 2026'); await page.getByRole('button', { name: 'Submit closing approval' }).click(); await expect(page.getByRole('dialog')).toContainText('Freeze this exact backend checklist'); await page.getByRole('button', { name: 'Confirm approval request' }).click(); await expect.poll(() => f.calls.some(call => call.path.endsWith('/close-request'))).toBe(true); expect(f.calls.find(call => call.path.endsWith('/close-request'))?.body).toEqual({ reason: 'Reviewed November close package', evidenceReference: 'Evidence binder November 2026' }); await expect(page.getByRole('link', { name: 'Open independent approval' })).toHaveAttribute('href', `/accounting/approvals?id=${finalIds.approval}`);
});

test('Stage37 PENDING_POLICY, missing opening evidence and unresolved controls remain close blockers', async ({ page }) => {
  await setupFinalizationBrowser(page, undefined, { pendingPolicy: true }); await page.goto('/accounting/closing'); await expect(page.getByRole('region', { name: 'Pre-close checklist' })).toContainText('PENDING_REVIEW'); await expect(page.getByText('Framework: PENDING_POLICY', { exact: false })).toBeVisible(); await expect(page.getByRole('button', { name: 'Submit closing approval' })).toBeDisabled(); await expect(page.getByText(/WARNING, FAIL, PENDING_REVIEW and UNVERIFIED remain blockers/)).toBeVisible();
});

test('Stage37 closed period exposes retained snapshot/history and independently approved reopening', async ({ page }) => {
  const f = await setupFinalizationBrowser(page, undefined, { closed: true }); await page.goto(`/accounting/closing/${f.period.id}?type=PERIOD`); await expect(page.getByRole('heading', { name: 'Closing snapshot & retained history' })).toBeVisible(); await expect(page.getByRole('region', { name: 'Closing approval history' })).toContainText('PERIOD_CLOSE'); await page.getByLabel('Reopening reason').fill('Correction requires controlled reopening'); await page.getByLabel('Supporting evidence reference').fill('Approved correction evidence package'); await page.getByRole('button', { name: 'Submit reopening approval' }).click(); await page.getByRole('button', { name: 'Confirm approval request' }).click(); await expect.poll(() => f.calls.some(call => call.path.endsWith('/reopen-request'))).toBe(true);
});

test('Stage37 annual preview reports policy/coverage blockers and never offers a force close', async ({ page }) => {
  await setupFinalizationBrowser(page, undefined, { pendingPolicy: true }); await page.goto('/accounting/closing'); await page.getByLabel('Closing scope').selectOption('YEAR'); await page.getByLabel('Fiscal year').selectOption('00000000-0000-4000-8000-000000002026'); await expect(page.getByText(/Annual closing readiness/)).toBeVisible(); await expect(page.getByText(/NOT_READY \/ PENDING_POLICY/)).toBeVisible(); await expect(page.getByRole('button', { name: /force/i })).toHaveCount(0); await expect(page.getByRole('button', { name: 'Submit closing approval' })).toBeDisabled();
});

test('Stage37 report-only user sees evidence but no reconciliation or closing mutations', async ({ page }) => {
  const f = await setupFinalizationBrowser(page, ['ACCOUNTING_REPORT']); await page.goto(`/accounting/reconciliation/bank?id=${finalIds.bank}`); await expect(page.getByText(/ACCOUNTING_JOURNAL_MANAGE is required/)).toBeVisible(); await expect(page.getByRole('button', { name: /Match evidence|Submit sign-off|Create reconciliation/ })).toHaveCount(0); await page.goto('/accounting/closing'); await expect(page.getByText(/Report access alone never grants closing authority/)).toBeVisible(); await expect(page.getByRole('button', { name: /Submit closing|Submit reopening/ })).toHaveCount(0); expect(f.calls).toHaveLength(0);
});

test('Stage37 shared approval supports typed finalization evidence, independent decision and backend application', async ({ page }) => {
  const f = await setupCoreBrowser(page); f.state.replaceApproval({ requestKind: 'PERIOD_CLOSE', sourceDocumentId: f.state.year.revFkAccPeriodFy[1].id, sourceVersion: 1, source: { current: { ...f.state.year.revFkAccPeriodFy[1], status: 'CLOSING', revision: 1, closingDraftId: finalIds.command }, reviewedPayload: { commandId: finalIds.command } } }); await page.goto(`/accounting/approvals?id=${ids.approval}`); await expect(page.getByRole('heading', { name: 'Frozen finalization source' })).toBeVisible(); await expect(page.getByText('PERIOD_CLOSE').first()).toBeVisible(); await expect(page.getByRole('button', { name: 'Approve request' })).toBeEnabled(); await expect(page.getByText(/backend recomputes the live source digest/)).toBeVisible();
});

for (const [name, width, height] of [['desktop', 1440, 1000], ['tablet', 900, 1100], ['mobile', 390, 844]] as const) {
  test(`Stage37 ${name} reconciliation and closing stay within the existing responsive Accounting shell`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height }); const f = await setupFinalizationBrowser(page); await page.goto('/accounting/reconciliation'); await expect(page.getByRole('navigation', { name: 'Accounting workspace' })).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true); await page.screenshot({ path: testInfo.outputPath(`stage37-reconciliation-${name}.png`), fullPage: true, animations: 'disabled' }); await page.goto('/accounting/closing'); await expect(page.getByRole('region', { name: 'Pre-close checklist' })).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true); if (name === 'mobile') { const table = page.getByRole('region', { name: 'Pre-close checklist' }); expect(await table.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true); } await page.screenshot({ path: testInfo.outputPath(`stage37-closing-${name}.png`), fullPage: true, animations: 'disabled' }); expect(f.errors).toEqual([]);
  });
}
