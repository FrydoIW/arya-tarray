"use client";

import { ChevronDown } from "lucide-react";
import type { SelectHTMLAttributes } from "react";

export function Select({ className = "", children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className={`ui-select ${className}`.trim()}>
      <select name="selection" autoComplete="off" aria-label={props["aria-label"] ?? "Select option"} {...props}>{children}</select>
      <ChevronDown size={14} aria-hidden="true" />
    </label>
  );
}
