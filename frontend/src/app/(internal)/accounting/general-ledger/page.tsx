import { LedgerWorkspace } from '@/features/accounting/core/LedgerWorkspace';
import { ledgerRouteScope } from '@/features/accounting/core/route-scope';
export default async function GeneralLedgerPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) { return <LedgerWorkspace initialScope={ledgerRouteScope(await searchParams)} />; }
