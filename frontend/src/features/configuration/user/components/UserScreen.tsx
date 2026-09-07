"use client";

import { useState } from "react";
import { Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { PageHeader } from "@/components/ui/PageHeader";
import type { UserItem } from "../types";
import { useUsers } from "../hooks/useUsers";
import { AddUserModal } from "./AddUserModal";
import { ResetPasswordModal } from "./ResetPasswordModal";
import { UserAccessFlow } from "./UserAccessFlow";
import { UserSummary } from "./UserSummary";
import { UserTable } from "./UserTable";
import styles from "../styles/user.module.css";

export function UserScreen() {
  const users = useUsers();
  const [addOpen, setAddOpen] = useState(false);
  const [resetUser, setResetUser] = useState<UserItem | null>(null);
  const [executeOpen, setExecuteOpen] = useState(false);

  return (
    <div className={`${styles.page} page-stack`}>
      <PageHeader
        breadcrumb={["Configuration", "User"]}
        title="User"
        description="Manage internal user accounts and assign roles for Arya Tarray."
        actions={(
          <>
            <Button
              type="button"
              variant="secondary"
              icon={<RotateCcw size={16} />}
              onClick={users.clearChanges}
              disabled={users.loading || users.saving}
            >
              Clear
            </Button>
            <Button
              type="button"
              icon={<Play size={16} />}
              onClick={() => {
                if (users.prepareExecute()) setExecuteOpen(true);
              }}
              disabled={users.loading || users.saving}
            >
              {users.saving ? "Executing..." : "Execute"}
            </Button>
          </>
        )}
      />

      {users.message ? <div className="ui-alert ui-alert-success">{users.message}</div> : null}
      {users.error ? <div className="ui-alert ui-alert-error">{users.error}</div> : null}

      <UserSummary {...users.summary} />

      <UserTable
        items={users.users}
        allItems={users.allUsers}
        roles={users.roles}
        search={users.search}
        statusFilter={users.statusFilter}
        loading={users.loading}
        disabled={users.saving}
        onSearchChange={users.setSearch}
        onStatusFilterChange={users.setStatusFilter}
        onReload={() => void users.refresh()}
        onCellChange={users.updateCell}
        onRemoveDraft={users.removeDraft}
        onResetPassword={setResetUser}
        hasPasswordReset={users.hasPasswordReset}
        onAdd={() => setAddOpen(true)}
      />

      <UserAccessFlow />

      <AddUserModal
        open={addOpen}
        roles={users.roles}
        disabled={users.saving}
        onClose={() => setAddOpen(false)}
        onAdd={users.addDraft}
      />

      <ResetPasswordModal
        user={resetUser}
        disabled={users.saving}
        onClose={() => setResetUser(null)}
        onStage={users.stagePasswordReset}
      />
      <ConfirmDialog
        open={executeOpen}
        title="Confirm Execute"
        message="Are you sure you want to execute these changes?"
        confirmLabel="Execute"
        loading={users.saving}
        onCancel={() => setExecuteOpen(false)}
        onConfirm={async () => {
          await users.executeChanges();
          setExecuteOpen(false);
        }}
      />
    </div>
  );
}
