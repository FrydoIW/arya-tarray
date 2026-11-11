import { expect, test, type Page } from '@playwright/test';
import { grants, ids, setupSchedules } from './helpers/accounting-schedules';

test.setTimeout(90_000);
const accrual = (id = ids.expense) => '/accounting/accruals/' + id;
const schedule = (id = ids.prepaid) => '/accounting/schedules/' + id;
const approval = (id: string) => '/accounting/approvals?id=' + id;
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const field = (page: Page, name: string) => page.getByLabel(name, { exact: true });
const confirmed = (page: Page, message: string) => expect(page.getByRole('status').filter({ hasText: message })).toBeVisible();
const alerted = (page: Page, message: string) => expect(page.getByRole('alert').filter({ hasText: message })).toBeVisible();

async function reviewAction(page: Page) {
  await button(page, 'Review action').click();
  await button(page, 'Confirm action').click();
}
async function confirmApproval(page: Page, action = 'Post approved journal') {
  await button(page, action).click();
  await button(page, 'Confirm Accounting action').click();
}
async function fillAccrual(page: Page, income = false) {
  await page.goto('/accounting/accruals/new');
  await expect(page.getByRole('heading', { name: 'New accrual draft' })).toBeVisible();
  if (income) await field(page, 'Accrual kind').selectOption('ACCRUED_INCOME');
  await field(page, 'Source reference').fill(income ? 'NEW-INC-34' : 'NEW-EXP-34');
  await field(page, income ? 'Recognition date' : 'Accounting date').fill('2026-11-09');
  await field(page, 'Service start').fill('2026-11-01');
  await field(page, 'Service end').fill('2026-11-30');
  await field(page, 'Accrual amount').fill('8000000.01');
  await field(page, income ? 'Revenue account' : 'Expense account').selectOption(income ? ids.incomeAccount : ids.expenseAccount);
  await field(page, income ? 'Accrued asset account' : 'Accrued liability account').selectOption(income ? ids.asset : ids.liability);
  await field(page, 'Recognition basis').fill('Synthetic earned right to consideration');
  await field(page, 'Policy reference').fill('Synthetic policy reference');
}
async function fillSchedulePlan(page: Page) {
  await page.goto('/accounting/schedules/new?journalId=' + ids.journal);
  await expect(page.getByRole('heading', { name: 'New recognition schedule' })).toBeVisible();
  await field(page, 'Service start').fill('2026-11-01');
  await field(page, 'Service end').fill('2026-12-31');
  await field(page, 'Original schedule amount').fill('8000000.00');
}

test('Stage34 accrual list filters and immutable posted detail show server balances and evidence', async ({ page }) => {
  const f = await setupSchedules(page);
  await page.goto('/accounting/accruals');
  await expect(page.getByRole('link', { name: 'INC-34-SYNTH' })).toBeVisible();
  await field(page, 'Kind').selectOption('ACCRUED_EXPENSE');
  await expect(page.getByRole('link', { name: 'INC-34-SYNTH' })).toHaveCount(0);
  await field(page, 'Find reference on this page').fill('unmatched');
  await expect(page.getByText('No records available', { exact: true })).toBeVisible();
  await field(page, 'Find reference on this page').fill('exp-34');
  await page.getByRole('link', { name: 'EXP-34-SYNTH' }).click();
  await expect(page.getByText('Synthetic approved service acceptance')).toBeVisible();
  await expect(page.getByText('Rp 5.000.000,00', { exact: true })).toBeVisible();
  await expect(button(page, 'Edit draft')).toHaveCount(0);
  expect(f.writes).toEqual([]);
});

test('Stage34 expense validates precision and evidence, preserves values after failure, and sends one exact draft', async ({ page }) => {
  const f = await setupSchedules(page, { draft: true, delay: 400 });
  await fillAccrual(page);
  await field(page, 'Supporting evidence').fill('Synthetic approved expense acceptance');
  await field(page, 'Accrual amount').fill('8000000.001');
  await button(page, 'Save accrual draft').click();
  await alerted(page, 'two decimal places');
  expect(f.writes).toHaveLength(0);
  await field(page, 'Accrual amount').fill('8000000.01');
  f.failures.set('accruals', { status: 503, message: 'Accrual service unavailable' });
  await button(page, 'Save accrual draft').click();
  await alerted(page, 'Accrual service unavailable');
  await expect(field(page, 'Accrual amount')).toHaveValue('8000000.01');
  f.failures.clear();
  await button(page, 'Save accrual draft').evaluate(element => {
    if (!(element instanceof HTMLButtonElement)) throw new Error('Expected a save button.');
    element.click();
    element.click();
  });
  await expect(page).toHaveURL(accrual());
  expect(f.writes).toHaveLength(2);
  expect(f.writes[1].body).toMatchObject({ amount: '8000000.01', metadata: { kind: 'ACCRUED_EXPENSE', scheduledReversalOn: null } });
});

test('Stage34 income requires evidence and does not turn commitments into automatic AR', async ({ page }) => {
  const f = await setupSchedules(page, { draft: true });
  await fillAccrual(page, true);
  await expect(page.getByText(/TIME_BASED commitments/)).toBeVisible();
  await button(page, 'Save accrual draft').click();
  await alerted(page, 'Provide evidence');
  expect(f.writes).toHaveLength(0);
  await field(page, 'Recognition evidence').fill('Synthetic earned income recognition evidence');
  await button(page, 'Save accrual draft').click();
  await expect(page).toHaveURL(accrual());
  expect(f.writes.map(write => write.path)).toEqual(['accruals']);
  expect(f.writes[0].body).toMatchObject({ metadata: { kind: 'ACCRUED_INCOME', supportingEvidence: 'Synthetic earned income recognition evidence' } });
});

test('Stage34 draft revision uses PATCH and current revision; approval submission is separate', async ({ page }) => {
  const f = await setupSchedules(page, { draft: true, ownApproval: true });
  await page.goto(accrual());
  await button(page, 'Edit draft').click();
  await field(page, 'Source reference').fill('EXP-REVISION-34');
  await button(page, 'Save accrual draft').click();
  await expect(page.getByRole('heading', { name: 'EXP-REVISION-34' })).toBeVisible();
  expect(f.writes[0]).toMatchObject({ method: 'PATCH', path: 'accruals/' + ids.expense, body: { expectedRevision: 1 } });
  await button(page, 'Submit accrual for approval').click();
  await reviewAction(page);
  await confirmed(page, 'Approval request created.');
  expect(f.writes[1]).toMatchObject({ path: 'accruals/' + ids.expense + '/submit', body: { expectedRevision: 2 } });
});

test('Stage34 independent reviewer sees digest material, decides, and posts through the accrual source endpoint', async ({ page }) => {
  const f = await setupSchedules(page, { draft: true });
  await page.goto(approval(ids.accrualApproval));
  await expect(page.getByRole('heading', { name: 'Accrual recognition evidence' })).toBeVisible();
  await expect(page.getByText('Synthetic approved service acceptance')).toBeVisible();
  await expect(button(page, 'Post approved journal')).toBeDisabled();
  await confirmApproval(page, 'Approve request');
  await confirmed(page, 'Accounting approval action confirmed');
  await confirmApproval(page);
  await confirmed(page, 'Posting confirmed by backend');
  expect(f.writes).toMatchObject([
    { path: 'approvals/' + ids.accrualApproval + '/decision', body: { decision: 'APPROVED' } },
    { path: 'accruals/' + ids.expense + '/post', body: { approvalRequestId: ids.accrualApproval } },
  ]);
});

test('Stage34 requester cannot review their own accrual and report access does not grant posting', async ({ page }) => {
  const f = await setupSchedules(page, { draft: true, ownApproval: true, grants: grants.filter(code => code !== 'ACCOUNTING_JOURNAL_POST') });
  await page.goto(approval(ids.accrualApproval));
  await expect(page.getByText(/You cannot approve or reject your own request/)).toBeVisible();
  await expect(button(page, 'Approve request')).toHaveCount(0);
  await expect(button(page, 'Post approved journal')).toHaveCount(0);
  expect(f.writes).toHaveLength(0);
});

for (const scenario of ['stale', 'closed'] as const) {
  test('Stage34 blocks ' + scenario + ' accrual posting before confirmation', async ({ page }) => {
    const f = await setupSchedules(page, { draft: true, approved: true, [scenario]: true });
    await page.goto(approval(ids.accrualApproval));
    await expect(page.getByText(scenario === 'stale' ? /Source revision differs/ : /not OPEN/)).toBeVisible();
    await expect(button(page, 'Post approved journal')).toBeDisabled();
    expect(f.writes).toHaveLength(0);
  });
}

test('Stage34 displays a server authorization rejection without claiming a journal', async ({ page }) => {
  const f = await setupSchedules(page, { draft: true, approved: true });
  f.failures.set('accruals/' + ids.expense + '/post', { status: 403, message: 'Posting permission was revoked' });
  await page.goto(approval(ids.accrualApproval));
  await confirmApproval(page);
  await alerted(page, 'Posting permission was revoked');
  await expect(page.getByText('Posting confirmed by backend', { exact: false })).toHaveCount(0);
});

test('Stage34 creates a separate adjustment draft with an exact amount and retains the original journal', async ({ page }) => {
  const f = await setupSchedules(page);
  await page.goto(accrual());
  await button(page, 'New adjustment').click();
  await field(page, 'Action accounting date').fill('2026-11-12');
  await field(page, 'Adjustment reference').fill('SYNTH-ADJ-34');
  await field(page, 'Adjustment amount').fill('50000.01');
  await field(page, 'Audit reason').fill('Synthetic corrected service evidence');
  await reviewAction(page);
  await expect(page.getByRole('region', { name: 'Accrual adjustments' })).toContainText('SYNTH-ADJ-34');
  expect(f.writes[0]).toMatchObject({ path: 'accruals/' + ids.expense + '/adjustments', body: { amount: '50000.01', adjustmentKind: 'INCREASE' } });
  await expect(page.getByText('JRN-SYNTHETIC-34', { exact: false }).first()).toBeVisible();
});

test('Stage34 opt-in scheduled reversal uses the stored date and surfaces duplicate rejection', async ({ page }) => {
  const f = await setupSchedules(page, { approved: true });
  await page.goto('/accounting/accruals/reversals');
  await field(page, 'Due as of').fill('2026-11-18');
  await page.getByRole('link', { name: 'Open accrual · ' + ids.expense }).click();
  await button(page, 'Request scheduled reversal').click();
  await expect(field(page, 'Action accounting date')).toHaveValue('2026-11-18');
  await field(page, 'Audit reason').fill('Synthetic reversal approval evidence');
  await reviewAction(page);
  await expect(page.getByRole('link', { name: 'Review reversal request' })).toHaveAttribute('href', approval(ids.reversal));
  expect(f.writes[0].body).toEqual({ remark: 'Synthetic reversal approval evidence' });
  f.failures.set('approvals/' + ids.reversal + '/post', { status: 409, message: 'Original journal has already been reversed.' });
  await page.getByRole('link', { name: 'Review reversal request' }).click();
  await confirmApproval(page);
  await alerted(page, 'Original journal has already been reversed');
});

for (const [kind, source, doc] of [['AP', ids.expense, ids.ap], ['AR', ids.income, ids.ar]] as const) {
  test('Stage34 displays ' + kind + ' clearing and on-demand settlement evidence', async ({ page }) => {
    await setupSchedules(page);
    await page.goto(accrual(source));
    await expect(page.getByRole('link', { name: kind + '-SYNTHETIC-34' })).toHaveAttribute('href', '/accounting/' + (kind === 'AP' ? 'payables' : 'receivables') + '/' + doc);
    await button(page, 'Inspect settlement').click();
    await expect(page.getByText(/Backend outstanding Rp 2.000.000,00/)).toBeVisible();
    await expect(page.getByRole('region', { name: 'Settlement allocations' })).toContainText('SETTLEMENT-SYNTHETIC-34');
  });
}

test('Stage34 linked clearing serializes only the original accrued balance offset', async ({ page }) => {
  const f = await setupSchedules(page);
  await page.route('**/api/accounting/ap/documents', route => {
    if (route.request().method() !== 'POST') return route.fallback();
    expect(route.request().postDataJSON()).toMatchObject({ accrualDraftId: ids.expense, counterpartyId: ids.vendor, controlAccountId: ids.apControl,
      lines: [{ accountingAccountId: ids.liability, amount: '3000000.01' }] });
    return route.fulfill({ status: 422, json: { message: 'Synthetic validation boundary' } });
  });
  await page.goto(accrual(ids.expense) + '/clearing');
  await field(page, 'Clearing document control account').selectOption(ids.apControl);
  await field(page, 'Document number').fill('INV-CLEAR-34');
  await field(page, 'Document source reference').fill('SYNTHETIC-CLEARING');
  await field(page, 'Document date').fill('2026-11-12');
  await field(page, 'Accounting date').fill('2026-11-12');
  await field(page, 'Due date').fill('2026-11-22');
  await field(page, 'Amount to clear').fill('3000000.01');
  await field(page, 'Clearing recognition evidence').fill('Synthetic valid clearing evidence');
  await button(page, 'Save linked clearing draft').click();
  await alerted(page, 'Synthetic validation boundary');
  await expect(field(page, 'Amount to clear')).toHaveValue('3000000.01');
  expect(f.errors).toEqual([]);
});

for (const method of ['MONTHLY_EQUAL', 'ACTUAL_DAYS', 'CUSTOM'] as const) {
  test('Stage34 shows the ' + method + ' backend allocation preview and invalidates edited inputs', async ({ page }) => {
    const f = await setupSchedules(page);
    await fillSchedulePlan(page);
    await field(page, 'Allocation method').selectOption(method);
    if (method === 'CUSTOM') {
      await button(page, 'Add custom period').click();
      await field(page, 'Period 1').selectOption(ids.november);
      await field(page, 'Recognition date 1').fill('2026-11-30');
      await field(page, 'Allocation 1').fill('8000000.01');
      await button(page, 'Preview schedule').click();
      await alerted(page, 'equal the requested amount exactly');
      expect(f.writes).toHaveLength(0);
      await field(page, 'Allocation 1').fill('8000000.00');
    }
    await button(page, 'Preview schedule').click();
    await expect(page.getByRole('region', { name: 'Backend allocation preview' })).toBeVisible();
    expect(f.writes[0]).toMatchObject({ path: 'schedules/preview', body: { allocationMethod: method, amount: '8000000.00' } });
    if (method === 'CUSTOM') expect(f.writes[0].body.customPeriods).toEqual([{ accountingPeriodId: ids.november, recognitionDate: '2026-11-30', plannedAmount: '8000000.00' }]);
    await field(page, 'Original schedule amount').fill('8000000.01');
    await expect(page.getByRole('region', { name: 'Backend allocation preview' })).toHaveCount(0);
    await expect(button(page, 'Save schedule draft')).toBeDisabled();
  });
}

test('Stage34 saves a prepayment using a posted line, backend preview and policy evidence', async ({ page }) => {
  const f = await setupSchedules(page);
  await fillSchedulePlan(page);
  await field(page, 'Schedule reference').fill('SYNTH-PREPAY-34');
  await field(page, 'Prepaid asset source line').selectOption(ids.sourceLine);
  await field(page, 'Expense account').selectOption(ids.expenseAccount);
  await field(page, 'Policy evidence').fill('Synthetic prepaid asset policy evidence');
  await field(page, 'Recognition basis').fill('Synthetic service delivery schedule');
  await button(page, 'Preview schedule').click();
  await button(page, 'Save schedule draft').click();
  await expect(page).toHaveURL(schedule());
  await expect(page.getByText('PENDING_INDEPENDENT_REVIEW', { exact: true })).toBeVisible();
  expect(f.writes[1]).toMatchObject({ path: 'schedules', body: { sourceJournalLineId: ids.sourceLine, scheduleKind: 'PREPAYMENT', amount: '8000000.00' } });
});

test('Stage34 deferred schedule saves only with an actual credit line and policy evidence', async ({ page }) => {
  const f = await setupSchedules(page);
  await fillSchedulePlan(page);
  await field(page, 'Schedule kind').selectOption('DEFERRED_INCOME');
  await expect(page.getByText(/Donor restriction by itself does not create a liability/)).toBeVisible();
  await field(page, 'Schedule reference').fill('SYNTH-DEFERRED-34');
  await field(page, 'Deferred liability source line').selectOption(f.state.journal.lines[1].id);
  await field(page, 'Revenue account').selectOption(ids.incomeAccount);
  await button(page, 'Preview schedule').click();
  await button(page, 'Save schedule draft').click();
  await alerted(page, 'Enter a reference, policy evidence, and recognition basis.');
  await field(page, 'Policy evidence').fill('Synthetic deferred liability evidence');
  await field(page, 'Recognition basis').fill('Synthetic fulfillment agreement');
  await button(page, 'Save schedule draft').click();
  await expect(page).toHaveURL(schedule(ids.deferred));
  expect(f.writes[1]).toMatchObject({ path: 'schedules', body: {
    sourceJournalLineId: f.state.journal.lines[1].id, scheduleKind: 'DEFERRED_INCOME', policyEvidence: 'Synthetic deferred liability evidence',
  } });
});

test('Stage34 submits setup and applies its independent approval without a journal', async ({ page }) => {
  const f = await setupSchedules(page, { approved: true });
  await page.goto(schedule());
  await button(page, 'Request schedule setup').click();
  await reviewAction(page);
  await page.getByRole('link', { name: 'Open approval', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Schedule approval evidence' })).toBeVisible();
  await confirmApproval(page, 'Apply approved command');
  await confirmed(page, 'No journal was created.');
  expect(f.writes).toMatchObject([
    { path: 'schedules/' + ids.prepaid + '/requests', body: { command: { action: 'SETUP' }, expectedRevision: 1 } },
    { path: 'schedules/' + ids.prepaid + '/apply', body: { approvalRequestId: ids.setup } },
  ]);
});

test('Stage34 deferred period requires fulfillment evidence, posts through the period API, and refreshes remaining balance', async ({ page }) => {
  const f = await setupSchedules(page, { approved: true });
  await page.goto(schedule(ids.deferred));
  await expect(page.getByText(/Donor restriction and deferred income are separate/)).toBeVisible();
  await expect(button(page, 'Request period recognition')).toHaveCount(1);
  await button(page, 'Request period recognition').click();
  await button(page, 'Review action').click();
  await alerted(page, 'performance obligation was fulfilled');
  expect(f.writes).toHaveLength(0);
  await field(page, 'Period fulfillment evidence').fill('Synthetic signed fulfillment document');
  await reviewAction(page);
  await page.getByRole('link', { name: 'Open approval', exact: true }).click();
  await expect(page.getByText('Synthetic signed fulfillment document')).toBeVisible();
  await confirmApproval(page);
  await confirmed(page, 'Posting confirmed by backend');
  expect(f.writes).toMatchObject([
    { path: 'schedule-periods/' + f.period.id + '/submit', body: { expectedRevision: 1, recognitionEvidence: 'Synthetic signed fulfillment document' } },
    { path: 'schedule-periods/' + f.period.id + '/post', body: { approvalRequestId: ids.periodApproval } },
  ]);
  await page.getByRole('link', { name: 'Open Accounting source' }).click();
  await expect(page.getByRole('region', { name: 'Schedule period allocations' }).getByText('POSTED', { exact: true })).toBeVisible();
  await expect(page.locator('dt').filter({ hasText: /^Remaining balance$/ }).locator('xpath=following-sibling::dd[1]')).toHaveText('Rp 4.000.000,00');
});

test('Stage34 posted reversal shows its journal and removes both reversal requests', async ({ page }) => {
  const f = await setupSchedules(page);
  if (!f.expense.postedJournal) throw new Error('Expected a posted accrual.');
  f.expense.postedJournal = { ...f.expense.postedJournal, revFkAccJournalReversal: { id: ids.recognition, journalNumber: 'REV-SYNTHETIC-34' } };
  f.expense.reconciliation = 'REVERSED';
  await page.goto(accrual());
  await expect(page.getByText(/Reversed · REV-SYNTHETIC-34/)).toBeVisible();
  await expect(button(page, 'Request reversal')).toHaveCount(0);
  await expect(button(page, 'Request scheduled reversal')).toHaveCount(0);
  expect(f.writes).toHaveLength(0);
});

test('Stage34 duplicate period posting rejection keeps the request and journal state server-authoritative', async ({ page }) => {
  const f = await setupSchedules(page, { approved: true });
  f.failures.set('schedule-periods/' + f.period.id + '/post', { status: 409, message: 'Schedule period was already posted.' });
  await page.goto(approval(ids.periodApproval));
  await confirmApproval(page);
  await alerted(page, 'Schedule period was already posted.');
  await expect(page.getByText('Posting confirmed by backend', { exact: false })).toHaveCount(0);
  expect(f.writes).toHaveLength(1);
});

test('Stage34 read error retries and forbidden data never exposes mutation actions', async ({ page }) => {
  const f = await setupSchedules(page, { grants: ['ACCOUNTING_REPORT'] });
  f.failures.set('accruals/' + ids.expense, { status: 503, message: 'Temporary accrual read error' });
  await page.goto(accrual());
  await alerted(page, 'Temporary accrual read error');
  f.failures.clear();
  await button(page, 'Retry').click();
  await expect(page.getByRole('heading', { name: 'EXP-34-SYNTH' })).toBeVisible();
  await expect(button(page, 'Request reversal')).toHaveCount(0);
  f.failures.set('accruals/' + ids.expense, { status: 403, message: 'Forbidden' });
  await button(page, 'Refresh accrual').click();
  await alerted(page, 'Additional access required');
  await expect(page.getByRole('heading', { name: 'EXP-34-SYNTH' })).toHaveCount(0);
  expect(f.writes).toHaveLength(0);
});

for (const [name, width, height] of [['desktop', 1440, 1000], ['tablet', 820, 1180], ['mobile', 390, 844]] as const) {
  test('Stage34 ' + name + ' schedule layout and workspace navigation', async ({ page }, info) => {
    await page.setViewportSize({ width, height });
    const f = await setupSchedules(page);
    await page.goto('/accounting');
    await expect(page.getByRole('heading', { name: 'Accruals & Prepayments' })).toBeVisible();
    await page.getByRole('navigation', { name: 'Accounting workspace' }).getByRole('link', { name: 'Schedules' }).click();
    await page.getByRole('link', { name: 'DEF-SYNTHETIC-34' }).click();
    const table = page.getByRole('region', { name: 'Schedule period allocations' });
    await expect(table).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    if (name === 'mobile') expect(await table.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('stage34-' + name + '.png'), fullPage: true, animations: 'disabled' });
    await expect(page.getByRole('tab', { name: 'Prepayments & Deferred Income', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#app-sidebar').getByRole('link', { name: 'Accounting', exact: true })).toHaveAttribute('aria-current', 'page');
    expect(f.errors).toEqual([]);
  });
}
