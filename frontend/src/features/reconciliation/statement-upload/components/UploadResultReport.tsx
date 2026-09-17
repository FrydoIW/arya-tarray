"use client";

import { useMemo } from "react";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { formatDate, formatMoney } from "@/lib/format";
import type { UploadAttemptResult, UploadDuplicateDetail } from "../types";
import styles from "../styles/statement-upload.module.css";

export function UploadResultReport({ result }: { result: UploadAttemptResult | null }) {
  const columns = useMemo<DataTableColumn<UploadDuplicateDetail>[]>(() => [
    {
      key: "source",
      header: "Source",
      minWidth: "130px",
      render: (row) => (
        <span className={styles.primaryCell}>
          #{row.sourceTransactionNo}
          <small>{row.sourceWorksheetRow ? `${row.sourceSheetName ?? "Sheet"} row ${row.sourceWorksheetRow}` : row.sourceSheetName ?? ""}</small>
        </span>
      )
    },
    {
      key: "transactionDate",
      header: "Date",
      minWidth: "115px",
      render: (row) => row.transactionDate ? formatDate(row.transactionDate) : "—"
    },
    {
      key: "description",
      header: "Reference / Description",
      minWidth: "260px",
      render: (row) => (
        <div className={styles.descriptionCell}>
          <strong>{row.referenceNo || row.senderName || "—"}</strong>
          <small>{row.description || "—"}</small>
        </div>
      )
    },
    {
      key: "originalAmount",
      header: "Amount",
      minWidth: "140px",
      align: "right",
      render: (row) => <span className={styles.amountCell}>{formatMoney(row.originalAmount)}</span>
    },
    {
      key: "matched",
      header: "Matched Statement",
      minWidth: "230px",
      render: (row) => <span className={styles.monospace}>{row.matchedStatementFileName ?? row.matchedStatementUploadId}</span>
    }
  ], []);

  if (!result) return null;

  return (
    <CollapsibleSection
      className={styles.tablePanel}
      title="Upload Result"
      description="Source workbook totals compared with the transactions actually imported."
      summary={`${result.sourceTransactions} source · ${result.importedTransactions} imported · ${result.duplicateTransactions} skipped`}
      defaultExpanded={false}
    >
      <div className={styles.uploadResultGrid}>
        <div><span>Source transactions</span><strong>{result.sourceTransactions.toLocaleString("id-ID")}</strong></div>
        <div><span>Imported</span><strong>{result.importedTransactions.toLocaleString("id-ID")}</strong></div>
        <div><span>Duplicates skipped</span><strong>{result.duplicateTransactions.toLocaleString("id-ID")}</strong></div>
      </div>
      {result.duplicates.length > 0 ? (
        <DataTable
          rows={result.duplicates}
          columns={columns}
          rowKey={(row) => row.matchedBankTransactionId}
          minWidth="950px"
          ariaLabel="Skipped duplicate transactions"
        />
      ) : null}
    </CollapsibleSection>
  );
}
