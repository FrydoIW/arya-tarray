import { CounterpartyWorkspace } from '@/features/accounting/apar/CounterpartyWorkspace';
import { routeId } from '@/features/accounting/core/route-scope';

export default async function CounterpartiesPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const id = routeId((await searchParams).id);
  return <CounterpartyWorkspace key={id} id={id} />;
}
