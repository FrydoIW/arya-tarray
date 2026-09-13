"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ChevronDown, ShieldCheck, X } from "lucide-react";
import { navigation } from "@/config/navigation";
import aryaLogo from "@/assets/brand/arya-buddha-white-gold.svg";

interface SidebarProps {
  pathname: string;
  mobileOpen: boolean;
  allowedMenuCodes: string[];
  onClose: () => void;
}

export function Sidebar({ pathname, mobileOpen, allowedMenuCodes, onClose }: SidebarProps) {
  const allowed = new Set(allowedMenuCodes);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({ MONITORING: true });

  return (
    <aside id="app-sidebar" className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`} aria-label="Application navigation">
      <div className="brand-row">
        <div className="brand-mark" aria-hidden="true">
          <Image src={aryaLogo} alt="" width={184} height={188} className="brand-mark-image" unoptimized priority />
        </div>

        <div className="brand-copy">
          <strong>Arya Tarray</strong>
          <span>NUSANTARA</span>
        </div>

        <button id="app-sidebar-close" className="sidebar-close" onClick={onClose} aria-label="Close menu">
          <X size={18} aria-hidden="true" />
        </button>
      </div>

      <div className="sidebar-rule" />

      <nav className="nav-list" aria-label="Primary navigation">
        <span className="nav-section-label">Your workspace</span>

        {navigation.map((group) => {
          const GroupIcon = group.icon;
          const visibleChildren = group.children.filter((child) => !child.enabled || allowed.has(child.menuCode));
          if (visibleChildren.length === 0) return null;
          const expanded = expandedGroups[group.menuCode] ?? false;
          const groupActive = visibleChildren.some((child) => child.href && (pathname === child.href || pathname.startsWith(`${child.href}/`)));
          const childrenId = `nav-group-${group.menuCode.toLowerCase().replaceAll("_", "-")}`;

          return (
            <section className={`nav-group${groupActive ? " nav-group-current" : ""}`} key={group.menuCode}>
              <button
                className="nav-group-label"
                type="button"
                aria-expanded={expanded}
                aria-controls={childrenId}
                title={group.label}
                onClick={() => setExpandedGroups((current) => ({
                  ...current,
                  [group.menuCode]: !(current[group.menuCode] ?? false)
                }))}
              >
                <GroupIcon size={17} aria-hidden="true" />
                <span>{group.label}</span>
                <ChevronDown className="nav-group-chevron" size={14} aria-hidden="true" />
              </button>

              <div className="nav-children-reveal" data-expanded={expanded} inert={!expanded}>
                <div className="nav-children" id={childrenId}>
                  {visibleChildren.map((child) => {
                    const ChildIcon = child.icon;
                    const active = Boolean(child.href && (pathname === child.href || pathname.startsWith(`${child.href}/`)));
  
                    return (
                      <Link
                        key={child.menuCode}
                        href={child.href ?? "#"}
                        aria-disabled={!child.enabled}
                        aria-current={active ? "page" : undefined}
                        tabIndex={child.enabled ? 0 : -1}
                        onClick={(event) => {
                          if (!child.enabled) {
                            event.preventDefault();
                            return;
                          }
                          onClose();
                        }}
                        className={`nav-child ${active ? "active" : ""} ${!child.enabled ? "nav-child-disabled" : ""}`}
                        title={!child.enabled ? `${child.label} · Feature belum dibuka pada fase ini` : child.label}
                      >
                        <ChildIcon size={15} aria-hidden="true" />
                        <span>{child.label}</span>
                      </Link>
                    );
                  })}
                </div>
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
