import { BankReconciliationWorkspace } from '@/features/accounting/finalization/BankReconciliationWorkspace';
import { routeId } from '@/features/accounting/core/route-scope';
export default async function BankReconciliationPage({ searchParams }: { searchParams: Promise<{ id?: string | string[] }> }) {
  const query = await searchParams;
  return <BankReconciliationWorkspace initialId={routeId(query.id)} />;
}
