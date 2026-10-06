"use client";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { currentBusinessMonthValue } from "@/lib/business-time";
import { exportAccounting, getAccountingJournal } from "../api/accounting.api";
import { useAccounting } from "../hooks/useAccounting";
import type { AccountingRow, AccountingView, JournalDetail } from "../types";
import styles from "./AccountingScreen.module.css";

const views: Array<[AccountingView, string]> = [["pending", "Pending Preview"], ["reconciliation", "Reconciliation"],
  ["journals", "Journals"], ["ledger", "General Ledger"], ["trial", "Trial Balance"], ["monthly", "Monthly Summary"]];
const label = (key: string) => key.replace(/([A-Z])/g, " $1").replace(/^./, c => c.toUpperCase());

function EvidenceTable({ rows, onJournal }: { rows: AccountingRow[]; onJournal?: (id: string) => void }) {
  const keys = [...new Set(rows.flatMap(row => Object.keys(row)))].filter(k => !["id", "journalId", "relatedJournal"].includes(k));
  if (!rows.length) return <p className={styles.empty}>No records match these filters.</p>;
  return <div className={styles.tableScroll}><table><thead><tr>{keys.map(k => <th key={k} scope="col">{label(k)}</th>)}</tr></thead>
    <tbody>{rows.map((row, index) => <tr key={String(row.id ?? index)}>{keys.map(k => <td key={k}>
      {k === "journal" && onJournal ? <button className={styles.link} onClick={() => onJournal(String(row.journalId ?? row.id))}>{row[k]}</button>
        : k === "state" ? <span className={styles.state} data-review={row[k] === "ACCOUNTING_REVIEW_REQUIRED"}>{String(row[k]).replaceAll("_", " ")}</span>
        : k === "journalId" && onJournal && row[k] ? <button onClick={() => onJournal(String(row[k]))}>View journal</button>
        : String(row[k] ?? "—")}
    </td>)}</tr>)}</tbody></table></div>;
}

export function AccountingScreen() {
  const [view, setView] = useState<AccountingView>("journals");
  const [filters, setFilters] = useState<Record<string, string>>({ from: `${currentBusinessMonthValue()}-01` });
  const [memberSearch, setMemberSearch] = useState("");
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<JournalDetail | null>(null);
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const query = useMemo(() => new URLSearchParams({ ...Object.fromEntries(Object.entries(filters).filter(([,v]) => v)), view, page: String(page) }).toString(), [filters, view, page]);
  const { report, options, loading, error } = useAccounting(query, memberSearch);
  function change(key: string, value: string) { setFilters(f => ({ ...f, [key]: value })); setPage(1); }
  async function openJournal(id: string) {
    try { setActionError(""); setDetail(await getAccountingJournal(id)); }
    catch (e) { setActionError(e instanceof Error ? e.message : "Journal could not load"); }
  }
  async function download(format: "pdf" | "xlsx") {
    setBusy(true); setActionError("");
    try { const result = await exportAccounting(query, format); const url = URL.createObjectURL(result.blob);
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = result.fileName; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setActionError(e instanceof Error ? e.message : "Export failed"); } finally { setBusy(false); }
  }
  return <main className={styles.page}>
    <PageHeader breadcrumb={["Accounting", views.find(v => v[0] === view)![1]]} title="Accounting"
      description="Original donation recognition and immutable journal evidence. Operational Carry remains allocation evidence."
      actions={<><Button variant="outline" disabled={busy || loading || !report} onClick={() => download("xlsx")}>Excel</Button>
        <Button variant="outline" disabled={busy || loading || !report} onClick={() => download("pdf")}>PDF</Button></>} />
    <nav className={styles.tabs} aria-label="Accounting reports">{views.map(([key, text]) => <Button key={key}
      variant={view === key ? "primary" : "ghost"} aria-pressed={view === key} onClick={() => { setView(key); setPage(1); }}>{text}</Button>)}</nav>
    <Card className={styles.filters}>
      <label>From<input type="date" value={filters.from} onChange={e => change("from", e.target.value)} /></label>
      <label>To<input type="date" value={filters.to ?? ""} onChange={e => change("to", e.target.value)} /></label>
      {([ ["bankAccountId", "Bank", "banks"], ["eventCodeId", "Event", "events"], ["eventCampaignId", "Campaign", "campaigns"], ["memberId", "Member snapshot", "members"] ] as const)
        .map(([key, text, list]) => <label key={key}>{text}<select value={filters[key] ?? ""} onChange={e => change(key, e.target.value)}><option value="">All</option>
          {options?.[list].map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select></label>)}
      <label>Find Member (first 50)<input value={memberSearch} onChange={e => setMemberSearch(e.target.value)} placeholder="Member name" /></label>
      <label>Event Type<select value={filters.eventType ?? ""} onChange={e => change("eventType", e.target.value)}><option value="">All</option>{["STANDARD", "CAMPAIGN", "TIME_BASED"].map(t => <option key={t}>{t}</option>)}</select></label>
      <label>Journal Type<select value={filters.journalType ?? ""} onChange={e => change("journalType", e.target.value)}><option value="">All</option><option>RECOGNITION</option><option>RECLASSIFICATION</option></select></label>
      <label>Journal number<input value={filters.journalNumber ?? ""} onChange={e => change("journalNumber", e.target.value)} /></label>
      {view === "ledger" ? <label>Account<select value={filters.accountCode ?? ""} onChange={e => change("accountCode", e.target.value)}><option value="">All</option><option value="1110">1110 Bank</option><option value="4110">4110 Contribution Revenue</option></select></label> : null}
    </Card>
    {error || actionError ? <div className="ui-alert ui-alert-error" role="alert">{error || actionError}</div> : null}
    {loading ? <p role="status">Loading Accounting…</p> : report ? <>
      <p className={styles.coverage}>Cutover: {report.cutoverDate}. {report.coverage}. {report.preview ? "PREVIEW — NOT POSTED" : ""}</p>
      {!["pending", "reconciliation"].includes(view) ? <Card className={styles.totals}><span>Debit <strong>{report.totalDebit}</strong></span>
        <span>Credit <strong>{report.totalCredit}</strong></span><span>Period movement <strong>{report.movementBalance}</strong></span>
        {view === "trial" ? <span>{report.balanced ? "Debit = Credit" : "Review: Debit ≠ Credit"}. All lines of matching journals.</span> : null}</Card> : null}
      <Card><EvidenceTable rows={report.rows} onJournal={openJournal} />
        {report.rows.some(r => r.journalId && !r.journal) ? <div className={styles.sourceLinks}>{report.rows.filter(r => r.journalId).map(r => <Button key={String(r.id)} variant="ghost" onClick={() => openJournal(String(r.journalId))}>Journal for {String(r.id).slice(0, 8)}</Button>)}</div> : null}
        {!["trial", "monthly"].includes(view) ? <footer className={styles.pagination}><Button variant="outline" disabled={report.page <= 1} onClick={() => setPage(report.page - 1)}>Previous</Button>
          <span>Page {report.page} · {report.total} records</span><Button variant="outline" disabled={report.page * report.pageSize >= report.total} onClick={() => setPage(report.page + 1)}>Next</Button></footer> : null}
      </Card>
      {report.additions.length ? <Card><h2>Proposed manual additions — first {report.additionsLimit}</h2><p>ACCOUNTING REVIEW REQUIRED. Approval remains operational; no automatic GL.</p><EvidenceTable rows={report.additions} /></Card> : null}
    </> : null}
    <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.journalNumber ?? "Journal evidence"} description="Immutable posted evidence">
      {detail ? <div className={styles.detail}><p>{detail.journalType} · {detail.accountingDate} · Posted {new Date(detail.postedAt).toLocaleString("en-GB", { timeZone: "Asia/Jakarta" })} Jakarta</p>
        <p className={styles.state} data-review={detail.state === "ACCOUNTING_REVIEW_REQUIRED"}>{detail.state.replaceAll("_", " ")}</p>
        <p>Source: {detail.bankTransaction.id} · Statement: {detail.bankTransaction.statementUpload.fileName} ({detail.bankTransaction.statementUpload.id})</p>
        <p>Approval: {detail.bankTransaction.statementUpload.approval?.id} · {detail.bankTransaction.statementUpload.approval?.status}</p>
        <p>Idempotency evidence: {detail.sourceEventKey}</p><p>{detail.descriptionSnapshot}</p>
        {detail.correctionItem ? <p>Correction: {detail.correctionItem.id} · Proposal: {detail.correctionItem.proposalId}</p> : null}
        {detail.relatedJournalId ? <Button variant="ghost" onClick={() => openJournal(detail.relatedJournalId!)}>Original recognition</Button> : null}
        {detail.linkedJournals.map(j => <Button key={j.id} variant="ghost" onClick={() => openJournal(j.id)}>{j.journalType}: {j.journalNumber}</Button>)}
        <EvidenceTable rows={detail.lines} /></div> : null}
    </Modal>
  </main>;
}
