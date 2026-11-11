import { apiFetch } from '@/lib/api';
import type { Approval } from '../core/types';
import type { Designation, DesignationInput, Fund, FundCommand, FundInput, FundMovement, FundMovementInput, FundSourcePath, ReleaseInput, Restriction, RestrictionInput } from './types';

function write<T>(path: string, body: unknown, method: 'POST' | 'PATCH' = 'POST') {
  return apiFetch<T>('/accounting/' + path, { method, body: JSON.stringify(body) });
}
export const saveFund = (input: FundInput, current?: Fund) => current
  ? write<Fund>('funds/' + current.id, { ...input, expectedRevision: current.revision }, 'PATCH')
  : write<Fund>('funds', input);
export const saveRestriction = (fundId: string, input: RestrictionInput, current?: Restriction) => current
  ? write<Restriction>('fund-restrictions/' + current.id, { ...input, expectedRevision: current.revision }, 'PATCH')
  : write<Restriction>('funds/' + fundId + '/restrictions', input);
export const createDesignation = (fundId: string, input: DesignationInput) =>
  write<Designation>('funds/' + fundId + '/designations', input);
export const createMovement = (fundId: string, input: FundMovementInput) =>
  write<FundMovement>('funds/' + fundId + '/movements', input);
export const createFundCommand = (fundId: string, input: FundCommand) =>
  write<FundMovement>('funds/' + fundId + '/commands', input);
export const submitFundSource = (path: FundSourcePath, id: string, revision: number, kind?: 'FUND_COMMAND' | 'FUND_JOURNAL') =>
  write<Approval>(path + '/' + id + '/submit', { expectedRevision: revision, ...(kind ? { kind } : {}) });
export const submitFundRelease = (restriction: Restriction, input: ReleaseInput) =>
  write<Approval>('fund-restrictions/' + restriction.id + '/releases', { ...input, expectedRevision: restriction.revision });
export const cancelFundSource = (path: Exclude<FundSourcePath, 'funds'>, id: string, revision: number, reason: string) =>
  write<unknown>(path + '/' + id + '/cancel', { expectedRevision: revision, reason });
export const applyFundApproval = (path: FundSourcePath, sourceId: string, approvalRequestId: string) =>
  write<unknown>(path + '/' + sourceId + '/apply', { approvalRequestId });
