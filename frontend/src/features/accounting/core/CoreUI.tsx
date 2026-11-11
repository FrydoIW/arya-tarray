"use client";
import type { ReactNode, InputHTMLAttributes } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { AccountingDataState, AccountingWorkspaceNavigation } from '../components/AccountingFoundation';
import styles from './core.module.css';

export function CorePage({ title, description, children, actions }: { title: string; description: string; children: ReactNode; actions?: ReactNode }) {
  return <div className={styles.page}><PageHeader title={title} breadcrumb={['Accounting', title]} description={description} actions={actions} /><AccountingWorkspaceNavigation />{children}</div>;
}
export function CoreCard({ children }: { children: ReactNode }) { return <Card className={styles.card}>{children}</Card>; }
export function CoreReadState({ read, empty }: { read: { loading: boolean; error: string; forbidden: boolean; refresh: () => void }; empty?: boolean }) {
  return <><AccountingDataState {...read} onRetry={read.refresh} />{empty && !read.loading && !read.error ? <EmptyState title="No records available" description="No records match this scope. Change the filters or refresh after configuration is available." /> : null}</>;
}
export function CoreFeedback({ error, message }: { error: string; message: string }) {
  return <>{error ? <div className="ui-alert ui-alert-error" role="alert">{error}</div> : null}{message ? <div className="ui-alert ui-alert-success" role="status">{message}</div> : null}</>;
}
export function CoreField({ label, children }: { label: string; children: ReactNode }) { return <div className={styles.field}><span>{label}</span>{children}</div>; }
export function CoreInput({ label, ...props }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return <label className={styles.field}><span>{label}</span><input {...props} aria-label={label} className="ui-table-input" /></label>;
}
export function CoreTable({ headers, children, label }: { headers: string[]; children: ReactNode; label: string }) {
  return <div className={styles.scroll} tabIndex={0} role="region" aria-label={label}><table className={styles.table}><thead><tr>{headers.map(header => <th scope="col" key={header}>{header}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;
}
export function CorePagination({ page, pageSize, total, loading, onPage }: { page: number; pageSize: number; total: number; loading: boolean; onPage: (page: number) => void }) {
  return <div className={styles.actions}><Button variant="outline" disabled={loading || page <= 1} onClick={() => onPage(page - 1)}>Previous</Button><span>Page {page} · {total} records</span><Button variant="outline" disabled={loading || page * pageSize >= total} onClick={() => onPage(page + 1)}>Next</Button></div>;
}
export function CorePolicyNote() { return <p className={styles.note}>Policy & reporting readiness: NOT_EVALUATED. COA completeness, reporting mappings, opening evidence and annual closing policy require authorized review. Balanced entries do not certify official financial statements.</p>; }
