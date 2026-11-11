import { HttpError } from "../../../lib/http.js";
import { centsToDecimal } from "../../../lib/money.js";
import { positiveCents } from "../apar/apar.domain.js";
import type { PlanInput, PlanRow } from "./schedule.schema.js";
export const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
export const dateText = (value: Date) => value.toISOString().slice(0, 10);
type Period = { id: string; startDate: Date; endDate: Date };
export function validatePlanRows(rows: PlanRow[], amount: string, start: string, end: string, periods: Period[]) {
  if (!rows.length || rows.length > 240 || new Set(rows.map(r => r.accountingPeriodId)).size !== rows.length
    || rows.reduce((n, r) => n + positiveCents(r.plannedAmount), 0n) !== positiveCents(amount)) {
    throw new HttpError(400, "Schedule requires unique periods whose positive exact amounts equal the source total.");
  }
  for (const row of rows) {
    const period = periods.find(p => p.id === row.accountingPeriodId), date = day(row.recognitionDate);
    if (!period || date < period.startDate || date > period.endDate || row.recognitionDate < start || row.recognitionDate > end) {
      throw new HttpError(400, "Recognition dates must fall inside their configured accounting period and service range.");
    }
  }
  return [...rows].sort((a, b) => a.recognitionDate.localeCompare(b.recognitionDate) || a.accountingPeriodId.localeCompare(b.accountingPeriodId));
}
export function generateSchedulePlan(input: PlanInput, periods: Period[]): PlanRow[] {
  if (input.startDate > input.endDate) throw new HttpError(400, "Schedule service dates are invalid.");
  if (input.allocationMethod === "CUSTOM") return validatePlanRows(input.customPeriods ?? [], input.amount, input.startDate, input.endDate, periods);
  if (input.customPeriods?.length) throw new HttpError(400, "Custom periods require the CUSTOM method.");
  const start = day(input.startDate), end = day(input.endDate);
  const ranges = periods.filter(p => p.endDate >= start && p.startDate <= end).sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  if (!ranges.length || ranges.length > 240) throw new HttpError(409, "Configure the complete accounting period range before planning.");
  let cursor = start.getTime();
  const slots = ranges.map(period => {
    const from = Math.max(start.getTime(), period.startDate.getTime()), to = Math.min(end.getTime(), period.endDate.getTime());
    if (from !== cursor) throw new HttpError(409, "Accounting periods have a gap or overlap; no periods will be created automatically.");
    cursor = to + 86400000;
    return { period, end: new Date(to), weight: input.allocationMethod === "ACTUAL_DAYS" ? BigInt((to - from) / 86400000 + 1) : 1n };
  });
  if (cursor !== end.getTime() + 86400000) throw new HttpError(409, "Missing future accounting period; configure it explicitly first.");
  const total = positiveCents(input.amount), denominator = slots.reduce((n, s) => n + s.weight, 0n);
  const amounts = slots.map(s => total * s.weight / denominator);
  let residual = total - amounts.reduce((a, b) => a + b, 0n);
  for (let index = 0; residual > 0n; index++, residual--) amounts[index] += 1n;
  return validatePlanRows(slots.map((slot, index) => ({ accountingPeriodId: slot.period.id,
    recognitionDate: dateText(slot.end), plannedAmount: centsToDecimal(amounts[index]) })), input.amount, input.startDate, input.endDate, periods);
}
