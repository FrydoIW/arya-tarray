"use client";
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { currentBusinessDayValue } from '@/lib/business-time';
import type { AccountingOptions } from '../types';
import { AccountLookupSearch, AccountSelect, useAccountLookup } from './AccountLookup';
import { CoreFeedback, CoreField, CoreInput, CoreReadState, CoreTable } from './CoreUI';
import { saveDraft } from './api';
import { useCoreMutation, useCoreRead } from './hooks';
import { draftJournalTypes } from './contracts.generated';
import { openDateReason, useFiscalYears } from './FiscalScope';
import { accountingMoney, centsDecimal, decimalCents } from './presentation';
import type { Draft, DraftInput, DraftLine } from './types';
import styles from './core.module.css';

export function DraftForm({ draft, onClose, onSaved }: { draft: Draft | null; onClose: () => void; onSaved: (draft: Draft) => void }) {
  const [form, setForm] = useState<DraftInput>(() => draft ? { journalType: draft.journalType, accountingDate: draft.accountingDate.slice(0, 10), sourceReference: draft.sourceReference, description: draft.description, lines: draft.lines } : { journalType: draftJournalTypes[0], accountingDate: currentBusinessDayValue(), sourceReference: '', description: null, lines: [{ accountId: '', debit: '0.00', credit: '0.00' }, { accountId: '', debit: '0.00', credit: '0.00' }] });
  const lookup = useAccountLookup(), fiscal = useFiscalYears(), banks = useCoreRead<AccountingOptions>('options');
  const mutation = useCoreMutation(), [validation, setValidation] = useState(''), [confirming, setConfirming] = useState(false);
  const periodReason = openDateReason(fiscal.data, form.accountingDate);
  const totals = form.lines.reduce((sum, line) => ({ debit: sum.debit + (decimalCents(line.debit) ?? BigInt(0)), credit: sum.credit + (decimalCents(line.credit) ?? BigInt(0)) }), { debit: BigInt(0), credit: BigInt(0) });
  const update = (next: Partial<DraftInput>) => { setForm(current => ({ ...current, ...next })); setConfirming(false); setValidation(''); };
  function updateLine(index: number, next: Partial<DraftLine>) { update({ lines: form.lines.map((line, i) => i === index ? { ...line, ...next } : line) }); }
  function review() {
    if (periodReason) { setValidation(periodReason); return; }
    if (!form.sourceReference.trim()) { setValidation('Source reference is required.'); return; }
    if (form.lines.length < 2 || form.lines.length > 500) { setValidation('A journal needs 2–500 lines.'); return; }
    for (const line of form.lines) {
      const debit = decimalCents(line.debit), credit = decimalCents(line.credit), account = lookup.read.data?.rows.find(row => row.id === line.accountId);
      if (!line.accountId || !/^\d{1,18}(\.\d{1,2})?$/.test(line.debit) || !/^\d{1,18}(\.\d{1,2})?$/.test(line.credit) || debit === null || credit === null || (debit > BigInt(0)) === (credit > BigInt(0))) { setValidation('Each line needs an account and exactly one positive debit or credit, with at most two decimal places.'); return; }
      if (account && (!account.activeFlag || !account.postingFlag)) { setValidation('Each line requires an active posting account.'); return; }
    }
    if (totals.debit !== totals.credit) { setValidation('Journal debits and credits must balance exactly.'); return; }
    setConfirming(true);
  }
  async function save() {
    const payload: DraftInput = { ...form, lines: form.lines.map(line => ({ accountId: line.accountId, debit: line.debit, credit: line.credit, bankAccountId: line.bankAccountId ?? null, accountingFundId: line.accountingFundId ?? null, fundRestrictionId: line.fundRestrictionId ?? null, counterpartyId: line.counterpartyId ?? null })) };
    const result = await mutation.run(() => saveDraft(draft?.id ?? null, payload, draft?.revision), 'Draft saved; no journal has been posted.');
    if (result) onSaved(result);
  }
  return <Modal open title={draft ? `Revise ${draft.draftNumber}` : 'Create journal draft'} description="Save an unposted manual or adjusting journal. Independent approval and posting are separate actions." onClose={() => { if (!mutation.busy) onClose(); }}>
    <form className={styles.modal} onSubmit={e => { e.preventDefault(); review(); }}>
      <CoreFeedback error={validation || mutation.error} message={mutation.message} />
      <fieldset disabled={mutation.busy} className={styles.formGrid}>
        <CoreField label="Journal type"><Select aria-label="Draft journal type" value={form.journalType} onChange={e => { const kind = draftJournalTypes.find(item => item === e.target.value); if (kind) update({ journalType: kind }); }}>{draftJournalTypes.map(kind => <option key={kind}>{kind}</option>)}</Select></CoreField>
        <CoreInput label="Accounting date" type="date" required value={form.accountingDate} onChange={e => update({ accountingDate: e.target.value })} />
        <CoreInput label="Source reference" required maxLength={110} value={form.sourceReference} onChange={e => update({ sourceReference: e.target.value })} />
        <label className={styles.field}><span>Description / supporting reference</span><textarea aria-label="Description / supporting reference" maxLength={5000} value={form.description ?? ''} onChange={e => update({ description: e.target.value || null })} /></label>
      </fieldset>
      <CoreReadState read={fiscal} />{periodReason ? <p className={styles.warning}>{periodReason}</p> : null}
      <AccountLookupSearch lookup={lookup} /><p className={styles.note}>Amounts use a decimal point and at most two decimal places. Additional existing fund/restriction/counterparty dimensions are preserved on revision. No attachment upload is provided by this draft API.</p>
      <div className={styles.lineEditor}><CoreTable label="Draft journal lines" headers={['Account', 'Debit', 'Credit', 'Bank dimension', 'Action']}>
        {form.lines.map((line, index) => <tr key={index}><td><AccountSelect label={`Line ${index + 1} account`} rows={lookup.read.data?.rows ?? []} mode="posting" value={line.accountId} disabled={mutation.busy || lookup.read.loading} onChange={accountId => updateLine(index, { accountId })} /></td>
          <td><input className="ui-table-input" aria-label={`Line ${index + 1} debit`} inputMode="decimal" value={line.debit} disabled={mutation.busy} onChange={e => updateLine(index, { debit: e.target.value })} /></td>
          <td><input className="ui-table-input" aria-label={`Line ${index + 1} credit`} inputMode="decimal" value={line.credit} disabled={mutation.busy} onChange={e => updateLine(index, { credit: e.target.value })} /></td>
          <td><Select aria-label={`Line ${index + 1} bank dimension`} value={line.bankAccountId ?? ''} disabled={mutation.busy || banks.loading} onChange={e => updateLine(index, { bankAccountId: e.target.value || null })}><option value="">None</option>{line.bankAccountId && !banks.data?.banks.some(bank => bank.id === line.bankAccountId) ? <option value={line.bankAccountId}>{line.bankAccountId}</option> : null}{banks.data?.banks.map(bank => <option key={bank.id} value={bank.id}>{bank.label}</option>)}</Select></td>
          <td><Button variant="ghost" disabled={mutation.busy || form.lines.length <= 2} onClick={() => update({ lines: form.lines.filter((_, i) => i !== index) })}>Remove line {index + 1}</Button></td></tr>)}
      </CoreTable><Button variant="outline" disabled={mutation.busy || form.lines.length >= 500} onClick={() => update({ lines: [...form.lines, { accountId: '', debit: '0.00', credit: '0.00' }] })}>Add line</Button></div>
      {banks.error ? <p role="alert" className={styles.warning}>{banks.error} Bank dimension choices unavailable. <Button variant="ghost" onClick={banks.refresh}>Retry bank choices</Button></p> : null}
      <div className={styles.summary}><span>Draft debit: {accountingMoney(centsDecimal(totals.debit))}</span><span>Draft credit: {accountingMoney(centsDecimal(totals.credit))}</span></div>
      {confirming ? <><p className={styles.warning}>Confirm saving this unposted {form.journalType} draft for {form.accountingDate}. Revising an existing draft supersedes its unused approvals. Nothing is posted by this action.</p><div className={styles.actions}><Button disabled={mutation.busy} onClick={() => void save()}>{mutation.busy ? 'Saving…' : 'Confirm save draft'}</Button><Button variant="outline" disabled={mutation.busy} onClick={() => setConfirming(false)}>Back to form</Button></div></> : <Button type="submit" disabled={mutation.busy || fiscal.loading}>Review draft</Button>}
    </form>
  </Modal>;
}
