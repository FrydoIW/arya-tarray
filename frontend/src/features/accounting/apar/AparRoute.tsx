import { notFound } from 'next/navigation';
import { routeId } from '../core/route-scope';
import { NewSourceWorkspace } from './NewSourceWorkspace';
import { DocumentWorkspace, SettlementWorkspace } from './SourceDetail';
import { OutstandingWorkspace, SubledgerList } from './SubledgerLists';
import type { Side } from './types';

export type AparRouteProps = {
  params: Promise<{ source?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function AparRoute({ side, params, searchParams }: AparRouteProps & { side: Side }) {
  const [{ source = [] }, query] = await Promise.all([params, searchParams]);
  const [first, second] = source;
  const initialParty = routeId(query.counterpartyId);
  const edit = query.edit === '1';
  if (source.length === 0) return <SubledgerList key={side + ':documents:' + initialParty} side={side} source="documents" initialParty={initialParty} />;
  if (source.length === 1) {
    if (first === 'new') return <NewSourceWorkspace side={side} source="documents" />;
    if (first === 'settlements') return <SubledgerList key={side + ':settlements:' + initialParty} side={side} source="settlements" initialParty={initialParty} />;
    if (first === 'outstanding' || first === 'aging') return <OutstandingWorkspace key={side + first + initialParty} side={side} view={first} initialParty={initialParty} />;
    if (routeId(first)) return <DocumentWorkspace key={first + edit} side={side} id={first} edit={edit} />;
  }
  if (source.length === 2 && first === 'settlements') {
    if (second === 'new') return <NewSourceWorkspace key={side + initialParty} side={side} source="settlements" initialParty={initialParty} />;
    if (routeId(second)) return <SettlementWorkspace key={second + edit} side={side} id={second} edit={edit} />;
  }
  notFound();
}
