import { expect, test, type Page } from '@playwright/test';
import { fundGrants, ids, setupFunds } from './helpers/accounting-funds';
import { ids as core } from './helpers/accounting-core';

test.setTimeout(90_000);
const root = '/accounting/funds';
const restrictionPath = root + '/restrictions/' + ids.restriction;
const approvalPath = '/accounting/approvals?id=' + ids.approval;
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const field = (page: Page, name: string) => page.getByLabel(name, { exact: true });
const alert = (page: Page, text: string) => expect(page.getByRole('alert').filter({ hasText: text })).toBeVisible();

test('Stage36 fund register uses server search/status and labelled loaded-page class filtering', async ({ page }) => {
  const f = await setupFunds(page);
  await page.goto(root);
  const table = page.getByRole('region', { name: 'Fund register' });
  await expect(table).toContainText('Synthetic donor-restricted program');
  await field(page, 'Search code or name').fill('GENERAL');
  await expect(table).toContainText('Synthetic unrestricted fund');
  expect(f.reads.some(({ path, query }) => path === 'funds' && query.get('search') === 'GENERAL')).toBe(true);
  await field(page, 'Classification on loaded page').selectOption('UNRESTRICTED');
  await expect(table).not.toContainText('Synthetic donor-restricted program');
  await expect(page.getByText(/filter only narrows the loaded page/)).toBeVisible();
  await field(page, 'Search code or name').fill('');
  await field(page, 'Classification on loaded page').selectOption('');
  await field(page, 'Fund status').selectOption('DRAFT');
  await expect(table).toContainText('Synthetic conditional funding');
  expect(f.reads.some(({ path, query }) => path === 'funds' && query.get('status') === 'DRAFT')).toBe(true);
});

test('Stage36 fund detail separates GL, restrictions, designations, cash and campaign wallet with journal traceability', async ({ page }) => {
  const f = await setupFunds(page);
  await page.goto(root + '/' + ids.restricted);
  await expect(page.getByText('Donor Restricted', { exact: true })).toBeVisible();
  const metrics = page.getByRole('region', { name: 'Fund balance definitions' });
  await expect(metrics).toContainText('Remaining donor restrictions');
  await expect(metrics).toContainText('Rp 13.000.000,00');
  await expect(metrics).toContainText('Campaign wallet');
  await expect(metrics).toContainText('Rp 25.000.000,00');
  await expect(page.getByRole('region', { name: 'Posted fund releases' })).toContainText('RELEASE-36-OLD');
  await expect(page.getByRole('region', { name: 'Fund journal history' }).getByRole('link', { name: 'View journal' })).toBeVisible();
  expect(f.writes).toHaveLength(0);
});

test('Stage36 displays unrestricted, donor-restricted and conditional funding classifications without upgrading policy', async ({ page }) => {
  await setupFunds(page);
  await page.goto(root + '/' + ids.unrestricted);
  await expect(page.getByText('Unrestricted', { exact: true })).toBeVisible();
  await page.goto(root + '/' + ids.restricted);
  await expect(page.getByText('Donor Restricted', { exact: true })).toBeVisible();
  await page.goto(root + '/' + ids.conditional);
  await expect(page.getByRole('strong').filter({ hasText: 'Conditional Funding Review' })).toBeVisible();
  await expect(page.getByText('PENDING_POLICY', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/must not be treated as verified recognition/).first()).toBeVisible();
});

test('Stage36 creates an explicit fund policy and never creates a campaign, donation or COA account', async ({ page }) => {
  const f = await setupFunds(page);
  await page.goto(root + '/new');
  await field(page, 'Fund code').fill('NEW-36');
  await field(page, 'Fund name').fill('Synthetic new fund');
  await field(page, 'Fund classification').selectOption('UNRESTRICTED');
  await field(page, 'Effective date').fill('2026-11-01');
  await field(page, 'Source reference').fill('SYNTHETIC-BOARD-DECISION-36');
  await field(page, 'Explicit adopted policy available').check();
  await field(page, 'Contribution account').selectOption(core.account);
  await field(page, 'Balance/control account').selectOption(core.account);
  await field(page, 'Policy reference').fill('Synthetic explicit adopted fund policy');
  await button(page, 'Create draft fund').click();
  await expect(page).toHaveURL(root + '/' + ids.unrestricted);
  expect(f.writes).toHaveLength(1);
  expect(f.writes[0]).toMatchObject({ path: 'funds', body: { fundCode: 'NEW-36', fundClass: 'UNRESTRICTED', eventCampaignId: null,
    policy: { contributionAccountId: core.account, policyReference: 'Synthetic explicit adopted fund policy' } } });
});

test('Stage36 edits only a creator-owned DRAFT fund with its current revision', async ({ page }) => {
  const f = await setupFunds(page, { draftFund: true });
  await page.goto(root + '/' + ids.unrestricted);
  await field(page, 'Fund name').fill('Synthetic revised unrestricted fund');
  await button(page, 'Save draft revision').click();
  await expect(page.getByRole('heading', { name: 'GENERAL · Synthetic revised unrestricted fund' })).toBeVisible();
  expect(f.writes).toHaveLength(1);
  expect(f.writes[0]).toMatchObject({ path: `funds/${ids.unrestricted}`, method: 'PATCH', body: {
    fundName: 'Synthetic revised unrestricted fund', expectedRevision: 1,
  } });
});

for (const [kind, criterion] of [['PURPOSE', 'EXPENSE_INCURRED'], ['TIME', 'TIME_ONLY'], ['BOTH', 'CAPITAL_ACQUIRED']] as const) {
  test(`Stage36 creates ${kind} donor terms from one posted contribution without duplicate nominal`, async ({ page }) => {
    const f = await setupFunds(page);
    await page.goto(`${root}/restrictions/new?fundId=${ids.restricted}`);
    await field(page, 'Posted contribution source').selectOption(ids.sourceLine);
    await field(page, 'Restriction kind').selectOption(kind);
    await field(page, 'Satisfaction criterion').selectOption(criterion);
    await field(page, 'Effective date').fill('2026-11-02');
    if (kind !== 'PURPOSE') await field(page, 'Release-on date').fill('2026-11-10');
    await field(page, 'Supporting reference').fill('TERMS-' + kind);
    if (kind !== 'TIME') await field(page, 'Donor purpose').fill('Synthetic explicit donor purpose evidence');
    await field(page, 'Donor terms evidence').fill('Synthetic signed donor terms evidence');
    await field(page, 'Eligibility terms').fill('Synthetic precise eligibility conditions');
    await button(page, 'Create restriction draft').click();
    await expect(page).toHaveURL(restrictionPath);
    expect(f.writes[0]).toMatchObject({ path: `funds/${ids.restricted}/restrictions`, body: { sourceJournalLineId: ids.sourceLine,
      originalAmount: '20000000.00', restrictionKind: kind, criteria: { purposeCriterion: criterion } } });
    expect(f.writes[0].body).not.toHaveProperty('recognizedRevenue');
  });
}

test('Stage36 invalid restriction evidence stays in the form and backend duplicate source rejection is visible', async ({ page }) => {
  const f = await setupFunds(page);
  await page.goto(`${root}/restrictions/new?fundId=${ids.restricted}`);
  await field(page, 'Posted contribution source').selectOption(ids.sourceLine);
  await field(page, 'Effective date').fill('2026-11-02');
  await field(page, 'Supporting reference').fill('DUPLICATE-36');
  await field(page, 'Donor purpose').fill('Synthetic explicit donor purpose evidence');
  await field(page, 'Donor terms evidence').fill('Synthetic signed donor terms evidence');
  await field(page, 'Eligibility terms').fill('Synthetic precise eligibility conditions');
  f.failures.set(`funds/${ids.restricted}/restrictions`, { status: 409, message: 'Source claims exceed the actual posted contribution.' });
  await button(page, 'Create restriction draft').click();
  await alert(page, 'Source claims exceed');
  await expect(field(page, 'Supporting reference')).toHaveValue('DUPLICATE-36');
  expect(f.writes).toHaveLength(1);
});

test('Stage36 restriction detail uses backend released/remaining amounts and immutable posted evidence', async ({ page }) => {
  await setupFunds(page);
  await page.goto(restrictionPath);
  await expect(page.getByText(/Rp 20.000.000,00 \/ Rp 7.000.000,00 \/ Rp 13.000.000,00/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'View journal' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Request partial or full restriction release' })).toBeVisible();
  await expect(page.getByText(/No journal preview endpoint exists/)).toBeVisible();
});

for (const [name, amount] of [['partial', '3000000.01'], ['full', '13000000.00']] as const) {
  test(`Stage36 submits ${name} release evidence for independent approval without optimistic balance change`, async ({ page }) => {
    const f = await setupFunds(page);
    await page.goto(restrictionPath);
    await field(page, 'Proposed release amount').fill(amount);
    await field(page, 'Release reference').fill('RELEASE-' + name.toUpperCase());
    await field(page, 'Accounting date').fill('2026-11-10');
    await field(page, 'Satisfaction date').fill('2026-11-10');
    await field(page, 'Evidence reference').fill('EXPENSE-EVIDENCE-' + name);
    await field(page, 'Required posted evidence line ID').fill(ids.evidenceLine);
    await field(page, 'Target unrestricted fund').selectOption(ids.unrestricted);
    await field(page, 'Release reason').fill('Synthetic eligible donor restriction release');
    await field(page, 'Eligibility evidence').fill('Synthetic actual posted program expense evidence');
    await button(page, 'Request release approval').click();
    await button(page, 'Confirm release request').click();
    await expect(page.getByRole('link', { name: 'Open release approval request' })).toBeVisible();
    expect(f.writes[0]).toMatchObject({ path: `fund-restrictions/${ids.restriction}/releases`, body: { amount, targetFundId: ids.unrestricted,
      evidenceJournalLineId: ids.evidenceLine, expectedRevision: 1 } });
    await expect(page.getByText(/backend remaining Rp 13.000.000,00/)).toBeVisible();
  });
}

for (const [scenario, message, amount] of [
  ['over-release', 'Release exceeds remaining restriction capacity.', '13000000.01'],
  ['duplicate evidence', 'Release reference/evidence has already been used.', '3000000.00'],
] as const) {
test('Stage36 surfaces ' + scenario + ' rejection without a false success', async ({ page }) => {
  const f = await setupFunds(page);
  await page.goto(restrictionPath);
  f.failures.set(`fund-restrictions/${ids.restriction}/releases`, { status: 409, message });
  await field(page, 'Proposed release amount').fill(amount);
  await field(page, 'Release reference').fill('DUP-' + amount);
  await field(page, 'Accounting date').fill('2026-11-10');
  await field(page, 'Satisfaction date').fill('2026-11-10');
  await field(page, 'Evidence reference').fill('DUPLICATE-EVIDENCE');
  await field(page, 'Required posted evidence line ID').fill(ids.evidenceLine);
  await field(page, 'Target unrestricted fund').selectOption(ids.unrestricted);
  await field(page, 'Release reason').fill('Synthetic proposed donor release evidence');
  await field(page, 'Eligibility evidence').fill('Synthetic actual posted expense evidence');
  await button(page, 'Request release approval').click(); await button(page, 'Confirm release request').click();
  await alert(page, message.split('.')[0]);
  await expect(page.getByRole('link', { name: 'Open release approval request' })).toHaveCount(0);
});
}

test('Stage36 independent reviewer sees frozen donor evidence, approves and authorized poster applies through fund API', async ({ page }) => {
  const f = await setupFunds(page);
  await page.goto(approvalPath);
  await expect(page.getByRole('heading', { name: 'Fund Accounting approval evidence' })).toBeVisible();
  await expect(page.getByText('Rp 7.000.000,00', { exact: true }).first()).toBeVisible();
  await button(page, 'Approve request').click(); await button(page, 'Confirm Accounting action').click();
  await expect(page.getByRole('status').filter({ hasText: 'Accounting approval action confirmed' })).toBeVisible();
  await button(page, 'Post approved journal').click(); await button(page, 'Confirm Accounting action').click();
  await expect(page.getByRole('status').filter({ hasText: 'Posting confirmed by backend' })).toBeVisible();
  expect(f.writes).toMatchObject([{ path: `approvals/${ids.approval}/decision`, body: { decision: 'APPROVED' } },
    { path: `fund-restrictions/${ids.restriction}/apply`, body: { approvalRequestId: ids.approval } }]);
});

for (const [name, options, expected] of [
  ['self approval', { own: true }, 'You cannot approve or reject your own request'],
  ['CLOSED period', { approved: true, closed: true }, 'not OPEN'],
  ['missing posting grant', { approved: true, grants: fundGrants.filter(grant => grant !== 'ACCOUNTING_JOURNAL_POST') }, 'Journal posting permission is required'],
] as const) {
  test('Stage36 blocks ' + name, async ({ page }) => {
    const f = await setupFunds(page, options);
    await page.goto(approvalPath);
    await expect(page.getByText(expected, { exact: false }).first()).toBeVisible();
    if (name === 'self approval') await expect(button(page, 'Approve request')).toHaveCount(0);
    if (name === 'missing posting grant') await expect(button(page, 'Post approved journal')).toHaveCount(0);
    expect(f.writes).toHaveLength(0);
  });
}

test('Stage36 stale digest and authorization failures never report posting success', async ({ page }) => {
  const f = await setupFunds(page, { approved: true });
  const path = `fund-restrictions/${ids.restriction}/apply`;
  f.failures.set(path, { status: 409, message: 'Fund approval source digest is stale.' });
  await page.goto(approvalPath);
  await button(page, 'Post approved journal').click(); await button(page, 'Confirm Accounting action').click();
  await alert(page, 'digest is stale');
  f.failures.set(path, { status: 403, message: 'Posting permission was revoked.' });
  await button(page, 'Post approved journal').click(); await button(page, 'Confirm Accounting action').click();
  await alert(page, 'Posting permission was revoked');
  await expect(page.getByText('Posting confirmed by backend', { exact: false })).toHaveCount(0);
});

test('Stage36 internal designation is nonfinancial and adjustment/release uses a separate approved command', async ({ page }) => {
  const f = await setupFunds(page);
  await page.goto(`${root}/designations/new?fundId=${ids.unrestricted}`);
  await field(page, 'Designation reference').fill('BOARD-NEW-36');
  await field(page, 'Designated amount').fill('4000000.01');
  await field(page, 'Effective date').fill('2026-11-10');
  await field(page, 'Supporting decision and purpose').fill('Synthetic board designation decision evidence');
  await button(page, 'Create designation draft').click();
  expect(f.writes[0]).toMatchObject({ path: `funds/${ids.unrestricted}/designations`, body: { amount: '4000000.01' } });
  f.designation.status = 'ACTIVE';
  await page.goto(`${root}/designations/${ids.designation}`);
  await field(page, 'Designation command').selectOption('DESIGNATION_RELEASE');
  await field(page, 'Accounting date').fill('2026-11-10');
  await field(page, 'Command reference').fill('BOARD-RELEASE-36');
  await field(page, 'Command reason/evidence').fill('Synthetic board release decision evidence');
  await button(page, 'Create command draft').click(); await button(page, 'Confirm command').click();
  expect(f.writes[1]).toMatchObject({ path: `funds/${ids.unrestricted}/commands`, body: { action: 'DESIGNATION_RELEASE', designationId: ids.designation } });
  expect(f.writes.every(row => !row.path.includes('journals'))).toBe(true);
});

for (const sourceKind of ['STANDARD_CONTRIBUTION', 'TIME_BASED_CONTRIBUTION', 'CAMPAIGN_CONTRIBUTION'] as const) {
  test(`Stage36 displays ${sourceKind} evidence without inferring receivable, income or campaign expense`, async ({ page }) => {
    const f = await setupFunds(page); f.setSourceKind(sourceKind);
    await page.goto(`${root}/movements/new?fundId=${ids.unrestricted}`);
    await expect(field(page, 'Posted contribution source').locator('option')).toContainText([sourceKind]);
    await field(page, 'Posted contribution source').selectOption(ids.sourceLine);
    await field(page, 'Classification action').selectOption('CLASSIFY');
    await field(page, 'Source reference').fill('CLASSIFY-' + sourceKind);
    await field(page, 'Classification reason/evidence').fill('Synthetic explicit source classification evidence');
    await button(page, 'Create classification draft').click();
    expect(f.writes[0].body).not.toHaveProperty('receivable');
    expect(f.writes[0].body).not.toHaveProperty('expense');
    expect(f.writes[0].body).not.toHaveProperty('bankTransaction');
  });
}

test('Stage36 reconciliation remains read-only, reports operational scope difference and supports retry', async ({ page }) => {
  const f = await setupFunds(page);
  const path = `funds/${ids.restricted}/reconciliation`;
  f.failures.set(path, { status: 503, message: 'Synthetic reconciliation unavailable.' });
  await page.goto(`${root}/reconciliation?fundId=${ids.restricted}`);
  await alert(page, 'Synthetic reconciliation unavailable');
  f.failures.clear(); await button(page, 'Retry').click();
  await expect(page.getByRole('region', { name: 'Fund and GL reconciliation metrics' })).toContainText('Rp 13.000.000,00');
  await expect(page.getByRole('region', { name: 'Fund reconciliation exceptions' })).toContainText('OPERATIONAL_SCOPE_DIFFERENCE');
  await expect(page.getByText(/accepts no fiscal-period or as-of filter/)).toBeVisible();
  expect(f.writes).toHaveLength(0);
});

test('Stage36 report-only user sees fund evidence but no mutation controls', async ({ page }) => {
  await setupFunds(page, { grants: ['ACCOUNTING_REPORT'] });
  await page.goto(restrictionPath);
  await expect(page.getByText('DONOR-TERMS-36')).toBeVisible();
  await expect(button(page, 'Request release approval')).toBeDisabled();
  await expect(button(page, 'Request independent approval')).toHaveCount(0);
});

test('Stage36 duplicate submit protection sends one release request', async ({ page }) => {
  const f = await setupFunds(page, { delay: 300 });
  await page.goto(restrictionPath);
  await field(page, 'Proposed release amount').fill('3000000.00');
  await field(page, 'Release reference').fill('RELEASE-LOCK-36');
  await field(page, 'Accounting date').fill('2026-11-10'); await field(page, 'Satisfaction date').fill('2026-11-10');
  await field(page, 'Evidence reference').fill('LOCK-EVIDENCE-36'); await field(page, 'Required posted evidence line ID').fill(ids.evidenceLine);
  await field(page, 'Target unrestricted fund').selectOption(ids.unrestricted);
  await field(page, 'Release reason').fill('Synthetic release lock reason evidence'); await field(page, 'Eligibility evidence').fill('Synthetic release lock eligibility evidence');
  await button(page, 'Request release approval').click();
  await button(page, 'Confirm release request').evaluate((element: HTMLButtonElement) => { element.click(); element.click(); });
  await expect(page.getByRole('link', { name: 'Open release approval request' })).toBeVisible();
  expect(f.writes.filter(row => row.path.endsWith('/releases'))).toHaveLength(1);
});

for (const [name, viewport] of [['desktop', { width: 1440, height: 1000 }], ['tablet', { width: 820, height: 1180 }], ['mobile', { width: 390, height: 844 }]] as const) {
  test(`Stage36 ${name} Fund UI retains AppShell, WorkspaceTabs and contained tables`, async ({ page }) => {
    await page.setViewportSize(viewport); await setupFunds(page); await page.goto(root);
    await expect(page.getByRole('navigation', { name: 'Accounting workspace' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Fund Accounting', exact: true }).first()).toBeVisible();
    await expect(page.getByRole('region', { name: 'Fund register' })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`fund-accounting-${name}.png`), fullPage: true });
  });
}
