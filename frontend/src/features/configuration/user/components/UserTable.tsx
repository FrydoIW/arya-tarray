"use client";

import { useEffect, useMemo, useState } from "react";
import { KeyRound, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { IconButton } from "@/components/ui/IconButton";
import { SearchInput } from "@/components/ui/SearchInput";
import { Select } from "@/components/ui/Select";
import { formatDateTime } from "@/lib/format";
import type { UserItem, UserRoleOption, UserStatus, UserStatusFilter } from "../types";
import styles from "../styles/user.module.css";

type UserTableProps = {
  items: UserItem[];
  allItems: UserItem[];
  roles: UserRoleOption[];
  search: string;
  statusFilter: UserStatusFilter;
  loading: boolean;
  disabled: boolean;
  onSearchChange: (value: string) => void;
  onStatusFilterChange: (value: UserStatusFilter) => void;
  onReload: () => void;
  onCellChange: (id: string, field: string, value: unknown) => void;
  onRemoveDraft: (id: string) => void;
  onResetPassword: (user: UserItem) => void;
  hasPasswordReset: (id: string) => boolean;
  onAdd: () => void;
};

export function UserTable({
  items,
  allItems,
  roles,
  search,
  statusFilter,
  loading,
  disabled,
  onSearchChange,
  onStatusFilterChange,
  onReload,
  onCellChange,
  onRemoveDraft,
  onResetPassword,
  hasPasswordReset,
  onAdd
}: UserTableProps) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  useEffect(() => {
    const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
    setPage((current) => Math.min(current, pageCount));
  }, [items.length, pageSize]);

  const columns = useMemo<DataTableColumn<UserItem>[]>(() => [
    {
      key: "fullName",
      header: "Full Name",
      minWidth: "245px",
      sticky: "left",
      editable: (row) => Boolean(row.isDraft) || row.roleCount <= 1,
      placeholder: "Full name"
    },
    {
      key: "email",
      header: "Email",
      minWidth: "265px",
      editable: (row) => Boolean(row.isDraft) || row.roleCount <= 1,
      placeholder: "name@aryatarray.local"
    },
    {
      key: "roleId",
      header: "Role",
      minWidth: "210px",
      editable: (row) => Boolean(row.isDraft) || row.roleCount <= 1,
      render: (row) => (
        <span className={`${styles.readOnlyRole} ${row.role?.activeFlag === false ? styles.roleInactiveText : ""}`}>
          {row.roleCount > 1 ? `Multiple roles (${row.roleCount})` : (row.role?.roleCode ?? "No role")}
        </span>
      ),
      renderEditor: ({ value, onChange }) => {
        const selected = roles.find((role) => role.id === String(value));
        return (
          <label className={`${styles.roleSelect} ${selected?.activeFlag === false ? styles.roleInactive : ""}`}>
            <select value={String(value ?? "")} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
              <option value="">Select role</option>
              {roles.map((role) => (
                <option
                  key={role.id}
                  value={role.id}
                  disabled={!role.activeFlag && role.id !== String(value)}
                >
                  {role.roleCode} — {role.roleName}{role.activeFlag ? "" : " (Inactive)"}
                </option>
              ))}
            </select>
          </label>
        );
      }
    },
    {
      key: "status",
      header: "Status",
      width: "155px",
      minWidth: "145px",
      editable: (row) => Boolean(row.isDraft) || row.roleCount <= 1,
      render: (row) => (
        <span className={`${styles.readOnlyStatus} ${row.status === "ACTIVE" ? styles.active : styles.inactive}`}>
          <span className={styles.statusDot} />
          {row.status === "ACTIVE" ? "Active" : "Inactive"}
        </span>
      ),
      renderEditor: ({ value, onChange }) => {
        const active = String(value) === "ACTIVE";
        return (
          <label className={`${styles.statusSelect} ${active ? styles.active : styles.inactive}`}>
            <span className={styles.statusDot} />
            <select
              value={active ? "ACTIVE" : "INACTIVE"}
              disabled={disabled}
              onChange={(event) => onChange(event.target.value as UserStatus)}
            >
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </label>
        );
      }
    },
    {
      key: "updatedBy",
      header: "Updated By",
      width: "200px",
      minWidth: "185px",
      render: (row) => row.isDraft
        ? <span className={styles.draftLabel}>New draft</span>
        : <span className={styles.updatedBy}>{row.updatedBy?.fullName ?? "—"}</span>
    },
    {
      key: "updatedAt",
      header: "Updated At",
      width: "190px",
      minWidth: "180px",
      render: (row) => row.isDraft ? <span className={styles.draftLabel}>Not executed</span> : formatDateTime(row.updatedAt)
    },
    {
      key: "action",
      header: "Action",
      width: "110px",
      minWidth: "105px",
      align: "center",
      sticky: "right",
      render: (row) => (
        <div className={styles.rowActions}>
          {row.isDraft ? (
            <IconButton
              label={`Remove draft ${row.fullName || row.email || "user"}`}
              icon={<Trash2 size={16} />}
              variant="danger"
              disabled={disabled}
              onClick={() => onRemoveDraft(row.id)}
            />
          ) : (
            <span className={styles.passwordActionWrap} data-pending={hasPasswordReset(row.id) ? "true" : "false"}>
              <IconButton
                label={hasPasswordReset(row.id) ? `Password reset staged for ${row.fullName}` : `Reset password for ${row.fullName}`}
                icon={<KeyRound size={16} />}
                disabled={disabled}
                onClick={() => onResetPassword(row)}
              />
              {hasPasswordReset(row.id) ? <i className={styles.pendingDot} aria-hidden="true" /> : null}
            </span>
          )}
        </div>
      )
    }
  ], [disabled, hasPasswordReset, onRemoveDraft, onResetPassword, roles]);

  return (
    <CollapsibleSection
      className={styles.tablePanel}
      title="User Master"
      description="Edit user identity, role, and status directly. Existing users are deactivated instead of hard-deleted."
      summary={`${allItems.length} users`}
      defaultExpanded={false}
      actions={<div className={styles.tableToolbar}>
          <SearchInput
            value={search}
            onChange={(event) => {
              setPage(1);
              onSearchChange(event.target.value);
            }}
            placeholder="Search by name, email, or role..."
            aria-label="Search users"
          />
          <Select
            value={statusFilter}
            onChange={(event) => {
              setPage(1);
              onStatusFilterChange(event.target.value as UserStatusFilter);
            }}
            aria-label="Filter user status"
          >
            <option value="ALL">All Status</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </Select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            icon={<RefreshCw size={16} />}
            onClick={onReload}
            disabled={loading || disabled}
            title="Reload latest users from database. Unsaved changes will be discarded."
          >
            Reload
          </Button>
        </div>}
    >

      <DataTable
        rows={items}
        columns={columns}
        rowKey={(row) => row.id}
        loading={loading}
        disabled={disabled}
        minWidth="1430px"
        emptyState={{
          title: "No users found",
          description: search || statusFilter !== "ALL" ? "Try changing your search or status filter." : "Add the first internal user."
        }}
        onCellChange={(row, key, value) => onCellChange(row.id, key, value)}
        pagination={{
          page,
          pageSize,
          total: items.length,
          onPageChange: setPage,
          onPageSizeChange: (nextPageSize) => {
            setPageSize(nextPageSize);
            setPage(1);
          }
        }}
        footerActions={(
          <Button
            type="button"
            variant="outline"
            size="sm"
            icon={<Plus size={16} />}
            onClick={() => {
              onAdd();
              setPage(Math.max(1, Math.ceil((allItems.length + 1) / pageSize)));
            }}
            disabled={disabled}
          >
            Add
          </Button>
        )}
      />
    </CollapsibleSection>
  );
}
