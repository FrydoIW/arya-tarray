"use client";

import type { CSSProperties, ReactNode } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { DataTablePagination } from "./DataTablePagination";
import type { DataTableColumn, DataTablePaginationConfig } from "./types";

type EmptyStateConfig = {
  title?: string;
  description?: string;
};

type DataTableProps<T> = {
  rows: T[];
  columns: DataTableColumn<T>[];
  rowKey: (row: T, index: number) => string;
  loading?: boolean;
  loadingText?: string;
  emptyState?: EmptyStateConfig;
  disabled?: boolean;
  minWidth?: string;
  onCellChange?: (row: T, columnKey: string, value: unknown) => void;
  pagination?: DataTablePaginationConfig;
  footerActions?: ReactNode;
  ariaLabel?: string;
};

function defaultValue<T>(row: T, column: DataTableColumn<T>) {
  if (column.getValue) return column.getValue(row);
  return (row as unknown as Record<string, unknown>)[column.key];
}

function displayValue(value: unknown, emptyValue: ReactNode = "—") {
  if (value === null || value === undefined || value === "") return emptyValue;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function columnClass<T>(column: DataTableColumn<T>) {
  return [
    `align-${column.align ?? "left"}`,
    column.sticky ? `ui-data-table-sticky-${column.sticky}` : ""
  ].filter(Boolean).join(" ");
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  loading = false,
  loadingText = "Loading data…",
  emptyState,
  disabled = false,
  minWidth,
  onCellChange,
  pagination,
  footerActions,
  ariaLabel = "Data table"
}: DataTableProps<T>) {
  const page = pagination?.page ?? 1;
  const pageSize = pagination?.pageSize ?? (rows.length || 1);
  const serverSide = pagination?.mode === "server";
  const startIndex = pagination && !serverSide ? (page - 1) * pageSize : 0;
  const visibleRows = pagination && !serverSide ? rows.slice(startIndex, startIndex + pageSize) : rows;
  const tableStyle: CSSProperties = minWidth ? { minWidth } : {};

  return (
    <div className="ui-data-table-shell" aria-busy={loading}>
      <div className="ui-data-table-scroll">
        <table className="ui-data-table" style={tableStyle} aria-label={ariaLabel}>
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  style={{ width: column.width, minWidth: column.minWidth }}
                  className={columnClass(column)}
                  scope="col"
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={columns.length} className="ui-data-table-message"><span role="status" aria-live="polite">{loadingText}</span></td></tr>
            ) : visibleRows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="ui-data-table-empty-cell">
                  <EmptyState title={emptyState?.title} description={emptyState?.description} />
                </td>
              </tr>
            ) : visibleRows.map((row, visibleIndex) => {
              const rowIndex = startIndex + visibleIndex;
              return (
                <tr key={rowKey(row, rowIndex)}>
                  {columns.map((column) => {
                    const value = defaultValue(row, column);
                    const editable = typeof column.editable === "function" ? column.editable(row) : Boolean(column.editable);
                    const change = (nextValue: unknown) => onCellChange?.(row, column.key, nextValue);

                    let content: ReactNode;
                    if (editable && onCellChange) {
                      if (column.renderEditor) {
                        content = column.renderEditor({ row, rowIndex, value, onChange: change });
                      } else if (column.inputType === "select") {
                        content = (
                          <select
                            className="ui-table-input ui-table-select"
                            value={String(value ?? "")}
                            disabled={disabled}
                            aria-label={`${column.header}, row ${rowIndex + 1}`}
                            name={`${column.key}-${rowIndex + 1}`}
                            onChange={(event) => change(column.parseValue ? column.parseValue(event.target.value) : event.target.value)}
                          >
                            {column.options?.map((option) => (
                              <option key={String(option.value)} value={String(option.value)}>{option.label}</option>
                            ))}
                          </select>
                        );
                      } else {
                        content = (
                          <input
                            className="ui-table-input"
                            type={column.inputType === "number" ? "number" : "text"}
                            value={String(value ?? "")}
                            placeholder={column.placeholder}
                            disabled={disabled}
                            aria-label={`${column.header}, row ${rowIndex + 1}`}
                            name={`${column.key}-${rowIndex + 1}`}
                            onChange={(event) => change(column.parseValue ? column.parseValue(event.target.value) : event.target.value)}
                          />
                        );
                      }
                    } else if (column.render) {
                      content = column.render(row, rowIndex);
                    } else {
                      content = displayValue(value, column.emptyValue);
                    }

                    return (
                      <td key={column.key} className={columnClass(column)}>
                        {content}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {(pagination || footerActions) ? (
        <div className="ui-data-table-bottom">
          {pagination ? <DataTablePagination {...pagination} /> : <span />}
          {footerActions ? <div className="ui-data-table-actions">{footerActions}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
