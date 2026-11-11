import { LedgerWorkspace } from '@/features/accounting/core/LedgerWorkspace';
import { ledgerRouteScope } from '@/features/accounting/core/route-scope';
export default async function TrialBalancePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) { return <LedgerWorkspace trial initialScope={ledgerRouteScope(await searchParams)} />; }
