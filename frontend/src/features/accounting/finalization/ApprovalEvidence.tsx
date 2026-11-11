"use client";
import type { ApprovalDetail } from '../core/types';
import { AccountingStatusIndicator } from '../components/AccountingFoundation';
import { record, text } from '../core/presentation';
import styles from './finalization.module.css';

const kinds = ['REPORTING_POLICY', 'REPORT_SNAPSHOT', 'BANK_RECONCILIATION', 'PERIOD_CLOSE', 'PERIOD_REOPEN', 'YEAR_CLOSE', 'YEAR_REOPEN'];
export type FinalizationApprovalReview = { kind: string; current: Record<string, unknown>; reviewedPayload: Record<string, unknown> | null; date: string; stale: boolean; contextAvailable: boolean; nonfinancial: boolean };
export function readFinalizationApproval(request: ApprovalDetail | null | undefined): FinalizationApprovalReview | null {
  if (!request || !kinds.includes(request.requestKind)) return null;
  const source = record(request.source), current = record(source?.current), reviewedPayload = record(source?.reviewedPayload);
  if (!current) return { kind: request.requestKind, current: {}, reviewedPayload, date: '', stale: false, contextAvailable: false, nonfinancial: !['YEAR_CLOSE', 'YEAR_REOPEN'].includes(request.requestKind) };
  const date = text(current.reconciliationDate ?? current.endDate ?? current.accountingDate).slice(0, 10);
  const revision = typeof current.revision === 'number' ? current.revision : Number(current.revision);
  return { kind: request.requestKind, current, reviewedPayload, date, stale: Number.isFinite(revision) && revision !== request.sourceVersion, contextAvailable: /^\d{4}-\d{2}-\d{2}$/.test(date), nonfinancial: !['YEAR_CLOSE', 'YEAR_REOPEN'].includes(request.requestKind) };
}
function pretty(value: unknown) { try { return JSON.stringify(value, null, 2); } catch { return String(value); } }
export function FinalizationApprovalEvidence({ review }: { review: FinalizationApprovalReview }) {
  return <section className={styles.module}><div className={styles.actions}><h3>Frozen finalization source</h3><AccountingStatusIndicator status={text(review.current.status)} /></div><dl className={styles.details}><dt>Finalization kind</dt><dd>{review.kind}</dd><dt>Source ID</dt><dd>{text(review.current.id)}</dd><dt>Source revision</dt><dd>{text(review.current.revision)}</dd><dt>Accounting cutoff</dt><dd>{review.date}</dd><dt>Closing command</dt><dd>{text(review.current.closingDraftId)}</dd></dl><h4>Reviewed typed payload</h4><pre className={styles.json}>{pretty(review.reviewedPayload)}</pre><p className={styles.note}>The backend recomputes the live source digest, checklist/fingerprint and authorization before decision and application. A changed revision or evidence rejects this approval as stale.</p></section>;
}
