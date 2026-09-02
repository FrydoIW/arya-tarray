import type { ReactNode } from "react";

export type DataTableOption = {
  label: string;
  value: string | number | boolean;
};

export type DataTableColumn<T> = {
  key: string;
  header: string;
  width?: string;
  minWidth?: string;
  align?: "left" | "center" | "right";
  sticky?: "left" | "right";
  editable?: boolean | ((row: T) => boolean);
  inputType?: "text" | "number" | "select";
  options?: DataTableOption[];
  placeholder?: string;
  emptyValue?: ReactNode;
  getValue?: (row: T) => unknown;
  parseValue?: (rawValue: string) => unknown;
  render?: (row: T, rowIndex: number) => ReactNode;
  renderEditor?: (args: {
    row: T;
    rowIndex: number;
    value: unknown;
    onChange: (value: unknown) => void;
  }) => ReactNode;
};

export type DataTablePaginationConfig = {
  mode?: "client" | "server";
  page: number;
  pageSize: number;
  total: number;
  pageSizeOptions?: number[];
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
};
