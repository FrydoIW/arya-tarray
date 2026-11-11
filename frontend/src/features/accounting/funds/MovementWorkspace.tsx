'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { useAuthSession } from '@/features/auth/context/AuthSessionContext';
import type { AccountingPage } from '../types';
import { ApprovalLink, ChoiceField, JournalLink, MoneyField, TextArea, positiveAmount, validDay } from '../apar/fields';
import { coreQuery } from '../core/api';
import { AccountingStatusIndicator } from '../components/AccountingFoundation';
import { CoreCard, CoreFeedback, CoreInput, CorePage, CorePagination, CoreReadState, CoreTable } from '../core/CoreUI';
import { useCoreMutation, useCoreRead } from '../core/hooks';
import { accountingMoney, record, text } from '../core/presentation';
import { journalPermissions } from '../core/contracts.generated';
import styles from '../core/core.module.css';
import { createMovement } from './api';
import { FundSourceActions } from './FundActions';
import { classLabel, FundNavigation, fundsHref, movementHref } from './FundUI';
import type { ContributionPage, Fund, FundMovement, FundMovementDetail, FundMovementInput } from './types';

function MovementFundChoice({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const read = useCoreRead<AccountingPage<Fund>>('funds?page=1&pageSize=100&status=ACTIVE');
  return <><ChoiceField label="Fund scope" value={value} onChange={onChange} required choices={(read.data?.rows ?? []).map(row => ({ id: row.id, label: `${row.fundCode} · ${row.fundName} · ${classLabel[row.fundClass]}`, disabled: row.fundClass === 'DONOR_RESTRICTED' }))} empty="Select active non-donor-restricted fund" /><CoreReadState read={read} /></>;
}
function MovementForm({ fund, onSaved }: { fund: Fund; onSaved: (row: FundMovement) => void }) {
  const user = useAuthSession(), mutation = useCoreMutation(), [sourcePage, setSourcePage] = useState(1);
  const sources = useCoreRead<ContributionPage>(`fund-contribution-sources?${coreQuery({ page: sourcePage, pageSize: 25, unallocatedOnly: 'true' })}`);
  const [input, setInput] = useState<FundMovementInput>({ action: 'CLASSIFY', sourceJournalLineId: '', amount: '', accountingDate: '', sourceReference: '', reason: '' });
  const valid = !!input.sourceJournalLineId && positiveAmount(input.amount) !== null && validDay(input.accountingDate) && input.sourceReference.trim() && input.reason.trim().length >= 10;
  async function submit(event: React.FormEvent) { event.preventDefault(); if (!valid || !user.menuCodes.includes(journalPermissions.manage)) return;
    const row = await mutation.run(() => createMovement(fund.id, input), 'Fund classification draft created. Original recognition remains unchanged; posting only reclassifies the selected source.'); if (row) onSaved(row); }
  return <CoreCard><h2>Create contribution classification</h2><p className={styles.note}>Use donor restriction workflow for DONOR_RESTRICTED funds. Classification does not create donation recognition, a BankTransaction, receivable or campaign expense.</p><CoreFeedback {...mutation} /><CoreReadState read={sources} />
    <form className={styles.page} onSubmit={submit}><ChoiceField label="Posted contribution source" value={input.sourceJournalLineId} onChange={value => { const source = sources.data?.rows.find(row => row.id === value); setInput(old => ({ ...old, sourceJournalLineId: value, amount: source?.unallocatedAmount ?? old.amount, accountingDate: source?.accountingDate.slice(0, 10) ?? old.accountingDate })); }}
      choices={(sources.data?.rows ?? []).map(row => ({ id: row.id, label: `${row.sourceKind} · ${row.accountType} · ${accountingMoney(row.unallocatedAmount)} · campaign ${row.eventCampaignId ?? 'none'}` }))} required />
      {sources.data ? <CorePagination {...sources.data} loading={sources.loading} onPage={setSourcePage} /> : null}<div className={styles.formGrid}><ChoiceField label="Classification action" value={input.action} onChange={action => setInput(old => ({ ...old, action: action as 'CLASSIFY' | 'OPENING' }))} choices={[{ id: 'CLASSIFY', label: 'Classify existing contribution' }, { id: 'OPENING', label: 'Classify approved opening source' }]} required />
        <MoneyField label="Classification amount" value={input.amount} onChange={amount => setInput(old => ({ ...old, amount }))} /><CoreInput label="Accounting date" type="date" value={input.accountingDate} onChange={e => setInput(old => ({ ...old, accountingDate: e.target.value }))} /><CoreInput label="Source reference" maxLength={110} value={input.sourceReference} onChange={e => setInput(old => ({ ...old, sourceReference: e.target.value }))} /></div>
      <TextArea label="Classification reason/evidence" minLength={10} maxLength={1000} value={input.reason} onChange={reason => setInput(old => ({ ...old, reason }))} />
      <Button type="submit" disabled={!valid || mutation.busy || fund.fundClass === 'DONOR_RESTRICTED' || !user.menuCodes.includes(journalPermissions.manage)}>Create classification draft</Button></form>
  </CoreCard>;
}

export function MovementWorkspace({ fundId: initialFundId = '', id, create = false }: { fundId?: string; id?: string; create?: boolean }) {
  const router = useRouter(), [fundId, setFundId] = useState(initialFundId), [page, setPage] = useState(1);
  const fund = useCoreRead<Fund>(fundId ? 'funds/' + fundId : 'funds/disabled', !!fundId);
  const list = useCoreRead<AccountingPage<FundMovement>>(`funds/${fundId}/movements?${coreQuery({ page, pageSize: 25 })}`, !!fundId && !id && !create);
  const detail = useCoreRead<FundMovementDetail>(id ? 'fund-movements/' + id : 'fund-movements/disabled', !!id);
  const actualFundId = detail.data?.accountingFundId ?? fundId;
  const otherFund = useCoreRead<Fund>(actualFundId ? 'funds/' + actualFundId : 'funds/disabled', !!actualFundId && fund.data?.id !== actualFundId);
  const currentFund = fund.data?.id === actualFundId ? fund.data : otherFund.data;
  if (create) return <CorePage title="New fund movement" description="Classify an existing posted source without recognizing donation income again."><FundNavigation fund={currentFund} /><MovementFundChoice value={fundId} onChange={value => { setFundId(value); router.replace(`${fundsHref}/movements/new?fundId=${value}`); }} />{currentFund ? <MovementForm fund={currentFund} onSaved={row => router.push(movementHref(row.id))} /> : null}</CorePage>;
  if (id) { const row = detail.data, command = record(row?.fundMetadata); const kind = row?.sourceKind === 'FUND_JOURNAL' ? 'FUND_JOURNAL' : 'FUND_COMMAND'; return <CorePage title="Fund movement" description="Classification or management command with approval and journal traceability." actions={<Button variant="outline" onClick={detail.refresh}>Refresh movement</Button>}><FundNavigation fund={currentFund} /><CoreReadState read={detail} />{row ? <>
    <CoreCard><div className={styles.summary}><h2>{row.sourceReference}</h2><AccountingStatusIndicator status={row.status} /></div><dl className={styles.details}><dt>Source kind / action</dt><dd>{row.sourceKind} · {text(command?.action)}</dd><dt>Accounting date</dt><dd>{row.accountingDate.slice(0, 10)}</dd><dt>Reason</dt><dd>{row.description}</dd><dt>Source line</dt><dd>{text(command?.sourceJournalLineId)}</dd><dt>Amount</dt><dd>{accountingMoney(typeof command?.amount === 'string' ? command.amount : null)}</dd><dt>Posted journal</dt><dd><JournalLink id={row.postedJournalId} /></dd></dl>
      {text(command?.action) === 'CONDITIONAL_REVIEW' ? <p className={styles.warning}>PENDING_POLICY. The bank source remains held. The UI does not infer recognition or expose an automatic resolution.</p> : null}<FundSourceActions path="fund-movements" kind={kind} source={row} onChanged={detail.refresh} /></CoreCard>
    <CoreCard><h2>Approval history</h2>{row.history.length ? <CoreTable label="Fund movement approval history" headers={['Request', 'Kind', 'Requester', 'Status', 'Version']}>{row.history.map(request => <tr key={request.id}><td><ApprovalLink id={request.id}>{request.id}</ApprovalLink></td><td>{request.requestKind}</td><td>{request.requestedById}</td><td><AccountingStatusIndicator status={request.status} /></td><td>{request.sourceVersion}</td></tr>)}</CoreTable> : <p className={styles.note}>No approval history.</p>}</CoreCard></> : null}</CorePage>; }
  return <CorePage title="Fund movements" description="Posted classifications, policy commands and retained fund audit evidence." actions={fundId ? <Link className={styles.link} href={`${fundsHref}/movements/new?fundId=${fundId}`}>New classification</Link> : null}><FundNavigation fund={fund.data} /><MovementFundChoice value={fundId} onChange={value => { setFundId(value); setPage(1); router.replace(`${fundsHref}/movements?fundId=${value}`); }} />
    {fundId ? <CoreCard><CoreReadState read={list} empty={list.data?.rows.length === 0} />{list.data?.rows.length ? <><CoreTable label="Fund movements and commands" headers={['Reference', 'Action', 'Date', 'Status', 'Posted journal']}>{list.data.rows.map(row => <tr key={row.id}><td><Link className={styles.link} href={movementHref(row.id)}>{row.sourceReference}</Link></td><td>{text(record(row.fundMetadata)?.action)}</td><td>{row.accountingDate.slice(0, 10)}</td><td><AccountingStatusIndicator status={row.status} /></td><td><JournalLink id={row.postedJournalId} /></td></tr>)}</CoreTable><CorePagination {...list.data} loading={list.loading} onPage={setPage} /></> : null}</CoreCard> : null}
  </CorePage>;
}
