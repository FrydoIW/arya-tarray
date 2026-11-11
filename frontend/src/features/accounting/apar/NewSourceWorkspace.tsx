'use client';

import { useAuthSession } from '@/features/auth/context/AuthSessionContext';
import { CoreCard, CorePage, CoreReadState } from '../core/CoreUI';
import { managementGrant } from './api';
import { DocumentForm } from './DocumentForm';
import { SettlementForm } from './SettlementForm';
import { SubledgerLinks, subledgerName } from './SubledgerLists';
import type { Side, Source } from './types';

export function NewSourceWorkspace({ side, source, initialParty }: { side: Side; source: Source; initialParty?: string }) {
  const user = useAuthSession();
  if (!user.menuCodes.includes(managementGrant[side])) return <CorePage title={subledgerName[side]} description="Draft creation requires subledger management access.">
    <SubledgerLinks side={side} />
    <CoreCard><CoreReadState read={{ forbidden: true, loading: false, error: '', refresh: () => undefined }} /></CoreCard>
  </CorePage>;
  return source === 'documents' ? <DocumentForm side={side} /> : <SettlementForm side={side} initialParty={initialParty} />;
}
