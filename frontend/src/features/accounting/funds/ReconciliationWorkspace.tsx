'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import type { AccountingPage } from '../types';
import { ChoiceField } from '../apar/fields';
import { AccountingStatusIndicator } from '../components/AccountingFoundation';
import { CoreCard, CorePage, CoreReadState, CoreTable } from '../core/CoreUI';
import { useCoreRead } from '../core/hooks';
import { accountingMoney } from '../core/presentation';
import styles from '../core/core.module.css';
import { classLabel, FundNavigation, fundsHref, movementHref, restrictionHref } from './FundUI';
import type { Fund, FundReconciliation } from './types';

export function ReconciliationWorkspace({ fundId = '' }: { fundId?: string }) {
  const router = useRouter(), funds = useCoreRead<AccountingPage<Fund>>('funds?page=1&pageSize=100');
  const fund = funds.data?.rows.find(row => row.id === fundId) ?? null;
  const read = useCoreRead<FundReconciliation>(fundId ? 'funds/' + fundId + '/reconciliation' : 'funds/disabled', !!fundId);
  const m = read.data?.metrics;
  return <CorePage title="Fund–GL reconciliation" description="Read-only current-posted-GL comparison. No automatic balancing or silent difference removal." actions={<Button variant="outline" disabled={!fundId || read.loading} onClick={read.refresh}>Refresh reconciliation</Button>}>
    <FundNavigation fund={fund} /><CoreCard><ChoiceField label="Fund scope" value={fundId} onChange={value => router.replace(`${fundsHref}/reconciliation?fundId=${value}`)} empty="Select fund" required
      choices={(funds.data?.rows ?? []).map(row => ({ id: row.id, label: `${row.fundCode} · ${row.fundName} · ${classLabel[row.fundClass]}` }))} /><CoreReadState read={funds} /><CoreReadState read={read} />
      {read.data ? <><div className={styles.summary}><AccountingStatusIndicator status={read.data.status} /><span>Scope: {m?.scope}</span></div>
        <p className={styles.note}>The backend accepts no fiscal-period or as-of filter. Results are current posted GL including reversals. Automatic adjustments: {String(read.data.automaticAdjustments)}.</p>
        {m ? <CoreTable label="Fund and GL reconciliation metrics" headers={['Measure', 'Amount', 'Accounting meaning']}>
          <tr><td>Recognized contribution classifications</td><td>{accountingMoney(m.recognizedContributionClassifications)}</td><td>Actual posted classifications, not donation creation</td></tr>
          <tr><td>Conditional liability classifications</td><td>{accountingMoney(m.classifiedConditionalLiabilityContributions)}</td><td>Liability control under explicit policy</td></tr>
          <tr><td>Accounting net assets</td><td>{accountingMoney(m.accountingNetAssets)}</td><td>Posted GL control</td></tr>
          <tr><td>Economic net resources</td><td>{accountingMoney(m.economicNetResources)}</td><td>GL net assets plus revenue less expenses</td></tr>
          <tr><td>Original restrictions</td><td>{accountingMoney(m.restrictedOriginalAmount)}</td><td>Evidenced donor terms</td></tr>
          <tr><td>Released restrictions</td><td>{accountingMoney(m.eligibleReleasedAmount)}</td><td>Active posted releases</td></tr>
          <tr><td>Remaining restrictions</td><td>{accountingMoney(m.unreleasedRestrictions)}</td><td>Original less active releases</td></tr>
          <tr><td>Internal designations</td><td>{accountingMoney(m.internalDesignations)}</td><td>Management allocation only</td></tr>
          <tr><td>Fund-tagged bank cash</td><td>{accountingMoney(m.actualFundTaggedBankCash)}</td><td>{m.cashAttribution}</td></tr>
          <tr><td>Campaign wallet</td><td>{accountingMoney(m.campaignWallet)}</td><td>{m.walletScope}</td></tr>
        </CoreTable> : null}
        <h3>Exceptions and policy gaps</h3>{read.data.exceptions.length ? <CoreTable label="Fund reconciliation exceptions" headers={['Code', 'Source', 'Reason']}>
          {read.data.exceptions.map((row, index) => <tr key={row.code + index}><td><AccountingStatusIndicator status={row.code === 'PENDING_POLICY' ? 'PENDING_POLICY' : 'UNVERIFIED'} /><br />{row.code}</td><td>{row.sourceId ? row.code.includes('DRAFT') ? <Link className={styles.link} href={movementHref(row.sourceId)}>{row.sourceId}</Link> : row.code.includes('RESTRICTION') ? <Link className={styles.link} href={restrictionHref(row.sourceId)}>{row.sourceId}</Link> : row.sourceId : 'Global/current fund'}</td><td className={styles.wrap}>{row.reason}</td></tr>)}</CoreTable> : <p className={styles.note}>No backend reconciliation exception was returned.</p>}
        {read.data.exceptionsTruncated ? <p className={styles.warning}>Exception results reached the backend safety limit. Review source data directly before relying on this view.</p> : null}
        {read.data.reviewRequests.length ? <><h3>Rejected or superseded release reviews</h3><CoreTable label="Release review history" headers={['Request', 'Restriction', 'Status', 'Remark']}>{read.data.reviewRequests.map(row => <tr key={row.id}><td><Link className={styles.link} href={'/accounting/approvals?id=' + row.id}>{row.id}</Link></td><td><Link className={styles.link} href={restrictionHref(row.sourceDocumentId)}>{row.sourceDocumentId}</Link></td><td>{row.status}</td><td>{row.decisionRemark ?? 'None'}</td></tr>)}</CoreTable></> : null}
        <p className={styles.note}>{read.data.invalidAttemptHandling}</p></> : null}
    </CoreCard>
  </CorePage>;
}
