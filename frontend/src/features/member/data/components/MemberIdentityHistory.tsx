"use client";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import type { DataTableColumn } from "@/components/ui/DataTable/types";
import { formatDateTime } from "@/lib/format";
import { useMemberIdentityHistory } from "../hooks/useMemberIdentityHistory";
import type { IdentityHistoryRow } from "../types";
import styles from "../styles/member-data.module.css";

const actionLabels: Record<IdentityHistoryRow["action"], string> = {
  REGISTER: "Register New",
  LINK: "Link Existing",
  ATTACH: "Tambah Identitas",
  IGNORE: "Ignore",
  MOVE: "Pindah",
  DETACH: "Lepas"
};

const columns: DataTableColumn<IdentityHistoryRow>[] = [
  { key: "actionAt", header: "Waktu", minWidth: "155px", render: row => formatDateTime(row.actionAt) },
  { key: "action", header: "Aksi", minWidth: "120px", render: row => <strong>{actionLabels[row.action]}</strong> },
  { key: "identity", header: "Identitas", minWidth: "220px", render: row => <div className={styles.name}><strong>{row.identity.accountName}</strong><small>{row.identity.sourceType}{row.identity.bankName ? ` · ${row.identity.bankName}` : ""}{row.identity.accountNumber ? ` · ${row.identity.accountNumber}` : ""}</small></div> },
  { key: "ownership", header: "Perubahan Kepemilikan", minWidth: "300px", render: row => <div className={styles.name}><strong>{row.fromMember ? `${row.fromMember.memberCode} · ${row.fromMember.memberName}` : "Tanpa donatur"}</strong><small>→ {row.toMember ? `${row.toMember.memberCode} · ${row.toMember.memberName}` : "Tanpa donatur"}</small></div> },
  { key: "status", header: "Status", minWidth: "170px", render: row => `${row.statusBefore} → ${row.statusAfter}` },
  { key: "reason", header: "Alasan", minWidth: "230px", render: row => row.reason || "—" },
  { key: "actionBy", header: "Diproses Oleh", minWidth: "150px", render: row => row.actionBy.fullName }
];

export function MemberIdentityHistory({ memberId }: { memberId: string }) {
  const state = useMemberIdentityHistory(memberId);
  return <section className={styles.detailPanel}>
    <div className={styles.sectionHead}>
      <div><h2>Riwayat Kepemilikan Identitas</h2><p>Jejak Register, Link, Tambah, Pindah, dan Lepas. Perubahan alias/catatan tidak termasuk riwayat kepemilikan.</p></div>
      <Button variant="outline" icon={<RefreshCw size={15} />} disabled={state.loading} onClick={state.reload}>Muat ulang</Button>
    </div>
    {state.error ? <div className="ui-alert ui-alert-error" role="alert">{state.error}</div> : null}
    <DataTable rows={state.workspace.rows} columns={columns} rowKey={row => row.historyId} loading={state.loading} minWidth="1350px"
      loadingText="Memuat riwayat kepemilikan…" emptyState={{ title: "Belum ada riwayat kepemilikan", description: "Riwayat baru dicatat setelah patch audit Member diterapkan." }}
      pagination={{ mode: "server", page: state.workspace.pagination.page, pageSize: state.workspace.pagination.pageSize,
        total: state.workspace.pagination.total, onPageChange: state.changePage, onPageSizeChange: state.changePageSize }} />
  </section>;
}
