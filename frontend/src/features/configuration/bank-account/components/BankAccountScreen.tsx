"use client";

import { useState } from "react";
import { Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { PageHeader } from "@/components/ui/PageHeader";
import type { BankAccount } from "../types";
import { useBankAccountWorkspace } from "../hooks/useBankAccountWorkspace";
import { BankAccountFlow } from "./BankAccountFlow";
import { BankAccountModal } from "./BankAccountModal";
import { BankAccountSummary } from "./BankAccountSummary";
import { BankAccountTable } from "./BankAccountTable";
import styles from "../styles/bank-account.module.css";

export function BankAccountScreen() {
  const workspace = useBankAccountWorkspace();
  const [modalMode, setModalMode] = useState<"ADD" | "EDIT">("ADD");
  const [selected, setSelected] = useState<BankAccount | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [executeOpen, setExecuteOpen] = useState(false);

  function openAdd() {
    setModalMode("ADD");
    setSelected(null);
    setModalOpen(true);
  }

  function openEdit(row: BankAccount) {
    setModalMode("EDIT");
    setSelected(row);
    setModalOpen(true);
  }

  return (
    <div className={`${styles.page} page-stack`}>
      <PageHeader
        breadcrumb={["Configuration", "Bank Account"]}
        title="Bank Account"
        description="Manage bank accounts used for statement upload and reconciliation."
        actions={(
          <>
            <Button type="button" variant="secondary" icon={<RotateCcw size={16} />} onClick={workspace.clearChanges} disabled={workspace.loading || workspace.saving}>
              Clear
            </Button>
            <Button type="button" icon={<Play size={16} />} onClick={() => {
              if (workspace.prepareExecute()) setExecuteOpen(true);
            }} disabled={workspace.loading || workspace.saving}>
              {workspace.saving ? "Executing..." : "Execute"}
            </Button>
          </>
        )}
      />

      {workspace.message ? <div className="ui-alert ui-alert-success">{workspace.message}</div> : null}
      {workspace.error ? <div className="ui-alert ui-alert-error">{workspace.error}</div> : null}

      <BankAccountSummary {...workspace.summary} />
      <BankAccountFlow />
      <BankAccountTable
        items={workspace.accounts}
        allItems={workspace.allAccounts}
        search={workspace.search}
        statusFilter={workspace.statusFilter}
        loading={workspace.loading}
        disabled={workspace.saving}
        onSearchChange={workspace.setSearch}
        onStatusFilterChange={workspace.setStatusFilter}
        onReload={() => void workspace.refresh()}
        onAdd={openAdd}
        onEdit={openEdit}
        onRemoveDraft={workspace.removeDraft}
      />

      <BankAccountModal
        open={modalOpen}
        mode={modalMode}
        account={selected}
        supportedBanks={workspace.supportedBanks}
        disabled={workspace.saving}
        onClose={() => setModalOpen(false)}
        onSubmit={(value) => {
          if (modalMode === "ADD") {
            workspace.addDraft({
              bankCode: value.bankCode ?? "",
              accountNo: value.accountNo ?? "",
              accountName: value.accountName,
              activeFlag: value.activeFlag
            });
          } else if (selected) {
            workspace.updateAccount(selected.id, value);
          }
          setModalOpen(false);
        }}
      />
      <ConfirmDialog
        open={executeOpen}
        title="Confirm Execute"
        message="Are you sure you want to execute these changes?"
        confirmLabel="Execute"
        loading={workspace.saving}
        onCancel={() => setExecuteOpen(false)}
        onConfirm={async () => {
          await workspace.executeChanges();
          setExecuteOpen(false);
        }}
      />
    </div>
  );
}
