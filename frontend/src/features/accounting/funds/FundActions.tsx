'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useAuthSession } from '@/features/auth/context/AuthSessionContext';
import { ApprovalLink } from '../apar/fields';
import type { Approval } from '../core/types';
import { CoreFeedback, CoreInput } from '../core/CoreUI';
import { useCoreMutation } from '../core/hooks';
import { journalPermissions } from '../core/contracts.generated';
import styles from '../core/core.module.css';
import { cancelFundSource, submitFundSource } from './api';
import type { FundSourcePath } from './types';

export function FundSourceActions({ path, source, kind, onChanged }: {
  path: FundSourcePath; source: { id: string; revision: number; status: string; createdById: string } | null;
  kind?: 'FUND_COMMAND' | 'FUND_JOURNAL'; onChanged: () => void;
}) {
  const user = useAuthSession(), mutation = useCoreMutation();
  const [reason, setReason] = useState(''), [action, setAction] = useState<'SUBMIT' | 'CANCEL' | null>(null);
  const [approval, setApproval] = useState<Approval | null>(null);
  const owner = !!source && source.createdById === user.id, draft = source?.status === 'DRAFT';
  const canManage = user.menuCodes.includes(journalPermissions.manage);
  async function execute() {
    if (!source || !action || !owner || !draft || !canManage) return;
    const result = action === 'SUBMIT'
      ? await mutation.run(() => submitFundSource(path, source.id, source.revision, kind), 'Approval request created. No financial result is assumed before independent review and application.')
      : await mutation.run(() => cancelFundSource(path as Exclude<FundSourcePath, 'funds'>, source.id, source.revision, reason.trim()), 'Draft cancelled by backend. Audit evidence remains available.');
    setAction(null);
    if (result) {
      if (action === 'SUBMIT') setApproval(result as Approval);
      else onChanged();
    }
  }
  return <div className={styles.page}>
    <CoreFeedback {...mutation} />
    {approval ? <p role="status"><ApprovalLink id={approval.id}>Open independent approval request</ApprovalLink></p> : null}
    {source && owner && draft && canManage ? <>
      {path !== 'funds' ? <CoreInput label="Cancellation reason" minLength={10} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} /> : null}
      <div className={styles.actions}>
        <Button disabled={mutation.busy} onClick={() => setAction('SUBMIT')}>Request independent approval</Button>
        {path !== 'funds' ? <Button variant="outline" disabled={mutation.busy || reason.trim().length < 10} onClick={() => setAction('CANCEL')}>Cancel draft</Button> : null}
      </div>
    </> : null}
    {source && draft && !owner ? <p className={styles.note}>Only creator user {source.createdById} may submit or cancel this draft.</p> : null}
    <ConfirmDialog open={!!action} title={action === 'CANCEL' ? 'Cancel fund draft?' : 'Submit fund source for review?'}
      message={action === 'CANCEL' ? 'Cancel this unposted draft. The backend records an audit entry and invalidates unused approvals.' : 'Submit the exact current source version and digest for independent review. Submission does not apply or post the source.'}
      confirmLabel={action === 'CANCEL' ? 'Confirm cancellation' : 'Confirm approval request'} loading={mutation.busy}
      onCancel={() => setAction(null)} onConfirm={execute} />
  </div>;
}
