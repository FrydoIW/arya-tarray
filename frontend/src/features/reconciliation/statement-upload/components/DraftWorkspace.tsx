"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import { FileSpreadsheet, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { Select } from "@/components/ui/Select";
import { formatDateTime } from "@/lib/format";
import type { BankAccountOption, StatementDraft } from "../types";
import { formatStatementPeriod, getStatementStatusLabel, getStatementStatusTone } from "../utils/statement-upload.utils";
import styles from "../styles/statement-upload.module.css";

type Props = {
  statement: StatementDraft | null;
  bankAccounts: BankAccountOption[];
  uploadDisabled: boolean;
  uploading: boolean;
  onFileSelected: (file: File, bankAccountId: string) => void;
};

export function DraftWorkspace({ statement, bankAccounts, uploadDisabled, uploading, onFileSelected }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [bankAccountId, setBankAccountId] = useState(statement?.bankAccountId ?? bankAccounts[0]?.id ?? "");
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    setBankAccountId(statement?.bankAccountId ?? bankAccounts[0]?.id ?? "");
  }, [bankAccounts, statement?.bankAccountId]);

  function selectFile(file?: File) {
    if (!file || uploadDisabled || !bankAccountId) return;
    onFileSelected(file, bankAccountId);
  }

  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    selectFile(event.dataTransfer.files?.[0]);
  }

  const statusTone = statement ? getStatementStatusTone(statement.status) : "draft";

  return (
    <CollapsibleSection
      className="ui-card"
      title="Selected Draft Workspace"
      description="Upload a new BCA workbook or inspect the RAW statement selected from Draft Statements."
      summary={statement ? getStatementStatusLabel(statement.status) : "No draft selected"}
      defaultExpanded={false}
    >
      <div className={styles.workspaceCard}>
      {!statement ? (
        <div className={styles.selectionNotice}>No draft selected. Select a statement draft above to continue.</div>
      ) : null}
      {statement?.overlaps?.length ? (
        <div className={styles.overlapNotice}>
          <strong>Overlapping statement period detected</strong>
          <span>This draft overlaps {statement.overlaps.map((item) => `${item.id} (${item.fileName})`).join(", ")} for the same bank account. The drafts remain separate; verify the source evidence before Execute.</span>
        </div>
      ) : null}
      {statement?.rejectionRemark ? (
        <div className={styles.returnNotice}>
          <strong>Returned for correction</strong>
          <span>{statement.rejectionRemark}</span>
        </div>
      ) : null}

      <div className={styles.workspaceGrid}>
        <dl className={styles.statementInfo}>
          <div><dt>Statement ID</dt><dd className={styles.monospace}>{statement?.id || "-"}</dd></div>
          <div><dt>Bank Account</dt><dd>{statement?.bankAccountLabel || "-"}</dd></div>
          <div><dt>Period</dt><dd>{statement ? formatStatementPeriod(statement.periodFrom, statement.periodTo) : "-"}</dd></div>
          <div><dt>Uploaded By</dt><dd>{statement?.uploadedBy || "-"}</dd></div>
          <div><dt>Uploaded At</dt><dd>{statement?.uploadedAt ? formatDateTime(statement.uploadedAt) : "-"}</dd></div>
          <div>
            <dt>Status</dt>
            <dd>
              {statement
                ? <span className={`${styles.statementStatus} ${styles[statusTone]}`}>{getStatementStatusLabel(statement.status)}</span>
                : <span>-</span>}
            </dd>
          </div>
          <div><dt>File Name</dt><dd className={styles.fileName}><FileSpreadsheet size={14} /> {statement?.fileName || "-"}</dd></div>
        </dl>

        <div
          className={`${styles.uploadZone} ${dragging ? styles.dragging : ""} ${uploadDisabled ? styles.uploadDisabled : ""}`}
          onDragEnter={(event) => { event.preventDefault(); if (!uploadDisabled) setDragging(true); }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={drop}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            hidden
            disabled={uploadDisabled}
            onChange={(event) => {
              selectFile(event.target.files?.[0]);
              event.currentTarget.value = "";
            }}
          />
          <span className={styles.uploadIcon}><UploadCloud size={24} /></span>
          <strong>Drag & drop statement file here</strong>
          <small>or</small>
          <div className={styles.uploadControls}>
            <Select
              aria-label="Bank account"
              value={bankAccountId}
              disabled={uploadDisabled || bankAccounts.length === 0}
              onChange={(event) => setBankAccountId(event.target.value)}
            >
              {bankAccounts.length === 0 ? <option value="">No active bank account</option> : null}
              {bankAccounts.map((account) => (
                <option key={account.id} value={account.id}>{account.label}</option>
              ))}
            </Select>
            <Button
              type="button"
              variant="outline"
              size="sm"
              icon={<UploadCloud size={15} />}
              disabled={uploadDisabled || !bankAccountId}
              onClick={() => inputRef.current?.click()}
            >
              {uploading ? "Uploading & parsing..." : "Upload Statement"}
            </Button>
          </div>
          <span className={styles.uploadHelp}>Supported format: .xlsx · Max file size: 50MB</span>
        </div>
      </div>
      </div>
    </CollapsibleSection>
  );
}
