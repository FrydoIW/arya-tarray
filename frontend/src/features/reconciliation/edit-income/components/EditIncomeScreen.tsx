"use client";

import { useState } from "react";
import { Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { PageHeader } from "@/components/ui/PageHeader";
import { useEditIncomeWorkspace } from "../hooks/useEditIncomeWorkspace";
import { EditIncomeCorrectionWorkspace } from "./EditIncomeCorrectionWorkspace";
import { EditIncomeFlow } from "./EditIncomeFlow";
import { EditIncomeStatementTable } from "./EditIncomeStatementTable";
import { EditIncomeSummary } from "./EditIncomeSummary";
import styles from "../styles/edit-income.module.css";

export function EditIncomeScreen() {
  const workspace = useEditIncomeWorkspace();
  const [executeOpen, setExecuteOpen] = useState(false);

  return (
    <div className={`${styles.page} page-stack`}>
      <PageHeader
        breadcrumb={["Reconciliation", "Edit Income"]}
        title="Edit Income"
        description="Correct finalized income classifications and submit changes for re-approval."
        actions={(
          <>
            <Button type="button" variant="secondary" icon={<RotateCcw size={16} />} disabled={!workspace.detail || workspace.busy || (workspace.mode === "INQUIRY" && workspace.modifiedTransactions === 0)} onClick={workspace.clearChanges}>Clear</Button>
            <Button type="button" icon={<Play size={16} />} disabled={!workspace.canExecute || workspace.loading || workspace.busy} onClick={() => {
              if (workspace.canExecute) setExecuteOpen(true);
            }} title={workspace.canExecute ? "Submit correction for re-approval" : "Select a Complete statement and make at least one correction first"}>Execute</Button>
          </>
        )}
      />

      {workspace.message ? <div className="ui-alert ui-alert-success">{workspace.message}</div> : null}
      {workspace.error ? <div className="ui-alert ui-alert-error">{workspace.error}</div> : null}

      <EditIncomeSummary summary={workspace.workspace.summary} modifiedTransactions={workspace.modifiedTransactions} periodMode={workspace.period.mode} month={workspace.period.month} date={workspace.period.date} />
      <EditIncomeFlow />
      <EditIncomeStatementTable
        rows={workspace.filteredStatements}
        bankAccounts={workspace.workspace.bankAccounts}
        periodMode={workspace.period.mode}
        month={workspace.period.month}
        date={workspace.period.date}
        maxMonth={workspace.maxMonth}
        maxDate={workspace.maxDate}
        monthDisabled={Boolean(workspace.detail)}
        search={workspace.statementSearch}
        statusFilter={workspace.statementStatusFilter}
        bankAccountFilter={workspace.bankAccountFilter}
        page={workspace.statementPage}
        pageSize={workspace.statementPageSize}
        loading={workspace.loading}
        busy={workspace.busy}
        onPeriodChange={workspace.changePeriod}
        onSearchChange={workspace.setStatementSearch}
        onStatusFilterChange={workspace.setStatementStatusFilter}
        onBankAccountFilterChange={workspace.setBankAccountFilter}
        onPageChange={workspace.setStatementPage}
        onPageSizeChange={workspace.setStatementPageSize}
        onReload={() => void workspace.refresh()}
        onOpen={(statementId) => void workspace.selectStatement(statementId)}
      />

      {workspace.detail ? (
        <EditIncomeCorrectionWorkspace
          detail={workspace.detail}
          rows={workspace.filteredTransactions}
          allRows={workspace.allTransactions}
          originalById={workspace.originalById}
          search={workspace.transactionSearch}
          statusFilter={workspace.transactionStatusFilter}
          eventCodeFilter={workspace.transactionEventCodeFilter}
          directionFilter={workspace.transactionDirectionFilter}
          mode={workspace.mode}
          correctionSummary={workspace.correctionSummary}
          page={workspace.transactionPage}
          pageSize={workspace.transactionPageSize}
          loading={workspace.detailLoading}
          busy={workspace.busy}
          canEdit={workspace.canEdit}
          onSearchChange={workspace.setTransactionSearch}
          onStatusFilterChange={workspace.setTransactionStatusFilter}
          onEventCodeFilterChange={workspace.setTransactionEventCodeFilter}
          onDirectionFilterChange={workspace.setTransactionDirectionFilter}
          onPageChange={workspace.setTransactionPage}
          onPageSizeChange={workspace.setTransactionPageSize}
          onReload={() => void workspace.refresh()}
          onBack={workspace.closeDetail}
          onTransactionChange={workspace.updateTransaction}
          onEditMode={workspace.enterEditMode}
          onInquiryMode={workspace.enterInquiryMode}
          onAddAdjustment={workspace.addAdjustment}
          onExclude={workspace.excludeTransaction}
          onRestore={workspace.restoreTransaction}
        />
      ) : (
        <div className={styles.noteCard}>
          <strong>Post-completion correction</strong>
          <span>Select a Complete statement and click Open. It starts in Inquiry; proposed corrections remain local until Execute and then require approval again.</span>
        </div>
      )}
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
