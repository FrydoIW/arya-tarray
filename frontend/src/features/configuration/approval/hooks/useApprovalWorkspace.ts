"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { executeApprovalWorkspace, getApprovalWorkspace } from "../api/approval.api";
import type {
  ApprovalConfiguration,
  ApprovalStatusFilter
} from "../types";
import {
  buildApprovalWorkspacePayload,
  configurationsAreDirty,
  filterConfigurations,
  resolveApprovers,
  summarizeConfigurations,
  SUPPORTED_APPROVAL_MENU_CODE,
  validateApprovalWorkspace
} from "../utils/approval-workspace.utils";

export function useApprovalWorkspace() {
  const [serverConfigurations, setServerConfigurations] = useState<ApprovalConfiguration[]>([]);
  const [workingConfigurations, setWorkingConfigurations] = useState<ApprovalConfiguration[]>([]);
  const [menus, setMenus] = useState<Awaited<ReturnType<typeof getApprovalWorkspace>>["menus"]>([]);
  const [approverUsers, setApproverUsers] = useState<Awaited<ReturnType<typeof getApprovalWorkspace>>["approverUsers"]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ApprovalStatusFilter>("ALL");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const applyWorkspace = useCallback((workspace: Awaited<ReturnType<typeof getApprovalWorkspace>>) => {
    setServerConfigurations(workspace.configurations);
    setWorkingConfigurations(workspace.configurations);
    setMenus(workspace.menus);
    setApproverUsers(workspace.approverUsers);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const workspace = await getApprovalWorkspace();
      applyWorkspace(workspace);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Approval workspace");
      return false;
    } finally {
      setLoading(false);
    }
  }, [applyWorkspace]);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredConfigurations = useMemo(
    () => filterConfigurations(workingConfigurations, search, statusFilter),
    [search, statusFilter, workingConfigurations]
  );

  const summary = useMemo(
    () => summarizeConfigurations(workingConfigurations),
    [workingConfigurations]
  );

  const dirty = useMemo(
    () => configurationsAreDirty(serverConfigurations, workingConfigurations),
    [serverConfigurations, workingConfigurations]
  );

  const configuredMenuIds = useMemo(
    () => new Set(workingConfigurations.map((item) => item.menu.id)),
    [workingConfigurations]
  );

  const availableMenus = useMemo(
    () => menus.filter((menu) => menu.activeFlag && !configuredMenuIds.has(menu.id)),
    [configuredMenuIds, menus]
  );

  const approvalTarget = useMemo(
    () => menus.find((menu) => menu.menuCode === SUPPORTED_APPROVAL_MENU_CODE)?.menuName
      ?? workingConfigurations.find((item) => item.menu.menuCode === SUPPORTED_APPROVAL_MENU_CODE)?.menu.menuName
      ?? "Not Available",
    [menus, workingConfigurations]
  );

  async function refresh() {
    setMessage("");
    const success = await load();
    if (success) setMessage("Approval workspace reloaded from database.");
    return success;
  }

  function clearChanges() {
    setWorkingConfigurations(serverConfigurations);
    setError("");
    setMessage("Unsaved changes cleared.");
  }

  function addDraft(input: { menuId: string; approverUserIds: string[]; activeFlag: boolean }) {
    const menu = menus.find((item) => item.id === input.menuId);
    if (!menu) return false;

    setWorkingConfigurations((current) => [...current, {
      id: `draft-approval-${crypto.randomUUID()}`,
      menu,
      approvers: resolveApprovers(input.approverUserIds, approverUsers),
      activeFlag: input.activeFlag,
      updatedBy: null,
      isDraft: true
    }]);
    setError("");
    setMessage("Approval Configuration added to local workspace. Execute to save.");
    return true;
  }

  function updateConfiguration(
    id: string,
    input: { menuId?: string; approverUserIds?: string[]; activeFlag?: boolean }
  ) {
    setWorkingConfigurations((current) => current.map((item) => {
      if (item.id !== id) return item;
      const nextMenu = item.isDraft && input.menuId
        ? menus.find((menu) => menu.id === input.menuId) ?? item.menu
        : item.menu;
      return {
        ...item,
        menu: nextMenu,
        approvers: input.approverUserIds
          ? resolveApprovers(input.approverUserIds, approverUsers, item.approvers)
          : item.approvers,
        activeFlag: input.activeFlag ?? item.activeFlag
      };
    }));
    setError("");
    setMessage("");
  }

  function removeDraft(id: string) {
    setWorkingConfigurations((current) => current.filter((item) => item.id !== id || !item.isDraft));
    setError("");
    setMessage("Draft Approval Configuration removed.");
  }

  async function executeChanges() {
    const validation = validateApprovalWorkspace({
      serverRows: serverConfigurations,
      workingRows: workingConfigurations,
      eligibleUsers: approverUsers
    });
    if (validation) {
      setError(validation);
      setMessage("");
      return false;
    }

    if (!dirty) {
      setError("");
      setMessage("No changes to execute.");
      return true;
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const payload = buildApprovalWorkspacePayload({
        serverRows: serverConfigurations,
        workingRows: workingConfigurations
      });
      const result = await executeApprovalWorkspace(payload);
      applyWorkspace(result);
      setMessage(`${result.changedCount} Approval Configuration change${result.changedCount === 1 ? "" : "s"} successfully executed.`);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to execute Approval workspace changes");
      return false;
    } finally {
      setSaving(false);
    }
  }

  return {
    configurations: filteredConfigurations,
    allConfigurations: workingConfigurations,
    menus,
    availableMenus,
    approverUsers,
    approvalTarget,
    summary,
    search,
    setSearch,
    statusFilter,
    setStatusFilter,
    dirty,
    loading,
    saving,
    error,
    message,
    refresh,
    clearChanges,
    addDraft,
    updateConfiguration,
    removeDraft,
    executeChanges
  };
}
