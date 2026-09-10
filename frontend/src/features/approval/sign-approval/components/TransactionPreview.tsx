import { useMemo } from "react";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { formatDate, formatMoney } from "@/lib/format";
import type { ApprovalTransactionPreview } from "../types";
import styles from "../styles/sign-approval.module.css";

type TransactionPreviewProps = {
  items: ApprovalTransactionPreview[];
  totalTransactions: number;
};

export function TransactionPreview({ items, totalTransactions }: TransactionPreviewProps) {
  const columns = useMemo<DataTableColumn<ApprovalTransactionPreview>[]>(() => [
    {
      key: "date",
      header: "Date",
      minWidth: "120px",
      render: (row) => formatDate(row.transactionDate)
    },
    {
      key: "description",
      header: "Description",
      minWidth: "310px",
      render: (row) => row.description || "—"
    },
    {
      key: "amount",
      header: "Amount",
      minWidth: "150px",
      align: "right",
      render: (row) => <strong className={styles.amountCell}>{formatMoney(row.originalAmount)}</strong>
    },
    {
      key: "suggestedEvent",
      header: "Suggested Event",
      minWidth: "190px",
      render: (row) => row.suggestedEvent
        ? <div className={styles.eventCell}><strong>{row.suggestedEvent.eventName}</strong><small>{row.suggestedEvent.code}</small></div>
        : "—"
    },
    {
      key: "finalEvent",
      header: "Final Event",
      minWidth: "190px",
      render: (row) => row.finalEvent
        ? <div className={styles.eventCell}><strong>{row.finalEvent.eventName}</strong><small>{row.finalEvent.code}</small></div>
        : "—"
    },
    {
      key: "status",
      header: "Status",
      width: "120px",
      render: (row) => (
        <span className={`${styles.transactionStatus} ${row.status === "CHECK" || row.status === "FINALIZED" ? styles.checked : styles.needsReview}`}>
          <i aria-hidden="true" />
          {row.status}
        </span>
      )
    }
  ], []);

  return (
    <section className={styles.tablePanel}>
      <div className={styles.compactHeader}>
        <div>
          <h2>Transaction Preview</h2>
          <p>Read-only preview. Showing {items.length.toLocaleString("id-ID")} of {totalTransactions.toLocaleString("id-ID")} transactions.</p>
        </div>
      </div>
      <DataTable
        rows={items}
        columns={columns}
        rowKey={(row: ApprovalTransactionPreview) => row.id}
        emptyState={{
          title: "No transactions available",
          description: "This statement does not currently have transaction rows to preview."
        }}
        minWidth="1120px"
      />
    </section>
  );
}
