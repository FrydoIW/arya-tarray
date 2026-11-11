import { expect, test, type Page } from '@playwright/test';
import { assetGrants, ids, setupAssets } from './helpers/accounting-assets';

test.setTimeout(90_000);
const root = '/accounting/assets';
const assetPath = root + '/' + ids.asset;
const runPath = root + '/depreciation/' + ids.run;
const approvalPath = '/accounting/approvals?id=' + ids.approval;
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const field = (page: Page, name: string) => page.getByLabel(name, { exact: true });
const alert = (page: Page, message: string) => expect(page.getByRole('alert').filter({ hasText: message })).toBeVisible();
const success = (page: Page, message: string) => expect(page.getByRole('status').filter({ hasText: message })).toBeVisible();
async function confirmSource(page: Page) {
  await button(page, 'Review action').click();
  await button(page, 'Confirm action').click();
}
async function confirmApproval(page: Page, action = 'Post approved journal') {
  await button(page, action).click();
  await button(page, 'Confirm Accounting action').click();
}

async function fillAsset(page: Page) {
  await page.goto(root + '/new?journalId=' + ids.journal);
  await expect(page.getByRole('heading', { name: 'New fixed asset' })).toBeVisible();
  await field(page, 'Asset code').fill('ASSET-NEW-35');
  await field(page, 'Asset name').fill('Synthetic new equipment');
  await field(page, 'Asset category').selectOption(ids.category);
  await field(page, 'Acquisition line').selectOption(ids.sourceLine);
  await field(page, 'Acquisition date').fill('2026-11-02');
  await field(page, 'Available-for-use date').fill('2026-11-09');
  await field(page, 'Useful life (months)').fill('24');
  await field(page, 'Residual value').fill('120000.01');
  await field(page, 'Acquisition evidence').fill('Synthetic asset delivery evidence');
}

async function fillRun(page: Page, period: string) {
  await page.goto(root + '/depreciation/new');
  await expect(page.getByRole('heading', { name: 'New depreciation run' })).toBeVisible();
  await field(page, 'Run reference').fill('DEPR-NEW-35');
  await field(page, 'Depreciation period').selectOption(period);
  await field(page, 'Asset to include').selectOption(ids.asset);
  await button(page, 'Include asset').click();
}

test('Stage35 asset register uses server search and filters, then opens posted evidence and the AP source', async ({ page }) => {
  const f = await setupAssets(page);
  await page.goto(root);
  const table = page.getByRole('region', { name: 'Fixed asset register' });
  await expect(table).toContainText('Synthetic projector');
  await field(page, 'Asset category').selectOption(ids.category);
  await field(page, 'Asset status').selectOption('ACTIVE');
  await field(page, 'Search asset code or name').fill('camera');
  await button(page, 'Search assets').click();
  await expect(table).not.toContainText('Synthetic projector');
  expect(f.reads.some(({ path, query }) => path === 'assets' && query.get('search') === 'camera' &&
    query.get('status') === 'ACTIVE' && query.get('categoryId') === ids.category)).toBe(true);
  await table.getByRole('link', { name: /ASSET-35/ }).click();
  await expect(page.getByText('Rp 4.000.000,00', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'View AP invoice' })).toHaveAttribute('href', '/accounting/payables/' + ids.ap);
  await button(page, 'Load journal history').click();
  await page.getByRole('region', { name: 'Asset journal history' }).getByRole('link', { name: 'View journal' }).first().click();
  await expect(page.getByRole('dialog', { name: 'AP-JOURNAL-35' })).toBeVisible();
  expect(f.writes).toHaveLength(0);
});

test('Stage35 category list and create form use dynamic eligible COA mappings and explicit policy', async ({ page }) => {
  const f = await setupAssets(page);
  await page.goto(root + '/categories');
  await expect(page.getByRole('region', { name: 'Asset category list' })).toContainText('Synthetic equipment');
  await page.getByRole('link', { name: 'New asset category' }).click();
  await expect(page.getByRole('heading', { name: 'New asset category' })).toBeVisible();
  await field(page, 'Category code').fill('EQ-35');
  await field(page, 'Category name').fill('Synthetic equipment mapping');
  await field(page, 'Default useful life (months)').fill('24');
  await field(page, 'Asset cost account').selectOption(ids.cost);
  await field(page, 'Accumulated depreciation account').selectOption(ids.accum);
  await field(page, 'Depreciation expense account').selectOption(ids.expense);
  await expect(field(page, 'Accumulated depreciation account').locator('option[value="' + ids.cost + '"]')).toHaveCount(0);
  await expect(page.getByText(/PENDING_POLICY · An explicit threshold/)).toBeVisible();
  await field(page, 'Supply an adopted policy').check();
  await field(page, 'Adopted capitalization policy reference').fill('Synthetic explicit adopted policy');
  await field(page, 'Capitalization threshold').fill('1000000.01');
  await field(page, 'Partial-month convention').selectOption('ACTUAL_DAYS');
  await button(page, 'Save asset category').click();
  await expect(page).toHaveURL(root + '/categories/' + ids.category);
  expect(f.writes[0]).toMatchObject({ path: 'asset-categories', body: {
    assetAccountId: ids.cost, accumulatedDepreciationAccountId: ids.accum, depreciationExpenseAccountId: ids.expense,
    policy: { capitalizationThreshold: '1000000.01', partialMonthPolicy: 'ACTUAL_DAYS' },
  } });
});

test('Stage35 validates dates, preserves a rejected draft and saves one exact acquisition request', async ({ page }) => {
  const f = await setupAssets(page, { delay: 300 });
  await fillAsset(page);
  await field(page, 'Available-for-use date').fill('2026-11-01');
  await button(page, 'Save asset draft').click();
  await alert(page, 'Available-for-use cannot precede acquisition');
  expect(f.writes).toHaveLength(0);
  await field(page, 'Available-for-use date').fill('2026-11-09');
  await expect(field(page, 'Depreciation start')).toHaveValue('2026-11-01');
  f.failures.set('assets', { status: 409, message: 'Source line is already claimed by another asset, change or schedule.' });
  await button(page, 'Save asset draft').click();
  await alert(page, 'Source line is already claimed');
  await expect(field(page, 'Residual value')).toHaveValue('120000.01');
  f.failures.clear();
  await button(page, 'Save asset draft').evaluate((element: HTMLButtonElement) => { element.click(); element.click(); });
  await expect(page).toHaveURL(assetPath);
  expect(f.writes).toHaveLength(2);
  expect(f.writes[1].body).toMatchObject({ acquisitionJournalLineId: ids.sourceLine, inServiceOn: '2026-11-09', residualValue: '120000.01' });
  expect(f.writes[1].body).not.toHaveProperty('acquisitionCost');
});

test('Stage35 activation uses independent approval and does not create a second journal', async ({ page }) => {
  const f = await setupAssets(page, { draft: true, approved: true, own: true });
  await page.goto(assetPath);
  await button(page, 'Submit for approval').click();
  await confirmSource(page);
  await page.getByRole('link', { name: 'APPROVED · Open approval' }).click();
  await expect(page.getByRole('heading', { name: 'Asset activation evidence' })).toBeVisible();
  await expect(button(page, 'Approve request')).toHaveCount(0);
  await confirmApproval(page, 'Apply approved command');
  await success(page, 'Asset command applied by backend. No journal was created.');
  expect(f.writes).toMatchObject([
    { path: 'assets/' + ids.asset + '/submit', body: { expectedRevision: 1 } },
    { path: 'assets/' + ids.asset + '/activate', body: { approvalRequestId: ids.approval } },
  ]);
});

for (const convention of ['FULL_MONTH', 'NEXT_MONTH', 'ACTUAL_DAYS']) {
  test('Stage35 previews ' + convention + ' using backend snapshot and explicit selection', async ({ page }) => {
    const f = await setupAssets(page);
    f.setConvention(convention);
    await fillRun(page, f.period.id);
    await button(page, 'Preview depreciation').click();
    const table = page.getByRole('region', { name: 'Depreciation preview allocations' });
    await expect(table).toContainText(convention);
    await expect(table).toContainText('Rp 500.000,00');
    expect(f.writes[0]).toMatchObject({ path: 'depreciation-runs/preview', body: {
      accountingPeriodId: f.period.id, assetIds: [ids.asset], runReference: 'DEPR-NEW-35',
    } });
    if (convention !== 'FULL_MONTH') return;
    await button(page, 'Create depreciation run').click();
    await button(page, 'Save depreciation run').click();
    await expect(page).toHaveURL(runPath);
    await button(page, 'Submit for approval').click();
    await confirmSource(page);
    await success(page, 'Independent approval requested.');
    expect(f.writes.map(row => row.path)).toEqual(['depreciation-runs/preview', 'depreciation-runs', 'depreciation-runs/' + ids.run + '/submit']);
  });
}

test('Stage35 depreciation run displays duplicate reservation errors and leaves the preview available', async ({ page }) => {
  const f = await setupAssets(page);
  await fillRun(page, f.period.id);
  await button(page, 'Preview depreciation').click();
  f.failures.set('depreciation-runs', { status: 409, message: 'Asset is already reserved for this period.' });
  await button(page, 'Create depreciation run').click();
  await button(page, 'Save depreciation run').click();
  await alert(page, 'already reserved for this period');
  await expect(page.getByRole('region', { name: 'Depreciation preview allocations' })).toBeVisible();
  expect(f.writes.filter(row => row.path === 'depreciation-runs')).toHaveLength(1);
});

test('Stage35 preview rejects an asset disposed while the selection is open', async ({ page }) => {
  const f = await setupAssets(page);
  await fillRun(page, f.period.id);
  f.asset.status = 'DISPOSED';
  await button(page, 'Preview depreciation').click();
  await alert(page, 'Only an authorized active unreversed asset can be depreciated');
  await expect(button(page, 'Create depreciation run')).toHaveCount(0);
});

test('Stage35 independent reviewer approves the retained run and the authorized action posts through Stage 2.4', async ({ page }) => {
  const f = await setupAssets(page);
  await page.goto(approvalPath);
  await expect(page.getByRole('heading', { name: 'Depreciation request snapshot' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Requested depreciation amounts' })).toContainText('Rp 500.000,00');
  await expect(button(page, 'Post approved journal')).toBeDisabled();
  await confirmApproval(page, 'Approve request');
  await success(page, 'Accounting approval action confirmed');
  await confirmApproval(page);
  await success(page, 'Posting confirmed by backend');
  expect(f.writes).toMatchObject([{ path: 'approvals/' + ids.approval + '/decision', body: { decision: 'APPROVED' } },
    { path: 'depreciation-runs/' + ids.run + '/post', body: { approvalRequestId: ids.approval } }]);
  await page.getByRole('link', { name: 'Open fixed asset source' }).click();
  await expect(page.getByRole('region', { name: 'Posted depreciation journal' })).toContainText('Rp 500.000,00');
  await expect(page.getByRole('region', { name: 'Posted depreciation line mapping' })).toBeVisible();
});

for (const [name, options, warning] of [
  ['CLOSED period', { closed: true }, 'not OPEN'],
  ['stale revision', { stale: true }, 'Source revision differs'],
  ['missing posting permission', { grants: assetGrants.filter(grant => grant !== 'ACCOUNTING_JOURNAL_POST') }, 'Journal posting permission is required'],
] as const) {
  test('Stage35 blocks posting for ' + name, async ({ page }) => {
    const f = await setupAssets(page, { approved: true, ...options });
    await page.goto(approvalPath);
    await expect(page.getByText(warning, { exact: false }).first()).toBeVisible();
    if (name === 'missing posting permission') await expect(button(page, 'Post approved journal')).toHaveCount(0);
    else await expect(button(page, 'Post approved journal')).toBeDisabled();
    expect(f.writes).toHaveLength(0);
  });
}

test('Stage35 surfaces live digest and authorization failures without posting success', async ({ page }) => {
  const f = await setupAssets(page, { approved: true });
  const path = 'depreciation-runs/' + ids.run + '/post';
  f.failures.set(path, { status: 409, message: 'Depreciation preview is stale; refresh and independently approve its new version.' });
  await page.goto(approvalPath);
  await confirmApproval(page);
  await alert(page, 'Depreciation preview is stale');
  f.failures.set(path, { status: 403, message: 'Posting permission was revoked.' });
  await confirmApproval(page);
  await alert(page, 'Posting permission was revoked');
  await expect(page.getByText('Posting confirmed by backend', { exact: false })).toHaveCount(0);
  expect(f.writes).toHaveLength(2);
});

for (const action of ['ESTIMATE', 'IMPAIRMENT', 'DISPOSE', 'WRITE_OFF'] as const) {
  test('Stage35 creates a separate ' + action + ' proposal with exact evidence', async ({ page }) => {
    const f = await setupAssets(page, { noPolicy: action === 'IMPAIRMENT' });
    await page.goto(assetPath);
    await button(page, 'New lifecycle draft').click();
    await field(page, 'Lifecycle action').selectOption(action);
    await field(page, 'Effective date').fill('2026-12-01');
    await field(page, 'Audit reason').fill('Synthetic reviewed lifecycle evidence');
    if (action === 'ESTIMATE' || action === 'IMPAIRMENT') {
      await field(page, 'Remaining life (months)').fill('12');
      await field(page, 'Revised residual value').fill('10.01');
    }
    if (action === 'IMPAIRMENT') {
      await field(page, 'Assessed recoverable amount').fill('3000000.01');
      await field(page, 'Impairment assessment evidence').fill('Synthetic explicit valuation assessment');
      await expect(page.getByRole('dialog').getByText(/PENDING_POLICY/)).toBeVisible();
      await expect(field(page, 'Lifecycle action').locator('option[value="IMPAIRMENT_REVERSAL"]')).toHaveCount(0);
    }
    if (action === 'DISPOSE') {
      await field(page, 'Disposal proceeds').fill('5000000.01');
      await field(page, 'Sale consideration journal ID').fill(ids.proceedsJournal);
      await button(page, 'Load sale consideration journal').click();
      await field(page, 'Sale consideration line').selectOption(ids.proceedsLine);
      await expect(page.getByRole('link', { name: 'View AR evidence document' })).toHaveAttribute('href', '/accounting/receivables/' + ids.ar);
    }
    await confirmSource(page);
    await page.getByRole('link', { name: 'Open change draft' }).click();
    await expect(page.getByRole('heading', { name: 'Asset change detail' })).toBeVisible();
    expect(f.writes[0]).toMatchObject({ path: 'assets/' + ids.asset + '/changes', body: { action, effectiveDate: '2026-12-01' } });
    if (action === 'DISPOSE') expect(f.writes[0].body).toMatchObject({ proceeds: '5000000.01', considerationJournalLineId: ids.proceedsLine, costJournalLineId: null });
    if (action === 'ESTIMATE') expect(f.writes[0].body).toMatchObject({ remainingLifeMonths: 12, residualValue: '10.01' });
    if (action === 'IMPAIRMENT') {
      expect(f.writes[0].body).toMatchObject({ recoverableAmount: '3000000.01', assessmentEvidence: 'Synthetic explicit valuation assessment' });
      await expect(button(page, 'Submit for approval')).toBeDisabled();
    }
    expect(f.writes).toHaveLength(1);
  });
}

test('Stage35 disposed asset shows actual posted gain and suppresses lifecycle creation', async ({ page }) => {
  const f = await setupAssets(page);
  f.asset.status = 'DISPOSED';
  f.asset.disposedOn = '2026-11-30';
  f.asset.depreciationState = 'STOPPED_DISPOSAL';
  f.asset.relFkAccFixedAssetDisposal = f.disposalJournal;
  await page.goto(assetPath);
  await expect(page.getByText('Posted disposal gain · Rp 800.000,01')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Posted disposal journal' })).toContainText('Synthetic disposal gain');
  await expect(button(page, 'New lifecycle draft')).toHaveCount(0);
});

test('Stage35 approved sale uses the existing asset posting endpoint and exposes its posted lines', async ({ page }) => {
  const f = await setupAssets(page, { approved: true });
  f.setChangeApproval({ action: 'DISPOSE', effectiveDate: '2026-11-30', reason: 'Synthetic independently reviewed sale',
    proceeds: '5000000.01', considerationJournalLineId: ids.proceedsLine, costJournalLineId: null });
  await page.goto(approvalPath);
  await expect(page.getByRole('heading', { name: 'Asset change evidence' })).toBeVisible();
  await expect(page.getByText(/Synthetic independently reviewed sale/).first()).toBeVisible();
  await confirmApproval(page);
  await success(page, 'Posting confirmed by backend');
  expect(f.writes).toMatchObject([{ path: 'asset-changes/' + ids.change + '/post', body: { approvalRequestId: ids.approval } }]);
  await page.getByRole('link', { name: 'Open fixed asset source' }).click();
  await expect(page.getByRole('region', { name: 'Posted asset change journal lines' })).toContainText('Rp 800.000,01');
});

test('Stage35 GL reconciliation exposes capacity errors, mismatch and empty scope without writes', async ({ page }) => {
  const f = await setupAssets(page);
  f.failures.set('assets/reconciliation', { status: 413, message: 'Asset control mapping exceeds the supported 1,000-account range.' });
  await page.goto(root + '/reconciliation');
  await alert(page, '1,000-account range');
  f.failures.clear();
  await button(page, 'Retry').click();
  await expect(page.getByRole('region', { name: 'Asset control reconciliation' })).toContainText('-Rp 1.000.000,00');
  await expect(page.getByText('MISMATCH', { exact: true }).first()).toBeVisible();
  f.reconciliation.rows.length = 0;
  f.reconciliation.reconciled = true;
  await button(page, 'Refresh reconciliation').click();
  await expect(page.getByText('UNVERIFIED', { exact: true })).toBeVisible();
  expect(f.writes).toHaveLength(0);
});

test('Stage35 report-only user cannot open asset management actions and API 403 remains explicit', async ({ page }) => {
  const f = await setupAssets(page, { grants: ['ACCOUNTING_REPORT'] });
  await page.goto(root + '/new');
  await alert(page, 'Journal management permission is required');
  f.failures.set('assets/' + ids.asset, { status: 403, message: 'Forbidden' });
  await page.goto(assetPath);
  await alert(page, 'Additional access required');
  await expect(button(page, 'New lifecycle draft')).toHaveCount(0);
  expect(f.writes).toHaveLength(0);
});

for (const [name, width, height] of [['desktop', 1440, 1000], ['tablet', 820, 1180], ['mobile', 390, 844]] as const) {
  test('Stage35 ' + name + ' assets preserve shell, tabs and table scrolling', async ({ page }, info) => {
    await page.setViewportSize({ width, height });
    const f = await setupAssets(page);
    await page.goto('/accounting');
    await expect(page.getByRole('heading', { name: 'Fixed Assets', exact: true })).toBeVisible();
    await page.getByRole('navigation', { name: 'Accounting workspace' }).getByRole('link', { name: 'Fixed Assets', exact: true }).click();
    const table = page.getByRole('region', { name: 'Fixed asset register' });
    await expect(table).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    if (name === 'mobile') expect(await table.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
    await expect(page.getByRole('tab', { name: 'Fixed Assets', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#app-sidebar').getByRole('link', { name: 'Accounting', exact: true })).toHaveAttribute('aria-current', 'page');
    await page.screenshot({ path: info.outputPath('fixed-assets-' + name + '.png'), fullPage: true, animations: 'disabled' });
    expect(f.errors).toEqual([]);
  });
}
