import { apiFetch } from '@/lib/api';
import type { Approval } from '../core/types';
import type { AccrualAdjustment, AccrualInput, AccrualRow, PlanInput, PlanPreview, ScheduleCommand, ScheduleInput, ScheduleSource } from './types';

function send<T>(path: string, body: unknown, method: 'POST' | 'PATCH' = 'POST') {
  return apiFetch<T>('/accounting/' + path, { method, body: JSON.stringify(body) });
}

export function saveAccrual(input: AccrualInput, existing?: Pick<AccrualRow, 'id' | 'revision'>) {
  return existing
    ? send<AccrualRow>('accruals/' + existing.id, { ...input, expectedRevision: existing.revision }, 'PATCH')
    : send<AccrualRow>('accruals', input);
}
export const adjustAccrual = (id: string, input: AccrualAdjustment) => send<AccrualRow>('accruals/' + id + '/adjustments', input);
export const previewSchedule = (input: PlanInput) => send<PlanPreview>('schedules/preview', input);
export const createSchedule = (input: ScheduleInput) => send<ScheduleSource>('schedules', input);
export const requestCommand = (id: string, expectedRevision: number, command: ScheduleCommand) =>
  send<Approval>('schedules/' + id + '/requests', { expectedRevision, command });
export const requestPeriod = (id: string, expectedRevision: number, recognitionEvidence?: string) =>
  send<Approval>('schedule-periods/' + id + '/submit', { expectedRevision, recognitionEvidence });
export const requestScheduledReversal = (id: string, remark: string) =>
  send<Approval>('accruals/' + id + '/scheduled-reversal', { remark });
export const requestAccrualReversal = (id: string, accountingDate: string, remark: string) =>
  send<Approval>('accruals/' + id + '/reversal-requests', { accountingDate, remark });
export const submitAccrual = (id: string, expectedRevision: number) =>
  send<Approval>('accruals/' + id + '/submit', { expectedRevision });
export const applyStage23Approval = (path: string, approvalRequestId: string) =>
  send<unknown>(path, { approvalRequestId });
