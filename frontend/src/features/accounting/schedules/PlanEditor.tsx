'use client';

import { Button } from '@/components/ui/Button';
import { ChoiceField, MoneyField, positiveAmount, validDay } from '../apar/fields';
import { CoreInput, CoreTable } from '../core/CoreUI';
import type { AccountingFiscalYear } from '../types';
import type { PlanRow } from './types';

type Period = AccountingFiscalYear['revFkAccPeriodFy'][number];
export function validatePlan(rows: PlanRow[], amount: string, start: string, end: string, periods: Period[]) {
  if (!rows.length || rows.length > 240) return 'Provide between 1 and 240 period allocations.';
  if (new Set(rows.map(row => row.accountingPeriodId)).size !== rows.length) return 'Each accounting period may be used once.';
  let sum = BigInt(0);
  for (const row of rows) {
    const period = periods.find(item => item.id === row.accountingPeriodId);
    const cents = positiveAmount(row.plannedAmount);
    if (cents === null) return 'All allocations must be positive exact decimal amounts.';
    if (!period || !validDay(row.recognitionDate) || row.recognitionDate < start || row.recognitionDate > end ||
      row.recognitionDate < period.startDate.slice(0, 10) || row.recognitionDate > period.endDate.slice(0, 10)) {
      return 'Choose a configured period and a recognition date within both the service dates and that period.';
    }
    sum += cents;
  }
  return sum === positiveAmount(amount) ? '' : 'Period allocations must equal the requested amount exactly.';
}

export function PlanEditor({ rows, periods, fixedPeriods, onChange }: {
  rows: PlanRow[]; periods: Period[]; fixedPeriods?: boolean; onChange: (rows: PlanRow[]) => void;
}) {
  const choices = periods.map(period => ({ id: period.id, label: period.periodCode + ' · ' + period.status }));
  const update = (index: number, value: Partial<PlanRow>) => onChange(rows.map((row, i) => i === index ? { ...row, ...value } : row));
  return <>
    {rows.length ? <CoreTable label="Editable period allocations" headers={['Period', 'Recognition date', 'Allocation', 'Action']}>
      {rows.map((row, index) => <tr key={index}><td>
        <ChoiceField label={'Period ' + (index + 1)} disabled={fixedPeriods} value={row.accountingPeriodId} choices={choices}
          onChange={accountingPeriodId => update(index, { accountingPeriodId })} />
      </td><td><CoreInput label={'Recognition date ' + (index + 1)} type="date" value={row.recognitionDate}
        onChange={event => update(index, { recognitionDate: event.target.value })} /></td>
      <td><MoneyField label={'Allocation ' + (index + 1)} value={row.plannedAmount} onChange={plannedAmount => update(index, { plannedAmount })} /></td>
      <td>{fixedPeriods ? 'Retain period' : <Button variant="outline" onClick={() => onChange(rows.filter((_, i) => i !== index))}>Remove period {index + 1}</Button>}</td></tr>)}
    </CoreTable> : null}
    {!fixedPeriods ? <div><Button variant="outline" disabled={rows.length >= 240}
      onClick={() => onChange([...rows, { accountingPeriodId: '', recognitionDate: '', plannedAmount: '' }])}>Add custom period</Button></div> : null}
  </>;
}
