"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isAbortError } from "@/lib/api";
import { getWorkspaceCache, invalidateWorkspaceCache, readWorkspace, setWorkspaceCache } from "@/lib/workspace-cache";
import { executeRoleWorkspace, getRoleWorkspace } from "../api/role.api";
import type {
  MatrixMode,
  MenuRegistryItem,
  MenuStatusFilter,
  MenuTypeFilter,
  Role,
  RoleStatusFilter
} from "../types";
import {
  accessIsDirty,
  buildRoleWorkspacePayload,
  filterMenus,
  filterRoles,
  menusAreDirty,
  roleMenuKey,
  rolesAreDirty,
  summarizeMenus,
  summarizeRoles,
  validateMenus,
  validateRoles,
  withAssignedRoleCounts
} from "../utils/role-workspace.utils";

export function useRoleWorkspace() {
  const cacheKey = "configuration/roles/workspace";
  const initialWorkspace = getWorkspaceCache<Awaited<ReturnType<typeof getRoleWorkspace>>>(cacheKey)?.value;
  const [serverRoles, setServerRoles] = useState<Role[]>(initialWorkspace?.roles ?? []);
  const [workingRoles, setWorkingRoles] = useState<Role[]>(initialWorkspace?.roles ?? []);
  const [deletedRoleIds, setDeletedRoleIds] = useState<string[]>([]);

  const [serverMenus, setServerMenus] = useState<MenuRegistryItem[]>(initialWorkspace?.menus ?? []);
  const [workingMenus, setWorkingMenus] = useState<MenuRegistryItem[]>(initialWorkspace?.menus ?? []);
  const [deletedMenuIds, setDeletedMenuIds] = useState<string[]>([]);

  const initialAccess = new Set(initialWorkspace?.roleMenus.map((item) => roleMenuKey(item.roleId, item.menuId)) ?? []);
  const [serverAccess, setServerAccess] = useState<Set<string>>(initialAccess);
  const [workingAccess, setWorkingAccess] = useState<Set<string>>(new Set(initialAccess));

  const [roleSearch, setRoleSearch] = useState("");
  const [roleStatusFilter, setRoleStatusFilter] = useState<RoleStatusFilter>("ALL");
  const [menuSearch, setMenuSearch] = useState("");
  const [menuStatusFilter, setMenuStatusFilter] = useState<MenuStatusFilter>("ALL");
  const [menuTypeFilter, setMenuTypeFilter] = useState<MenuTypeFilter>("ALL");
  const [matrixMode, setMatrixMode] = useState<MatrixMode>("INQUIRY");

  const [loading, setLoading] = useState(!initialWorkspace);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const requestRef = useRef<AbortController | null>(null);

  const applyWorkspace = useCallback((workspace: Awaited<ReturnType<typeof getRoleWorkspace>>) => {
    setServerRoles(workspace.roles);
    setWorkingRoles(workspace.roles);
    setDeletedRoleIds([]);
    setServerMenus(workspace.menus);
    setWorkingMenus(workspace.menus);
    setDeletedMenuIds([]);
    const nextAccess = new Set(workspace.roleMenus.map((item) => roleMenuKey(item.roleId, item.menuId)));
    setServerAccess(nextAccess);
    setWorkingAccess(new Set(nextAccess));
  }, [cacheKey]);

  const load = useCallback(async (force = false, consumerSignal?: AbortSignal) => {
    const ownedController = consumerSignal ? null : new AbortController();
    if (ownedController) {
      requestRef.current?.abort();
      requestRef.current = ownedController;
    }
    const signal = consumerSignal ?? ownedController!.signal;
    const read = readWorkspace(cacheKey, getRoleWorkspace, { force });
    if (read.cached) applyWorkspace(read.cached);
    if (!read.promise) {
      if (requestRef.current === ownedController) requestRef.current = null;
      setLoading(false);
      return true;
    }
    setLoading(!read.cached || force);
    setError("");
    const release = read.release;
    signal.addEventListener("abort", release, { once: true });
    try {
      const workspace = await read.promise;
      if (signal.aborted) return false;
      applyWorkspace(workspace);
      return true;
    } catch (err) {
      if (isAbortError(err) || signal.aborted) return false;
      setError(err instanceof Error ? err.message : "Failed to load role workspace");
      return false;
    } finally {
      signal.removeEventListener("abort", release);
      release();
      if (requestRef.current === ownedController) requestRef.current = null;
      if (!signal.aborted) setLoading(false);
    }
  }, [applyWorkspace]);

  useEffect(() => {
    const controller = new AbortController();
    void load(false, controller.signal);
    return () => { controller.abort(); requestRef.current?.abort(); };
  }, [load]);

  const filteredRoles = useMemo(
    () => filterRoles(workingRoles, roleSearch, roleStatusFilter),
    [roleSearch, roleStatusFilter, workingRoles]
  );

  const viewMenus = useMemo(
    () => withAssignedRoleCounts(workingMenus, workingRoles, workingAccess),
    [workingAccess, workingMenus, workingRoles]
  );

  const filteredMenus = useMemo(
    () => filterMenus(viewMenus, workingMenus, menuSearch, menuStatusFilter, menuTypeFilter),
    [menuSearch, menuStatusFilter, menuTypeFilter, viewMenus, workingMenus]
  );

  const roleSummary = useMemo(() => summarizeRoles(workingRoles), [workingRoles]);
  const menuSummary = useMemo(() => summarizeMenus(workingMenus), [workingMenus]);

  const rolesDirty = useMemo(
    () => rolesAreDirty(serverRoles, workingRoles, deletedRoleIds),
    [deletedRoleIds, serverRoles, workingRoles]
  );

  const menusDirty = useMemo(
    () => menusAreDirty(serverMenus, workingMenus, deletedMenuIds),
    [deletedMenuIds, serverMenus, workingMenus]
  );

  const accessDirty = useMemo(
    () => accessIsDirty(serverAccess, workingAccess),
    [serverAccess, workingAccess]
  );

  const dirty = rolesDirty || menusDirty || accessDirty;

  async function refresh() {
    setMessage("");
    const success = await load(true);
    if (success) setMessage("Role workspace reloaded from database.");
    return success;
  }

  function clearChanges() {
    setWorkingRoles(serverRoles);
    setDeletedRoleIds([]);
    setWorkingMenus(serverMenus);
    setDeletedMenuIds([]);
    setWorkingAccess(new Set(serverAccess));
    setMessage("Unsaved changes cleared.");
    setError("");
  }

  function updateRoleCell(id: string, field: string, value: unknown) {
    setMessage("");
    setError("");
    setWorkingRoles((current) => current.map((item) => {
      if (item.id !== id) return item;
      if (field === "roleCode") {
        if (!item.isDraft) return item;
        return { ...item, roleCode: String(value).toUpperCase().replace(/[^A-Z0-9_]/g, "").slice(0, 50) };
      }
      if (field === "roleName") return { ...item, roleName: String(value) };
      if (field === "description") return { ...item, description: String(value) };
      if (field === "activeFlag") return { ...item, activeFlag: Boolean(value) };
      return item;
    }));
  }

  function addRoleDraft() {
    const id = `draft-role-${crypto.randomUUID()}`;
    setMessage("");
    setError("");
    setWorkingRoles((current) => [...current, {
      id,
      roleCode: "",
      roleName: "",
      description: "",
      activeFlag: true,
      assignedUsers: 0,
      updatedBy: null,
      isDraft: true
    }]);
    return id;
  }

  function removeRole(id: string) {
    const target = workingRoles.find((item) => item.id === id);
    if (!target) return;
    if (!target.isDraft && target.assignedUsers > 0) {
      setError(`Role ${target.roleCode} masih dipakai ${target.assignedUsers} user. Ubah menjadi Inactive jika tidak ingin digunakan lagi.`);
      setMessage("");
      return;
    }

    setWorkingRoles((current) => current.filter((item) => item.id !== id));
    setWorkingAccess((current) => {
      const next = new Set(current);
      for (const key of next) if (key.startsWith(`${id}:`)) next.delete(key);
      return next;
    });

    if (target.isDraft) {
      setMessage("Draft Role removed.");
    } else {
      setDeletedRoleIds((ids) => ids.includes(id) ? ids : [...ids, id]);
      setMessage(`Role ${target.roleCode} marked for deletion. Execute to save or Clear to restore.`);
    }
    setError("");
  }

  function updateMenuCell(id: string, field: string, value: unknown) {
    setMessage("");
    setError("");
    setWorkingMenus((current) => current.map((item) => {
      if (item.id !== id) return item;
      if (field === "menuCode") {
        if (!item.isDraft) return item;
        return { ...item, menuCode: String(value).toUpperCase().replace(/[^A-Z0-9_]/g, "").slice(0, 100) };
      }
      if (field === "menuName") return { ...item, menuName: String(value) };
      if (field === "route") {
        if (!item.isDraft || item.menuType === "GROUP") return item;
        return { ...item, route: String(value) };
      }
      if (field === "menuType") {
        if (!item.isDraft) return item;
        const nextType = value === "GROUP" ? "GROUP" : "PAGE";
        const firstGroup = current.find((menu) => menu.id !== item.id && menu.menuType === "GROUP");
        return {
          ...item,
          menuType: nextType,
          parentMenuId: nextType === "GROUP" ? null : item.parentMenuId ?? firstGroup?.id ?? null,
          route: nextType === "GROUP" ? null : item.route ?? ""
        };
      }
      if (field === "parentMenuId") {
        if (item.menuType === "GROUP") return item;
        return { ...item, parentMenuId: value ? String(value) : null };
      }
      if (field === "displayOrder") return { ...item, displayOrder: Math.max(0, Number(value) || 0) };
      if (field === "activeFlag") return { ...item, activeFlag: Boolean(value) };
      return item;
    }));
  }

  function addMenuDraft() {
    const id = `draft-menu-${crypto.randomUUID()}`;
    const existingGroups = workingMenus.filter((item) => item.menuType === "GROUP");
    const defaultType = existingGroups.length > 0 ? "PAGE" : "GROUP";
    const nextOrder = workingMenus.reduce((max, item) => Math.max(max, item.displayOrder), 0) + 10;
    setMessage("");
    setError("");
    setWorkingMenus((current) => [...current, {
      id,
      parentMenuId: defaultType === "PAGE" ? existingGroups[0]?.id ?? null : null,
      parentMenu: null,
      menuCode: "",
      menuName: "",
      route: defaultType === "PAGE" ? "" : null,
      menuType: defaultType,
      displayOrder: nextOrder,
      activeFlag: true,
      childCount: 0,
      assignedRoles: 0,
      updatedBy: null,
      isDraft: true
    }]);
    return id;
  }

  function removeMenu(id: string) {
    const target = workingMenus.find((item) => item.id === id);
    if (!target) return;
    const remainingChild = workingMenus.find((item) => item.parentMenuId === id && item.id !== id);
    if (target.menuType === "GROUP" && remainingChild) {
      setError(`Group ${target.menuName || target.menuCode} masih memiliki child menu ${remainingChild.menuName || remainingChild.menuCode}. Hapus atau pindahkan child menu terlebih dahulu.`);
      setMessage("");
      return;
    }

    setWorkingMenus((current) => current.filter((item) => item.id !== id));
    setWorkingAccess((current) => {
      const next = new Set(current);
      for (const key of next) if (key.endsWith(`:${id}`)) next.delete(key);
      return next;
    });

    if (target.isDraft) {
      setMessage("Draft Menu removed.");
    } else {
      setDeletedMenuIds((ids) => ids.includes(id) ? ids : [...ids, id]);
      setMessage(`Menu ${target.menuCode} marked for deletion. Execute to save or Clear to restore.`);
    }
    setError("");
  }

  function toggleAccess(roleId: string, menuId: string) {
    if (matrixMode !== "EDIT") return;
    const role = workingRoles.find((item) => item.id === roleId);
    const menu = workingMenus.find((item) => item.id === menuId);
    if (!role || !menu || role.isDraft || menu.isDraft || menu.menuType !== "PAGE") return;

    setWorkingAccess((current) => {
      const next = new Set(current);
      const key = roleMenuKey(roleId, menuId);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setMessage("");
    setError("");
  }

  function hasAccess(roleId: string, menuId: string) {
    return workingAccess.has(roleMenuKey(roleId, menuId));
  }

  async function executeChanges() {
    const roleValidation = validateRoles(workingRoles);
    if (roleValidation) {
      setError(roleValidation);
      setMessage("");
      return false;
    }
    const menuValidation = validateMenus(workingMenus);
    if (menuValidation) {
      setError(menuValidation);
      setMessage("");
      return false;
    }
    if (!dirty) {
      setMessage("No changes to execute.");
      setError("");
      return true;
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const payload = buildRoleWorkspacePayload({
        serverRoles,
        workingRoles,
        deletedRoleIds,
        serverMenus,
        workingMenus,
        deletedMenuIds,
        workingAccess,
        includeRoleMenus: accessDirty
      });

      const result = await executeRoleWorkspace(payload);

      invalidateWorkspaceCache(cacheKey);
      invalidateWorkspaceCache("configuration/users/workspace");
      setWorkspaceCache(cacheKey, result);
      applyWorkspace(result);
      if (result.changedCount > 0 && accessDirty) {
        setMessage(`${result.changedCount} master change${result.changedCount === 1 ? "" : "s"} and access matrix updates successfully executed.`);
      } else if (result.changedCount > 0) {
        setMessage(`${result.changedCount} master change${result.changedCount === 1 ? "" : "s"} successfully executed.`);
      } else {
        setMessage("Access matrix changes successfully executed.");
      }
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to execute Role workspace changes");
      return false;
    } finally {
      setSaving(false);
    }
  }

  const persistedRoles = useMemo(() => workingRoles.filter((item) => !item.isDraft), [workingRoles]);
  const persistedMenus = useMemo(() => workingMenus.filter((item) => !item.isDraft), [workingMenus]);

  return {
    roles: filteredRoles,
    allRoles: workingRoles,
    persistedRoles,
    roleSummary,
    roleSearch,
    setRoleSearch,
    roleStatusFilter,
    setRoleStatusFilter,
    updateRoleCell,
    addRoleDraft,
    removeRole,

    menus: filteredMenus,
    allMenus: viewMenus,
    persistedMenus,
    menuSummary,
    menuSearch,
    setMenuSearch,
    menuStatusFilter,
    setMenuStatusFilter,
    menuTypeFilter,
    setMenuTypeFilter,
    updateMenuCell,
    addMenuDraft,
    removeMenu,

    matrixMode,
    setMatrixMode,
    hasAccess,
    toggleAccess,

    dirty,
    loading,
    saving,
    error,
    message,
    refresh,
    clearChanges,
    executeChanges
  };
}
