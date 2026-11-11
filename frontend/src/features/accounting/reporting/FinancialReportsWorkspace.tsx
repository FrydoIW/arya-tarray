'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Select } from '@/components/ui/Select';
import { AccountingStatusIndicator } from '../components/AccountingFoundation';
import { CoreCard, CoreField, CoreInput, CorePage, CoreReadState } from '../core/CoreUI';
import { useFiscalYears } from '../core/FiscalScope';
import { useCoreRead, useCoreSelection } from '../core/hooks';
import type { AccountingFiscalYear } from '../types';
import { exportFinancialStatements, financialReportQuery, readFinancialStatements, readSupportingSchedules } from './api';
import { CashFlowStatementView, ComprehensiveIncomeView, NetAssetsView, PositionStatementView } from './FinancialStatementViews';
import { SupportingSchedulesView } from './SupportingSchedulesView';
import { comparativeReport, comparativeStatus as comparativeUnavailable, type FinancialReport, type ReportScope, type StatementKind, type SupportingSchedules } from './types';
import { currentBusinessDayValue } from '@/lib/business-time';
import styles from './reporting.module.css';

const statementTabs: Array<[StatementKind, string]> = [
  ['position', 'Financial Position'],
  ['income', 'Comprehensive Income'],
  ['net-assets', 'Changes in Net Assets'],
  ['cash-flows', 'Cash Flows'],
  ['supporting-schedules', 'Supporting Schedules']
];
type ScopeState = {
  yearId: string; periodId: string; from: string; to: string;
  comparative: boolean; comparativeFrom: string; comparativeTo: string;
};
const emptyScope: ScopeState = { yearId: '', periodId: '', from: '', to: '', comparative: false, comparativeFrom: '', comparativeTo: '' };
const dayPattern = /^\d{4}-\d{2}-\d{2}$/;
const validDay = (value: string) => dayPattern.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const day = (value: string) => value.slice(0, 10);
const inRange = (today: string, year: AccountingFiscalYear) => day(year.startDate) <= today && today <= day(year.endDate);

function defaultYear(years: AccountingFiscalYear[], today: string) {
  return years.find(year => inRange(today, year)) ?? years[0];
}
function priorYear(years: AccountingFiscalYear[], year: AccountingFiscalYear) {
  return years.filter(item => item.id !== year.id && day(item.endDate) < day(year.startDate))
    .sort((left, right) => day(right.endDate).localeCompare(day(left.endDate)))[0];
}

export function FinancialReportsWorkspace({ initialStatement = 'position', initialScope }: {
  initialStatement?: StatementKind;
  initialScope?: { fiscalYearId: string; from?: string; to?: string; comparativeFrom?: string; comparativeTo?: string };
}) {
  const fiscal = useFiscalYears();
  const [scope, setScope] = useCoreSelection<ScopeState>('financial-report-scope', initialScope ? {
    yearId: initialScope.fiscalYearId, periodId: '', from: initialScope.from ?? '', to: initialScope.to ?? '',
    comparative: Boolean(initialScope.comparativeFrom && initialScope.comparativeTo),
    comparativeFrom: initialScope.comparativeFrom ?? '', comparativeTo: initialScope.comparativeTo ?? ''
  } : emptyScope, Boolean(initialScope));
  const [exporting, setExporting] = useState<'csv' | 'xlsx' | null>(null), [exportError, setExportError] = useState('');
  const today = currentBusinessDayValue(), years = fiscal.data ?? [];
  const selectedYear = years.find(year => year.id === scope.yearId);
  const selectedPeriod = selectedYear?.revFkAccPeriodFy.find(period => period.id === scope.periodId);

  useEffect(() => {
    if (!years.length) return;
    if (!selectedYear) {
      const next = defaultYear(years, today);
      setScope({ ...emptyScope, yearId: next.id, from: day(next.startDate), to: day(next.endDate) });
      return;
    }
    if (!scope.from || !scope.to) setScope({ ...scope, from: day(selectedYear.startDate), to: day(selectedYear.endDate) });
  }, [scope, selectedYear, setScope, today, years]);

  const yearStart = selectedYear ? day(selectedYear.startDate) : '', yearEnd = selectedYear ? day(selectedYear.endDate) : '';
  const datesInYear = Boolean(selectedYear && validDay(scope.from) && validDay(scope.to) && scope.from >= yearStart && scope.to <= yearEnd && scope.from <= scope.to);
  const comparativeValid = !scope.comparative || (validDay(scope.comparativeFrom) && validDay(scope.comparativeTo) && scope.comparativeFrom <= scope.comparativeTo);
  const valid = Boolean(selectedYear && datesInYear && comparativeValid);
  const reportScope: ReportScope | null = valid && selectedYear ? {
    fiscalYearId: selectedYear.id, from: scope.from, to: scope.to,
    ...(scope.comparative ? { comparativeFrom: scope.comparativeFrom, comparativeTo: scope.comparativeTo } : {})
  } : null;
  const query = reportScope ? financialReportQuery(reportScope) : '';
  const report = useCoreRead<FinancialReport>(`financial-statements?${query}`, Boolean(query) && initialStatement !== 'supporting-schedules');
  const schedules = useCoreRead<SupportingSchedules>(`financial-statements/supporting-schedules?${query}`, Boolean(query) && initialStatement === 'supporting-schedules');
  const activeRead = initialStatement === 'supporting-schedules' ? schedules : report;
  const activeReport = initialStatement === 'supporting-schedules' ? schedules.data?.report ?? null : report.data;
  const comparison = activeReport ? (comparativeReport(activeReport.comparative) ? null : comparativeUnavailable(activeReport.comparative)) : null;
  const canExport = Boolean(reportScope && activeReport && !activeRead.loading && !exporting);
  const dateMessage = !selectedYear ? 'Select a fiscal year to load a financial statement.'
    : !validDay(scope.from) || !validDay(scope.to) ? 'Choose both report dates as complete calendar dates.'
      : scope.from > scope.to ? 'The report start date must be on or before the report end date.'
        : scope.from < yearStart || scope.to > yearEnd ? `The report dates must stay inside the selected fiscal year (${yearStart}–${yearEnd}).`
          : !comparativeValid ? 'Comparative dates must both be complete and start on or before end.' : '';
  const tabHref = (kind: StatementKind) => `/accounting/financial-reports?${new URLSearchParams({
    statement: kind,
    ...(selectedYear ? { fiscalYearId: selectedYear.id } : {}),
    ...(validDay(scope.from) ? { from: scope.from } : {}), ...(validDay(scope.to) ? { to: scope.to } : {}),
    ...(scope.comparative && validDay(scope.comparativeFrom) && validDay(scope.comparativeTo) ? { comparativeFrom: scope.comparativeFrom, comparativeTo: scope.comparativeTo } : {})
  })}`;
  const glHref = (accountId?: string) => `/accounting/general-ledger?${new URLSearchParams({
    from: scope.from, to: scope.to, fiscalYearId: selectedYear?.id ?? '', ...(accountId ? { accountId } : {})
  })}`;
  const tbHref = `/accounting/trial-balance?${new URLSearchParams({ from: scope.from, to: scope.to, fiscalYearId: selectedYear?.id ?? '' })}`;
  const journalHref = (id: string) => `/accounting/journals?journalId=${encodeURIComponent(id)}`;

  function changeYear(yearId: string) {
    const next = years.find(year => year.id === yearId);
    setScope({ ...scope, yearId, periodId: '', from: next ? day(next.startDate) : '', to: next ? day(next.endDate) : '' });
  }
  function changePeriod(periodId: string) {
    const next = selectedYear?.revFkAccPeriodFy.find(period => period.id === periodId);
    setScope({ ...scope, periodId, from: next ? day(next.startDate) : yearStart, to: next ? day(next.endDate) : yearEnd });
  }
  function toggleComparative(enabled: boolean) {
    const prior = selectedYear ? priorYear(years, selectedYear) : undefined;
    setScope({ ...scope, comparative: enabled, comparativeFrom: enabled ? day(prior?.startDate ?? selectedYear?.startDate ?? '') : '', comparativeTo: enabled ? day(prior?.endDate ?? selectedYear?.endDate ?? '') : '' });
  }
  async function download(format: 'csv' | 'xlsx') {
    if (!reportScope) return;
    setExporting(format); setExportError('');
    try {
      const result = await exportFinancialStatements(reportScope, format), url = URL.createObjectURL(result.blob), anchor = document.createElement('a');
      anchor.href = url; anchor.download = result.fileName; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Financial statement export failed.');
    } finally { setExporting(null); }
  }
  const refreshing = activeRead.loading || fiscal.loading;
  return <CorePage title="Financial Statements" description="Posted-GL financial statements, policy readiness and supporting evidence. Official publication requires approved accounting policy and professional review."
    actions={<><Button variant="outline" disabled={!reportScope || refreshing} onClick={() => { fiscal.refresh(); activeRead.refresh(); }}>{refreshing ? 'Refreshing…' : 'Refresh'}</Button>
      <Button variant="outline" disabled={!canExport} onClick={() => void download('csv')}>{exporting === 'csv' ? 'Preparing CSV…' : 'Export CSV'}</Button>
      <Button variant="outline" disabled={!canExport} onClick={() => void download('xlsx')}>{exporting === 'xlsx' ? 'Preparing XLSX…' : 'Export XLSX'}</Button></>}>
    <CoreCard>
      <div className={styles.filters}>
        <CoreField label="Fiscal year"><Select aria-label="Fiscal year" value={scope.yearId} disabled={fiscal.loading} onChange={event => changeYear(event.target.value)}>
          <option value="">Select fiscal year</option>{years.map(year => <option key={year.id} value={year.id}>{year.yearCode} · {year.status}</option>)}
        </Select></CoreField>
        <CoreField label="Accounting period"><Select aria-label="Accounting period" value={scope.periodId} disabled={!selectedYear || fiscal.loading} onChange={event => changePeriod(event.target.value)}>
          <option value="">All dates in selected year</option>{selectedYear?.revFkAccPeriodFy.map(period => <option key={period.id} value={period.id}>{period.periodCode} · {period.status}</option>)}
        </Select></CoreField>
        <CoreInput label="From date" type="date" value={scope.from} min={yearStart} max={yearEnd} onChange={event => setScope({ ...scope, periodId: '', from: event.target.value })} />
        <CoreInput label="To date" type="date" value={scope.to} min={yearStart} max={yearEnd} onChange={event => setScope({ ...scope, periodId: '', to: event.target.value })} />
        <label className={styles.check}><input type="checkbox" aria-label="Include comparative period" checked={scope.comparative} onChange={event => toggleComparative(event.target.checked)} />Include comparative period</label>
        {scope.comparative ? <>
          <CoreInput label="Comparative from" type="date" value={scope.comparativeFrom} onChange={event => setScope({ ...scope, comparativeFrom: event.target.value })} />
          <CoreInput label="Comparative to" type="date" value={scope.comparativeTo} onChange={event => setScope({ ...scope, comparativeTo: event.target.value })} />
        </> : null}
      </div>
      <CoreReadState read={fiscal} />
      {!fiscal.loading && !fiscal.error && years.length === 0 ? <EmptyState title="No fiscal year available" description="Financial statements require an actual fiscal year and accounting period configuration. No year was invented." /> : null}
      {dateMessage ? <p role="alert" className={styles.warning}>{dateMessage}</p> : null}
      {selectedPeriod ? <div className={styles.actions}><AccountingStatusIndicator status={selectedPeriod.status} /><span className={styles.note}>Selected period {selectedPeriod.periodCode}: {day(selectedPeriod.startDate)}–{day(selectedPeriod.endDate)}. The report uses the explicit dates above.</span></div> : null}
      <p className={styles.note}>The request uses these exact calendar dates and the selected fiscal year. There is no silent fallback to a different reporting period. Comparative dates are resolved by the backend to the fiscal year and adopted policy that cover them.</p>
      <div className={styles.actions}><Link className={styles.link} href={glHref()}>Open General Ledger</Link><Link className={styles.link} href={tbHref}>Open Trial Balance</Link><Link className={styles.link} href="/accounting/reports">Existing donation reports</Link><Link className={styles.link} href="/accounting/reconciliation">Reconciliation & closing</Link></div>
    </CoreCard>
    <nav className={styles.statementTabs} aria-label="Financial statement views">
      {statementTabs.map(([kind, label]) => <Link key={kind} href={tabHref(kind)} aria-current={kind === initialStatement ? 'page' : undefined} className={styles.statementTab}>{label}</Link>)}
    </nav>
    {exportError ? <div className="ui-alert ui-alert-error" role="alert">{exportError}</div> : null}
    <CoreReadState read={activeRead} />
    {activeReport ? <CoreCard>
      <div className={styles.actions}><h2>Report status & accounting scope</h2><AccountingStatusIndicator status={activeReport.status} /><span className={styles.note}>Backend official flag: {String(activeReport.official)}</span></div>
      <div className={styles.warning} role="status"><strong>{activeReport.status === 'DRAFT_VERIFIED' ? 'DRAFT — backend mathematical checks passed, not an official financial statement.' : 'DRAFT / UNVERIFIED — backend reporting exceptions remain and this must not be published as official.'}</strong><br />
        These figures come exclusively from the backend posted General Ledger and its adopted policy. A balanced Trial Balance does not establish policy readiness, opening evidence or professional approval.</div>
      <dl className={styles.details}>
        <dt>Report dates</dt><dd>{activeReport.scope.from} – {activeReport.scope.to} (inclusive)</dd>
        <dt>Comparative dates</dt><dd>{scope.comparative ? `${scope.comparativeFrom} – ${scope.comparativeTo}` : 'Not requested'}</dd>
        <dt>Fiscal year revision</dt><dd>{activeReport.fiscalYearRevision}</dd>
        <dt>Policy</dt><dd>{activeReport.policyReference ?? 'PENDING_POLICY'}{activeReport.policyId ? ` · ${activeReport.policyId}` : ''}</dd>
        <dt>Ledger fingerprint</dt><dd className={styles.wrap}>{activeReport.ledgerFingerprint}</dd>
        <dt>Basis</dt><dd>{activeReport.basis}</dd>
      </dl>
      {comparison ? <div className={styles.warning} role="alert">Comparative report is {comparison.status}. {comparison.exceptions.join(' ') || 'No comparative exception detail was returned.'} No comparative values are inferred.</div> : null}
      <h3>Backend reporting exceptions ({activeReport.exceptions.length})</h3>
      {activeReport.exceptions.length ? <ul className={styles.exceptionList}>{activeReport.exceptions.map((exception, index) => <li className={styles.exception} key={`${exception}-${index}`}>{exception}</li>)}</ul>
        : <p className={styles.note}>No backend reporting exception was returned for this scope. This does not certify official readiness.</p>}
    </CoreCard> : null}
    {activeReport && initialStatement === 'position' ? <PositionStatementView report={activeReport} drilldown={glHref} /> : null}
    {activeReport && initialStatement === 'income' ? <ComprehensiveIncomeView report={activeReport} tbHref={tbHref} /> : null}
    {activeReport && initialStatement === 'net-assets' ? <NetAssetsView report={activeReport} /> : null}
    {activeReport && initialStatement === 'cash-flows' ? <CashFlowStatementView report={activeReport} journalHref={journalHref} /> : null}
    {schedules.data && initialStatement === 'supporting-schedules' ? <SupportingSchedulesView schedules={schedules.data} drilldown={glHref} tbHref={tbHref} /> : null}
  </CorePage>;
}
