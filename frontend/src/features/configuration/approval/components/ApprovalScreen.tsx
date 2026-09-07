"use client";

import { useState } from "react";
import { Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { PageHeader } from "@/components/ui/PageHeader";
import type { ApprovalConfiguration } from "../types";
import { useApprovalWorkspace } from "../hooks/useApprovalWorkspace";
import { ApprovalConfigModal } from "./ApprovalConfigModal";
import { ApprovalFlow } from "./ApprovalFlow";
import { ApprovalSummary } from "./ApprovalSummary";
import { ApprovalTable } from "./ApprovalTable";
import styles from "../styles/approval.module.css";

export function ApprovalScreen() {
  const workspace = useApprovalWorkspace();
  const [modalMode, setModalMode] = useState<"ADD" | "EDIT" | null>(null);
  const [editingConfiguration, setEditingConfiguration] = useState<ApprovalConfiguration | null>(null);
  const [executeOpen, setExecuteOpen] = useState(false);

  function openAdd() {
    workspace.setSearch("");
    workspace.setStatusFilter("ALL");
    setEditingConfiguration(null);
    setModalMode("ADD");
  }

  function openEdit(configuration: ApprovalConfiguration) {
    setEditingConfiguration(configuration);
    setModalMode("EDIT");
  }

  function closeModal() {
    if (workspace.saving) return;
    setModalMode(null);
    setEditingConfiguration(null);
  }

  return (
    <div className={`${styles.page} page-stack`}>
      <PageHeader
        breadcrumb={["Configuration", "Approval"]}
        title="Approval"
        description="Configure which supported process requires approval and assign the users responsible for approving it."
        actions={(
          <>
            <Button
              type="button"
              variant="secondary"
              icon={<RotateCcw size={16} />}
              onClick={workspace.clearChanges}
              disabled={workspace.loading || workspace.saving}
            >
              Clear
            </Button>
            <Button
              type="button"
              icon={<Play size={16} />}
              onClick={() => {
                if (workspace.prepareExecute()) setExecuteOpen(true);
              }}
              disabled={workspace.loading || workspace.saving}
            >
              {workspace.saving ? "Executing..." : "Execute"}
            </Button>
          </>
        )}
      />

      {workspace.message ? <div className="ui-alert ui-alert-success">{workspace.message}</div> : null}
      {workspace.error ? <div className="ui-alert ui-alert-error">{workspace.error}</div> : null}

      <ApprovalSummary
        total={workspace.summary.total}
        active={workspace.summary.active}
        approvers={workspace.summary.approvers}
        approvalTarget={workspace.approvalTarget}
      />

      <ApprovalFlow />

      <ApprovalTable
        items={workspace.configurations}
        allItems={workspace.allConfigurations}
        search={workspace.search}
        statusFilter={workspace.statusFilter}
        loading={workspace.loading}
        disabled={workspace.saving}
        canAdd={workspace.availableMenus.length > 0}
        onSearchChange={workspace.setSearch}
        onStatusFilterChange={workspace.setStatusFilter}
        onReload={() => void workspace.refresh()}
        onStatusChange={(id, activeFlag) => workspace.updateConfiguration(id, { activeFlag })}
        onEdit={openEdit}
        onRemoveDraft={workspace.removeDraft}
        onAdd={openAdd}
      />

      <ApprovalConfigModal
        open={modalMode !== null}
        mode={modalMode ?? "ADD"}
        configuration={editingConfiguration}
        menuOptions={modalMode === "ADD" ? workspace.availableMenus : workspace.menus}
        approverUsers={workspace.approverUsers}
        disabled={workspace.saving}
        onClose={closeModal}
        onSubmit={(value) => {
          if (modalMode === "ADD") {
            if (!value.menuId) return;
            workspace.addDraft({
              menuId: value.menuId,
              approverUserIds: value.approverUserIds,
              activeFlag: value.activeFlag
            });
          } else if (editingConfiguration) {
            workspace.updateConfiguration(editingConfiguration.id, {
              menuId: editingConfiguration.isDraft ? value.menuId : undefined,
              approverUserIds: value.approverUserIds,
              activeFlag: value.activeFlag
            });
          }
          closeModal();
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
