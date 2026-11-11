'use client';

import Link from 'next/link';
import { JournalLink, validDay } from '../apar/fields';
import { CoreTable } from '../core/CoreUI';
import { accountingMoney, record, text } from '../core/presentation';
import { routeId } from '../core/route-scope';
import type { ApprovalDetail } from '../core/types';
import styles from '../core/core.module.css';
import { designationHref, fundHref, movementHref, restrictionHref } from './FundUI';
import type { FundSourcePath } from './types';

export function readFundApproval(request: ApprovalDetail | null) {
  if (!request || !routeId(request.sourceDocumentId) || !['FUND_SETUP', 'FUND_RESTRICTION', 'FUND_DESIGNATION', 'FUND_RELEASE', 'FUND_COMMAND', 'FUND_JOURNAL'].includes(request.requestKind)) return null;
  const id = request.sourceDocumentId, kind = request.requestKind;
  const live = record(request.source), current = record(live?.current), payload = record(request.requestPayload);
  const snapshot = record(payload?.snapshot), restriction = record(snapshot?.restriction), designation = record(snapshot?.designation);
  const draft = record(snapshot?.draft), fund = kind === 'FUND_SETUP' ? snapshot : record(snapshot?.fund);
  const release = record(snapshot?.release), source = record(snapshot?.source), sourceJournal = record(source?.journal);
  const path: FundSourcePath = kind === 'FUND_SETUP' ? 'funds' : ['FUND_RESTRICTION', 'FUND_RELEASE'].includes(kind)
    ? 'fund-restrictions' : kind === 'FUND_DESIGNATION' ? 'fund-designations' : 'fund-movements';
  const href = kind === 'FUND_SETUP' ? fundHref(id) : ['FUND_RESTRICTION', 'FUND_RELEASE'].includes(kind)
    ? restrictionHref(id) : kind === 'FUND_DESIGNATION' ? designationHref(id) : movementHref(id);
  const date = text(release?.accountingDate ?? draft?.accountingDate ?? designation?.effectiveOn ?? restriction?.effectiveOn ?? fund?.effectiveOn).slice(0, 10);
  const nonfinancial = ['FUND_SETUP', 'FUND_DESIGNATION', 'FUND_COMMAND'].includes(kind);
  const active = ['PENDING', 'APPROVED'].includes(request.status);
  const reviewedRevision = Number(text(kind === 'FUND_SETUP' ? snapshot?.revision : kind === 'FUND_DESIGNATION' ? designation?.revision
    : ['FUND_RESTRICTION', 'FUND_RELEASE'].includes(kind) ? restriction?.revision : draft?.revision));
  const stale = active && (Number(current?.revision) !== reviewedRevision || kind !== 'FUND_RELEASE' && reviewedRevision !== request.sourceVersion);
  const contextAvailable = Boolean(current?.id === id && validDay(date) && routeId(text(fund?.id ?? current?.accountingFundId ?? current?.id))
    && (kind === 'FUND_SETUP' ? snapshot?.id === id
      : kind === 'FUND_DESIGNATION' ? designation?.id === id
      : ['FUND_RESTRICTION', 'FUND_RELEASE'].includes(kind) ? restriction?.id === id && routeId(text(source?.id))
      : draft?.id === id && record(draft?.fundMetadata))
    && (kind !== 'FUND_RELEASE' || release && routeId(text(release.targetFundId)) && typeof release.amount === 'string'));
  return { id, kind, path, href, date, nonfinancial, stale, contextAvailable, snapshot, fund, restriction, designation, draft, release, sourceJournal };
}

export function FundApprovalEvidence({ review }: { review: NonNullable<ReturnType<typeof readFundApproval>> }) {
  const command = record(review.draft?.fundMetadata);
  return <>
    <h3>Fund Accounting approval evidence</h3>
    <Link className={styles.link} href={review.href}>Open reviewed fund source</Link>
    {!review.contextAvailable ? <p className={styles.warning} role="alert">Fund source evidence is incomplete or unsupported. Decision and application are blocked.</p> : null}
    <dl className={styles.details}>
      <dt>Request kind / source</dt><dd>{review.kind} · {review.id}</dd>
      <dt>Fund</dt><dd>{text(review.fund?.fundCode)} · {text(review.fund?.fundName)} · {text(review.fund?.fundClass)}</dd>
      <dt>Accounting/effective date</dt><dd>{review.date}</dd>
      {review.restriction ? <><dt>Restriction</dt><dd>{text(review.restriction.restrictionKind)} · {accountingMoney(text(review.restriction.originalAmount))} · {text(review.restriction.supportingReference)}</dd>
        <dt>Donor terms</dt><dd>{text(review.restriction.termsEvidence)} · {text(record(review.restriction.criteria)?.purposeCriterion)}</dd></> : null}
      {review.designation ? <><dt>Internal designation</dt><dd>{text(review.designation.designationReference)} · {accountingMoney(text(review.designation.amount))}</dd>
        <dt>Management purpose</dt><dd>{text(review.designation.purposeText)}</dd></> : null}
      {command ? <><dt>Command</dt><dd>{text(command.action)} · {text(command.reason)}</dd></> : null}
      {review.release ? <><dt>Release proposal</dt><dd>{text(review.release.releaseReference)} · {accountingMoney(text(review.release.amount))}</dd>
        <dt>Satisfaction / evidence</dt><dd>{text(review.release.satisfactionDate)} · {text(review.release.eligibilityEvidence)} · {text(review.release.evidenceReference)}</dd>
        <dt>Target unrestricted fund</dt><dd>{text(record(review.snapshot?.target)?.fundCode)} · {text(review.release.targetFundId)}</dd></> : null}
    </dl>
    {review.sourceJournal ? <p className={styles.note}>Original contribution source · <JournalLink id={text(review.sourceJournal.id)} /></p> : null}
    {review.release && record(review.snapshot?.evidence) ? <CoreTable label="Release journal-line evidence" headers={['Line', 'Debit', 'Credit', 'Journal']}>
      <tr><td>{text(record(review.snapshot?.evidence)?.id)}</td><td>{accountingMoney(text(record(review.snapshot?.evidence)?.debit))}</td>
        <td>{accountingMoney(text(record(review.snapshot?.evidence)?.credit))}</td><td><JournalLink id={text(record(record(review.snapshot?.evidence)?.journal)?.id)} /></td></tr>
    </CoreTable> : null}
    <details><summary>View full retained approval snapshot</summary><pre className={styles.scroll} tabIndex={0}>{JSON.stringify(review.snapshot, null, 2)}</pre></details>
    <p className={styles.note}>The backend validates the current digest, revision, permissions, period and source capacity again when deciding and applying. A release reclassifies restricted resources and does not recognize donation revenue again.</p>
  </>;
}
