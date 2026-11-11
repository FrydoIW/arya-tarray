'use client';

import Link from 'next/link';
import { JournalLink, validDay } from '../apar/fields';
import { CoreTable } from '../core/CoreUI';
import { accountingMoney, record, text } from '../core/presentation';
import { routeId } from '../core/route-scope';
import type { ApprovalDetail } from '../core/types';
import styles from '../core/core.module.css';
import { assetHref, changeHref, dayOnly, runHref, snapshotMoney } from './AssetUI';
import type { SourcePath } from './types';

const changeActions = ['ESTIMATE', 'ADDITIONAL', 'CORRECTION', 'DEACTIVATE', 'RECLASSIFY', 'IMPAIRMENT', 'DISPOSE', 'WRITE_OFF'];
function rows(value: unknown) {
  return Array.isArray(value) ? value.map(record).filter((row): row is Record<string, unknown> => !!row) : [];
}

export function readAssetApproval(request: ApprovalDetail | null) {
  if (!request || !routeId(request.sourceDocumentId)) return null;
  const { requestKind: kind, sourceDocumentId: id } = request;
  const activation = kind === 'ASSET_ACTIVATE', run = kind === 'DEPRECIATION_RUN';
  const change = kind === 'ASSET_CHANGE' || kind === 'ASSET_JOURNAL';
  if (!activation && !run && !change) return null;
  const snapshot = record(record(request.requestPayload)?.snapshot);
  const live = record(request.source);
  const source = change ? record(live?.draft) : live;
  const acquisition = record(live?.relFkAccFixedAssetSource);
  const journal = record(acquisition?.journal);
  const command = record(snapshot?.command);
  const evidence = activation ? snapshot : record(snapshot?.asset);
  const assets = rows(snapshot?.assets);
  const date = dayOnly(text(activation ? journal?.accountingDate : run ? snapshot?.date : command?.effectiveDate));
  const path: SourcePath = activation ? 'assets' : run ? 'depreciation-runs' : 'asset-changes';
  const href = (activation ? assetHref : run ? runHref : changeHref) + '/' + id;
  const nonfinancial = activation || kind === 'ASSET_CHANGE';
  const activeRequest = ['PENDING', 'APPROVED'].includes(request.status);
  const stale = activeRequest && (source?.revision !== request.sourceVersion || text(snapshot?.revision) !== String(request.sourceVersion));
  const contextAvailable = Boolean(snapshot?.id === id && source?.id === id && validDay(date) &&
    (activation ? routeId(text(snapshot.source)) && snapshot.source === acquisition?.id && !!record(snapshot.policy)
      : run ? routeId(text(snapshot.period)) && snapshot.period === source?.accountingPeriodId && assets.length && assets.every(row =>
        routeId(text(row.id)) && typeof row.amount === 'string' && !!record(record(row.snapshot)?.asset))
      : command && changeActions.includes(text(command.action)) && command.action === record(live?.command)?.action
        && evidence?.id === record(live?.asset)?.id && source?.sourceKind === kind));
  return { id, path, href, activation, run, date, contextAvailable, stale, nonfinancial, snapshot, evidence, command, assets,
    journalId: text(acquisition?.journalId), sourceEvidence: rows(snapshot?.sourceEvidence) };
}

export function AssetApprovalEvidence({ review }: { review: NonNullable<ReturnType<typeof readAssetApproval>> }) {
  const { snapshot, evidence, command } = review;
  const policy = record(evidence?.policy);
  return <>
    <h3>{review.run ? 'Depreciation request snapshot' : review.activation ? 'Asset activation evidence' : 'Asset change evidence'}</h3>
    <Link className={styles.link} href={review.href}>Open fixed asset source</Link>
    {!review.contextAvailable ? <p className={styles.warning} role="alert">Incomplete or unsupported asset evidence. Decisions and application are blocked.</p> : null}
    {review.run ? <>
      <p>Run {text(snapshot?.reference)} · Period {text(snapshot?.period)} · {review.date}</p>
      <CoreTable label="Requested depreciation amounts" headers={['Asset', 'Policy', 'Gross cost', 'Accumulated', 'Residual', 'Planned amount']}>
        {review.assets.map(row => {
          const asset = record(record(row.snapshot)?.asset);
          return <tr key={text(row.id)}><td><Link className={styles.link} href={assetHref + '/' + text(row.id)}>{text(asset?.code)} · {text(asset?.name)}</Link></td>
            <td>{text(record(asset?.policy)?.partialMonthPolicy)}</td><td>{snapshotMoney(asset?.cost)}</td>
            <td>{snapshotMoney(asset?.accumulated)}</td><td>{accountingMoney(text(asset?.residual))}</td><td>{accountingMoney(text(row.amount))}</td></tr>;
        })}
      </CoreTable>
    </> : <dl className={styles.details}>
      <dt>Asset</dt><dd>{text(evidence?.code)} · {text(evidence?.name)}</dd>
      <dt>Acquired / available / depreciation start</dt><dd>{text(evidence?.acquired)} / {text(evidence?.available)} / {text(evidence?.start)}</dd>
      <dt>Gross cost / accumulated / impairment</dt><dd>{snapshotMoney(evidence?.cost)} / {snapshotMoney(evidence?.accumulated)} / {snapshotMoney(evidence?.impairment)}</dd>
      <dt>Useful life / residual</dt><dd>{text(evidence?.life)} months · {accountingMoney(text(evidence?.residual))}</dd>
      <dt>Policy / convention</dt><dd>{text(policy?.policyReference)} · {text(policy?.partialMonthPolicy)}</dd>
      <dt>Acquisition evidence</dt><dd>{text(policy?.supportingEvidence)} · {text(evidence?.source)}{review.activation ? <> · <JournalLink id={review.journalId} /></> : null}</dd>
      {command ? <>
        <dt>Proposed action / reason</dt><dd>{text(command.action)} · {text(command.reason)}</dd>
        {command.assessmentEvidence ? <><dt>Impairment assessment / recoverable amount</dt>
          <dd>{text(command.assessmentEvidence)} · {accountingMoney(text(command.recoverableAmount))}</dd></> : null}
        {command.proceeds !== undefined ? <><dt>Proceeds</dt><dd>{accountingMoney(text(command.proceeds))}</dd></> : null}
      </> : null}
    </dl>}
    {review.sourceEvidence.length ? <CoreTable label="Posted source evidence" headers={['Source line', 'Account', 'Debit', 'Credit', 'Journal']}>
      {review.sourceEvidence.map(row => <tr key={text(row.id)}><td>{text(row.id)}</td><td>{text(row.account)}</td>
        <td>{accountingMoney(text(row.debit))}</td><td>{accountingMoney(text(row.credit))}</td><td><JournalLink id={text(row.journal)} /></td></tr>)}
    </CoreTable> : null}
    {snapshot ? <details><summary>View full retained approval snapshot</summary>
      <pre className={styles.scroll} tabIndex={0}>{JSON.stringify(snapshot, null, 2)}</pre></details> : null}
    <p className={styles.note}>The backend validates the live digest at decision and application. Snapshot values are retained for audit.</p>
  </>;
}
