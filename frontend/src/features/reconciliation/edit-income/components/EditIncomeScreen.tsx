"use client";

import { Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { useEditIncomeWorkspace } from "../hooks/useEditIncomeWorkspace";
import { EditIncomeCorrectionWorkspace } from "./EditIncomeCorrectionWorkspace";
import { EditIncomeFlow } from "./EditIncomeFlow";
import { EditIncomeStatementTable } from "./EditIncomeStatementTable";
import { EditIncomeSummary } from "./EditIncomeSummary";
import styles from "../styles/edit-income.module.css";

export function EditIncomeScreen() {
  const workspace = useEditIncomeWorkspace();

  return (
    <div className={`${styles.page} page-stack`}>
      <PageHeader
        breadcrumb={["Reconciliation", "Edit Income"]}
        title="Edit Income"
        description="Correct finalized income classifications and submit changes for re-approval."
        actions={(
          <>
            <Button type="button" variant="secondary" icon={<RotateCcw size={16} />} disabled={!workspace.detail || workspace.busy || workspace.modifiedTransactions === 0} onClick={workspace.clearChanges}>Clear</Button>
            <Button type="button" icon={<Play size={16} />} disabled={!workspace.canExecute || workspace.loading || workspace.busy} onClick={() => void workspace.execute()} title={workspace.canExecute ? "Submit correction for re-approval" : "Select a Complete statement and make at least one correction first"}>Execute</Button>
          </>
        )}
      />

      {workspace.message ? <div className="ui-alert ui-alert-success">{workspace.message}</div> : null}
      {workspace.error ? <div className="ui-alert ui-alert-error">{workspace.error}</div> : null}

      <EditIncomeSummary summary={workspace.workspace.summary} modifiedTransactions={workspace.modifiedTransactions} month={workspace.month} />
      <EditIncomeFlow />
      <EditIncomeStatementTable
        rows={workspace.filteredStatements}
        bankAccounts={workspace.workspace.bankAccounts}
        month={workspace.month}
        maxMonth={workspace.maxMonth}
        monthDisabled={Boolean(workspace.detail)}
        search={workspace.statementSearch}
        statusFilter={workspace.statementStatusFilter}
        bankAccountFilter={workspace.bankAccountFilter}
        page={workspace.statementPage}
        pageSize={workspace.statementPageSize}
        loading={workspace.loading}
        busy={workspace.busy}
        onMonthChange={workspace.changeMonth}
        onSearchChange={workspace.setStatementSearch}
        onStatusFilterChange={workspace.setStatementStatusFilter}
        onBankAccountFilterChange={workspace.setBankAccountFilter}
        onPageChange={workspace.setStatementPage}
        onPageSizeChange={workspace.setStatementPageSize}
        onReload={() => void workspace.refresh()}
        onEdit={(statementId) => void workspace.selectStatement(statementId)}
      />

      {workspace.detail ? (
        <EditIncomeCorrectionWorkspace
          detail={workspace.detail}
          rows={workspace.filteredTransactions}
          originalById={workspace.originalById}
          search={workspace.transactionSearch}
          statusFilter={workspace.transactionStatusFilter}
          page={workspace.transactionPage}
          pageSize={workspace.transactionPageSize}
          loading={workspace.detailLoading}
          busy={workspace.busy}
          canEdit={workspace.canEdit}
          onSearchChange={workspace.setTransactionSearch}
          onStatusFilterChange={workspace.setTransactionStatusFilter}
          onPageChange={workspace.setTransactionPage}
          onPageSizeChange={workspace.setTransactionPageSize}
          onReload={() => void workspace.refresh()}
          onBack={workspace.closeDetail}
          onTransactionChange={workspace.updateTransaction}
        />
      ) : (
        <div className={styles.noteCard}>
          <strong>Post-completion correction</strong>
          <span>Select a Complete statement and click Edit. Changes stay local until Execute, then require approval again.</span>
        </div>
      )}
    </div>
  );
}
