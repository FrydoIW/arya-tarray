import { FinancialReportsWorkspace } from '@/features/accounting/reporting/FinancialReportsWorkspace';
import type { StatementKind } from '@/features/accounting/reporting/types';
import { routeId } from '@/features/accounting/core/route-scope';

const statements: StatementKind[] = ['position', 'income', 'net-assets', 'cash-flows', 'supporting-schedules'];
function reportDay(value: string | string[] | undefined) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : '';
}
export default async function FinancialReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const statement = typeof query.statement === 'string' && statements.includes(query.statement as StatementKind) ? query.statement as StatementKind : 'position';
  const fiscalYearId = routeId(query.fiscalYearId);
  const from = reportDay(query.from), to = reportDay(query.to), comparativeFrom = reportDay(query.comparativeFrom), comparativeTo = reportDay(query.comparativeTo);
  const initialScope = fiscalYearId ? {
    fiscalYearId,
    ...(from && to && from <= to ? { from, to } : {}),
    ...(comparativeFrom && comparativeTo && comparativeFrom <= comparativeTo ? { comparativeFrom, comparativeTo } : {})
  } : undefined;
  return <FinancialReportsWorkspace key={statement} initialStatement={statement} initialScope={initialScope} />;
}
