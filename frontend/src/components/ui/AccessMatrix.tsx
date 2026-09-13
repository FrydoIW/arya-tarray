"use client";

import type { ReactNode } from "react";
import { Check, Minus } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";

export type AccessMatrixColumn = {
  id: string;
  label: string;
  description?: string;
  active?: boolean;
};

export type AccessMatrixRow = {
  id: string;
  label: string;
  description?: string;
  active?: boolean;
};

export type AccessMatrixGroup = {
  id: string;
  label: string;
  rows: AccessMatrixRow[];
};

type AccessMatrixProps = {
  columns: AccessMatrixColumn[];
  groups: AccessMatrixGroup[];
  editable?: boolean;
  disabled?: boolean;
  loading?: boolean;
  minWidth?: string;
  cornerHeader?: ReactNode;
  hasAccess: (columnId: string, rowId: string) => boolean;
  onToggle?: (columnId: string, rowId: string) => void;
  emptyState?: {
    title?: string;
    description?: string;
  };
};

export function AccessMatrix({
  columns,
  groups,
  editable = false,
  disabled = false,
  loading = false,
  minWidth = "920px",
  cornerHeader = "Item",
  hasAccess,
  onToggle,
  emptyState
}: AccessMatrixProps) {
  const rowCount = groups.reduce((total, group) => total + group.rows.length, 0);

  // While the workspace is still loading the matrix is unknown, not empty.
  if (loading && (columns.length === 0 || rowCount === 0)) {
    return (
      <div className="ui-access-matrix-scroll">
        <table className="ui-access-matrix" style={{ minWidth }} aria-busy="true" aria-label="Access matrix — loading">
          <thead>
            <tr><th className="ui-access-matrix-feature">{cornerHeader}</th></tr>
          </thead>
          <tbody>
            {Array.from({ length: 4 }, (_, index) => (
              <tr key={`matrix-loading-${index}`} aria-hidden="true" className="ui-table-skeleton-row">
                <td className="ui-access-matrix-feature"><span className="ui-table-skeleton" style={{ width: `${44 + ((index % 3) * 14)}%` }} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (columns.length === 0 || rowCount === 0) {
    return (
      <EmptyState
        title={emptyState?.title ?? "No matrix data"}
        description={emptyState?.description ?? "No rows or columns are available."}
      />
    );
  }

  return (
    <div className="ui-access-matrix-scroll">
      <table className="ui-access-matrix" style={{ minWidth }}>
        <thead>
          <tr>
            <th className="ui-access-matrix-feature">{cornerHeader}</th>
            {columns.map((column) => (
              <th key={column.id} title={column.description}>
                <span>{column.label}</span>
                {column.active === false ? <small>Inactive</small> : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <MatrixGroupRows
              key={group.id}
              group={group}
              columns={columns}
              editable={editable}
              disabled={disabled}
              hasAccess={hasAccess}
              onToggle={onToggle}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

type MatrixGroupRowsProps = {
  group: AccessMatrixGroup;
  columns: AccessMatrixColumn[];
  editable: boolean;
  disabled: boolean;
  hasAccess: (columnId: string, rowId: string) => boolean;
  onToggle?: (columnId: string, rowId: string) => void;
};

function MatrixGroupRows({
  group,
  columns,
  editable,
  disabled,
  hasAccess,
  onToggle
}: MatrixGroupRowsProps) {
  return (
    <>
      <tr className="ui-access-matrix-group">
        <td className="ui-access-matrix-feature"><strong>{group.label}</strong></td>
        {columns.map((column) => <td key={column.id} aria-hidden="true" />)}
      </tr>
      {group.rows.map((row) => (
        <tr key={row.id}>
          <td className="ui-access-matrix-feature">
            <div className="ui-access-matrix-row-label">
              <span>{row.label}</span>
              {row.description ? <small>{row.description}</small> : null}
              {row.active === false ? <em>Inactive</em> : null}
            </div>
          </td>
          {columns.map((column) => {
            const allowed = hasAccess(column.id, row.id);
            return (
              <td key={column.id} className="ui-access-matrix-cell">
                {editable ? (
                  <label className="ui-access-matrix-check">
                    <input
                      type="checkbox"
                      checked={allowed}
                      disabled={disabled || column.active === false || row.active === false}
                      aria-label={`${column.label} access to ${row.label}`}
                      onChange={() => onToggle?.(column.id, row.id)}
                    />
                    <span aria-hidden="true"><Check size={14} /></span>
                  </label>
                ) : allowed ? (
                  <span className="ui-access-matrix-allowed" title="Allowed"><Check size={15} /></span>
                ) : (
                  <span className="ui-access-matrix-denied" title="No access"><Minus size={15} /></span>
                )}
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
