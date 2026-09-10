"use client";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { Button } from "@/components/ui/Button";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { SearchInput } from "@/components/ui/SearchInput";
import { Select } from "@/components/ui/Select";
import { formatDateTime, formatMoney } from "@/lib/format";
import { statusLabels, type Candidate, type Workspace, type WorkspaceQuery } from "../types";
import styles from "../styles/member-registration.module.css";
type Props = {
  workspace: Workspace; query: WorkspaceQuery; search: string; loading: boolean; busy: boolean;
  onSearch: (value: string) => void; onStatus: (value: WorkspaceQuery["status"]) => void;
  onPage: (value: number) => void; onPageSize: (value: number) => void; onReload: () => void;
  onAction: (kind: "register" | "link" | "ignore", row: Candidate) => void;
};
export function MemberCandidateTable(props: Props) {
  const columns: DataTableColumn<Candidate>[] = [
    { key: "accountName", header: "Nama Rekening", minWidth: "200px", render: row => <div className={styles.identity}><strong>{row.accountName}</strong>{row.bankName || row.accountNumber ? <small>{[row.bankName, row.accountNumber, row.accountType].filter(Boolean).join(" · ")}</small> : null}{row.member ? <small>{row.member.memberCode} · {row.member.memberName}</small> : null}</div> },
    { key: "initialName", header: "Initial Name", minWidth: "110px", render: row => row.initialName || "—" },
    { key: "firstSeenAt", header: "First Seen", minWidth: "145px", render: row => formatDateTime(row.firstSeenAt) },
    { key: "lastSeenAt", header: "Last Seen", minWidth: "145px", render: row => formatDateTime(row.lastSeenAt) },
    { key: "transactionCount", header: "Transactions", align: "right" },
    { key: "observedAmount", header: "Observed Amount", minWidth: "135px", align: "right", render: row => formatMoney(row.observedAmount) },
    { key: "verificationStatus", header: "Status", minWidth: "145px", render: row => <span className={styles[row.verificationStatus]}>{statusLabels[row.verificationStatus]}</span> },
    { key: "remark", header: "Alasan / Catatan", minWidth: "220px", render: row => row.remark || "—" },
    { key: "actions", header: "Action", minWidth: "250px", render: row => row.verificationStatus === "UNVERIFIED" ? <div className={styles.actions}>
      <Button size="sm" disabled={props.busy} onClick={() => props.onAction("register", row)}>Registrasi</Button>
      <Button size="sm" variant="outline" disabled={props.busy} onClick={() => props.onAction("link", row)}>Link</Button>
      <Button size="sm" variant="secondary" disabled={props.busy} onClick={() => props.onAction("ignore", row)}>Ignore</Button>
    </div> : "—" }
  ];
  return <CollapsibleSection className={styles.panel} title="Daftar Identitas" summary={`${props.workspace.pagination.total} identitas`} defaultExpanded={false} actions={<div className={`${styles.toolbar} ${styles.collapsibleToolbar}`}>
      <SearchInput value={props.search} maxLength={150} placeholder="Search nama rekening / initial" aria-label="Cari identitas donatur" onChange={e => props.onSearch(e.target.value)} />
      <Select value={props.query.status} aria-label="Status registrasi" onChange={e => props.onStatus(e.target.value as WorkspaceQuery["status"])}>
        <option value="UNVERIFIED">Belum Registrasi</option><option value="VERIFIED">Terverifikasi</option><option value="IGNORED">Diabaikan</option><option value="ALL">Semua Status</option>
      </Select>
      <Button variant="secondary" disabled={props.loading || props.busy} onClick={props.onReload}>Reload</Button>
    </div>}>
    <DataTable rows={props.workspace.rows} columns={columns} rowKey={row => row.memberIdentityId} loading={props.loading} minWidth="1450px"
      emptyState={{ title: "Tidak ada identitas donatur", description: "Ubah pencarian/status atau registrasi donatur secara manual." }}
      pagination={{ mode: "server", page: props.workspace.pagination.page, pageSize: props.query.pageSize, total: props.workspace.pagination.total, onPageChange: props.onPage, onPageSizeChange: props.onPageSize, pageSizeOptions: [10, 25, 50, 100] }} />
  </CollapsibleSection>;
}
