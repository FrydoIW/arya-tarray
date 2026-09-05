"use client";

import { LogOut, Menu } from "lucide-react";
import type { User } from "@/features/auth/types";
import { getNavigationTitle } from "@/config/navigation";

interface TopbarProps {
  pathname: string;
  user: User;
  menuOpen: boolean;
  onMenuOpen: () => void;
  onLogout: () => void;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "AT";
}

export function Topbar({ pathname, user, menuOpen, onMenuOpen, onLogout }: TopbarProps) {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="topbar-leading">
          <button
            className="mobile-menu-button"
            type="button"
            onClick={onMenuOpen}
            aria-label="Open navigation"
            aria-controls="app-sidebar"
            aria-expanded={menuOpen}
          >
            <Menu size={19} aria-hidden="true" />
          </button>
          <div className="topbar-page-title">{getNavigationTitle(pathname)}</div>
        </div>

        <div className="topbar-actions">
          <div className="user-chip">
            <div className="user-avatar" aria-hidden="true">{initials(user.fullName)}</div>
            <div className="user-copy">
              <strong>{user.fullName}</strong>
              <span>{user.roleCode.replaceAll("_", " ").toLowerCase()}</span>
            </div>
          </div>

          <button className="icon-button" onClick={onLogout} title="Sign out" aria-label="Sign out">
            <LogOut size={18} aria-hidden="true" />
          </button>
        </div>
      </div>
    </header>
  );
}
