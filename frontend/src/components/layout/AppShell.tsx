"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { clearSession, getToken } from "@/lib/api";
import { getCurrentUser } from "@/features/auth/api/auth.api";
import type { User } from "@/features/auth/types";
import { AuthSessionProvider } from "@/features/auth/context/AuthSessionContext";
import { getNavigationByPathname } from "@/config/navigation";
import { setWorkspaceCacheSession } from "@/lib/workspace-cache";
import { AccessDenied } from "./AccessDenied";
import { ScreenLoader } from "./ScreenLoader";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { WorkspaceTabs } from "./WorkspaceTabs";
import { useWorkspaceTabs } from "./useWorkspaceTabs";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const prefetchedRoutes = useRef(new Set<string>());

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }

    getCurrentUser()
      .then((nextUser) => {
        setWorkspaceCacheSession(nextUser.id);
        setUser(nextUser);
      })
      .catch(() => {
        clearSession();
        router.replace("/login");
      });
  }, [router]);

  useEffect(() => {
    if (!mobileOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMobileOpen(false);
    }

    function onBreakpointChange(event: MediaQueryListEvent) {
      if (!event.matches) setMobileOpen(false);
    }

    const compactLayout = window.matchMedia("(max-width: 1199px)");
    document.addEventListener("keydown", onKeyDown);
    compactLayout.addEventListener("change", onBreakpointChange);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      compactLayout.removeEventListener("change", onBreakpointChange);
    };
  }, [mobileOpen]);

  const routeDenied = useMemo(() => {
    if (!user) return false;
    const item = getNavigationByPathname(pathname);
    if (!item?.enabled) return false;
    return !(user.menuCodes ?? []).includes(item.menuCode);
  }, [pathname, user]);

  const workspaceTabs = useWorkspaceTabs(user?.id ?? null, user?.menuCodes ?? [], pathname);

  useEffect(() => {
    for (const tab of workspaceTabs.tabs) {
      if (prefetchedRoutes.current.has(tab.route)) continue;
      prefetchedRoutes.current.add(tab.route);
      router.prefetch(tab.route);
    }
  }, [router, workspaceTabs.tabs]);

  function logout() {
    clearSession();
    router.replace("/login");
  }

  function closeWorkspaceTab(route: string) {
    const nextRoute = workspaceTabs.closeTab(route);
    if (nextRoute) router.push(nextRoute);
  }

  if (!user) return <ScreenLoader />;

  return (
    <AuthSessionProvider user={user}>
    <div className="app-shell">
      <Sidebar
        pathname={pathname}
        mobileOpen={mobileOpen}
        allowedMenuCodes={user.menuCodes ?? []}
        onClose={() => setMobileOpen(false)}
      />

      {mobileOpen ? (
        <button
          className="sidebar-backdrop"
          onClick={() => setMobileOpen(false)}
          aria-label="Close menu"
        />
      ) : null}

      <main className="main-area" id="main-content" tabIndex={-1}>
        <Topbar
          pathname={pathname}
          user={user}
          menuOpen={mobileOpen}
          onMenuOpen={() => setMobileOpen(true)}
          onLogout={logout}
        />
        <WorkspaceTabs
          tabs={workspaceTabs.tabs}
          activeRoute={workspaceTabs.activeRoute}
          onActivate={(route) => router.push(route)}
          onClose={closeWorkspaceTab}
        />
        <div className="page-stage">{routeDenied ? <AccessDenied /> : children}</div>
      </main>
    </div>
    </AuthSessionProvider>
  );
}
