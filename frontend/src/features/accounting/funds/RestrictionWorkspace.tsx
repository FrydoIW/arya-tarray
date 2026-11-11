'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Select } from '@/components/ui/Select';
import { useAuthSession } from '@/features/auth/context/AuthSessionContext';
import type { AccountingPage } from '../types';
import { ApprovalLink, ChoiceField, JournalLink, MoneyField, TextArea, positiveAmount, validDay } from '../apar/fields';
import { coreQuery } from '../core/api';
import { AccountingStatusIndicator } from '../components/AccountingFoundation';
import { CoreCard, CoreFeedback, CoreField, CoreInput, CorePage, CorePagination, CoreReadState, CoreTable } from '../core/CoreUI';
import { useCoreMutation, useCoreRead } from '../core/hooks';
import { accountingMoney } from '../core/presentation';
import { journalPermissions } from '../core/contracts.generated';
import { openDateReason, useFiscalYears } from '../core/FiscalScope';
import styles from '../core/core.module.css';
import { saveRestriction, submitFundRelease } from './api';
import { FundSourceActions } from './FundActions';
import { classLabel, FundNavigation, fundHref, fundsHref, restrictionHref } from './FundUI';
import { purposeCriteria, restrictionKinds, type ContributionPage, type Fund, type ReleaseInput, type Restriction, type RestrictionDetail, type RestrictionInput } from './types';

function FundChoice({ value, onChange, unrestricted = false }: { value: string; onChange: (value: string) => void; unrestricted?: boolean }) {
  const read = useCoreRead<AccountingPage<Fund>>('funds?page=1&pageSize=100&status=ACTIVE');
  const rows = (read.data?.rows ?? []).filter(row => !unrestricted || row.fundClass === 'UNRESTRICTED');
  return <><ChoiceField label={unrestricted ? 'Target unrestricted fund' : 'Fund scope'} value={value} onChange={onChange}
    choices={rows.map(row => ({ id: row.id, label: row.fundCode + ' · ' + row.fundName + ' · ' + classLabel[row.fundClass] }))} empty="Select fund" required /><CoreReadState read={read} /></>;
}

const emptyRestriction: RestrictionInput = { sourceJournalLineId: '', originalAmount: '', donorMemberId: null, restrictionKind: 'PURPOSE', purposeText: '', effectiveOn: '', releaseOn: null,
  supportingReference: '', termsEvidence: '', criteria: { purposeCriterion: 'EXPENSE_INCURRED', eligibilityTerms: '' }, eventCampaignId: null };
function restrictionInput(row?: Restriction | null): RestrictionInput {
  return row ? { sourceJournalLineId: row.sourceJournalLineId, originalAmount: row.originalAmount, donorMemberId: row.donorMemberId,
    restrictionKind: row.restrictionKind, purposeText: row.purposeText, effectiveOn: row.effectiveOn.slice(0, 10), releaseOn: row.releaseOn?.slice(0, 10) ?? null,
    supportingReference: row.supportingReference, termsEvidence: row.termsEvidence, criteria: row.criteria, eventCampaignId: row.eventCampaignId } : emptyRestriction;
}
function validRestriction(v: RestrictionInput) {
  const time = ['TIME', 'BOTH'].includes(v.restrictionKind), pureTime = v.restrictionKind === 'TIME';
  return !!v.sourceJournalLineId && positiveAmount(v.originalAmount) !== null && validDay(v.effectiveOn)
    && (!time || !!v.releaseOn && validDay(v.releaseOn) && v.releaseOn >= v.effectiveOn)
    && v.supportingReference.trim() && v.termsEvidence.trim().length >= 10 && v.criteria.eligibilityTerms.trim().length >= 10
    && (pureTime ? v.criteria.purposeCriterion === 'TIME_ONLY' : v.criteria.purposeCriterion !== 'TIME_ONLY' && (v.purposeText?.trim().length ?? 0) >= 10);
}

function RestrictionForm({ fund, current, onSaved }: { fund: Fund; current?: Restriction | null; onSaved: (row: Restriction) => void }) {
  const user = useAuthSession(), mutation = useCoreMutation(), [input, setInput] = useState(() => restrictionInput(current));
  const [sourcePage, setSourcePage] = useState(1);
  const sources = useCoreRead<ContributionPage>(`fund-contribution-sources?${coreQuery({ page: sourcePage, pageSize: 25, unallocatedOnly: 'true' })}`);
  useEffect(() => setInput(restrictionInput(current)), [current]);
  const canManage = user.menuCodes.includes(journalPermissions.manage);
  function patch(value: Partial<RestrictionInput>) { setInput(old => ({ ...old, ...value })); }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (!canManage || fund.fundClass !== 'DONOR_RESTRICTED' || !validRestriction(input)) return;
    const row = await mutation.run(() => saveRestriction(fund.id, input, current ?? undefined), current ? 'Draft donor terms revised. Prior approvals were invalidated.' : 'Draft donor restriction created from actual source evidence.');
    if (row) onSaved(row);
  }
  return <CoreCard><h2>{current ? 'Revise draft donor restriction' : 'Create donor restriction'}</h2>
    {fund.fundClass !== 'DONOR_RESTRICTED' ? <p className={styles.warning}>Restrictions can only be created inside a DONOR_RESTRICTED fund. A campaign name alone does not establish donor terms.</p> : null}
    <CoreFeedback {...mutation} /><CoreReadState read={sources} />
    <form className={styles.page} onSubmit={submit}><ChoiceField label="Posted contribution source" value={input.sourceJournalLineId} onChange={value => {
      const source = sources.data?.rows.find(row => row.id === value); patch({ sourceJournalLineId: value, originalAmount: source?.unallocatedAmount ?? input.originalAmount,
        eventCampaignId: source?.eventCampaignId ?? null, donorMemberId: source?.historicalMemberId ?? null });
    }} choices={(sources.data?.rows ?? []).map(row => ({ id: row.id, label: `${row.accountingDate.slice(0, 10)} · ${row.sourceKind} · ${accountingMoney(row.unallocatedAmount)} unallocated` }))} required />
      {sources.data ? <CorePagination {...sources.data} loading={sources.loading} onPage={setSourcePage} /> : null}
      <p className={styles.note}>The source carries actual journal, bank, event, campaign and canonical identity evidence. The UI does not expose donor personal data or create recognition.</p>
      <div className={styles.formGrid}><MoneyField label="Restricted amount" value={input.originalAmount} onChange={value => patch({ originalAmount: value })} />
        <CoreField label="Restriction kind"><Select aria-label="Restriction kind" value={input.restrictionKind} onChange={e => {
          const kind = e.target.value as RestrictionInput['restrictionKind']; patch({ restrictionKind: kind, criteria: { ...input.criteria, purposeCriterion: kind === 'TIME' ? 'TIME_ONLY' : input.criteria.purposeCriterion === 'TIME_ONLY' ? 'EXPENSE_INCURRED' : input.criteria.purposeCriterion } });
        }}>{restrictionKinds.map(value => <option key={value}>{value}</option>)}</Select></CoreField>
        <CoreField label="Satisfaction criterion"><Select aria-label="Satisfaction criterion" value={input.criteria.purposeCriterion} onChange={e => patch({ criteria: { ...input.criteria, purposeCriterion: e.target.value as RestrictionInput['criteria']['purposeCriterion'] } })}>{purposeCriteria.map(value => <option key={value} disabled={input.restrictionKind === 'TIME' ? value !== 'TIME_ONLY' : value === 'TIME_ONLY'}>{value}</option>)}</Select></CoreField>
        <CoreInput label="Effective date" type="date" required value={input.effectiveOn} onChange={e => patch({ effectiveOn: e.target.value })} />
        <CoreInput label="Release-on date" type="date" value={input.releaseOn ?? ''} onChange={e => patch({ releaseOn: e.target.value || null })} />
        <CoreInput label="Terms effective date" type="date" value={input.criteria.termsEffectiveOn ?? ''} onChange={e => patch({ criteria: { ...input.criteria, termsEffectiveOn: e.target.value || undefined } })} />
        <CoreInput label="Supporting reference" required maxLength={255} value={input.supportingReference} onChange={e => patch({ supportingReference: e.target.value })} />
        <CoreInput label="Canonical donor member ID (optional)" value={input.donorMemberId ?? ''} onChange={e => patch({ donorMemberId: e.target.value || null })} />
        <CoreInput label="Campaign evidence ID (optional)" value={input.eventCampaignId ?? ''} onChange={e => patch({ eventCampaignId: e.target.value || null })} />
      </div>
      {input.restrictionKind !== 'TIME' ? <TextArea label="Donor purpose" minLength={10} maxLength={1000} value={input.purposeText ?? ''} onChange={value => patch({ purposeText: value || null })} /> : null}
      <TextArea label="Donor terms evidence" minLength={10} maxLength={1000} value={input.termsEvidence} onChange={value => patch({ termsEvidence: value })} />
      <TextArea label="Eligibility terms" minLength={10} maxLength={1000} value={input.criteria.eligibilityTerms} onChange={value => patch({ criteria: { ...input.criteria, eligibilityTerms: value } })} />
      <Button type="submit" disabled={!canManage || mutation.busy || fund.fundClass !== 'DONOR_RESTRICTED' || !validRestriction(input)}>{current ? 'Save restriction revision' : 'Create restriction draft'}</Button>
    </form></CoreCard>;
}

const emptyRelease: ReleaseInput = { amount: '', releaseReference: '', accountingDate: '', satisfactionDate: '', targetFundId: '', releaseReason: '', eligibilityEvidence: '', evidenceReference: '', evidenceJournalLineId: null };
function ReleaseForm({ restriction, onSubmitted }: { restriction: RestrictionDetail; onSubmitted: () => void }) {
  const user = useAuthSession(), fiscal = useFiscalYears(), mutation = useCoreMutation();
  const [input, setInput] = useState<ReleaseInput>(emptyRelease), [confirm, setConfirm] = useState(false), [approvalId, setApprovalId] = useState('');
  const criterion = restriction.criteria.purposeCriterion, needsLine = ['EXPENSE_INCURRED', 'CAPITAL_ACQUIRED'].includes(criterion);
  const periodReason = validDay(input.accountingDate) ? openDateReason(fiscal.data, input.accountingDate) : 'Choose a valid accounting date.';
  const valid = positiveAmount(input.amount) !== null && validDay(input.satisfactionDate) && !!input.targetFundId && input.releaseReference.trim()
    && input.releaseReason.trim().length >= 10 && input.eligibilityEvidence.trim().length >= 10 && input.evidenceReference.trim()
    && (needsLine ? !!input.evidenceJournalLineId : !input.evidenceJournalLineId) && !periodReason;
  async function submit() {
    if (!valid || !user.menuCodes.includes(journalPermissions.manage)) return;
    const request = await mutation.run(() => submitFundRelease(restriction, input), 'Release approval requested. Remaining restriction is unchanged until authorized posting succeeds.');
    setConfirm(false); if (request) { setApprovalId(request.id); onSubmitted(); }
  }
  return <CoreCard><h2>Request partial or full restriction release</h2><CoreFeedback {...mutation} /><CoreReadState read={fiscal} />
    <p className={styles.note}>Original {accountingMoney(restriction.originalAmount)} · previously released {accountingMoney(restriction.releasedAmount)} · backend remaining {accountingMoney(restriction.remainingAmount)}.</p>
    <p className={styles.note}>Criterion {criterion}. The backend rechecks eligible evidence, source capacity, duplicate evidence, dates, policy mappings and OPEN period. No journal preview endpoint exists.</p>
    {approvalId ? <p role="status"><ApprovalLink id={approvalId}>Open release approval request</ApprovalLink></p> : null}
    <div className={styles.formGrid}><MoneyField label="Proposed release amount" value={input.amount} onChange={amount => setInput(old => ({ ...old, amount }))} />
      <CoreInput label="Release reference" maxLength={100} value={input.releaseReference} onChange={e => setInput(old => ({ ...old, releaseReference: e.target.value }))} />
      <CoreInput label="Accounting date" type="date" value={input.accountingDate} onChange={e => setInput(old => ({ ...old, accountingDate: e.target.value }))} />
      <CoreInput label="Satisfaction date" type="date" value={input.satisfactionDate} onChange={e => setInput(old => ({ ...old, satisfactionDate: e.target.value }))} />
      <CoreInput label="Evidence reference" maxLength={255} value={input.evidenceReference} onChange={e => setInput(old => ({ ...old, evidenceReference: e.target.value }))} />
      <CoreInput label={needsLine ? 'Required posted evidence line ID' : 'Evidence line must remain empty'} value={input.evidenceJournalLineId ?? ''} disabled={!needsLine} onChange={e => setInput(old => ({ ...old, evidenceJournalLineId: e.target.value || null }))} />
    </div><FundChoice unrestricted value={input.targetFundId} onChange={targetFundId => setInput(old => ({ ...old, targetFundId }))} />
    <TextArea label="Release reason" minLength={10} maxLength={500} value={input.releaseReason} onChange={releaseReason => setInput(old => ({ ...old, releaseReason }))} />
    <TextArea label="Eligibility evidence" minLength={10} maxLength={1000} value={input.eligibilityEvidence} onChange={eligibilityEvidence => setInput(old => ({ ...old, eligibilityEvidence }))} />
    {periodReason ? <p className={styles.warning}>{periodReason}</p> : null}
    <Button disabled={!valid || mutation.busy || !user.menuCodes.includes(journalPermissions.manage)} onClick={() => setConfirm(true)}>Request release approval</Button>
    <ConfirmDialog open={confirm} title="Submit restriction release?" message="Submit this exact release evidence for independent review. This does not post a journal or reduce the restriction. The backend remains authoritative for eligible and remaining amounts." confirmLabel="Confirm release request" loading={mutation.busy} onCancel={() => setConfirm(false)} onConfirm={submit} />
  </CoreCard>;
}

export function RestrictionWorkspace({ fundId: initialFundId = '', id, create = false }: { fundId?: string; id?: string; create?: boolean }) {
  const router = useRouter(), [fundId, setFundId] = useState(initialFundId), [page, setPage] = useState(1);
  const fund = useCoreRead<Fund>(fundId ? 'funds/' + fundId : 'funds/disabled', !!fundId);
  const list = useCoreRead<AccountingPage<Restriction>>(`funds/${fundId}/restrictions?${coreQuery({ page, pageSize: 25 })}`, !!fundId && !id && !create);
  const detail = useCoreRead<RestrictionDetail>(id ? 'fund-restrictions/' + id : 'fund-restrictions/disabled', !!id);
  const actualFundId = detail.data?.accountingFundId ?? fundId;
  const actualFund = useCoreRead<Fund>(actualFundId ? 'funds/' + actualFundId : 'funds/disabled', !!actualFundId && (!fund.data || fund.data.id !== actualFundId));
  const currentFund = fund.data?.id === actualFundId ? fund.data : actualFund.data;
  if (create) return <CorePage title="New donor restriction" description="Create donor purpose/time terms from an actual posted contribution source."><FundNavigation fund={currentFund} /><FundChoice value={fundId} onChange={value => { setFundId(value); router.replace(`${fundsHref}/restrictions/new?fundId=${value}`); }} />{fundId && currentFund ? <RestrictionForm fund={currentFund} onSaved={row => router.push(restrictionHref(row.id))} /> : null}</CorePage>;
  if (id) { const row = detail.data; return <CorePage title="Donor restriction" description="Terms, source, release capacity and retained approval evidence." actions={<Button variant="outline" onClick={detail.refresh}>Refresh restriction</Button>}><FundNavigation fund={currentFund} /><CoreReadState read={detail} />
    {row ? <><CoreCard><div className={styles.summary}><h2>{row.supportingReference}</h2><AccountingStatusIndicator status={row.status} /></div><dl className={styles.details}>
      <dt>Kind / criterion</dt><dd>{row.restrictionKind} · {row.criteria.purposeCriterion}</dd><dt>Purpose</dt><dd>{row.purposeText ?? 'Time restriction only'}</dd><dt>Terms evidence</dt><dd>{row.termsEvidence}</dd><dt>Eligibility terms</dt><dd>{row.criteria.eligibilityTerms}</dd>
      <dt>Effective / release-on</dt><dd>{row.effectiveOn.slice(0, 10)} / {row.releaseOn?.slice(0, 10) ?? 'Not applicable'}</dd><dt>Original / released / remaining</dt><dd>{accountingMoney(row.originalAmount)} / {accountingMoney(row.releasedAmount)} / {accountingMoney(row.remainingAmount)}</dd>
      <dt>Source journal line</dt><dd>{row.sourceJournalLineId}</dd><dt>Classification journal</dt><dd><JournalLink id={row.classificationJournalId} /></dd><dt>Campaign evidence</dt><dd>{row.eventCampaignId ?? 'None; campaign is not inferred'}</dd><dt>Canonical donor ID</dt><dd>{row.donorMemberId ?? 'Not exposed/linked'}</dd>
    </dl><FundSourceActions path="fund-restrictions" source={row} onChanged={detail.refresh} /></CoreCard>
      {row.status === 'DRAFT' && currentFund ? <RestrictionForm fund={currentFund} current={row} onSaved={() => detail.refresh()} /> : null}
      {row.status === 'ACTIVE' ? <ReleaseForm restriction={row} onSubmitted={() => undefined} /> : null}
      <CoreCard><h2>Approval history</h2>{row.history.length ? <CoreTable label="Restriction approval history" headers={['Request', 'Kind', 'Requester', 'Status', 'Version']}>
        {row.history.map(request => <tr key={request.id}><td><ApprovalLink id={request.id}>{request.id}</ApprovalLink></td><td>{request.requestKind}</td><td>{request.requestedById}</td><td><AccountingStatusIndicator status={request.status} /></td><td>{request.sourceVersion}</td></tr>)}</CoreTable> : <p className={styles.note}>No approval history.</p>}</CoreCard></> : null}</CorePage>; }
  return <CorePage title="Donor restrictions" description="Fund-scoped donor purpose/time terms and remaining restricted amounts." actions={fundId ? <Link className={styles.link} href={`${fundsHref}/restrictions/new?fundId=${fundId}`}>New restriction</Link> : null}><FundNavigation fund={fund.data} /><FundChoice value={fundId} onChange={value => { setFundId(value); setPage(1); router.replace(`${fundsHref}/restrictions?fundId=${value}`); }} />
    {fundId ? <CoreCard><CoreReadState read={list} empty={list.data?.rows.length === 0} />{list.data?.rows.length ? <><CoreTable label="Donor restrictions" headers={['Reference', 'Kind / criterion', 'Original', 'Released', 'Remaining', 'Status']}>
      {list.data.rows.map(row => <tr key={row.id}><td><Link className={styles.link} href={restrictionHref(row.id)}>{row.supportingReference}</Link></td><td>{row.restrictionKind} · {row.criteria.purposeCriterion}</td><td>{accountingMoney(row.originalAmount)}</td><td>{accountingMoney(row.releasedAmount)}</td><td>{accountingMoney(row.remainingAmount)}</td><td><AccountingStatusIndicator status={row.status} /></td></tr>)}</CoreTable><CorePagination {...list.data} loading={list.loading} onPage={setPage} /></> : null}</CoreCard> : null}
  </CorePage>;
}
