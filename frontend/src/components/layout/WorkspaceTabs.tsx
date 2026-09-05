"use client";

import { X } from "lucide-react";
import type { WorkspaceTab } from "./useWorkspaceTabs";

interface WorkspaceTabsProps {
  tabs: WorkspaceTab[];
  activeRoute: string | null;
  onActivate: (route: string) => void;
  onClose: (route: string) => void;
}

export function WorkspaceTabs({ tabs, activeRoute, onActivate, onClose }: WorkspaceTabsProps) {
  if (tabs.length === 0) return null;

  return (
    <nav className="workspace-tabs" aria-label="Open workspace pages">
      <div className="workspace-tabs-inner" role="tablist" aria-label="Workspace tabs">
        {tabs.map((tab) => {
          const active = tab.route === activeRoute;

          return (
            <div className={`workspace-tab ${active ? "active" : ""}`} key={tab.route}>
              <button
                className="workspace-tab-activate"
                type="button"
                role="tab"
                aria-selected={active}
                title={tab.label}
                onClick={() => onActivate(tab.route)}
              >
                <span>{tab.label}</span>
              </button>
              <button
                className="workspace-tab-close"
                type="button"
                aria-label={`Close ${tab.label} tab`}
                title={`Close ${tab.label}`}
                onClick={() => onClose(tab.route)}
              >
                <X size={13} aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </nav>
  );
}
