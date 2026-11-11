'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { currentBusinessDayValue } from '@/lib/business-time';
import { AccountLookupSearch, AccountSelect, useAccountLookup } from '../core/AccountLookup';
import { CoreFeedback, CoreField, CoreInput, CoreReadState } from '../core/CoreUI';
import { openDateReason, useFiscalYears } from '../core/FiscalScope';
import { useCoreMutation } from '../core/hooks';
import { accountingMoney, decimalCents } from '../core/presentation';
import { routeId } from '../core/route-scope';
import styles from '../core/core.module.css';
import { adjustReceivable, cancelSource, matchSettlement, reverseSource, submitSource } from './api';
import { BankEvidencePicker } from './BankEvidence';
import { ChoiceField, MoneyField, positiveAmount, TextArea, validDay } from './fields';
import type { AdjustmentInput, SettlementDetail, Side } from './types';

type Action = 'submit' | 'cancel' | 'reverse' | 'match' | 'adjust';
const labels: Record<Action, string> = {
  submit: 'Request approval', cancel: 'Withdraw draft', reverse: 'Request reversal',
  match: 'Match imported transaction', adjust: 'Request AR adjustment'
};
const descriptions: Record<Action, string> = {
  submit: 'Send the displayed revision to independent reviewers. Posting requires separate authorization.',
  cancel: 'Withdraw the draft and invalidate active approval requests. The audit record is retained.',
  reverse: 'Request independent review of a compensating journal. The original journal is retained.',
  match: 'Attach existing bank evidence to this posted settlement. This action creates no payment, receipt or journal.',
  adjust: 'Send a change to the recognized receivable for independent approval and separate posting.'
};

type SourceActionProps = {
  side: Side;
  path: string;
  revision: number;
  accountingDate: string;
  settlement?: SettlementDetail;
  adjustment?: { outstanding: string; controlAccountId: string };
  available: Action[];
  onChanged: (approvalId: string, message: string) => void;
};

export function SourceActions(props: SourceActionProps) {
  const [action, setAction] = useState<Action | null>(null);
  return <>
    {props.available.length ? <div className={styles.actions}>
      {props.available.map(item => <Button key={item} variant="outline" onClick={() => setAction(item)}>{labels[item]}</Button>)}
    </div> : null}
    {action ? <SourceActionDialog {...props} action={action} onClose={() => setAction(null)}
      onSaved={(id, message) => { setAction(null); props.onChanged(id, message); }} /> : null}
  </>;
}

function SourceActionDialog({ side, path, revision, accountingDate, settlement, adjustment, action, onClose, onSaved }: SourceActionProps & {
  action: Action; onClose: () => void; onSaved: (approvalId: string, message: string) => void;
}) {
  const [date, setDate] = useState(action === 'submit' ? accountingDate : currentBusinessDayValue());
  const [reason, setReason] = useState('');
  const [bankId, setBankId] = useState('');
  const [review, setReview] = useState(false);
  const [error, setError] = useState('');
  const mutation = useCoreMutation();
  const fiscal = useFiscalYears();
  const [adjust, setAdjust] = useState<AdjustmentInput>({
    adjustmentReference: '', accountingDate: '', adjustmentKind: 'DECREASE', amount: '', offsetAccountId: '', reason: ''
  });
  const requirePeriod = ['submit', 'reverse', 'adjust'].includes(action);
  const period = requirePeriod ? openDateReason(fiscal.data, date) : '';
  const maxReason = action === 'match' || action === 'adjust' ? 500 : 1000;
  const minReason = action === 'adjust' ? 10 : 1;
  const change = () => { setReview(false); setError(''); };
  const changeAdjust = (update: Partial<AdjustmentInput>) => { setAdjust(current => ({ ...current, ...update })); change(); };

  function validate() {
    if (requirePeriod && (!validDay(date) || period)) return period || 'Enter a valid accounting date.';
    if ((action === 'reverse' || action === 'adjust') && date < accountingDate) return 'The accounting date cannot precede the source.';
    if (action !== 'submit' && reason.trim().length < minReason) return 'Enter the required reason or evidence.';
    if (action === 'match' && (!settlement || !routeId(bankId))) return 'Select an existing imported transaction.';
    if (action === 'adjust') {
      const amount = positiveAmount(adjust.amount);
      if (!adjust.adjustmentReference.trim() || amount === null || !routeId(adjust.offsetAccountId)) return 'Enter an adjustment reference, positive exact amount and offset account.';
      const outstanding = decimalCents(adjustment?.outstanding ?? '');
      if (adjust.adjustmentKind === 'DECREASE' && outstanding !== null && amount > outstanding) return 'Decrease exceeds the displayed outstanding balance.';
    }
    return '';
  }
  async function save() {
    const issue = validate();
    if (issue) { setError(issue); setReview(false); return; }
    if (action === 'submit' || action === 'reverse' || action === 'adjust') {
      const work = action === 'submit' ? () => submitSource(path, revision)
        : action === 'reverse' ? () => reverseSource(path, date, reason.trim())
          : () => adjustReceivable(path, { ...adjust, adjustmentReference: adjust.adjustmentReference.trim(), accountingDate: date, reason: reason.trim() });
      const result = await mutation.run(work, 'Approval requested.');
      if (result) onSaved(result.id, 'Approval requested.');
      return;
    }
    if (action === 'cancel') {
      const result = await mutation.run(() => cancelSource(path, revision, reason.trim()), 'Draft withdrawn.');
      if (result) onSaved('', 'Draft withdrawn.');
      return;
    }
    const result = await mutation.run(() => matchSettlement(path, bankId, reason.trim()), 'Bank evidence linked.');
    if (result) onSaved('', 'Bank evidence linked. ' + result.reconciliationState);
  }

  return <Modal open title={labels[action]} description={descriptions[action]} onClose={() => { if (!mutation.busy) onClose(); }}>
    <form className={styles.modal} onSubmit={event => { event.preventDefault(); const issue = validate(); setError(issue); setReview(!issue); }}>
      <CoreFeedback error={error || mutation.error} message={mutation.message} />
      <fieldset className={styles.page} disabled={mutation.busy}>
        {requirePeriod ? <CoreReadState read={fiscal} /> : null}
        {period ? <p className={styles.warning}>{period}</p> : null}
        {action === 'submit' ? <p>Source revision {revision} · Accounting date {accountingDate}</p> : null}
        {action === 'reverse' || action === 'adjust' ? <CoreInput label="Action accounting date" required type="date" min={accountingDate}
          value={date} onChange={event => { setDate(event.target.value); change(); }} /> : null}
        {action === 'adjust' ? <>
          <CoreInput label="Adjustment reference" maxLength={100} required value={adjust.adjustmentReference}
            onChange={event => changeAdjust({ adjustmentReference: event.target.value })} />
          <ChoiceField label="Adjustment kind" value={adjust.adjustmentKind} required
            choices={[{ id: 'DECREASE', label: 'Decrease' }, { id: 'INCREASE', label: 'Increase' }]}
            onChange={value => changeAdjust({ adjustmentKind: value === 'INCREASE' ? 'INCREASE' : 'DECREASE' })} />
          <MoneyField label="Adjustment amount" value={adjust.amount} onChange={amount => changeAdjust({ amount })} />
          <AdjustmentAccount kind={adjust.adjustmentKind} controlAccountId={adjustment?.controlAccountId}
            value={adjust.offsetAccountId} onChange={offsetAccountId => changeAdjust({ offsetAccountId })} />
          <p className={styles.note}>Displayed outstanding · {accountingMoney(adjustment?.outstanding)}</p>
        </> : null}
        {action === 'match' && settlement ? <BankEvidencePicker side={side} bankAccountId={settlement.bankAccountId} amount={settlement.amount}
          date={settlement.settlementDate} value={bankId} onChange={value => { setBankId(value); change(); }} /> : null}
        {action !== 'submit' ? <TextArea label="Reason / evidence" minLength={minReason} maxLength={maxReason} value={reason}
          onChange={value => { setReason(value); change(); }} /> : null}
      </fieldset>
      {review ? <><p className={styles.warning}>{descriptions[action]}</p><Button disabled={mutation.busy} onClick={save}>Confirm {labels[action].toLowerCase()}</Button></>
        : <Button type="submit" disabled={mutation.busy || !!period}>Review action</Button>}
    </form>
  </Modal>;
}

function AdjustmentAccount({ kind, controlAccountId, value, onChange }: {
  kind: AdjustmentInput['adjustmentKind']; controlAccountId?: string; value: string; onChange: (value: string) => void;
}) {
  const lookup = useAccountLookup();
  const accounts = (lookup.read.loading ? [] : lookup.read.data?.rows ?? []).filter(row => !row.contraFlag
    && row.id !== controlAccountId && (['REVENUE', 'LIABILITY'].includes(row.accountType) && row.normalBalance === 'CREDIT'
      || kind === 'DECREASE' && row.accountType === 'EXPENSE' && row.normalBalance === 'DEBIT'));
  return <><AccountLookupSearch lookup={lookup} />
    <CoreField label="Adjustment offset account">
      <AccountSelect label="Adjustment offset account" rows={accounts} value={value} mode="posting" onChange={onChange} />
    </CoreField>
  </>;
}
