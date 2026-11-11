import { apiFetch, apiFetchBlob } from '@/lib/api';
import type { FinancialReport, ReportScope, SupportingSchedules } from './types';

export function financialReportQuery(scope: ReportScope) {
  const params = new URLSearchParams({ fiscalYearId: scope.fiscalYearId, from: scope.from, to: scope.to });
  if (scope.comparativeFrom && scope.comparativeTo) {
    params.set('comparativeFrom', scope.comparativeFrom);
    params.set('comparativeTo', scope.comparativeTo);
  }
  if (scope.accountingFundId) params.set('accountingFundId', scope.accountingFundId);
  if (scope.eventCampaignId) params.set('eventCampaignId', scope.eventCampaignId);
  return params.toString();
}
export const readFinancialStatements = (scope: ReportScope, signal: AbortSignal) =>
  apiFetch<FinancialReport>(`/accounting/financial-statements?${financialReportQuery(scope)}`, { signal });
export const readSupportingSchedules = (scope: ReportScope, signal: AbortSignal) =>
  apiFetch<SupportingSchedules>(`/accounting/financial-statements/supporting-schedules?${financialReportQuery(scope)}`, { signal });
export const exportFinancialStatements = (scope: ReportScope, format: 'csv' | 'xlsx') =>
  apiFetchBlob(`/accounting/financial-statements/export?${financialReportQuery(scope)}&format=${format}`);
