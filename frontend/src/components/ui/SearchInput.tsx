"use client";

import { Search } from "lucide-react";
import type { InputHTMLAttributes } from "react";

export function SearchInput({ className = "", placeholder = "Search…", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  const accessibleLabel = props["aria-label"] ?? (typeof placeholder === "string" ? placeholder.replace(/[…\.]+$/, "") : "Search");

  return (
    <label className={`ui-search-input ${className}`.trim()}>
      <Search size={16} aria-hidden="true" />
      <input
        type="search"
        name="search"
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        aria-label={accessibleLabel}
        {...props}
      />
    </label>
  );
}
