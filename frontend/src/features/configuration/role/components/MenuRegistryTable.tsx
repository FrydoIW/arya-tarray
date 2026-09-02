"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { IconButton } from "@/components/ui/IconButton";
import { SearchInput } from "@/components/ui/SearchInput";
import { Select } from "@/components/ui/Select";
import { formatDateTime } from "@/lib/format";
import type {
  MenuRegistryItem,
  MenuStatusFilter,
  MenuTypeFilter
} from "../types";
import styles from "../styles/role.module.css";

type MenuRegistryTableProps = {
  items: MenuRegistryItem[];
  allItems: MenuRegistryItem[];
  search: string;
  statusFilter: MenuStatusFilter;
  typeFilter: MenuTypeFilter;
  loading: boolean;
  disabled: boolean;
  onSearchChange: (value: string) => void;
  onStatusFilterChange: (value: MenuStatusFilter) => void;
  onTypeFilterChange: (value: MenuTypeFilter) => void;
  onReload: () => void;
  onCellChange: (id: string, field: string, value: unknown) => void;
  onDelete: (id: string) => void;
  onAdd: () => void;
};

export function MenuRegistryTable({
  items,
  allItems,
  search,
  statusFilter,
  typeFilter,
  loading,
  disabled,
  onSearchChange,
  onStatusFilterChange,
  onTypeFilterChange,
  onReload,
  onCellChange,
  onDelete,
  onAdd
}: MenuRegistryTableProps) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  useEffect(() => {
    const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
    setPage((current) => Math.min(current, pageCount));
  }, [items.length, pageSize]);

  const groupOptions = useMemo(
    () => allItems
      .filter((item) => item.menuType === "GROUP")
      .sort((a, b) => a.displayOrder - b.displayOrder || a.menuName.localeCompare(b.menuName)),
    [allItems]
  );

  const columns = useMemo<DataTableColumn<MenuRegistryItem>[]>(() => [
    {
      key: "menuCode",
      header: "Menu Code",
      width: "210px",
      minWidth: "200px",
      sticky: "left",
      editable: (row) => Boolean(row.isDraft),
      placeholder: "CONFIG_MENU_CODE",
      render: (row) => <span className={styles.menuCodeReadonly}>{row.menuCode}</span>
    },
    {
      key: "menuName",
      header: "Menu Name",
      minWidth: "220px",
      editable: true,
      placeholder: "Menu name"
    },
    {
      key: "menuType",
      header: "Type",
      width: "135px",
      minWidth: "125px",
      editable: (row) => Boolean(row.isDraft),
      renderEditor: ({ row, value, onChange }) => (
        <select
          className="ui-table-input ui-table-select"
          value={String(value)}
          disabled={disabled || !row.isDraft}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="GROUP">Group</option>
          <option value="PAGE">Page</option>
        </select>
      ),
      render: (row) => (
        <span className={`${styles.menuTypeBadge} ${row.menuType === "GROUP" ? styles.group : styles.pageType}`}>
          {row.menuType === "GROUP" ? "Group" : "Page"}
        </span>
      )
    },
    {
      key: "parentMenuId",
      header: "Parent Group",
      minWidth: "200px",
      editable: (row) => row.menuType === "PAGE",
      renderEditor: ({ row, value, onChange }) => row.menuType === "GROUP" ? (
        <span className={styles.mutedValue}>Top level</span>
      ) : (
        <select
          className="ui-table-input ui-table-select"
          value={String(value ?? "")}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value || null)}
        >
          <option value="">Select group</option>
          {groupOptions.filter((group) => group.id !== row.id).map((group) => (
            <option key={group.id} value={group.id}>{group.menuName || group.menuCode || "New group"}</option>
          ))}
        </select>
      ),
      render: (row) => row.menuType === "GROUP"
        ? <span className={styles.mutedValue}>Top level</span>
        : allItems.find((item) => item.id === row.parentMenuId)?.menuName || row.parentMenu?.menuName || "-"
    },
    {
      key: "route",
      header: "Route",
      minWidth: "310px",
      editable: (row) => Boolean(row.isDraft && row.menuType === "PAGE"),
      placeholder: "/configuration/menu",
      render: (row) => row.menuType === "GROUP"
        ? <span className={styles.mutedValue}>-</span>
        : <code className={styles.routeValue}>{row.route || "-"}</code>
    },
    {
      key: "displayOrder",
      header: "Order",
      width: "105px",
      minWidth: "95px",
      editable: true,
      inputType: "number",
      parseValue: (value) => Math.max(0, Number(value) || 0),
      align: "center"
    },
    {
      key: "activeFlag",
      header: "Status",
      width: "155px",
      minWidth: "145px",
      editable: true,
      renderEditor: ({ value, onChange }) => (
        <label className={`${styles.statusSelect} ${Boolean(value) ? styles.active : styles.inactive}`}>
          <span className={styles.statusDot} />
          <select value={Boolean(value) ? "true" : "false"} disabled={disabled} onChange={(event) => onChange(event.target.value === "true")}>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        </label>
      )
    },
    {
      key: "assignedRoles",
      header: "Assigned Roles",
      width: "145px",
      minWidth: "135px",
      align: "center",
      render: (row) => row.menuType === "GROUP"
        ? <span className={styles.mutedValue}>-</span>
        : <span className={styles.assignmentCount}>{row.assignedRoles}</span>
    },
    {
      key: "updatedBy",
      header: "Updated By",
      width: "190px",
      minWidth: "180px",
      render: (row) => row.isDraft
        ? <span className={styles.draftLabel}>New row</span>
        : <span className={styles.updatedBy}>{row.updatedBy?.fullName || "-"}</span>
    },
    {
      key: "updatedAt",
      header: "Updated At",
      width: "190px",
      minWidth: "180px",
      render: (row) => row.isDraft ? <span className={styles.draftLabel}>Not saved</span> : formatDateTime(row.updatedAt)
    },
    {
      key: "actions",
      header: "Action",
      width: "82px",
      minWidth: "82px",
      align: "center",
      sticky: "right",
      render: (row) => (
        <div className={styles.rowActions}>
          <IconButton
            label={row.isDraft ? "Remove draft menu" : `Delete Menu ${row.menuCode}`}
            icon={<Trash2 size={16} />}
            variant="danger"
            disabled={disabled}
            onClick={() => onDelete(row.id)}
          />
        </div>
      )
    }
  ], [allItems, disabled, groupOptions, onDelete]);

  return (
    <section className={styles.tablePanel}>
      <div className={styles.tableHeader}>
        <div>
          <h2>Menu Registry</h2>
          <p>Register menu groups and pages known by the system. Existing code, type, and route stay read-only after the first Execute.</p>
        </div>

        <div className={styles.tableToolbar}>
          <SearchInput
            value={search}
            onChange={(event) => {
              setPage(1);
              onSearchChange(event.target.value);
            }}
            placeholder="Search menu code, name, route..."
            aria-label="Search menu registry"
          />
          <Select
            value={typeFilter}
            onChange={(event) => {
              setPage(1);
              onTypeFilterChange(event.target.value as MenuTypeFilter);
            }}
            aria-label="Filter menu type"
          >
            <option value="ALL">All Type</option>
            <option value="GROUP">Group</option>
            <option value="PAGE">Page</option>
          </Select>
          <Select
            value={statusFilter}
            onChange={(event) => {
              setPage(1);
              onStatusFilterChange(event.target.value as MenuStatusFilter);
            }}
            aria-label="Filter menu status"
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
            title="Reload latest Role workspace from database. Unsaved changes will be discarded."
          >
            Reload
          </Button>
        </div>
      </div>

      <DataTable
        rows={items}
        columns={columns}
        rowKey={(row) => row.id}
        loading={loading}
        disabled={disabled}
        minWidth="2030px"
        emptyState={{
          title: "No menus registered",
          description: search || statusFilter !== "ALL" || typeFilter !== "ALL"
            ? "Try changing your filters."
            : "Add a Group first, then register Page menus under it."
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
    </section>
  );
}
