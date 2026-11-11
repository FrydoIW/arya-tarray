'use client';
import Link from 'next/link';
import { Fragment } from 'react';
import { AccountingStatusIndicator } from '../components/AccountingFoundation';
import { CoreCard } from '../core/CoreUI';
import { accountingMoney } from '../core/presentation';
import type { CashFlowStatement, FinancialReport, NetAssetMovement, PositionLine, TrialBalanceReportRow } from './types';
import { comparativeReport } from './types';
import styles from './reporting.module.css';

const incomeLabels: Record<string, string> = {
  CONTRIBUTIONS: 'Contributions', OTHER_INCOME: 'Other income', UNMAPPED: 'Unmapped income classification'
};
const expenseLabels: Record<string, string> = {
  PROGRAM: 'Program expenses', FUNDRAISING: 'Fundraising expenses', ADMINISTRATIVE: 'Administrative expenses',
  DEPRECIATION: 'Depreciation', OTHER_EXPENSE: 'Other recognised expenses', UNMAPPED: 'Unmapped expense classification'
};
const sectionLabels: Record<string, string> = {
  CURRENT_ASSETS: 'Current assets', NONCURRENT_ASSETS: 'Non-current assets',
  CURRENT_LIABILITIES: 'Current liabilities', NONCURRENT_LIABILITIES: 'Non-current liabilities',
  NET_ASSETS: 'Net assets'
};
const classLabels: Record<string, string> = {
  UNRESTRICTED: 'Net assets without donor restrictions', RESTRICTED: 'Net assets with donor restrictions',
  UNMAPPED: 'Unmapped net-asset class'
};
const money = (value: string | null | undefined) => <span className={styles.money}>{accountingMoney(value)}</span>;
const missing = (value: string | undefined) => value === undefined ? <span className={styles.notSupplied}>Not supplied</span> : accountingMoney(value);
const ordered = (record: Record<string, string>, preferred: string[]) =>
  [...preferred.filter(key => key in record), ...Object.keys(record).filter(key => !preferred.includes(key)).sort()];
const comparativePosition = (report: FinancialReport) => comparativeReport(report.comparative)?.financialPosition ?? null;
const comparativeIncome = (report: FinancialReport) => comparativeReport(report.comparative)?.comprehensiveIncome ?? null;
const comparativeNetAssets = (report: FinancialReport) => comparativeReport(report.comparative)?.changesInNetAssets ?? null;
const comparativeCashFlow = (report: FinancialReport) => comparativeReport(report.comparative)?.cashFlows ?? null;

function statementHeader(period: string, title: string, description: string) {
  return <div className={styles.statementHeader}><div><h2>{title}</h2><p className={styles.note}>{description}</p></div><span className={styles.periodLabel}>{period}</span></div>;
}
function exerciseLine(line: PositionLine, rows: Map<string, TrialBalanceReportRow>, comparative: Map<string, PositionLine>, drilldown: (accountId?: string) => string) {
  const account = rows.get(line.accountId);
  return <tr key={`${line.section}-${line.accountId}`}>
    <td><Link className={styles.link} href={drilldown(line.accountId)}>{account ? `${account.code} · ${line.line}` : line.line}</Link><br /><span className={styles.subtle}>{line.accountId}</span></td>
    <td className={styles.money}>{accountingMoney(line.amount)}</td>
    <td className={styles.money}>{comparative.has(line.accountId) ? accountingMoney(comparative.get(line.accountId)?.amount) : '—'}</td>
  </tr>;
}

export function PositionStatementView({ report, drilldown }: { report: FinancialReport; drilldown: (accountId?: string) => string }) {
  const current = report.financialPosition, comparative = comparativePosition(report);
  const rows = new Map(report.trialBalance.rows.map(row => [row.id, row]));
  const comparativeLines = new Map((comparative?.lines ?? []).map(line => [line.accountId, line]));
  const knownSections = new Set(['CURRENT_ASSETS', 'NONCURRENT_ASSETS', 'CURRENT_LIABILITIES', 'NONCURRENT_LIABILITIES', 'NET_ASSETS']);
  const otherLines = current.lines.filter(line => !knownSections.has(line.section));
  const group = (sections: string[]) => sections.flatMap(section => current.lines.filter(line => line.section === section));
  const assetLines = group(['CURRENT_ASSETS', 'NONCURRENT_ASSETS']), liabilityLines = group(['CURRENT_LIABILITIES', 'NONCURRENT_LIABILITIES']);
  const netAssetLines = group(['NET_ASSETS']);
  const sectionRow = (section: string) => <tr className={styles.sectionRow} key={section}><td colSpan={3}>{sectionLabels[section] ?? section}</td></tr>;
  const totalRow = (label: string, value: string | undefined, compValue: string | undefined) => <tr className={styles.total} key={label}><td>{label}</td><td className={styles.money}>{value === undefined ? 'Not supplied' : accountingMoney(value)}</td><td className={styles.money}>{comparative ? (compValue === undefined ? 'Not supplied' : accountingMoney(compValue)) : ''}</td></tr>;
  const classes = [...new Set([...Object.keys(current.netAssetClasses), ...Object.keys(comparative?.netAssetClasses ?? {})])];
  return <CoreCard>
    {statementHeader(`${report.scope.from} – ${report.scope.to}`, 'Statement of Financial Position', 'All values are backend posted-GL closing balances. The equation and totals are backend-derived; this screen adds no adjustment.')}
    {comparative ? <p className={styles.note}>Comparative statement: {comparativePosition(report) ? `${report.scope.from} – ${report.scope.to}` : ''} against the backend comparative scope. Values are shown only when the backend returned them.</p> : null}
    <div className={styles.scroll} tabIndex={0} role="region" aria-label="Statement of financial position">
      <table className={styles.statementTable}>
        <thead><tr><th>Statement line</th><th>Current period</th><th>Comparative period</th></tr></thead>
        <tbody>
          <tr className={styles.groupRow}><td colSpan={3}>Assets</td></tr>
          {['CURRENT_ASSETS', 'NONCURRENT_ASSETS'].map(section => <Fragment key={section}>{current.lines.some(line => line.section === section) ? sectionRow(section) : null}{assetLines.filter(line => line.section === section).map(line => exerciseLine(line, rows, comparativeLines, drilldown))}</Fragment>)}
          {totalRow('Total assets', current.assets, comparative?.assets)}
          <tr className={styles.groupRow}><td colSpan={3}>Liabilities</td></tr>
          {['CURRENT_LIABILITIES', 'NONCURRENT_LIABILITIES'].map(section => <Fragment key={section}>{current.lines.some(line => line.section === section) ? sectionRow(section) : null}{liabilityLines.filter(line => line.section === section).map(line => exerciseLine(line, rows, comparativeLines, drilldown))}</Fragment>)}
          {totalRow('Total liabilities', current.liabilities, comparative?.liabilities)}
          <tr className={styles.groupRow}><td colSpan={3}>Net assets</td></tr>
          {netAssetLines.length ? sectionRow('NET_ASSETS') : null}
          {netAssetLines.map(line => exerciseLine(line, rows, comparativeLines, drilldown))}
          {totalRow('Permanent net assets', current.permanentNetAssets, comparative?.permanentNetAssets)}
          {totalRow('Undistributed surplus / deficit', current.undistributedSurplusDeficit, comparative?.undistributedSurplusDeficit)}
          {totalRow('Total net assets', current.totalNetAssets, comparative?.totalNetAssets)}
          <tr className={styles.checkRow}><td>Equation check: assets − liabilities − total net assets</td><td className={current.balanced ? styles.balanced : styles.danger}>{accountingMoney(current.difference)} · {current.balanced ? 'Balanced' : 'Difference requires review'}</td><td>{comparative ? `${accountingMoney(comparative.difference)} · ${comparative.balanced ? 'Balanced' : 'Difference requires review'}` : ''}</td></tr>
        </tbody>
      </table>
    </div>
    {otherLines.length ? <div>
      <h3 className={styles.warningHeading}>Unmapped statement lines ({otherLines.length})</h3>
      <p className={styles.warning}>These accounts have no adopted statement section. They remain visible and are not silently excluded from the backend totals.</p>
      <div className={styles.scroll} tabIndex={0} role="region" aria-label="Unmapped statement lines">
        <table className={styles.statementTable}><thead><tr><th>Account</th><th>Current amount</th><th>Comparative amount</th></tr></thead>
          <tbody>{otherLines.map(line => exerciseLine(line, rows, comparativeLines, drilldown))}</tbody></table>
      </div>
    </div> : null}
    <div>
      <h3>Net assets by restriction class</h3>
      {classes.length ? <div className={styles.scroll} tabIndex={0} role="region" aria-label="Net assets by restriction class">
        <table className={styles.statementTable}><thead><tr><th>Class</th><th>Current closing</th><th>Comparative closing</th></tr></thead>
          <tbody>{classes.map(key => <tr key={key}><td>{classLabels[key] ?? key}</td><td className={styles.money}>{missing(current.netAssetClasses[key])}</td><td className={styles.money}>{comparative ? missing(comparative.netAssetClasses[key]) : ''}</td></tr>)}</tbody></table>
      </div> : <p className={styles.note}>No net-asset class was returned for this scope.</p>}
      <p className={styles.note}>A balanced equation is an arithmetic check. It does not establish policy readiness, opening evidence or official reporting status.</p>
    </div>
  </CoreCard>;
}

export function ComprehensiveIncomeView({ report, tbHref }: { report: FinancialReport; tbHref: string }) {
  const current = report.comprehensiveIncome, comparative = comparativeIncome(report);
  const categoryRows = (record: Record<string, string>, labels: Record<string, string>, preferred: string[]) =>
    ordered(record, preferred).map(key => <tr key={key}><td>{labels[key] ?? key}</td><td className={styles.money}>{missing(record[key])}</td><td className={styles.money}>{comparative ? missing(comparative.categories[key]) : ''}</td></tr>);
  return <CoreCard>
    {statementHeader(`${report.scope.from} – ${report.scope.to}`, 'Statement of Comprehensive Income', 'Backend posted-GL income and functional expense classes. Receipts are not automatically recognized income, and closing entries are excluded by the backend.')}
    <div className={styles.scroll} tabIndex={0} role="region" aria-label="Statement of comprehensive income">
      <table className={styles.statementTable}><thead><tr><th>Line</th><th>Current period</th><th>Comparative period</th></tr></thead>
        <tbody>
          <tr className={styles.groupRow}><td colSpan={3}>Income</td></tr>
          {categoryRows(current.incomeCategories, incomeLabels, ['CONTRIBUTIONS', 'OTHER_INCOME', 'UNMAPPED'])}
          <tr className={styles.total}><td>Recognized income</td><td className={styles.money}>{accountingMoney(current.recognizedIncome)}</td><td className={styles.money}>{comparative ? accountingMoney(comparative.recognizedIncome) : ''}</td></tr>
          <tr className={styles.groupRow}><td colSpan={3}>Expenses</td></tr>
          {categoryRows(current.expenseCategories, expenseLabels, ['PROGRAM', 'FUNDRAISING', 'ADMINISTRATIVE', 'DEPRECIATION', 'OTHER_EXPENSE', 'UNMAPPED'])}
          <tr className={styles.total}><td>Recognized expenses</td><td className={styles.money}>{accountingMoney(current.recognizedExpenses)}</td><td className={styles.money}>{comparative ? accountingMoney(comparative.recognizedExpenses) : ''}</td></tr>
          <tr className={styles.checkRow}><td>Surplus / deficit</td><td className={styles.money}>{accountingMoney(current.surplusDeficit)}</td><td className={styles.money}>{comparative ? accountingMoney(comparative.surplusDeficit) : ''}</td></tr>
        </tbody></table>
    </div>
    {current.incomeCategories.UNMAPPED || current.expenseCategories.UNMAPPED ? <p className={styles.warning}>An unmapped income or expense classification was returned. The backend report is consequently not fully classified; do not treat this as an adopted functional presentation.</p> : null}
    <p className={styles.note}>{current.closingEntriesExcluded ? 'Closing journals and their reversals are excluded from this income statement by the backend.' : 'The backend did not confirm closing-entry exclusion; review the report exceptions before use.'}</p>
    <div className={styles.actions}><Link className={styles.link} href={tbHref}>Review Trial Balance</Link><Link className={styles.link} href="/accounting/general-ledger">Open General Ledger</Link></div>
  </CoreCard>;
}

function netAssetKeys(entries: Record<string, NetAssetMovement>, order: string[]) {
  return [...order.filter(key => key in entries), ...Object.keys(entries).filter(key => !order.includes(key)).sort()];
}
export function NetAssetsView({ report }: { report: FinancialReport }) {
  const current = report.changesInNetAssets, comparative = comparativeNetAssets(report);
  const movementTable = (entries: Record<string, NetAssetMovement>, label: string) => {
    const keys = netAssetKeys(entries, ['UNRESTRICTED', 'RESTRICTED', 'UNMAPPED']);
    return <div>
      <h3>{label}</h3>
      {keys.length ? <div className={styles.scroll} tabIndex={0} role="region" aria-label={label}>
        <table className={styles.statementTable}><thead><tr><th>Class</th><th>Opening</th><th>Surplus / deficit</th><th>Other movements</th><th>Closing</th><th>Rollforward difference</th></tr></thead>
          <tbody>{keys.map(key => { const row = entries[key]; return row ? <tr key={key}><td>{classLabels[key] ?? key}</td><td className={styles.money}>{accountingMoney(row.opening)}</td><td className={styles.money}>{accountingMoney(row.surplusDeficit)}</td><td className={styles.money}>{accountingMoney(row.otherMovements)}</td><td className={styles.money}>{accountingMoney(row.closing)}</td><td className={row.rollforwardDifference === '0.00' ? styles.money : styles.danger}>{accountingMoney(row.rollforwardDifference)}</td></tr> : null; })}</tbody></table>
      </div> : <p className={styles.note}>No net-asset movement was returned for this scope.</p>}
    </div>;
  };
  const unmapped = 'UNMAPPED' in current || Boolean(comparative && 'UNMAPPED' in comparative);
  return <CoreCard>
    {statementHeader(`${report.scope.from} – ${report.scope.to}`, 'Statement of Changes in Net Assets', 'Backend opening, income, other actual net-asset movements and closing balances by donor-restriction class.')}
    {movementTable(current, 'Current period')}
    {comparative ? movementTable(comparative, 'Comparative period') : null}
    <p className={styles.warning}>Donor restriction releases reclassify resources between restricted and unrestricted net assets; they do not create new total net assets. Internal management designations are a subset of unrestricted resources and are not liabilities or additional net assets. <Link href="/accounting/funds">Review Fund Accounting</Link> for designation and restriction evidence.</p>
    {unmapped ? <p className={styles.warning}>An unmapped net-asset class was returned. The rollforward remains visible but the classification is not adopted.</p> : null}
    <p className={styles.note}>Each class rollforward difference is computed by the backend. A zero difference is an arithmetic check, not an official reporting certification.</p>
  </CoreCard>;
}

function cashFlowTable(current: CashFlowStatement, comparative: CashFlowStatement | null) {
  const activities = current.activities, compActivities = comparative?.activities;
  const row = (label: string, value: string | null | undefined, compValue: string | null | undefined) => <tr key={label}><td>{label}</td><td className={styles.money}>{accountingMoney(value)}</td><td className={styles.money}>{comparative ? accountingMoney(compValue) : ''}</td></tr>;
  return <div className={styles.scroll} tabIndex={0} role="region" aria-label="Statement of cash flows">
    <table className={styles.statementTable}><thead><tr><th>Direct cash flow line</th><th>Current period</th><th>Comparative period</th></tr></thead>
      <tbody>
        <tr className={styles.groupRow}><td colSpan={3}>Cash flows by activity (DIRECT method)</td></tr>
        {row('Operating activities', activities?.OPERATING, compActivities?.OPERATING)}
        {row('Investing activities', activities?.INVESTING, compActivities?.INVESTING)}
        {row('Financing activities', activities?.FINANCING, compActivities?.FINANCING)}
        {row('Net cash movement', current.netMovement, comparative?.netMovement)}
        {row('Opening cash / cash equivalents', current.opening, comparative?.opening)}
        {row('Closing cash / cash equivalents', current.closing, comparative?.closing)}
        <tr className={styles.checkRow}><td>Backend classification difference</td><td className={current.difference === '0.00' ? styles.balanced : current.difference ? styles.danger : styles.money}>{accountingMoney(current.difference)}</td><td>{comparative ? accountingMoney(comparative.difference) : ''}</td></tr>
      </tbody></table>
  </div>;
}
export function CashFlowStatementView({ report, journalHref }: { report: FinancialReport; journalHref: (id: string) => string }) {
  const current = report.cashFlows, comparative = comparativeCashFlow(report);
  const direct = current.method === 'DIRECT';
  return <CoreCard>
    {statementHeader(`${report.scope.from} – ${report.scope.to}`, 'Statement of Cash Flows', 'Backend DIRECT-method cash movement and source classification under the adopted policy. The indirect method is not implemented.')}
    <div className={styles.actions}><AccountingStatusIndicator status={current.status} /><span className={styles.note}>Method: {current.method ?? 'Not supplied'}</span></div>
    {!direct ? <p className={styles.warning}>The backend did not return a DIRECT cash-flow method for this scope. No cash-flow activity total has been inferred.</p> : null}
    {cashFlowTable(current, comparative)}
    <h3>Cash-flow source evidence ({current.sources.length})</h3>
    {current.sources.length ? <div className={styles.scroll} tabIndex={0} role="region" aria-label="Cash-flow source journals">
      <table className={styles.statementTable}><thead><tr><th>Journal</th><th>Cash movement</th><th>Classified allocations</th></tr></thead>
        <tbody>{current.sources.map(source => <tr key={source.journalId}><td><Link className={styles.link} href={journalHref(source.journalId)}>{source.journalId}</Link></td><td className={styles.money}>{accountingMoney(source.cashMovement)}</td><td>{source.allocations.length ? source.allocations.map((allocation, index) => <div key={`${allocation.sourceId}-${index}`} className={styles.allocation}>{allocation.activity} · {accountingMoney(allocation.amount)} · <span className={styles.subtle}>{allocation.sourceId}</span></div>) : <span className={styles.note}>No external allocation (internal cash movement).</span>}</td></tr>)}</tbody></table>
    </div> : <p className={styles.note}>No cash-flow journal evidence was returned for this scope.</p>}
    {current.exceptions.length ? <div><h3>Cash-flow classification exceptions ({current.exceptions.length})</h3><ul className={styles.exceptionList}>{current.exceptions.map((exception, index) => <li className={styles.exception} key={`${exception}-${index}`}>{exception}</li>)}</ul></div> : null}
    <p className={styles.note}>Internal bank transfers net to zero, depreciation does not create a cash movement, and no balancing cash-flow line is added. Only backend-returned values are shown.</p>
  </CoreCard>;
}
