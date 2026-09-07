"use client";

import { useState } from "react";
import { Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { PageHeader } from "@/components/ui/PageHeader";
import { MenuRegistryTable } from "./MenuRegistryTable";
import { RoleAccessMatrix } from "./RoleAccessMatrix";
import { RoleSummary } from "./RoleSummary";
import { RoleTable } from "./RoleTable";
import { RoleUsageRule } from "./RoleUsageRule";
import { useRoleWorkspace } from "../hooks/useRoleWorkspace";
import styles from "../styles/role.module.css";

export function RoleScreen() {
  const workspace = useRoleWorkspace();
  const [executeOpen, setExecuteOpen] = useState(false);

  function addRole() {
    workspace.setRoleSearch("");
    workspace.setRoleStatusFilter("ALL");
    workspace.addRoleDraft();
  }

  function addMenu() {
    workspace.setMenuSearch("");
    workspace.setMenuStatusFilter("ALL");
    workspace.setMenuTypeFilter("ALL");
    workspace.addMenuDraft();
  }

  return (
    <div className={`${styles.page} page-stack`}>
      <PageHeader
        breadcrumb={["Configuration", "Role"]}
        title="Role"
        description="Maintain roles, register application menus, and configure which pages each role can access."
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

      <RoleSummary {...workspace.roleSummary} />
      <RoleUsageRule />

      <RoleTable
        items={workspace.roles}
        search={workspace.roleSearch}
        statusFilter={workspace.roleStatusFilter}
        mode={workspace.roleMode}
        loading={workspace.loading}
        disabled={workspace.saving}
        onSearchChange={workspace.setRoleSearch}
        onStatusFilterChange={workspace.setRoleStatusFilter}
        onModeChange={workspace.changeRoleMode}
        onReload={() => void workspace.refresh()}
        onCellChange={workspace.updateRoleCell}
        onDelete={workspace.removeRole}
        totalCount={workspace.allRoles.length}
        onAdd={addRole}
      />

      <MenuRegistryTable
        items={workspace.menus}
        allItems={workspace.allMenus}
        search={workspace.menuSearch}
        statusFilter={workspace.menuStatusFilter}
        typeFilter={workspace.menuTypeFilter}
        loading={workspace.loading}
        disabled={workspace.saving}
        onSearchChange={workspace.setMenuSearch}
        onStatusFilterChange={workspace.setMenuStatusFilter}
        onTypeFilterChange={workspace.setMenuTypeFilter}
        onReload={() => void workspace.refresh()}
        onCellChange={workspace.updateMenuCell}
        onDelete={workspace.removeMenu}
        onAdd={addMenu}
      />

      <RoleAccessMatrix
        roles={workspace.persistedRoles}
        menus={workspace.persistedMenus}
        mode={workspace.matrixMode}
        loading={workspace.loading}
        disabled={workspace.saving}
        onModeChange={workspace.setMatrixMode}
        hasAccess={workspace.hasAccess}
        onToggle={workspace.toggleAccess}
        onReload={() => void workspace.refresh()}
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
