"use client";

import { useMemo } from "react";
import { FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { formatDateTime } from "@/lib/format";
import type { StatementDraftListItem } from "../types";
import { formatStatementPeriod } from "../utils/statement-upload.utils";
import styles from "../styles/statement-upload.module.css";

type Props = {
  rows: StatementDraftListItem[];
  selectedStatementId: string | null;
  loading: boolean;
  busy: boolean;
  onOpen: (statementId: string) => void;
};

export function DraftStatements({ rows, selectedStatementId, loading, busy, onOpen }: Props) {
  const columns = useMemo<DataTableColumn<StatementDraftListItem>[]>(() => [
    { key: "id", header: "Statement ID", minWidth: "210px", sticky: "left", render: (row) => <span className={styles.monospace}>{row.id}</span> },
    { key: "bankAccountLabel", header: "Bank Account", minWidth: "210px", render: (row) => <span className={styles.primaryCell}>{row.bankAccountLabel}<small>{row.accountNo}</small></span> },
    { key: "period", header: "Period", minWidth: "180px", render: (row) => formatStatementPeriod(row.periodFrom, row.periodTo) },
    { key: "fileName", header: "File Name", minWidth: "210px" },
    { key: "totalTransaction", header: "Transactions", minWidth: "105px", align: "right" },
    { key: "needsReview", header: "Needs Review", minWidth: "105px", align: "right" },
    { key: "uploadedBy", header: "Uploaded By", minWidth: "145px" },
    { key: "uploadedAt", header: "Uploaded At", minWidth: "155px", render: (row) => formatDateTime(row.uploadedAt) },
    { key: "status", header: "Status", minWidth: "90px", render: () => <span className={`${styles.statementStatus} ${styles.draft}`}>Draft</span> },
    {
      key: "action",
      header: "Action",
      minWidth: "105px",
      sticky: "right",
      align: "center",
      render: (row) => (
        <Button
          type="button"
          variant="outline"
          size="sm"
          icon={<FolderOpen size={13} />}
          disabled={busy || loading || row.id === selectedStatementId}
          onClick={() => onOpen(row.id)}
        >
          {row.id === selectedStatementId ? "Selected" : "Open"}
        </Button>
      )
    }
  ], [busy, loading, onOpen, selectedStatementId]);

  return (
    <CollapsibleSection
      className={styles.tablePanel}
      title="Draft Statements"
      description="Select one RAW statement draft. Every workspace operation remains isolated by Statement ID."
      summary={`${rows.length} drafts`}
      defaultExpanded={false}
    >
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(row) => row.id}
        loading={loading}
        minWidth="1450px"
        emptyState={{ title: "No RAW statement drafts", description: "Upload a statement workbook to create the first independent draft." }}
      />
    </CollapsibleSection>
  );
}
