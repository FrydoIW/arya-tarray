export function routeId(value: string | string[] | undefined) { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : ''; }
export function ledgerRouteScope(params: Record<string, string | string[] | undefined>) {
  const scope: Partial<{ accountId: string; yearId: string; periodId: string; from: string; to: string }> = {};
  for (const [query, key] of [['accountId', 'accountId'], ['fiscalYearId', 'yearId'], ['accountingPeriodId', 'periodId']] as const) { const value = routeId(params[query]); if (value) scope[key] = value; }
  for (const key of ['from', 'to'] as const) { const value = params[key]; if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value) scope[key] = value; }
  return scope;
}
