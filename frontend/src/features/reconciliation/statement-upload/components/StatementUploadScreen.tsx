"use client";

import { useState } from "react";
import { Play, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { PageHeader } from "@/components/ui/PageHeader";
import { useStatementUploadWorkspace } from "../hooks/useStatementUploadWorkspace";
import { DraftReviewSummary } from "./DraftReviewSummary";
import { DraftTransactionReview } from "./DraftTransactionReview";
import { DraftWorkspace } from "./DraftWorkspace";
import { StatementUploadFlow } from "./StatementUploadFlow";
import { StatementUploadSummary } from "./StatementUploadSummary";
import styles from "../styles/statement-upload.module.css";

export function StatementUploadScreen() {
  const workspace = useStatementUploadWorkspace();
  const [executeOpen, setExecuteOpen] = useState(false);

  return (
    <div className={`${styles.page} page-stack`}>
      <PageHeader
        breadcrumb={["Reconciliation", "Statement Upload"]}
        title="Statement Upload"
        description="Upload bank statements, review draft transactions, and submit completed drafts for approval."
        actions={(
          <>
            <Button
              type="button"
              variant="secondary"
              icon={<RotateCw size={16} className={workspace.loading ? "spin" : ""} />}
              disabled={workspace.loading || workspace.busy}
              onClick={() => void workspace.refresh()}
            >
              Reload
            </Button>
            <Button
              type="button"
              icon={<Play size={16} />}
              disabled={!workspace.canExecute || workspace.loading || workspace.busy}
              onClick={() => {
                if (workspace.canExecute) setExecuteOpen(true);
              }}
              title={workspace.canExecute ? "Submit draft for approval" : "Resolve all required incoming transactions before Execute"}
            >
              Execute
            </Button>
          </>
        )}
      />

      {workspace.message ? <div className="ui-alert ui-alert-success">{workspace.message}</div> : null}
      {workspace.error ? <div className="ui-alert ui-alert-error">{workspace.error}</div> : null}

      <StatementUploadSummary summary={workspace.workspace.summary} />
      <StatementUploadFlow />
      <DraftWorkspace
        statement={workspace.workspace.statement}
        bankAccounts={workspace.workspace.bankAccounts}
        uploadDisabled={!workspace.canUpload}
        uploading={workspace.uploading}
        onFileSelected={(file, bankAccountId) => void workspace.upload(file, bankAccountId)}
      />
      <DraftTransactionReview
        rows={workspace.filteredTransactions}
        eventCodes={workspace.workspace.eventCodes}
        search={workspace.search}
        statusFilter={workspace.statusFilter}
        page={workspace.page}
        pageSize={workspace.pageSize}
        loading={workspace.loading}
        disabled={!workspace.canEditDraft || workspace.busy || Boolean(workspace.savingTransactionId)}
        onSearchChange={workspace.setSearch}
        onStatusFilterChange={workspace.setStatusFilter}
        onPageChange={workspace.setPage}
        onPageSizeChange={workspace.setPageSize}
        onReload={() => void workspace.refresh()}
        onFinalEventChange={(transactionId, eventCodeId) => void workspace.updateFinalEvent(transactionId, eventCodeId)}
      />
      <DraftReviewSummary
        resolved={workspace.resolvedTransactions}
        needsReview={workspace.needsReview}
        relevantIncoming={workspace.relevantIncoming}
        canExecute={workspace.canExecute}
        lifecycleEditable={!workspace.workspace.statement || workspace.workspace.statement.status === "RAW"}
      />
      <ConfirmDialog
        open={executeOpen}
        title="Confirm Execute"
        message="Are you sure you want to execute these changes?"
        confirmLabel="Execute"
        loading={workspace.busy}
        onCancel={() => setExecuteOpen(false)}
        onConfirm={async () => {
          await workspace.execute();
          setExecuteOpen(false);
        }}
      />
    </div>
  );
}
