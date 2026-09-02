"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Select } from "@/components/ui/Select";
import type { DataTablePaginationConfig } from "./types";

export function DataTablePagination({
  page,
  pageSize,
  total,
  pageSizeOptions = [10, 25, 50],
  onPageChange,
  onPageSizeChange
}: DataTablePaginationConfig) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(page, 1), pageCount);
  const start = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const end = Math.min(total, safePage * pageSize);

  return (
    <div className="ui-data-table-footer">
      <span className="ui-data-table-count">Showing {start}–{end} of {total} entries</span>
      <div className="ui-data-table-pagination">
        <button type="button" onClick={() => onPageChange(safePage - 1)} disabled={safePage <= 1} aria-label="Previous page">
          <ChevronLeft size={15} />
        </button>
        <span className="ui-data-table-page" aria-label={`Page ${safePage} of ${pageCount}`}>{safePage}<span className="ui-data-table-page-total">/{pageCount}</span></span>
        <button type="button" onClick={() => onPageChange(safePage + 1)} disabled={safePage >= pageCount} aria-label="Next page">
          <ChevronRight size={15} />
        </button>
        {onPageSizeChange ? (
          <Select
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            aria-label="Rows per page"
            className="ui-page-size-select"
          >
            {pageSizeOptions.map((option) => <option key={option} value={option}>{option} / page</option>)}
          </Select>
        ) : null}
      </div>
    </div>
  );
}
