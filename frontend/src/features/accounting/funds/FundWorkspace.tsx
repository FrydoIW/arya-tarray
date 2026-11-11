'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { useAuthSession } from '@/features/auth/context/AuthSessionContext';
import type { AccountingAccount, AccountingPage } from '../types';
import { JournalLink, validDay } from '../apar/fields';
import { AccountLookupSearch, AccountSelect, useAccountLookup } from '../core/AccountLookup';
import { coreQuery } from '../core/api';
import { AccountingStatusIndicator } from '../components/AccountingFoundation';
import { CoreCard, CoreFeedback, CoreField, CoreInput, CorePage, CorePagination, CoreReadState, CoreTable } from '../core/CoreUI';
import { useCoreMutation, useCoreRead, useCoreSelection } from '../core/hooks';
import { accountingMoney } from '../core/presentation';
import { journalPermissions } from '../core/contracts.generated';
import { TextArea } from '../apar/fields';
import styles from '../core/core.module.css';
import { saveFund } from './api';
import { FundSourceActions } from './FundActions';
import { classHelp, classLabel, FundClassEvidence, FundNavigation, fundHref, fundsHref } from './FundUI';
import { fundClasses, type Fund, type FundDetail, type FundInput, type FundMetrics, type FundJournal, type FundRelease } from './types';

const empty: FundInput = { fundCode: '', fundName: '', description: null, fundClass: 'UNRESTRICTED', balanceAccountId: null,
  eventCampaignId: null, effectiveOn: '', expiresOn: null, sourceReference: '', policy: null };
function inputOf(row?: Fund | null): FundInput {
  return row ? { fundCode: row.fundCode, fundName: row.fundName, description: row.description, fundClass: row.fundClass,
    balanceAccountId: row.balanceAccountId, eventCampaignId: row.eventCampaignId, effectiveOn: row.effectiveOn.slice(0, 10),
    expiresOn: row.expiresOn?.slice(0, 10) ?? null, sourceReference: row.sourceReference, policy: row.policy } : empty;
}
function valid(input: FundInput) {
  const policy = input.policy;
  return input.fundCode.trim() && input.fundName.trim() && validDay(input.effectiveOn)
    && (!input.expiresOn || validDay(input.expiresOn) && input.expiresOn >= input.effectiveOn)
    && input.sourceReference.trim() && (!policy || policy.policyReference.trim().length >= 10 && !!policy.contributionAccountId
      && (input.fundClass !== 'CONDITIONAL_LIABILITY' || (policy.conditionalObligationEvidence?.trim().length ?? 0) >= 10)
      && (input.fundClass !== 'DONOR_RESTRICTED' || !!policy.release));
}

function FundForm({ current, onSaved }: { current?: Fund | null; onSaved: (row: Fund) => void }) {
  const user = useAuthSession(), lookup = useAccountLookup(), mutation = useCoreMutation();
  const [input, setInput] = useState<FundInput>(() => inputOf(current)), canManage = user.menuCodes.includes(journalPermissions.manage);
  useEffect(() => setInput(inputOf(current)), [current]);
  const rows = lookup.read.data?.rows ?? [], policy = input.policy;
  function patch(value: Partial<FundInput>) { setInput(old => ({ ...old, ...value })); }
  function policyPatch(value: Partial<NonNullable<FundInput['policy']>>) {
    setInput(old => ({ ...old, policy: { policyReference: '', contributionAccountId: '', conditionalObligationEvidence: null, release: null, ...old.policy, ...value } }));
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (!canManage || !valid(input)) return;
    const row = await mutation.run(() => saveFund(input, current ?? undefined), current ? 'Draft fund revision saved.' : 'Draft fund created. Activation still requires independent approval.');
    if (row) onSaved(row);
  }
  return <CoreCard><h2>{current ? 'Edit draft fund' : 'Create fund'}</h2><p className={styles.note}>No campaign, donation or COA account is created automatically. Classification and mappings require explicit policy evidence.</p>
    <CoreFeedback {...mutation} /><form className={styles.page} onSubmit={submit}>
      <div className={styles.formGrid}><CoreInput label="Fund code" required maxLength={40} value={input.fundCode} onChange={e => patch({ fundCode: e.target.value })} />
        <CoreInput label="Fund name" required maxLength={200} value={input.fundName} onChange={e => patch({ fundName: e.target.value })} />
        <CoreField label="Fund classification"><Select aria-label="Fund classification" value={input.fundClass} onChange={e => patch({ fundClass: e.target.value as FundInput['fundClass'] })}>{fundClasses.map(value => <option key={value} value={value}>{classLabel[value]}</option>)}</Select></CoreField>
        <CoreInput label="Effective date" type="date" required value={input.effectiveOn} onChange={e => patch({ effectiveOn: e.target.value })} />
        <CoreInput label="Expiration date" type="date" value={input.expiresOn ?? ''} onChange={e => patch({ expiresOn: e.target.value || null })} />
        <CoreInput label="Source reference" required maxLength={255} value={input.sourceReference} onChange={e => patch({ sourceReference: e.target.value })} />
        <CoreInput label="Related campaign ID (optional)" value={input.eventCampaignId ?? ''} onChange={e => patch({ eventCampaignId: e.target.value || null })} />
      </div><TextArea label="Description" maxLength={1000} minLength={0} required={false} value={input.description ?? ''} onChange={value => patch({ description: value || null })} />
      <p className={styles.note}>{classHelp[input.fundClass]}</p>
      <label className={styles.check}><input type="checkbox" checked={!!policy} onChange={e => patch({ policy: e.target.checked ? { policyReference: '', contributionAccountId: '', conditionalObligationEvidence: null, release: null } : null })} />Explicit adopted policy available</label>
      {policy ? <><AccountLookupSearch lookup={lookup} /><div className={styles.formGrid}>
        <CoreField label="Contribution account"><AccountSelect label="Contribution account" mode="posting" rows={rows} value={policy.contributionAccountId} onChange={value => policyPatch({ contributionAccountId: value })} /></CoreField>
        <CoreField label="Balance/control account"><AccountSelect label="Balance/control account" mode="posting" rows={rows} value={input.balanceAccountId ?? ''} onChange={value => patch({ balanceAccountId: value || null })} /></CoreField>
      </div><TextArea label="Policy reference" maxLength={1000} minLength={10} value={policy.policyReference} onChange={value => policyPatch({ policyReference: value })} />
      {input.fundClass === 'CONDITIONAL_LIABILITY' ? <TextArea label="Conditional obligation evidence" maxLength={1000} minLength={10} value={policy.conditionalObligationEvidence ?? ''} onChange={value => policyPatch({ conditionalObligationEvidence: value || null })} /> : null}
      {input.fundClass === 'DONOR_RESTRICTED' ? <><label className={styles.check}><input type="checkbox" checked={!!policy.release} onChange={e => policyPatch({ release: e.target.checked ? { mode: 'REVENUE_RECLASSIFICATION', debitAccountId: '', creditAccountId: '' } : null })} />Approved release mapping available</label>
        {policy.release ? <div className={styles.formGrid}><CoreField label="Release mode"><Select aria-label="Release mode" value={policy.release.mode} onChange={e => policyPatch({ release: { ...policy.release!, mode: e.target.value as 'REVENUE_RECLASSIFICATION' | 'NET_ASSET_RECLASSIFICATION' } })}><option value="REVENUE_RECLASSIFICATION">Revenue reclassification</option><option value="NET_ASSET_RECLASSIFICATION">Net asset reclassification</option></Select></CoreField>
          <CoreField label="Restricted release debit"><AccountSelect label="Restricted release debit" mode="posting" rows={rows} value={policy.release.debitAccountId} onChange={value => policyPatch({ release: { ...policy.release!, debitAccountId: value } })} /></CoreField>
          <CoreField label="Unrestricted release credit"><AccountSelect label="Unrestricted release credit" mode="posting" rows={rows} value={policy.release.creditAccountId} onChange={value => policyPatch({ release: { ...policy.release!, creditAccountId: value } })} /></CoreField></div> : null}</> : null}</> : <p className={styles.warning}>This fund will remain PENDING_POLICY and cannot be activated or used for financial classification until an explicit policy is supplied.</p>}
      <Button type="submit" disabled={!canManage || mutation.busy || !valid(input)}>{current ? 'Save draft revision' : 'Create draft fund'}</Button>
    </form></CoreCard>;
}

function FundBalances({ id }: { id: string }) {
  const read = useCoreRead<FundMetrics>('funds/' + id + '/balances');
  const m = read.data;
  return <CoreCard><h2>Fund balance and utilization</h2><CoreReadState read={read} />{m ? <>
    <p className={styles.note}>Scope: {m.scope}. These figures remain distinct and are never combined as a generic total fund balance.</p>
    <CoreTable label="Fund balance definitions" headers={['Measure', 'Backend amount', 'Meaning']}>
      <tr><td>Accounting net assets</td><td>{accountingMoney(m.accountingNetAssets)}</td><td>Posted GL net asset control</td></tr>
      <tr><td>Economic net resources</td><td>{accountingMoney(m.economicNetResources)}</td><td>Net assets plus revenue less recognized expenses</td></tr>
      <tr><td>Remaining donor restrictions</td><td>{accountingMoney(m.unreleasedRestrictions)}</td><td>Original restriction less active releases</td></tr>
      <tr><td>Internal designations</td><td>{accountingMoney(m.internalDesignations)}</td><td>Management designation, not donor restriction</td></tr>
      <tr><td>Management available net resources</td><td>{accountingMoney(m.managementAvailableNetResources)}</td><td>Only defined by backend for unrestricted funds</td></tr>
      <tr><td>Fund-tagged bank cash</td><td>{accountingMoney(m.actualFundTaggedBankCash)}</td><td>{m.cashAttribution}</td></tr>
      <tr><td>Campaign wallet</td><td>{accountingMoney(m.campaignWallet)}</td><td>{m.walletScope}</td></tr>
    </CoreTable><p className={styles.note}>Commitments: {m.commitmentStatus}. Campaign targets and future subscriptions are not inferred as receivables, income or commitments.</p>
  </> : null}</CoreCard>;
}

function FundEvidence({ fund }: { fund: FundDetail }) {
  const releases = useCoreRead<AccountingPage<FundRelease>>(`funds/${fund.id}/releases?page=1&pageSize=25`);
  const journals = useCoreRead<AccountingPage<FundJournal>>(`funds/${fund.id}/journals?page=1&pageSize=25`);
  return <><FundBalances id={fund.id} /><CoreCard><h2>Posted release and journal traceability</h2><CoreReadState read={releases} /><CoreReadState read={journals} />
    {releases.data?.rows.length ? <CoreTable label="Posted fund releases" headers={['Reference', 'Amount', 'Release / satisfaction', 'Restriction', 'Journal']}>
      {releases.data.rows.map(row => <tr key={row.id}><td>{row.releaseReference}</td><td>{accountingMoney(row.amount)}</td><td>{row.releaseDate.slice(0, 10)} / {row.satisfactionDate.slice(0, 10)}</td><td><Link className={styles.link} href={fundsHref + '/restrictions/' + row.fundRestrictionId}>{row.fundRestrictionId}</Link></td><td><JournalLink id={row.releaseJournalId} /></td></tr>)}</CoreTable> : null}
    {journals.data?.rows.length ? <CoreTable label="Fund journal history" headers={['Journal', 'Date', 'Kind', 'Reference', 'Reversal of']}>
      {journals.data.rows.map(row => <tr key={row.id}><td><JournalLink id={row.id} /></td><td>{row.accountingDate.slice(0, 10)}</td><td>{row.journalType} · {row.sourceKind}</td><td>{row.sourceReference ?? 'None'}</td><td>{row.reversalOfJournalId ? <JournalLink id={row.reversalOfJournalId} /> : '—'}</td></tr>)}</CoreTable> : null}
  </CoreCard><CoreCard><h2>Approval and audit history</h2><p className={styles.note}>User identities remain backend IDs because this API does not expose display names. History is limited to {fund.historyLimit} records.</p>
    {fund.history.length ? <CoreTable label="Fund approval history" headers={['Request', 'Kind', 'Requester', 'Status', 'Version', 'Digest']}>
      {fund.history.map(row => <tr key={row.id}><td><Link className={styles.link} href={'/accounting/approvals?id=' + row.id}>{row.id}</Link></td><td>{row.requestKind}</td><td>{row.requestedById}</td><td><AccountingStatusIndicator status={row.status} /></td><td>{row.sourceVersion}</td><td className={styles.wrap}>{row.sourceDigest}</td></tr>)}</CoreTable> : <p className={styles.note}>No retained approval request for this fund.</p>}
  </CoreCard></>;
}

export function FundWorkspace({ id, create = false }: { id?: string; create?: boolean }) {
  const router = useRouter(), user = useAuthSession();
  const [filters, setFilters] = useCoreSelection('funds', { search: '', status: '', class: '', page: 1 });
  const read = useCoreRead<AccountingPage<Fund>>(`funds?${coreQuery({ search: filters.search, status: filters.status, page: filters.page, pageSize: 25 })}`, !id && !create);
  const detail = useCoreRead<FundDetail>(id ? 'funds/' + id : 'funds/disabled', !!id);
  const rows = (read.data?.rows ?? []).filter(row => !filters.class || row.fundClass === filters.class);
  if (create) return <CorePage title="New fund" description="Create an explicit policy-backed fund without creating donations, campaigns or COA accounts."><FundNavigation /><FundForm onSaved={row => router.push(fundHref(row.id))} /></CorePage>;
  if (id) { const fund = detail.data; return <CorePage title="Fund detail" description="Policy, balances, source history and approval evidence for one fund." actions={<Button variant="outline" onClick={detail.refresh} disabled={detail.loading}>Refresh fund</Button>}>
    <FundNavigation fund={fund} /><CoreReadState read={detail} />{fund ? <><CoreCard><div className={styles.summary}><h2>{fund.fundCode} · {fund.fundName}</h2><AccountingStatusIndicator status={fund.status} /></div><FundClassEvidence fund={fund} />
      <dl className={styles.details}><dt>Description</dt><dd>{fund.description ?? 'None'}</dd><dt>Effective / expires</dt><dd>{fund.effectiveOn.slice(0, 10)} / {fund.expiresOn?.slice(0, 10) ?? 'No expiry'}</dd><dt>Campaign reference</dt><dd>{fund.eventCampaignId ?? 'None; campaign is not inferred'}</dd><dt>Policy reference</dt><dd>{fund.policy?.policyReference ?? 'PENDING_POLICY'}</dd><dt>Control / contribution account</dt><dd>{fund.balanceAccountId ?? 'None'} / {fund.policy?.contributionAccountId ?? 'None'}</dd><dt>Created / updated by</dt><dd>{fund.createdById} / {fund.updatedById}</dd></dl>
      <div className={styles.actions}><Link className={styles.link} href={`${fundsHref}/restrictions?fundId=${fund.id}`}>Open restrictions</Link><Link className={styles.link} href={`${fundsHref}/designations?fundId=${fund.id}`}>Open designations</Link><Link className={styles.link} href={`${fundsHref}/movements?fundId=${fund.id}`}>Open movements</Link><Link className={styles.link} href={`${fundsHref}/reconciliation?fundId=${fund.id}`}>Open reconciliation</Link></div>
      <FundSourceActions path="funds" source={fund} onChanged={detail.refresh} /></CoreCard>
      {fund.status === 'DRAFT' && fund.createdById === user.id && user.menuCodes.includes(journalPermissions.manage) ? <FundForm current={fund} onSaved={() => detail.refresh()} /> : null}<FundEvidence fund={fund} /></> : null}
  </CorePage>; }
  return <CorePage title="Fund Accounting" description="Fund register, donor restrictions, internal designations and posted GL evidence." actions={<Link className={styles.link} href={fundsHref + '/new'}>New fund</Link>}>
    <FundNavigation /><CoreCard><div className={styles.filters}><CoreInput label="Search code or name" value={filters.search} onChange={e => setFilters({ ...filters, search: e.target.value, page: 1 })} />
      <CoreField label="Fund status"><Select aria-label="Fund status" value={filters.status} onChange={e => setFilters({ ...filters, status: e.target.value, page: 1 })}><option value="">All statuses</option>{['DRAFT', 'ACTIVE', 'CLOSED'].map(value => <option key={value}>{value}</option>)}</Select></CoreField>
      <CoreField label="Classification on loaded page"><Select aria-label="Classification on loaded page" value={filters.class} onChange={e => setFilters({ ...filters, class: e.target.value, page: 1 })}><option value="">All loaded classes</option>{fundClasses.map(value => <option key={value} value={value}>{classLabel[value]}</option>)}</Select></CoreField></div>
      <p className={styles.note}>Search and status are server filters. The backend has no classification query, so that filter only narrows the loaded page and is labelled accordingly.</p><CoreReadState read={read} empty={rows.length === 0} />
      {read.data && !read.loading && !read.error ? <><CoreTable label="Fund register" headers={['Fund', 'Classification', 'Effective / expires', 'Campaign', 'Policy', 'Status']}>
        {rows.map(row => <tr key={row.id}><td><Link className={styles.link} href={fundHref(row.id)}>{row.fundCode} · {row.fundName}</Link></td><td>{classLabel[row.fundClass]}</td><td>{row.effectiveOn.slice(0, 10)} / {row.expiresOn?.slice(0, 10) ?? 'No expiry'}</td><td>{row.eventCampaignId ?? 'None'}</td><td><AccountingStatusIndicator status={row.policyStatus ?? 'UNVERIFIED'} /></td><td><AccountingStatusIndicator status={row.status} /></td></tr>)}</CoreTable><CorePagination {...read.data} loading={read.loading} onPage={page => setFilters({ ...filters, page })} /></> : null}
    </CoreCard></CorePage>;
}
