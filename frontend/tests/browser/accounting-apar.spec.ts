import { expect, test, type Page } from '@playwright/test';
import type { Side } from '../../src/features/accounting/apar/types';
import { aparGrants, aparIds, postedId, routes, setupAparBrowser, sourceDate } from './helpers/accounting-apar';
import { ids } from './helpers/accounting-core';
import { browserActor } from './helpers/accounting-workspace';

test.setTimeout(90000);
type Fixture = Awaited<ReturnType<typeof setupAparBrowser>>;

async function submitForApproval(page: Page) {
  await page.getByRole('button', { name: 'Request approval', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Request approval' });
  await dialog.getByRole('button', { name: 'Review action' }).click();
  await dialog.getByRole('button', { name: 'Confirm request approval' }).click();
  await expect(page.getByRole('link', { name: 'Open approval', exact: true })).toBeVisible();
}

async function confirmDecision(page: Page, decision: 'Approve' | 'Reject' | 'Post approved journal') {
  await page.getByRole('button', { name: decision === 'Post approved journal' ? decision : decision + ' request', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm Accounting action' }).click();
}

async function reviewAndPost(page: Page, fixture: Fixture, sourceId: string) {
  const approval = [...fixture.approvals.values()].find(row => row.sourceDocumentId === sourceId && row.status === 'PENDING')!;
  expect(approval).toBeDefined();
  fixture.setActor(approval.approvers[0].approverUserId);
  await page.goto('/accounting/approvals?id=' + approval.id);
  await confirmDecision(page, 'Approve');
  await confirmDecision(page, 'Post approved journal');
  await expect(page.getByText('APPLIED', { exact: true }).first()).toBeVisible();
  expect(approval.status).toBe('APPLIED');
}

async function fillDocument(page: Page, side: Side, reference: string) {
  await expect(page.getByRole('heading', { name: side === 'ap' ? 'New invoice' : 'New receivable', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: side === 'ap' ? 'Vendor' : 'Debtor', exact: true }).selectOption(aparIds.party);
  await page.getByLabel('Document number', { exact: true }).fill(reference);
  await page.getByLabel('Supporting reference', { exact: true }).fill('EVIDENCE-33');
  await page.getByLabel(side === 'ap' ? 'Invoice evidence and basis' : 'Recognition evidence and basis', { exact: true }).fill('Signed evidence for delivered services.');
  await page.getByRole('combobox', { name: 'Control account', exact: true }).selectOption(side === 'ap' ? aparIds.liability : aparIds.receivable);
  await page.getByRole('combobox', { name: 'Offset account 1', exact: true }).selectOption(side === 'ap' ? ids.expense : ids.income);
  await page.getByLabel('Line description 1', { exact: true }).fill('Delivered services');
}

async function fillSettlement(page: Page, side: Side, reference: string, amount: string) {
  await expect(page.getByRole('heading', { name: side === 'ap' ? 'New payment' : 'New receipt', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: side === 'ap' ? 'Vendor' : 'Debtor', exact: true }).selectOption(aparIds.party);
  await page.getByLabel('Settlement reference', { exact: true }).fill(reference);
  await page.getByLabel('Supporting reference', { exact: true }).fill('TRANSFER-EVIDENCE');
  await page.getByLabel('Settlement amount', { exact: true }).fill(amount);
  await page.getByRole('combobox', { name: 'Bank account', exact: true }).selectOption(aparIds.bank);
  await page.getByRole('combobox', { name: 'Bank GL account', exact: true }).selectOption(ids.account);
}

async function allocate(page: Page, document: string, amount: string) {
  await page.getByRole('button', { name: 'Allocate to ' + document, exact: true }).click();
  await page.getByLabel('Allocate ' + document, { exact: true }).fill(amount);
}

test('shared counterparty list, create, edit and related AP/AR views', async ({ page }) => {
  const fixture = await setupAparBrowser(page);
  await page.goto('/accounting/counterparties');
  await expect(page.getByRole('link', { name: 'Fixture Vendor and Debtor' })).toBeVisible();
  await page.getByRole('button', { name: 'New counterparty' }).click();
  await page.getByLabel('Counterparty code', { exact: true }).fill('PARTY-NEW');
  await page.getByLabel('Display name', { exact: true }).fill('New shared counterparty');
  await page.getByRole('button', { name: 'Review counterparty' }).click();
  await page.getByRole('button', { name: 'Confirm counterparty' }).click();
  await page.getByRole('link', { name: 'New shared counterparty', exact: true }).click();
  await page.getByRole('button', { name: 'Edit counterparty' }).click();
  await expect(page.getByLabel('Counterparty code', { exact: true })).toBeDisabled();
  await page.getByLabel('Display name', { exact: true }).fill('Edited counterparty');
  await page.getByRole('checkbox', { name: 'Active' }).uncheck();
  await page.getByRole('button', { name: 'Review counterparty' }).click();
  await page.getByRole('button', { name: 'Confirm counterparty' }).click();
  await expect(page.getByRole('heading', { name: /Edited counterparty/ })).toBeVisible();
  expect(fixture.calls.find(call => call.method === 'PATCH')?.body).toEqual({ displayName: 'Edited counterparty', activeFlag: false });
  const link = page.getByRole('link', { name: 'Related AR documents' });
  const relatedId = (await link.getAttribute('href'))?.split('counterpartyId=')[1];
  await link.click();
  await expect.poll(() => fixture.calls.some(call => call.path === 'ar/documents' && call.query.get('counterpartyId') === relatedId)).toBe(true);
  expect(fixture.errors).toEqual([]);
});

for (const side of ['ap', 'ar'] as const) {
  const noun = side === 'ap' ? 'invoice' : 'receivable';
  const settlement = side === 'ap' ? 'payment' : 'receipt';
  const reference = side.toUpperCase() + '-CREATED';
  const first = side.toUpperCase() + '-001';
  const second = side.toUpperCase() + '-002';
  const partial = side === 'ap' ? '3000000.00' : '4000000.00';
  const remaining = side === 'ap' ? '5000000.00' : '6000000.00';

  test(side.toUpperCase() + ' document create, revision, evidence, independent approval and authorized posting', async ({ page }) => {
    const fixture = await setupAparBrowser(page);
    await page.goto(routes[side]);
    await expect(page.getByRole('link', { name: first, exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'New ' + noun, exact: true }).click();
    await fillDocument(page, side, reference);
    await page.getByLabel('Line amount 1', { exact: true }).fill('1234.567');
    await page.getByRole('button', { name: 'Review draft', exact: true }).click();
    await expect(page.getByText('Each line needs an offset account, description and positive exact amount.')).toBeVisible();
    expect(fixture.calls.some(call => call.method === 'POST' && call.path === side + '/documents')).toBe(false);
    await page.getByLabel('Line amount 1', { exact: true }).fill('1234.56');
    await page.getByRole('button', { name: 'Review draft', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm save draft', exact: true }).click();
    await page.getByRole('link', { name: 'Open saved ' + noun }).click();
    await expect(page.getByRole('heading', { name: reference, exact: true })).toBeVisible();
    await expect(page.getByText('Signed evidence for delivered services.', { exact: true })).toBeVisible();
    const doc = [...fixture.documents.values()].find(row => row.documentNumber === reference)!;
    expect(doc.lines[0].amount).toBe('1234.56');
    await page.getByRole('link', { name: 'Edit draft', exact: true }).click();
    await page.getByLabel('Supporting reference', { exact: true }).fill('REVISED-EVIDENCE');
    await page.getByRole('button', { name: 'Review draft', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm save draft', exact: true }).click();
    await page.getByRole('link', { name: 'Open saved ' + noun }).click();
    expect(fixture.calls.find(call => call.method === 'PATCH')?.body.expectedRevision).toBe(1);
    await submitForApproval(page);
    await page.getByRole('link', { name: 'Open approval', exact: true }).click();
    await expect(page.getByText('REVISED-EVIDENCE', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve request', exact: true })).toHaveCount(0);
    const approval = [...fixture.approvals.values()][0];
    expect(approval.sourceVersion).toBe(2);
    fixture.setActor(aparIds.reviewer, aparGrants.filter(code => code !== 'ACCOUNTING_JOURNAL_POST'));
    await page.goto('/accounting/approvals?id=' + approval.id);
    await confirmDecision(page, 'Approve');
    await expect(page.getByText('APPROVED', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Post approved journal', exact: true })).toHaveCount(0);
    fixture.setActor(aparIds.reviewer);
    await page.reload();
    await confirmDecision(page, 'Post approved journal');
    await expect(page.getByText('APPLIED', { exact: true }).first()).toBeVisible();
    expect(fixture.calls.find(call => call.path === side + '/documents/' + doc.id + '/post')?.body).toEqual({ approvalRequestId: approval.id });
    await page.getByRole('link', { name: 'Open source · ' + reference }).click();
    await expect(page.getByText('RECOGNIZED', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Edit draft', exact: true })).toHaveCount(0);
    await page.getByRole('link', { name: 'View journal', exact: true }).first().click();
    await expect(page.getByRole('dialog', { name: 'JRN-CORE-32' })).toBeVisible();
    expect(fixture.errors).toEqual([]);
  });

  test(side.toUpperCase() + ' partial ' + settlement + ', full close with multiple allocations, as-of aging and over-allocation prevention', async ({ page }) => {
    const fixture = await setupAparBrowser(page);
    await page.goto(routes[side] + '/settlements/new');
    await fillSettlement(page, side, 'PARTIAL-33', partial);
    await allocate(page, first, '99999999.00');
    await page.getByRole('button', { name: 'Review settlement', exact: true }).click();
    await expect(page.getByText('An allocation exceeds the displayed outstanding balance.')).toBeVisible();
    expect(fixture.calls.some(call => call.method === 'POST' && call.path === side + '/settlements')).toBe(false);
    await page.getByLabel('Allocate ' + first, { exact: true }).fill(partial);
    await page.getByRole('button', { name: 'Review settlement', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm save settlement' }).click();
    await page.getByRole('link', { name: 'Open saved ' + settlement }).click();
    const firstSettlement = [...fixture.settlements.values()].find(row => row.settlementReference === 'PARTIAL-33')!;
    await page.getByRole('link', { name: 'Edit draft', exact: true }).click();
    await expect(page.getByLabel('Settlement amount', { exact: true })).toHaveValue(partial);
    await page.getByLabel('Supporting reference', { exact: true }).fill('REVISED-TRANSFER-EVIDENCE');
    await page.getByRole('button', { name: 'Review settlement', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm save settlement' }).click();
    await page.getByRole('link', { name: 'Open saved ' + settlement }).click();
    expect(fixture.calls.find(call => call.method === 'PATCH' && call.path.endsWith(firstSettlement.id))?.body.expectedRevision).toBe(1);
    await submitForApproval(page);
    await reviewAndPost(page, fixture, firstSettlement.id);
    await page.goto(routes[side] + '/' + postedId(side));
    await expect(page.getByText(side === 'ap' ? 'Rp 5.000.000,00' : 'Rp 6.000.000,00', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'PARTIAL-33', exact: true })).toBeVisible();
    await page.goto(routes[side] + '/aging');
    await expect(page.getByRole('heading', { name: 'Outstanding as of ' + sourceDate })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Outstanding balances' })).toContainText(first);
    expect(fixture.calls.some(call => call.path === side + '/aging' && call.query.get('asOf') === sourceDate)).toBe(true);
    fixture.setActor(browserActor.id);
    await page.goto(routes[side] + '/settlements/new');
    const amount = side === 'ap' ? '7000000.00' : '8000000.00';
    await fillSettlement(page, side, 'FINAL-33', amount);
    await allocate(page, first, remaining);
    await allocate(page, second, '2000000.00');
    await expect(page.getByText('Remaining Rp 0,00', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Review settlement', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm save settlement' }).click();
    await page.getByRole('link', { name: 'Open saved ' + settlement }).click();
    await submitForApproval(page);
    const finalSettlement = [...fixture.settlements.values()].find(row => row.settlementReference === 'FINAL-33')!;
    expect(finalSettlement.allocations).toHaveLength(2);
    expect(finalSettlement.bankTransactionId).toBeNull();
    await reviewAndPost(page, fixture, finalSettlement.id);
    await page.goto(routes[side] + '/settlements/' + finalSettlement.id);
    await expect(page.getByText('AWAITING_STATEMENT', { exact: true })).toBeVisible();
    await expect(page.getByText('RECONCILED', { exact: true })).toHaveCount(0);
    await page.goto(routes[side] + '/' + postedId(side));
    await expect(page.getByText('Rp 0,00', { exact: true })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Settlement history' }).or(page.getByRole('region', { name: 'Settlement history', exact: true }))).toContainText('FINAL-33');
    await page.goto(routes[side] + '/outstanding');
    await expect(page.getByRole('heading', { name: 'Outstanding as of ' + sourceDate })).toBeVisible();
    expect(fixture.calls.some(call => call.path === side + '/outstanding' && call.query.get('asOf') === sourceDate)).toBe(true);
    expect(fixture.errors).toEqual([]);
  });
}

test('bank matching uses imported evidence, preserves CHECK lifecycle and issues one match request', async ({ page }) => {
  const fixture = await setupAparBrowser(page);
  await page.goto(routes.ap + '/settlements/' + aparIds.postedPayment);
  await expect(page.getByText('AWAITING_STATEMENT', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Match imported transaction', exact: true }).click();
  const modal = page.getByRole('dialog');
  await modal.getByRole('button', { name: 'Find imported transactions' }).click();
  await modal.getByRole('button', { name: 'Use IMPORTED-DEBIT-33', exact: true }).click();
  await expect(modal.getByText('WRONG-DIRECTION-33', { exact: true })).toHaveCount(0);
  await modal.getByLabel('Reason / evidence', { exact: true }).fill('Exact imported debit verified.');
  await modal.getByRole('button', { name: 'Review action' }).click();
  const confirm = modal.getByRole('button', { name: 'Confirm match imported transaction' });
  await confirm.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(page.getByText('MATCHED_PENDING_FINALIZATION', { exact: true })).toBeVisible();
  await expect(page.getByText('CHECK / CHECK', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Match imported transaction', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Read bank matching history' }).click();
  await expect(page.getByRole('region', { name: 'Bank matching history' })).toContainText('Recorded exact imported debit evidence.');
  await expect(page.getByText('Unrelated settlement evidence.', { exact: true })).toHaveCount(0);
  const mutations = fixture.calls.filter(call => call.method !== 'GET');
  expect(mutations).toHaveLength(1);
  expect(mutations[0].body).toEqual({ bankTransactionId: aparIds.mutation, remark: 'Exact imported debit verified.' });
  expect(fixture.unhandled).toEqual([]);
});

test('source conflicts retain input, stale approval disables decision and rejection is confirmed', async ({ page }) => {
  const fixture = await setupAparBrowser(page);
  const path = 'ap/documents';
  fixture.failures.set('POST ' + path, { status: 409, message: 'Source reference already exists.' });
  await page.goto(routes.ap + '/new');
  await fillDocument(page, 'ap', 'CONFLICT-33');
  await page.getByLabel('Line amount 1', { exact: true }).fill('1234.01');
  await page.getByRole('button', { name: 'Review draft', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm save draft', exact: true }).click();
  await expect(page.getByText(/Source reference already exists/)).toBeVisible();
  await expect(page.getByLabel('Line amount 1', { exact: true })).toHaveValue('1234.01');
  fixture.failures.delete('POST ' + path);
  await page.getByRole('button', { name: 'Confirm save draft', exact: true }).click();
  await page.getByRole('link', { name: 'Open saved invoice' }).click();
  await submitForApproval(page);
  const approval = [...fixture.approvals.values()][0];
  const doc = fixture.documents.get(approval.sourceDocumentId)!;
  doc.revision += 1;
  fixture.setActor(aparIds.reviewer);
  await page.goto('/accounting/approvals?id=' + approval.id);
  await expect(page.getByText(/Source version is stale/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve request', exact: true })).toBeDisabled();
  doc.revision -= 1;
  await page.getByRole('button', { name: 'Refresh request', exact: true }).click();
  await page.getByLabel('Decision / cancellation remark', { exact: true }).fill('Source evidence needs correction.');
  await confirmDecision(page, 'Reject');
  await expect(page.getByText('REJECTED', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Post approved journal', exact: true })).toBeDisabled();
});

test('AP posting respects closed periods and exposes backend digest conflicts without retrying', async ({ page }) => {
  const fixture = await setupAparBrowser(page);
  const doc = fixture.documents.get(postedId('ap'))!;
  Object.assign(doc, { status: 'DRAFT', financialState: 'UNPOSTED', recognitionJournalId: null });
  const approval = fixture.createApproval('AP_INVOICE', doc.id, doc.revision);
  Object.assign(approval, { status: 'APPROVED', decidedById: aparIds.reviewer });
  fixture.state.year.revFkAccPeriodFy[1].status = 'CLOSED';
  await page.goto('/accounting/approvals?id=' + approval.id);
  await expect(page.getByText(/not OPEN. Posting is blocked/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Post approved journal', exact: true })).toBeDisabled();
  fixture.state.year.revFkAccPeriodFy[1].status = 'OPEN';
  await page.reload();
  const postPath = 'ap/documents/' + doc.id + '/post';
  fixture.failures.set('POST ' + postPath, { status: 409, message: 'Approved source digest no longer matches.' });
  await confirmDecision(page, 'Post approved journal');
  await expect(page.getByText(/Approved source digest no longer matches/)).toBeVisible();
  expect(fixture.calls.filter(call => call.path === postPath && call.method === 'POST')).toHaveLength(1);
  await expect(page.getByRole('link', { name: 'View journal', exact: true })).toHaveCount(0);
});

test('AR adjustment, draft withdrawal and reversal use authorized source actions', async ({ page }) => {
  const fixture = await setupAparBrowser(page);
  const documentId = postedId('ar');
  await page.goto(routes.ar + '/' + documentId);
  await page.getByRole('button', { name: 'Request AR adjustment', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Adjustment reference', { exact: true }).fill('AR-ADJ-33');
  await dialog.getByLabel('Adjustment amount', { exact: true }).fill('1000000.00');
  await dialog.getByRole('combobox', { name: 'Adjustment offset account', exact: true }).selectOption(ids.expense);
  await dialog.getByLabel('Reason / evidence', { exact: true }).fill('Documented write-off decision and evidence.');
  await dialog.getByRole('button', { name: 'Review action' }).click();
  await dialog.getByRole('button', { name: 'Confirm request ar adjustment' }).click();
  await expect(page.getByRole('link', { name: 'Open approval', exact: true })).toBeVisible();
  expect(fixture.calls.find(call => call.path.endsWith('/adjustments'))?.body).toMatchObject({
    adjustmentKind: 'DECREASE', accountingDate: sourceDate, amount: '1000000.00', offsetAccountId: ids.expense
  });
  const adjustment = [...fixture.approvals.values()].find(row => row.requestKind === 'AR_ADJUSTMENT')!;
  await reviewAndPost(page, fixture, documentId);
  expect(fixture.calls.some(call => call.path === 'approvals/' + adjustment.id + '/post')).toBe(true);
  fixture.setActor(browserActor.id);
  await page.goto(routes.ar + '/' + documentId);
  await page.getByRole('button', { name: 'Request reversal', exact: true }).click();
  await dialog.getByLabel('Reason / evidence', { exact: true }).fill('Independent reversal review requested.');
  await dialog.getByRole('button', { name: 'Review action' }).click();
  await dialog.getByRole('button', { name: 'Confirm request reversal' }).click();
  await expect.poll(() => fixture.calls.some(call => call.path === 'ar/documents/' + documentId + '/reversal-requests')).toBe(true);
  await expect(page.getByRole('link', { name: 'Open approval', exact: true })).toBeVisible();
  const reversal = [...fixture.approvals.values()].find(row => row.requestKind === 'JOURNAL_REVERSAL')!;
  await reviewAndPost(page, fixture, ids.journal);
  expect(fixture.calls.some(call => call.path === 'approvals/' + reversal.id + '/post')).toBe(true);
  fixture.setActor(browserActor.id);
  await page.goto(routes.ar + '/new');
  await fillDocument(page, 'ar', 'WITHDRAW-33');
  await page.getByLabel('Line amount 1', { exact: true }).fill('100.00');
  await page.getByRole('button', { name: 'Review draft', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm save draft', exact: true }).click();
  await page.getByRole('link', { name: 'Open saved receivable' }).click();
  await page.getByRole('button', { name: 'Withdraw draft', exact: true }).click();
  await dialog.getByLabel('Reason / evidence', { exact: true }).fill('Duplicate draft withdrawn.');
  await dialog.getByRole('button', { name: 'Review action' }).click();
  await dialog.getByRole('button', { name: 'Confirm withdraw draft' }).click();
  await expect(page.getByText('VOID', { exact: true })).toBeVisible();
  expect(fixture.calls.filter(call => call.method === 'POST' && call.path.endsWith('/post'))).toHaveLength(2);
});

test('read failure and retry, forbidden write route and permission-aware source actions', async ({ page }) => {
  const fixture = await setupAparBrowser(page, ['ACCOUNTING_REPORT']);
  fixture.failures.set('GET ap/documents', { status: 503, message: 'Payables unavailable.' });
  await page.goto(routes.ap);
  await expect(page.getByText('Payables unavailable.', { exact: true })).toBeVisible();
  fixture.failures.delete('GET ap/documents');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('link', { name: 'AP-001', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'New invoice', exact: true })).toHaveCount(0);
  await page.goto(routes.ap + '/new');
  await expect(page.getByText('Additional access required', { exact: true })).toBeVisible();
  await page.goto(routes.ap + '/' + postedId('ap'));
  await expect(page.getByText('RECOGNIZED', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Request reversal', exact: true })).toHaveCount(0);
  await page.goto(routes.ap + '/settlements/' + aparIds.postedPayment);
  await expect(page.getByText('AWAITING_STATEMENT', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Match imported transaction', exact: true })).toHaveCount(0);
  fixture.failures.set('GET ap/documents/' + postedId('ap'), { status: 403, message: 'Report access revoked.' });
  await page.goto(routes.ap + '/' + postedId('ap'));
  await expect(page.getByText('Additional access required', { exact: true })).toBeVisible();
  expect(fixture.calls.every(call => call.method === 'GET')).toBe(true);
});

for (const viewport of [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'mobile', width: 390, height: 844 }
]) {
  test('AP/AR ' + viewport.name + ' navigation and scroll containment', async ({ page }, testInfo) => {
    const fixture = await setupAparBrowser(page);
    await page.setViewportSize(viewport);
    await page.goto('/accounting');
    await page.getByRole('navigation', { name: 'Accounting workspace' }).getByRole('link', { name: 'Payables', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Accounts Payable', exact: true })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('link', { name: 'AP-001', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'AP-001', exact: true })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('table', { name: 'AP/AR documents', exact: true })).toBeVisible();
    await page.goForward();
    await expect(page.getByRole('heading', { name: 'AP-001', exact: true })).toBeVisible();
    await page.getByRole('navigation', { name: 'Accounting workspace' }).getByRole('link', { name: 'Receivables', exact: true }).click();
    await page.getByRole('link', { name: 'New receivable', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'New receivable', exact: true })).toBeVisible();
    await expect(page.getByLabel('Recognition evidence and basis', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    const table = page.getByRole('region', { name: 'Document lines', exact: true });
    if (viewport.name === 'mobile') expect(await table.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('ap-ar-' + viewport.name + '.png'), fullPage: true, animations: 'disabled' });
    expect(fixture.errors).toEqual([]);
  });
}
