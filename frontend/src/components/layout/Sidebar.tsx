"use client";

import Link from "next/link";
import { ChevronUp, Flower2, ShieldCheck, X } from "lucide-react";
import { navigation } from "@/config/navigation";

interface SidebarProps {
  pathname: string;
  mobileOpen: boolean;
  allowedMenuCodes: string[];
  onClose: () => void;
}

export function Sidebar({ pathname, mobileOpen, allowedMenuCodes, onClose }: SidebarProps) {
  const allowed = new Set(allowedMenuCodes);

  return (
    <aside id="app-sidebar" className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`} aria-label="Application navigation">
      <div className="brand-row">
        <div className="brand-seal" aria-hidden="true"><Flower2 size={27} /></div>
        <div className="brand-copy">
          <strong>Arya Tarray</strong>
          <span>NUSANTARA</span>
        </div>
        <button id="app-sidebar-close" className="sidebar-close" onClick={onClose} aria-label="Close menu"><X size={18} aria-hidden="true" /></button>
      </div>

      <div className="sidebar-rule" />

      <nav className="nav-list" aria-label="Primary navigation">
        <span className="nav-section-label">Workspace</span>

        {navigation.map((group) => {
          const GroupIcon = group.icon;
          const visibleChildren = group.children.filter((child) => !child.enabled || allowed.has(child.menuCode));
          if (visibleChildren.length === 0) return null;

          return (
            <section className="nav-group" key={group.menuCode}>
              <div className="nav-group-label">
                <GroupIcon size={17} aria-hidden="true" />
                <span>{group.label}</span>
                <ChevronUp size={14} aria-hidden="true" />
              </div>

              <div className="nav-children">
                {visibleChildren.map((child) => {
                  const ChildIcon = child.icon;
                  const active = Boolean(child.href && pathname === child.href);

                  return (
                    <Link
                      key={child.menuCode}
                      href={child.href ?? "#"}
                      aria-disabled={!child.enabled}
                      tabIndex={child.enabled ? 0 : -1}
                      onClick={(event) => {
                        if (!child.enabled) {
                          event.preventDefault();
                          return;
                        }
                        onClose();
                      }}
                      className={`nav-child ${active ? "active" : ""} ${!child.enabled ? "nav-child-disabled" : ""}`}
                      title={!child.enabled ? "Feature belum dibuka pada fase ini" : undefined}
                    >
                      <ChildIcon size={15} aria-hidden="true" />
                      <span>{child.label}</span>
                    </Link>
                  );
                })}
              </div>
            </section>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <span className="sidebar-footer-icon"><ShieldCheck size={17} /></span>
        <div><strong>Internal Workspace</strong><span>Authorized access only</span></div>
      </div>
    </aside>
  );
}
