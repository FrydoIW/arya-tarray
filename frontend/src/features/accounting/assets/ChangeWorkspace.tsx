'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ApprovalLink, ChoiceField, JournalLink, MoneyField, TextArea, validDay } from '../apar/fields';
import { AccountingStatusIndicator } from '../components/AccountingFoundation';
import { CoreCard, CoreInput, CorePage, CoreReadState } from '../core/CoreUI';
import { useCoreRead } from '../core/hooks';
import { accountingMoney, decimalCents } from '../core/presentation';
import { routeId } from '../core/route-scope';
import styles from '../core/core.module.css';
import { ActionReview } from '../schedules/ScheduleUI';
import { createChange } from './api';
import { assetHref, AssetLinks, CategoryChoice, dayOnly, isCredit, isDebit, JournalLines, moneyInput, PostedLineChoice, purchaseKind, SourceActions, SourceDocumentLink, validLife } from './AssetUI';
import type { AssetDetail, ChangeCommand, ChangeDetail, ChangeInput, ChangeResult } from './types';

export const changeLabels: Record<ChangeInput['action'], string> = {
  ESTIMATE: 'Prospective estimate change', ADDITIONAL: 'Additional capitalized expenditure',
  CORRECTION: 'Master-record correction', RECLASSIFY: 'Reclassify asset',
  IMPAIRMENT: 'Recognize impairment', DISPOSE: 'Disposal or sale', WRITE_OFF: 'Write-off', DEACTIVATE: 'Deactivate unused registration',
};
export const changeLabel = (action: ChangeCommand['action']) => action === 'IMPAIRMENT_REVERSAL' ? 'Valuation-based impairment reversal' : changeLabels[action];

export function ChangeForm({ asset, onClose, onSaved }: { asset: AssetDetail; onClose: () => void; onSaved: (draft: ChangeResult) => void }) {
  const [action, setAction] = useState<ChangeInput['action']>('ESTIMATE');
  const [date, setDate] = useState(''), [reason, setReason] = useState('');
  const [life, setLife] = useState(''), [residual, setResidual] = useState(asset.residualValue);
  const [recoverable, setRecoverable] = useState(''), [evidence, setEvidence] = useState('');
  const [proceeds, setProceeds] = useState(''), [consideration, setConsideration] = useState(''), [credit, setCredit] = useState('');
  const [sourceLine, setSourceLine] = useState(''), [costLine, setCostLine] = useState(''), [cost, setCost] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [master, setMaster] = useState({ assetName: asset.assetName, description: asset.description ?? '', location: asset.location ?? '',
    custodianId: asset.custodianId ?? '', acquiredOn: dayOnly(asset.acquiredOn) });
  const updateMaster = (value: Partial<typeof master>) => setMaster({ ...master, ...value });
  const prospective = action === 'ESTIMATE' || action === 'ADDITIONAL' || action === 'IMPAIRMENT';
  const sale = action === 'DISPOSE';
  const mapping = asset.relFkAccFixedAssetCat;
  const positiveProceeds = (decimalCents(proceeds) ?? BigInt(0)) > BigInt(0);
  const impairmentPending = !asset.policySnapshot?.impairmentEnabled || !asset.policySnapshot.impairmentPolicyReference ||
    !mapping.impairmentExpenseAccountId || !mapping.impairmentAllowanceAccountId;
  function validate() {
    if (!validDay(date) || reason.trim().length < 10) return 'Enter an effective date and an audit reason of at least 10 characters.';
    if (prospective && (!date.endsWith('-01') || !validLife(life) || !moneyInput(residual))) {
      return 'Prospective changes require a first-of-month date, 1–600 months of remaining life and an exact residual value.';
    }
    if (action === 'ADDITIONAL' && !routeId(sourceLine)) return 'Select a distinct actual posted capital expenditure line.';
    if (action === 'RECLASSIFY' && (!routeId(categoryId) || categoryId === asset.assetCategoryId)) return 'Select a different active category.';
    if (action === 'IMPAIRMENT' && (!moneyInput(recoverable) || evidence.trim().length < 10)) return 'Provide an assessed recoverable amount and supporting assessment evidence.';
    if (action === 'CORRECTION' && (!master.assetName.trim() || !validDay(master.acquiredOn) || master.acquiredOn > dayOnly(asset.inServiceOn)
      || master.custodianId && !routeId(master.custodianId))) return 'Check the corrected name, acquisition date and optional custodian UUID.';
    if (sale && (!moneyInput(proceeds) || (positiveProceeds
      ? !routeId(consideration) || decimalCents(credit) !== decimalCents(proceeds)
      : !!consideration))) return 'Enter exact proceeds. Positive proceeds require a matching posted consideration credit, and zero proceeds require no consideration line.';
    if (sale && consideration && consideration === costLine) return 'Consideration and cost must use distinct journal lines.';
    return '';
  }
  function run() {
    const common = { effectiveDate: date, reason: reason.trim() };
    const estimate = { residualValue: residual, remainingLifeMonths: Number(life) };
    let input: ChangeInput;
    switch (action) {
      case 'ESTIMATE': input = { action, ...common, ...estimate }; break;
      case 'ADDITIONAL': input = { action, ...common, ...estimate, sourceJournalLineId: sourceLine }; break;
      case 'CORRECTION': input = { action, ...common, ...master, description: master.description || null,
        location: master.location || null, custodianId: master.custodianId || null }; break;
      case 'RECLASSIFY': input = { action, ...common, categoryId }; break;
      case 'IMPAIRMENT': input = { action, ...common, ...estimate, recoverableAmount: recoverable, assessmentEvidence: evidence.trim() }; break;
      case 'DISPOSE': input = { action, ...common, proceeds, considerationJournalLineId: consideration || null, costJournalLineId: costLine || null }; break;
      case 'WRITE_OFF':
      case 'DEACTIVATE': input = { action, ...common }; break;
    }
    return createChange(asset.id, input);
  }
  return <ActionReview title="New asset lifecycle draft" description="Save a separate draft for review. Asset balances and posted journals are managed by the backend."
    validate={validate} run={run} onClose={onClose} onDone={onSaved}
    fields={<>
      <ChoiceField label="Lifecycle action" value={action} choices={Object.entries(changeLabels).map(([id, label]) => ({ id, label }))}
        onChange={value => {
          const kind = (Object.keys(changeLabels) as ChangeInput['action'][]).find(item => item === value);
          if (kind) setAction(kind);
        }} />
      <div className={styles.formGrid}>
        <CoreInput label="Effective date" type="date" value={date} onChange={event => setDate(event.target.value)} />
        {prospective ? <><CoreInput label="Remaining life (months)" inputMode="numeric" maxLength={3} value={life} onChange={event => setLife(event.target.value)} />
          <MoneyField label="Revised residual value" value={residual} onChange={setResidual} /></> : null}
      </div>
      {action === 'CORRECTION' ? <div className={styles.formGrid}>
        <CoreInput label="Corrected asset name" maxLength={200} value={master.assetName} onChange={event => updateMaster({ assetName: event.target.value })} />
        <CoreInput label="Corrected acquisition date" type="date" value={master.acquiredOn} onChange={event => updateMaster({ acquiredOn: event.target.value })} />
        <CoreInput label="Corrected description" maxLength={1000} value={master.description} onChange={event => updateMaster({ description: event.target.value })} />
        <CoreInput label="Corrected location" maxLength={255} value={master.location} onChange={event => updateMaster({ location: event.target.value })} />
        <CoreInput label="Corrected custodian UUID" value={master.custodianId} onChange={event => updateMaster({ custodianId: event.target.value.trim() })} />
      </div> : null}
      {action === 'ADDITIONAL' ? <PostedLineChoice label="Additional expenditure" value={sourceLine} onChange={setSourceLine}
        eligible={(line, journal) => purchaseKind(journal) && isDebit(line) && line.accountId === mapping.assetAccountId && line.id !== asset.acquisitionJournalLineId} /> : null}
      {action === 'RECLASSIFY' ? <CategoryChoice value={categoryId} onChange={setCategoryId} exclude={asset.assetCategoryId} /> : null}
      {action === 'IMPAIRMENT' ? <>
        {impairmentPending ? <p className={styles.warning}>PENDING_POLICY · Adopted impairment policy and COA mappings are required for approval.</p> : null}
        <MoneyField label="Assessed recoverable amount" value={recoverable} onChange={setRecoverable} />
        <TextArea label="Impairment assessment evidence" value={evidence} onChange={setEvidence} maxLength={1000} />
        <p className={styles.note}>Current carrying amount · {accountingMoney(asset.carryingAmount)}. The backend derives the proposed loss from the actual assessment.</p>
      </> : null}
      {sale || action === 'WRITE_OFF' ? <p className={styles.note}>Current backend carrying amount {accountingMoney(asset.carryingAmount)} · accumulated depreciation {accountingMoney(asset.accumulatedDepreciation)}. Gain/loss is available in the posted disposal journal.</p> : null}
      {sale ? <>
        <MoneyField label="Disposal proceeds" value={proceeds} onChange={setProceeds} />
        <p className={styles.note}>Use existing AR clearing or approved manual cash evidence. Record actual disposal costs through an existing AP/manual expense journal.</p>
        <PostedLineChoice label="Sale consideration" value={consideration} onChange={(id, line) => { setConsideration(id); setCredit(line?.credit ?? ''); }}
          eligible={(line, journal) => ['AR_DOCUMENT', 'MANUAL_JOURNAL'].includes(journal.sourceKind) && isCredit(line) && line.accountId === mapping.disposalClearingAccountId} />
        <PostedLineChoice label="Disposal cost (optional)" value={costLine} onChange={(id, line) => { setCostLine(id); setCost(line?.debit ?? ''); }}
          eligible={(line, journal) => purchaseKind(journal) && isDebit(line) && line.accountId === mapping.lossAccountId} />
        {costLine ? <p>Recorded disposal cost · {accountingMoney(cost)}</p> : null}
      </> : null}
      <TextArea label="Audit reason" value={reason} onChange={setReason} maxLength={1000} />
    </>} />;
}

export function ChangeEvidence({ command }: { command: ChangeCommand }) {
  return <dl className={styles.details}>
    <dt>Action</dt><dd>{changeLabel(command.action)}</dd><dt>Effective date</dt><dd>{command.effectiveDate}</dd><dt>Audit reason</dt><dd>{command.reason}</dd>
    {'remainingLifeMonths' in command ? <><dt>Remaining life / residual</dt><dd>{command.remainingLifeMonths} months · {accountingMoney(command.residualValue)}</dd></> : null}
    {command.action === 'ADDITIONAL' ? <><dt>Capital expenditure line ID</dt><dd>{command.sourceJournalLineId}</dd></> : null}
    {command.action === 'RECLASSIFY' ? <><dt>Target category</dt><dd>{command.categoryId}</dd></> : null}
    {command.action === 'CORRECTION' ? <><dt>Corrected fields</dt><dd>{Object.entries(command).filter(([key]) =>
      ['assetName', 'description', 'location', 'custodianId', 'acquiredOn'].includes(key)).map(([key, value]) => <div key={key}>{key} · {value ?? 'Cleared'}</div>)}</dd></> : null}
    {command.action === 'IMPAIRMENT' ? <><dt>Assessed recoverable amount</dt><dd>{accountingMoney(command.recoverableAmount)}</dd>
      <dt>Assessment evidence</dt><dd>{command.assessmentEvidence}</dd></> : null}
    {command.action === 'IMPAIRMENT_REVERSAL' ? <><dt>Assessment evidence</dt><dd>{command.assessmentEvidence}</dd></> : null}
    {command.action === 'DISPOSE' ? <><dt>Actual proceeds in request</dt><dd>{accountingMoney(command.proceeds)}</dd>
      <dt>Consideration / cost line IDs</dt><dd>{command.considerationJournalLineId ?? 'None'} / {command.costJournalLineId ?? 'None'}</dd></> : null}
  </dl>;
}

export function ChangeWorkspace({ id }: { id: string }) {
  const read = useCoreRead<ChangeDetail>('asset-changes/' + id);
  const source = read.data;
  const history = useCoreRead<Pick<AssetDetail, 'approvalHistory'>>('assets/' + (source?.asset.id ?? ''), !!source?.asset.id);
  const saved = source?.asset.changes.find(row => row.id === id);
  const policy = source?.asset.policySnapshot;
  const mapping = source?.asset.relFkAccFixedAssetCat;
  const blocked = source?.command.action === 'IMPAIRMENT_REVERSAL' ? 'PENDING_POLICY · Valuation-based impairment reversal is unsupported.'
    : source?.asset.status !== 'ACTIVE' ? 'An active asset is required for submission.'
    : !policy?.policyReference ? 'PENDING_POLICY · Adopted capitalization and depreciation policy is required.'
      : source.command.action === 'IMPAIRMENT' && (!policy.impairmentEnabled || !policy.impairmentPolicyReference ||
        !mapping?.impairmentExpenseAccountId || !mapping.impairmentAllowanceAccountId)
        ? 'PENDING_POLICY · Adopted impairment policy and COA mappings are required.' : '';
  return <CorePage title="Asset change detail" description="Proposed evidence, independent approval and original journal history.">
    <AssetLinks /><CoreCard><CoreReadState read={read} />
      {source && !read.loading && !read.error ? <>
        <h2>{source.draft.draftNumber} · {source.asset.assetNumber}</h2><AccountingStatusIndicator status={source.draft.status} />
        <Link className={styles.link} href={assetHref + '/' + source.asset.id}>Open asset · {source.asset.assetName}</Link>
        <ChangeEvidence command={source.command} />
        {saved?.assetSourceLine ? <p>Evidence source · <JournalLink id={saved.assetSourceLine.journalId} /> <SourceDocumentLink journal={saved.assetSourceLine.journal} /></p> : null}
        {saved?.assetCostLine ? <p>Cost evidence · {accountingMoney(saved.assetCostLine.debit)} · <JournalLink id={saved.assetCostLine.journalId} /> <SourceDocumentLink journal={saved.assetCostLine.journal} /></p> : null}
        {saved?.postedJournal ? <JournalLines journal={saved.postedJournal} label="Posted asset change journal lines" /> :
          <p className={styles.note}>No posted journal is returned for this change.</p>}
        <p className={styles.warning}>Valuation-based impairment reversal remains PENDING_POLICY. An approved correction of an erroneous posted journal is a separate workflow.</p>
        <CoreReadState read={history} />
        {history.data?.approvalHistory.filter(row => row.sourceDocumentId === id).map(row =>
          <div key={row.id}><ApprovalLink id={row.id}>{row.status} · Revision {row.sourceVersion}</ApprovalLink></div>)}
        <div><Button variant="outline" onClick={() => { read.refresh(); history.refresh(); }}>Refresh change</Button></div>
      </> : null}
      <SourceActions path="asset-changes" source={!read.loading && !read.error ? source?.draft : null} date={dayOnly(source?.draft.accountingDate)}
        approvals={history.data?.approvalHistory} block={blocked} onChanged={() => { read.refresh(); history.refresh(); }} />
    </CoreCard>
  </CorePage>;
}
