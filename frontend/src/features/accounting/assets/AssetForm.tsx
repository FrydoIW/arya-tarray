'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { MoneyField, TextArea, validDay } from '../apar/fields';
import { CoreFeedback, CoreInput, CoreReadState } from '../core/CoreUI';
import { useCoreMutation, useCoreRead } from '../core/hooks';
import { accountingMoney, decimalCents } from '../core/presentation';
import { routeId } from '../core/route-scope';
import styles from '../core/core.module.css';
import { saveAsset } from './api';
import { CategoryChoice, dayOnly, isDebit, moneyInput, PostedLineChoice, purchaseKind, validLife } from './AssetUI';
import type { AssetDetail, AssetInput, Category, Policy } from './types';

function policyStart(available: string, policy?: Policy['partialMonthPolicy']) {
  if (!validDay(available) || !policy) return '';
  if (policy === 'ACTUAL_DAYS') return available;
  if (policy === 'FULL_MONTH') return available.slice(0, 7) + '-01';
  const next = new Date(available.slice(0, 7) + '-01T00:00:00.000Z');
  next.setUTCMonth(next.getUTCMonth() + 1);
  return dayOnly(next.toISOString());
}

export function AssetForm({ asset, journalId, onSaved }: { asset?: AssetDetail; journalId?: string; onSaved: (id: string) => void }) {
  const mutation = useCoreMutation();
  const [form, setForm] = useState<Omit<AssetInput, 'usefulLifeMonths'>>({
    assetNumber: asset?.assetNumber ?? '', assetName: asset?.assetName ?? '', description: asset?.description ?? null,
    location: asset?.location ?? null, custodianId: asset?.custodianId ?? null, assetCategoryId: asset?.assetCategoryId ?? '',
    acquisitionJournalLineId: asset?.acquisitionJournalLineId ?? '', acquiredOn: dayOnly(asset?.acquiredOn),
    inServiceOn: dayOnly(asset?.inServiceOn), depreciationStartOn: dayOnly(asset?.depreciationStartOn), residualValue: asset?.residualValue ?? '',
    supportingEvidence: asset?.policySnapshot?.supportingEvidence ?? '',
  });
  const [issue, setIssue] = useState(''), [cost, setCost] = useState(asset?.relFkAccFixedAssetSource.debit ?? '');
  const [life, setLife] = useState(asset ? String(asset.usefulLifeMonths) : '');
  const read = useCoreRead<Category>('asset-categories/' + form.assetCategoryId, !!form.assetCategoryId);
  const category = !read.loading && !read.error ? read.data : null;
  const start = policyStart(form.inServiceOn, category?.policy?.partialMonthPolicy);
  const update = (value: Partial<typeof form>) => setForm({ ...form, ...value });
  async function save() {
    const depreciationStartOn = start || form.depreciationStartOn;
    const residual = decimalCents(form.residualValue), acquisition = decimalCents(cost);
    const error = !form.assetNumber.trim() || !form.assetName.trim() ? 'Enter an asset code and name.'
      : !category?.activeFlag || !routeId(form.acquisitionJournalLineId) || acquisition === null ? 'Select an active category and actual posted acquisition line.'
        : ![form.acquiredOn, form.inServiceOn, depreciationStartOn].every(validDay) || form.acquiredOn > form.inServiceOn
          ? 'Enter valid dates. Available-for-use cannot precede acquisition.'
          : !validLife(life) || !moneyInput(form.residualValue) || residual === null || residual > acquisition
            ? 'Enter 1–600 months and an exact nonnegative residual no larger than the source debit.'
            : form.supportingEvidence.trim().length < 10 || form.custodianId && !routeId(form.custodianId)
              ? 'Provide supporting evidence and a valid custodian UUID if applicable.' : '';
    setIssue(error);
    if (error) return;
    const saved = await mutation.run(() => saveAsset({ ...form, depreciationStartOn, usefulLifeMonths: Number(life) }, asset), 'Asset draft saved.');
    if (saved) onSaved(saved.id);
  }
  return <form className={styles.page} noValidate onSubmit={event => { event.preventDefault(); void save(); }}>
    <CoreFeedback error={issue || mutation.error} message={mutation.message} />
    <fieldset className={styles.page} disabled={mutation.busy}>
      <div className={styles.formGrid}>
        <CoreInput label="Asset code" maxLength={80} value={form.assetNumber} onChange={event => update({ assetNumber: event.target.value })} />
        <CoreInput label="Asset name" maxLength={200} value={form.assetName} onChange={event => update({ assetName: event.target.value })} />
        <CoreInput label="Location" maxLength={255} value={form.location ?? ''} onChange={event => update({ location: event.target.value || null })} />
        <CoreInput label="Description" maxLength={1000} value={form.description ?? ''} onChange={event => update({ description: event.target.value || null })} />
        <CoreInput label="Custodian user ID (optional)" value={form.custodianId ?? ''} onChange={event => update({ custodianId: event.target.value.trim() || null })} />
      </div>
      <CategoryChoice value={form.assetCategoryId} onChange={assetCategoryId => {
        if (assetCategoryId !== form.assetCategoryId) { setCost(''); update({ assetCategoryId, acquisitionJournalLineId: '' }); }
      }} />
      {form.assetCategoryId ? <CoreReadState read={read} /> : null}
      {category ? <p className={category.policy ? styles.note : styles.warning}>{category.policy
        ? 'STRAIGHT_LINE · ' + category.policy.partialMonthPolicy + ' · Default useful life ' + category.defaultUsefulLifeMonths + ' months'
        : 'PENDING_POLICY · The draft can be saved. Activation requires an adopted capitalization and depreciation policy.'}</p> : null}
      <p className={styles.note}>Select an actual unreversed AP or approved manual acquisition journal with a debit to the category asset account. The source debit supplies the entire acquisition cost.</p>
      <PostedLineChoice label="Acquisition" initialJournal={asset?.relFkAccFixedAssetSource.journalId ?? journalId}
        value={form.acquisitionJournalLineId} eligible={(line, journal) => purchaseKind(journal) && isDebit(line) && line.accountId === category?.assetAccountId}
        onChange={(acquisitionJournalLineId, line) => { setCost(line?.debit ?? ''); update({ acquisitionJournalLineId }); }} />
      <p>Acquisition source debit · {accountingMoney(cost || null)}</p>
      <div className={styles.formGrid}>
        <CoreInput label="Acquisition date" type="date" value={form.acquiredOn} onChange={event => update({ acquiredOn: event.target.value })} />
        <CoreInput label="Available-for-use date" type="date" value={form.inServiceOn} onChange={event => update({ inServiceOn: event.target.value })} />
        <CoreInput label="Depreciation start" type="date" readOnly={!!start} value={start || form.depreciationStartOn}
          onChange={event => update({ depreciationStartOn: event.target.value })} />
        <CoreInput label="Useful life (months)" inputMode="numeric" maxLength={3} value={life} onChange={event => setLife(event.target.value)} />
        <MoneyField label="Residual value" value={form.residualValue} onChange={residualValue => update({ residualValue })} />
      </div>
      <TextArea label="Acquisition evidence" value={form.supportingEvidence} onChange={supportingEvidence => update({ supportingEvidence })} maxLength={1000} />
      <div><Button type="submit" disabled={mutation.busy}>Save asset draft</Button></div>
    </fieldset>
  </form>;
}
