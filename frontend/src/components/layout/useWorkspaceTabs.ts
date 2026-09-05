"use client";

import { useEffect, useMemo, useState } from "react";
import { getDefaultNavigationPath, getNavigationByPathname, navigation } from "@/config/navigation";

const WORKSPACE_TABS_KEY = "arya_workspace_tabs";

export type WorkspaceTab = {
  route: string;
  label: string;
  menuCode: string;
};

function availablePages(allowedMenuCodes: Set<string>) {
  return navigation.flatMap((group) => group.children).filter((page) =>
    page.enabled && page.href && allowedMenuCodes.has(page.menuCode)
  );
}

function storedTabs(allowedMenuCodes: Set<string>): WorkspaceTab[] {
  try {
    const raw = window.sessionStorage.getItem(WORKSPACE_TABS_KEY);
    if (!raw) return [];

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const pages = availablePages(allowedMenuCodes);
    const restored: WorkspaceTab[] = [];

    for (const value of parsed) {
      if (!value || typeof value !== "object") continue;
      const candidate = value as Record<string, unknown>;
      if (typeof candidate.menuCode !== "string" || typeof candidate.route !== "string") continue;

      const page = pages.find((item) => item.menuCode === candidate.menuCode && item.href === candidate.route);
      if (!page?.href || restored.some((tab) => tab.route === page.href)) continue;

      restored.push({ route: page.href, label: page.label, menuCode: page.menuCode });
    }

    return restored;
  } catch {
    return [];
  }
}

export function clearWorkspaceTabsSession() {
  if (typeof window !== "undefined") window.sessionStorage.removeItem(WORKSPACE_TABS_KEY);
}

export function useWorkspaceTabs(userId: string | null, menuCodes: string[], pathname: string) {
  const permissionKey = [...menuCodes].sort().join("|");
  const allowedMenuCodes = useMemo(
    () => new Set(permissionKey ? permissionKey.split("|") : []),
    [permissionKey]
  );
  const [tabs, setTabs] = useState<WorkspaceTab[]>([]);
  const [readyForUser, setReadyForUser] = useState<string | null>(null);

  const currentTab = useMemo(() => {
    const currentPage = getNavigationByPathname(pathname);
    return currentPage?.enabled && currentPage.href && allowedMenuCodes.has(currentPage.menuCode)
      ? { route: currentPage.href, label: currentPage.label, menuCode: currentPage.menuCode }
      : null;
  }, [allowedMenuCodes, pathname]);

  useEffect(() => {
    if (!userId) {
      setTabs([]);
      setReadyForUser(null);
      return;
    }

    const restored = storedTabs(allowedMenuCodes);
    setTabs(restored);
    setReadyForUser(userId);
  }, [allowedMenuCodes, userId]);

  useEffect(() => {
    if (!userId || readyForUser !== userId || !currentTab) return;
    setTabs((current) => current.some((tab) => tab.route === currentTab.route)
      ? current
      : [...current, currentTab]);
  }, [currentTab, readyForUser, userId]);

  useEffect(() => {
    if (!userId || readyForUser !== userId) return;
    window.sessionStorage.setItem(WORKSPACE_TABS_KEY, JSON.stringify(tabs));
  }, [readyForUser, tabs, userId]);

  function closeTab(route: string) {
    const index = tabs.findIndex((tab) => tab.route === route);
    if (index < 0) return null;

    const remaining = tabs.filter((tab) => tab.route !== route);
    setTabs(remaining);

    if (remaining.length === 0) return getDefaultNavigationPath(menuCodes);
    if (currentTab?.route !== route) return null;
    return remaining[index]?.route
      ?? remaining[index - 1]?.route
      ?? getDefaultNavigationPath(menuCodes);
  }

  return {
    tabs,
    activeRoute: currentTab?.route ?? null,
    closeTab
  };
}
