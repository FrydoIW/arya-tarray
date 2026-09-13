"use client";

import { ChevronRight, LayoutGrid, LogOut, Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { User } from "@/features/auth/types";
import { getNavigationTitle } from "@/config/navigation";

interface TopbarProps {
  pathname: string;
  user: User;
  menuOpen: boolean;
  sidebarCollapsed: boolean;
  onSidebarToggle: () => void;
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

export function Topbar({
  pathname,
  user,
  menuOpen,
  sidebarCollapsed,
  onSidebarToggle,
  onMenuOpen,
  onLogout
}: TopbarProps) {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="topbar-leading">
          <button
            className="icon-button desktop-sidebar-toggle"
            type="button"
            onClick={onSidebarToggle}
            aria-label={sidebarCollapsed ? "Perluas sidebar" : "Perkecil sidebar"}
            title={sidebarCollapsed ? "Perluas sidebar" : "Perkecil sidebar"}
            aria-pressed={sidebarCollapsed}
            aria-controls="app-sidebar"
          >
            {sidebarCollapsed ? <PanelLeftOpen size={18} aria-hidden="true" /> : <PanelLeftClose size={18} aria-hidden="true" />}
          </button>
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
          <div className="topbar-breadcrumb">
            <LayoutGrid size={16} aria-hidden="true" />
            <span>Workspace</span>
            <ChevronRight size={13} aria-hidden="true" />
            <div className="topbar-page-title">{getNavigationTitle(pathname)}</div>
          </div>
        </div>

        <div className="topbar-actions">
          <span className="topbar-workspace-label">Yayasan Arya Tarray Nusantara</span>
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
