'use client';
import Link from 'next/link';
import { AccountingStatusIndicator } from '../components/AccountingFoundation';
import { CoreCard } from '../core/CoreUI';
import { accountingMoney } from '../core/presentation';
import type { ControlReconciliation, FundReconciliation, ReconciliationException } from '../finalization/types';
import type { ReportMapping, SupportingSchedules, TrialBalanceReportRow } from './types';
import styles from './reporting.module.css';

function ExceptionList({ rows }: { rows: ReconciliationException[] }) {
  if (!rows.length) return <p className={styles.note}>No backend exception was returned for this control.</p>;
  return <ul className={styles.exceptionList}>{rows.map((row, index) => <li className={styles.exception} key={`${row.code}-${row.sourceId ?? index}`}>
    <strong>{row.code}</strong>{row.severity ? ` · ${row.severity}` : ''}{row.reason ? <><br />{row.reason}</> : null}{row.sourceId ? <><br /><span className={styles.subtle}>Source: {row.sourceId}</span></> : null}
  </li>)}</ul>;
}
function controlCard(title: string, value: ControlReconciliation, href: string) {
  return <section className={styles.subledgerCard} key={title}>
    <div className={styles.actions}><h3>{title}</h3><AccountingStatusIndicator status={value.status} /></div>
    <dl className={styles.miniDetails}><dt>Subledger</dt><dd>{accountingMoney(value.subledgerTotal)}</dd><dt>General ledger</dt><dd>{accountingMoney(value.glTotal)}</dd><dt>Difference</dt><dd className={value.difference && value.difference !== '0.00' ? styles.danger : ''}>{accountingMoney(value.difference)}</dd><dt>As of</dt><dd>{value.asOf}</dd></dl>
    {value.components ? <dl className={styles.miniDetails}><dt>Cost</dt><dd>{accountingMoney(value.components.cost)}</dd><dt>Accumulated depreciation</dt><dd>{accountingMoney(value.components.accumulatedDepreciation)}</dd><dt>Impairment</dt><dd>{accountingMoney(value.components.impairment)}</dd><dt>Carrying value</dt><dd>{accountingMoney(value.components.netCarryingValue)}</dd><dt>Depreciation expense</dt><dd>{accountingMoney(value.components.depreciationExpenseBeforeAnnualClosing)}</dd></dl> : null}
    {value.rows?.length ? <div className={styles.scroll} tabIndex={0} role="region" aria-label={`${title} control accounts`}>
      <table className={styles.statementTable}><thead><tr><th>Control account</th><th>Subledger</th><th>GL</th><th>Difference</th></tr></thead>
        <tbody>{value.rows.map(row => <tr key={row.accountId}><td>{row.accountId}</td><td className={styles.money}>{accountingMoney(row.subledger)}</td><td className={styles.money}>{accountingMoney(row.generalLedger)}</td><td className={styles.money}>{accountingMoney(row.difference)}</td></tr>)}</tbody></table>
    </div> : <p className={styles.note}>No control-account evidence rows were returned.</p>}
    <ExceptionList rows={value.exceptions} />
    {value.truncated ? <p className={styles.warning}>The backend reported truncated evidence. This control must not be treated as complete.</p> : null}
    <Link className={styles.link} href={href}>Open source workspace</Link>
  </section>;
}
function fundCard(value: FundReconciliation) {
  return <section className={styles.subledgerCard} key="Fund accounting">
    <div className={styles.actions}><h3>Fund accounting</h3><AccountingStatusIndicator status={value.status} /></div>
    <p className={styles.note}>Accounting net assets, donor restrictions, internal designations, campaign wallets and bank cash are separate concepts in this backend evidence.</p>
    {value.controls.length ? <div className={styles.scroll} tabIndex={0} role="region" aria-label="Fund control accounts">
      <table className={styles.statementTable}><thead><tr><th>Fund</th><th>Classified</th><th>Released</th><th>Remaining</th><th>GL resources</th><th>Difference</th></tr></thead>
        <tbody>{value.controls.map(row => <tr key={row.fundId}><td>{row.fundId}</td><td className={styles.money}>{accountingMoney(row.classified)}</td><td className={styles.money}>{accountingMoney(row.released)}</td><td className={styles.money}>{accountingMoney(row.remaining)}</td><td className={styles.money}>{accountingMoney(row.glNetResources)}</td><td className={styles.money}>{accountingMoney(row.difference)}</td></tr>)}</tbody></table>
    </div> : <p className={styles.note}>No fund control rows were returned for this cutoff.</p>}
    {value.conditionalControls.length ? <div className={styles.scroll} tabIndex={0} role="region" aria-label="Conditional fund controls">
      <table className={styles.statementTable}><thead><tr><th>Fund</th><th>Source classifications</th><th>Approved adjustments</th><th>GL</th><th>Difference</th></tr></thead>
        <tbody>{value.conditionalControls.map(row => <tr key={row.fundId}><td>{row.fundId}</td><td className={styles.money}>{accountingMoney(row.sourceClassifications)}</td><td className={styles.money}>{accountingMoney(row.approvedAdjustments)}</td><td className={styles.money}>{accountingMoney(row.generalLedger)}</td><td className={styles.money}>{accountingMoney(row.difference)}</td></tr>)}</tbody></table>
    </div> : null}
    {value.internalDesignations.length ? <div className={styles.scroll} tabIndex={0} role="region" aria-label="Internal management designations">
      <table className={styles.statementTable}><thead><tr><th>Fund</th><th>Designated</th><th>Management available</th><th>Financial journal created</th></tr></thead>
        <tbody>{value.internalDesignations.map(row => <tr key={row.fundId}><td>{row.fundId}</td><td className={styles.money}>{accountingMoney(row.designated)}</td><td className={styles.money}>{accountingMoney(row.managementAvailable)}</td><td>{String(row.financialJournalCreated)}</td></tr>)}</tbody></table>
    </div> : null}
    <ExceptionList rows={value.exceptions} />
    {value.truncated ? <p className={styles.warning}>The backend reported truncated fund evidence. This control must not be treated as complete.</p> : null}
    <p className={styles.note}>{value.financialSource}</p>
    <Link className={styles.link} href="/accounting/funds">Open Fund Accounting</Link>
  </section>;
}
function mappingText(row: TrialBalanceReportRow) {
  if (!row.mapping) return <span className={styles.danger}>UNMAPPED</span>;
  return <>{row.mapping.section}<br /><span className={styles.subtle}>{row.mapping.statementLine}</span></>;
}
function classText(mapping: ReportMapping | null) {
  if (!mapping) return '—';
  return [mapping.incomeClass, mapping.netAssetClass].filter(Boolean).join(' · ') || '—';
}
function flowText(mapping: ReportMapping | null) {
  if (!mapping) return '—';
  return `${mapping.cashEquivalent ? 'Cash equivalent' : 'Not cash'}${mapping.cashFlowActivity ? ` · ${mapping.cashFlowActivity}` : ''}`;
}

export function SupportingSchedulesView({ schedules, drilldown, tbHref }: { schedules: SupportingSchedules; drilldown: (accountId?: string) => string; tbHref: string }) {
  const policy = schedules.policy, report = schedules.report, subledgers = schedules.subledgers;
  return <>
    <CoreCard>
      <div className={styles.actions}><h2>Accounting policy & adopted mappings</h2>{policy ? <AccountingStatusIndicator status="APPROVED_POLICY" /> : <AccountingStatusIndicator status="PENDING_POLICY" />}</div>
      {policy ? <dl className={styles.details}>
        <dt>Policy reference</dt><dd>{policy.policyReference}</dd><dt>Framework</dt><dd>{policy.frameworkReference}</dd>
        <dt>Cash-flow method / materiality</dt><dd>{policy.cashFlowMethod} · {policy.materiality}</dd>
        <dt>Cutover evidence</dt><dd>{policy.cutoverCoverageEvidence}</dd><dt>Opening evidence</dt><dd>{policy.openingBalanceEvidence}</dd>
        <dt>AP / AR control accounts</dt><dd>{policy.controls.payable.join(', ') || 'None'} / {policy.controls.receivable.join(', ') || 'None'}</dd>
        <dt>Bank / GL mappings</dt><dd>{policy.bankAccounts.length ? policy.bankAccounts.map(bank => `${bank.bankAccountId} → ${bank.glAccountId}`).join(' · ') : 'None'}</dd>
        <dt>Annual closing mapping</dt><dd>{policy.annual ? `${policy.annual.policyReference} · unrestricted ${policy.annual.unrestrictedAccountId} · restricted ${policy.annual.restrictedAccountId}` : 'PENDING_POLICY'}</dd>
      </dl> : <p className={styles.warning}>PENDING_POLICY. No independently adopted reporting policy was returned. Statement sections, functional classes, cash equivalents, controls and annual closing mappings remain unadopted. This screen does not invent them.</p>}
    </CoreCard>
    <CoreCard>
      <div className={styles.actions}><h2>Statement mappings by account</h2><span className={styles.note}>Backend report status: {report.status} · {report.trialBalance.rows.length} account row(s)</span></div>
      <p className={styles.note}>Unmapped active posting accounts remain visible. Mapping evidence is read-only; this screen creates no COA, mapping or policy record.</p>
      <div className={styles.scroll} tabIndex={0} role="region" aria-label="Statement mappings by account">
        <table className={styles.statementTable}><thead><tr><th>Account</th><th>Type</th><th>Statement section</th><th>Functional / net-asset class</th><th>Cash-flow mapping</th><th>Closing debit minus credit</th></tr></thead>
          <tbody>{report.trialBalance.rows.map(row => <tr key={row.id}><td><Link className={styles.link} href={drilldown(row.id)}>{row.code} · {row.name}</Link></td><td>{row.accountType}</td><td>{mappingText(row)}</td><td>{classText(row.mapping)}</td><td>{flowText(row.mapping)}</td><td className={styles.money}>{accountingMoney(row.signedClosingDebit)}</td></tr>)}</tbody></table>
      </div>
      <div className={styles.actions}><Link className={styles.link} href={tbHref}>Open Trial Balance</Link><Link className={styles.link} href="/accounting/general-ledger">Open General Ledger</Link><Link className={styles.link} href="/accounting/reconciliation">Open subledger reconciliation</Link></div>
    </CoreCard>
    <CoreCard>
      <div className={styles.actions}><h2>Supporting subledger evidence</h2><AccountingStatusIndicator status={subledgers.status} /><span className={styles.note}>As of {subledgers.asOf}</span></div>
      <p className={styles.note}>Subledgers provide source classification and reconciliation evidence only. They do not add a second set of balances to the posted GL, and this screen does not recompute their totals.</p>
      <div className={styles.subledgerGrid}>
        {controlCard('Accounts payable', subledgers.ap, '/accounting/payables')}
        {controlCard('Accounts receivable', subledgers.ar, '/accounting/receivables')}
        {controlCard('Fixed assets', subledgers.assets, '/accounting/assets/reconciliation')}
        {controlCard('Accruals & prepayments', subledgers.accruals, '/accounting/accruals')}
        {fundCard(subledgers.funds)}
      </div>
    </CoreCard>
    <CoreCard>
      <h2>Narrative notes & disclosures</h2>
      <p className={styles.warning}>{schedules.narrativeStatus}. Narrative accounting policies, judgments and formal disclosures require professional preparation and approval. No fictional policy text is generated here.</p>
      <p className={styles.note}>Export is available only through the existing DRAFT CSV/XLSX reporting contract. Supporting subledger details are not silently substituted for approved narrative notes.</p>
    </CoreCard>
  </>;
}
