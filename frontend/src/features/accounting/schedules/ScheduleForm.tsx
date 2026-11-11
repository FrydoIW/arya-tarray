'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { ChoiceField, JournalLink, MoneyField, positiveAmount, TextArea, validDay } from '../apar/fields';
import { AccountLookupSearch, AccountSelect, useAccountLookup } from '../core/AccountLookup';
import { CoreFeedback, CoreField, CoreInput, CoreReadState } from '../core/CoreUI';
import { useFiscalYears } from '../core/FiscalScope';
import { useCoreMutation, useCoreRead } from '../core/hooks';
import { accountingMoney } from '../core/presentation';
import { routeId } from '../core/route-scope';
import type { CoreJournal } from '../core/types';
import styles from '../core/core.module.css';
import { createSchedule, previewSchedule } from './api';
import { PlanEditor, validatePlan } from './PlanEditor';
import { PlanTable } from './ScheduleUI';
import { allocationMethods, type PlanPreview, type ScheduleInput } from './types';

export const scheduleKinds = [{ id: 'PREPAYMENT', label: 'Prepayment' }, { id: 'DEFERRED_INCOME', label: 'Deferred income' }];

export function ScheduleForm({ journalId }: { journalId: string }) {
  const router = useRouter(), accounts = useAccountLookup(), fiscal = useFiscalYears(), mutation = useCoreMutation();
  const [issue, setIssue] = useState('');
  const [journalInput, setJournalInput] = useState(journalId);
  const [journal, setJournal] = useState(journalId);
  const [preview, setPreview] = useState<PlanPreview | null>(null);
  const [form, setForm] = useState<ScheduleInput>({ scheduleKind: 'PREPAYMENT', scheduleReference: '', sourceJournalLineId: '',
    recognitionAccountId: '', amount: '', startDate: '', endDate: '', policyEvidence: '', recognitionBasis: '',
    allocationMethod: 'MONTHLY_EQUAL', customPeriods: [],
  });
  const update = (value: Partial<ScheduleInput>, invalidatesPreview = false) => {
    if (invalidatesPreview) setPreview(null);
    setForm({ ...form, ...value });
  };
  const source = useCoreRead<CoreJournal>('journals/' + journal, !!journal);
  const prepaid = form.scheduleKind === 'PREPAYMENT';
  const eligibleSource = source.data && !source.loading && !source.error && source.data.state === 'POSTED'
    && !source.data.reversalOfJournalId && !source.data.linkedJournals.some(item => item.journalType === 'REVERSAL');
  const lines = eligibleSource ? source.data?.lines.filter(line => positiveAmount(prepaid ? line.debit : line.credit)) ?? [] : [];
  const selected = lines.find(line => line.id === form.sourceJournalLineId);
  const periods = fiscal.data?.flatMap(year => year.revFkAccPeriodFy) ?? [];
  const custom = form.allocationMethod === 'CUSTOM';
  const { amount, startDate, endDate, allocationMethod, customPeriods } = form;
  const plan = { amount, startDate, endDate, allocationMethod, ...(custom ? { customPeriods } : {}) };
  async function generate() {
    const error = !positiveAmount(amount) ? 'Enter a positive exact amount.'
      : !validDay(startDate) || !validDay(endDate) || startDate > endDate ? 'Enter a valid service date range.'
        : custom ? validatePlan(customPeriods ?? [], amount, startDate, endDate, periods) : '';
    setIssue(error);
    if (error) return;
    setPreview(null);
    const result = await mutation.run(() => previewSchedule(plan), 'Backend preview ready. No schedule was saved.');
    if (result) setPreview(result);
  }
  async function save() {
    const error = !preview ? 'Generate a current preview first.' : !selected || !routeId(form.recognitionAccountId)
      || selected.accountId === form.recognitionAccountId ? 'Choose an eligible posted source line and a distinct recognition account.'
        : !form.scheduleReference.trim() || [form.policyEvidence, form.recognitionBasis].some(value => value.trim().length < 10)
          ? 'Enter a reference, policy evidence, and recognition basis.' : '';
    setIssue(error);
    if (error) return;
    const result = await mutation.run(() => createSchedule({ ...form, ...plan, customPeriods: custom ? customPeriods : undefined }), 'Schedule draft saved.');
    if (result) router.push('/accounting/schedules/' + result.id);
  }
  return <form noValidate className={styles.page} onSubmit={event => { event.preventDefault(); void save(); }}>
    <CoreFeedback error={issue || mutation.error} message={mutation.message} />
    <fieldset className={styles.page} disabled={mutation.busy}>
      <div className={styles.formGrid}>
        <ChoiceField label="Schedule kind" value={form.scheduleKind} choices={scheduleKinds} onChange={value => {
          if (value === 'PREPAYMENT' || value === 'DEFERRED_INCOME') update({ scheduleKind: value, sourceJournalLineId: '', recognitionAccountId: '' }, true);
        }} />
        <CoreInput label="Schedule reference" value={form.scheduleReference} maxLength={100} onChange={event => update({ scheduleReference: event.target.value })} />
        <MoneyField label="Original schedule amount" value={amount} onChange={value => update({ amount: value }, true)} />
        <CoreInput label="Service start" type="date" value={startDate} onChange={event => update({ startDate: event.target.value }, true)} />
        <CoreInput label="Service end" type="date" value={endDate} onChange={event => update({ endDate: event.target.value }, true)} />
        <ChoiceField label="Allocation method" value={allocationMethod} choices={allocationMethods.map(id => ({ id, label: id }))} onChange={value => {
          if (value === 'MONTHLY_EQUAL' || value === 'ACTUAL_DAYS' || value === 'CUSTOM') update({ allocationMethod: value }, true);
        }} />
      </div>
      {custom ? <><CoreReadState read={fiscal} /><PlanEditor rows={customPeriods ?? []} periods={periods}
        onChange={value => update({ customPeriods: value }, true)} /></> : null}
      <div><Button variant="outline" disabled={mutation.busy} onClick={generate}>Preview schedule</Button></div>
      {preview ? <><h3>Backend plan preview</h3><p className={styles.note}>Planned allocations only. Nothing has been posted.</p>
        <PlanTable rows={preview.periods} label="Backend allocation preview"
          periodLabels={new Map(periods.map(period => [period.id, period.periodCode]))} /></> : null}
      <h3>Posted balance source</h3>
      <div className={styles.toolbar}>
        <CoreInput label="Posted source journal ID" value={journalInput} onChange={event => {
          setJournalInput(event.target.value); setJournal(''); update({ sourceJournalLineId: '' });
        }} />
        <Button variant="outline" disabled={!routeId(journalInput) || source.loading} onClick={() => setJournal(routeId(journalInput))}>Load journal</Button>
      </div>
      {journal ? <CoreReadState read={source} /> : null}
      {source.data && !source.loading && !source.error ? <p>{source.data.journalNumber} · <JournalLink id={source.data.id} /></p> : null}
      {source.data && !source.loading && !source.error && !eligibleSource ? <p className={styles.warning}>Select an original posted journal without a posted reversal.</p> : null}
      <ChoiceField label={prepaid ? 'Prepaid asset source line' : 'Deferred liability source line'}
        value={form.sourceJournalLineId} onChange={sourceJournalLineId => update({ sourceJournalLineId })}
        choices={lines.map(line => ({ id: line.id, label: line.accountCodeSnapshot + ' · ' + line.accountNameSnapshot + ' · ' + accountingMoney(prepaid ? line.debit : line.credit) }))} />
      <p className={styles.note}>The source line must use the actual {prepaid ? 'prepaid asset' : 'deferred liability'} account. The backend verifies account class, reversal status, and remaining source capacity.</p>
      <AccountLookupSearch lookup={accounts} />
      <CoreField label={prepaid ? 'Expense account' : 'Revenue account'}><AccountSelect label={prepaid ? 'Expense account' : 'Revenue account'}
        value={form.recognitionAccountId} mode="posting" onChange={recognitionAccountId => update({ recognitionAccountId })}
        rows={(accounts.read.data?.rows ?? []).filter(row => !row.contraFlag && row.accountType === (prepaid ? 'EXPENSE' : 'REVENUE'))} /></CoreField>
      {!prepaid ? <p className={styles.warning}>Deferred income requires an actual liability and fulfillment evidence. Donor restriction by itself does not create a liability.</p> : null}
      <TextArea label="Policy evidence" value={form.policyEvidence} onChange={policyEvidence => update({ policyEvidence })} maxLength={1000} minLength={10} />
      <TextArea label="Recognition basis" value={form.recognitionBasis} onChange={recognitionBasis => update({ recognitionBasis })} maxLength={1000} minLength={10} />
      <div><Button type="submit" disabled={mutation.busy || !preview}>Save schedule draft</Button></div>
    </fieldset>
  </form>;
}
