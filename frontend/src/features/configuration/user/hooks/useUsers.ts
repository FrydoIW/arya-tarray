"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isAbortError } from "@/lib/api";
import { getWorkspaceCache, invalidateWorkspaceCache, readWorkspace, setWorkspaceCache } from "@/lib/workspace-cache";
import { executeUserWorkspace, getUserWorkspace } from "../api/user.api";
import type {
  AddUserDraftInput,
  UserItem,
  UserMode,
  UserStatus,
  UserStatusFilter,
  UserWorkspace
} from "../types";
import {
  normalizeUserUpdate,
  sameUserUpdate,
  validateUsers
} from "../utils/user-workspace.utils";

const EMPTY_WORKSPACE: UserWorkspace = {
  users: [],
  roles: []
};
const USER_WORKSPACE_KEY = "configuration/users/workspace";

export function useUsers() {
  const initialWorkspace = getWorkspaceCache<UserWorkspace>(USER_WORKSPACE_KEY)?.value ?? EMPTY_WORKSPACE;
  const [serverWorkspace, setServerWorkspace] = useState<UserWorkspace>(initialWorkspace);
  const [workingUsers, setWorkingUsers] = useState<UserItem[]>(initialWorkspace.users);
  const [passwordResets, setPasswordResets] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<UserStatusFilter>("ALL");
  const [mode, setMode] = useState<UserMode>("INQUIRY");
  const [loading, setLoading] = useState(initialWorkspace === EMPTY_WORKSPACE);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const requestRef = useRef<AbortController | null>(null);

  const applyWorkspace = useCallback((workspace: UserWorkspace) => {
    setServerWorkspace(workspace);
    setWorkingUsers(workspace.users);
    setPasswordResets({});
    setMode("INQUIRY");
  }, []);

  const load = useCallback(async (force = false, consumerSignal?: AbortSignal) => {
    const ownedController = consumerSignal ? null : new AbortController();
    if (ownedController) {
      requestRef.current?.abort();
      requestRef.current = ownedController;
    }
    const signal = consumerSignal ?? ownedController!.signal;
    const read = readWorkspace(USER_WORKSPACE_KEY, getUserWorkspace, { force });
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
      setError(err instanceof Error ? err.message : "Failed to load users");
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

  const users = useMemo(() => {
    const query = search.trim().toLowerCase();

    return workingUsers.filter((item) => {
      const statusMatch = statusFilter === "ALL" || item.status === statusFilter;
      if (!statusMatch) return false;
      if (!query) return true;

      const role = serverWorkspace.roles.find((candidate) => candidate.id === item.roleId);

      return item.fullName.toLowerCase().includes(query)
        || item.email.toLowerCase().includes(query)
        || (role?.roleCode ?? item.role?.roleCode ?? "").toLowerCase().includes(query)
        || (role?.roleName ?? item.role?.roleName ?? "").toLowerCase().includes(query)
        || (item.updatedBy?.fullName ?? "").toLowerCase().includes(query);
    });
  }, [workingUsers, search, statusFilter, serverWorkspace.roles]);

  const summary = useMemo(() => {
    const assignedRoleIds = new Set(workingUsers.map((item) => item.roleId).filter(Boolean));

    return {
      total: workingUsers.length,
      active: workingUsers.filter((item) => item.status === "ACTIVE").length,
      inactive: workingUsers.filter((item) => item.status === "INACTIVE").length,
      assignedRoleCount: assignedRoleIds.size,
      totalRoleCount: serverWorkspace.roles.length
    };
  }, [workingUsers, serverWorkspace.roles.length]);

  const dirty = useMemo(() => {
    if (Object.keys(passwordResets).length > 0) return true;
    if (workingUsers.length !== serverWorkspace.users.length) return true;

    const serverMap = new Map(serverWorkspace.users.map((item) => [item.id, item]));

    return workingUsers.some((item) => {
      if (item.isDraft) return true;
      const original = serverMap.get(item.id);
      return !original || !sameUserUpdate(normalizeUserUpdate(item), normalizeUserUpdate(original));
    });
  }, [passwordResets, serverWorkspace.users, workingUsers]);

  async function refresh() {
    setMessage("");
    const success = await load(true);
    if (success) setMessage("Users reloaded from database.");
    return success;
  }

  function updateCell(id: string, field: string, value: unknown) {
    setMessage("");
    setError("");

    setWorkingUsers((current) => current.map((item) => {
      if (item.id !== id) return item;

      if (field === "fullName") return { ...item, fullName: String(value) };
      if (field === "email") return { ...item, email: String(value).replace(/\s/g, "").toLowerCase() };
      if (field === "roleId") return { ...item, roleId: String(value) };
      if (field === "status") return { ...item, status: String(value) as UserStatus };

      return item;
    }));
  }

  function addDraft(input: AddUserDraftInput) {
    const id = `draft-${crypto.randomUUID()}`;
    setError("");
    setMessage("");

    setWorkingUsers((current) => [
      ...current,
      {
        id,
        fullName: input.fullName.trim(),
        email: input.email.trim().toLowerCase(),
        status: input.status,
        roleId: input.roleId,
        role: null,
        roleCount: input.roleId ? 1 : 0,
        updatedBy: null,
        isDraft: true,
        draftPassword: input.password
      }
    ]);

    return id;
  }

  function removeDraft(id: string) {
    const target = workingUsers.find((item) => item.id === id);
    if (!target?.isDraft) return;

    setWorkingUsers((current) => current.filter((item) => item.id !== id));
    setMessage("Draft user removed.");
    setError("");
  }

  function stagePasswordReset(id: string, password: string) {
    const target = workingUsers.find((item) => item.id === id);
    if (!target || target.isDraft) return;

    setPasswordResets((current) => ({ ...current, [id]: password }));
    setMessage(`New password for ${target.fullName} staged. Execute to save it.`);
    setError("");
  }

  const hasPasswordReset = useCallback((id: string) => {
    return Boolean(passwordResets[id]);
  }, [passwordResets]);

  function clearChanges() {
    setWorkingUsers(serverWorkspace.users);
    setPasswordResets({});
    setMode("INQUIRY");
    setError("");
    setMessage("Unsaved changes cleared.");
  }

  function changeMode(nextMode: UserMode) {
    if (nextMode === "INQUIRY" && dirty) {
      setError("User Master has unsaved changes. Use Clear to discard them before returning to Inquiry mode.");
      setMessage("");
      return;
    }
    setMode(nextMode);
  }

  function prepareExecute() {
    const validationError = validateUsers(workingUsers, serverWorkspace.roles);
    if (validationError) {
      setError(validationError);
      setMessage("");
      return false;
    }

    for (const [id, password] of Object.entries(passwordResets)) {
      if (!workingUsers.some((item) => item.id === id)) continue;
      if (password.length < 8) {
        setError("Reset password minimal 8 karakter.");
        setMessage("");
        return false;
      }
    }

    if (!dirty) {
      setMessage("No changes to execute.");
      setError("");
      return false;
    }

    return true;
  }

  async function executeChanges() {
    if (!prepareExecute()) return false;

    const serverMap = new Map(serverWorkspace.users.map((item) => [item.id, item]));
    const creates = workingUsers
      .filter((item) => item.isDraft)
      .map((item) => ({
        clientId: item.id,
        fullName: item.fullName.trim(),
        email: item.email.trim().toLowerCase(),
        password: item.draftPassword ?? "",
        roleId: item.roleId,
        status: item.status
      }));

    const updates = workingUsers.flatMap((item) => {
      if (item.isDraft) return [];
      const original = serverMap.get(item.id);
      const input = normalizeUserUpdate(item);
      if (original && sameUserUpdate(input, normalizeUserUpdate(original))) return [];
      return [{ id: item.id, input }];
    });

    const passwordResetPayload = Object.entries(passwordResets)
      .filter(([id]) => workingUsers.some((item) => item.id === id && !item.isDraft))
      .map(([id, password]) => ({ id, password }));

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const result = await executeUserWorkspace({
        creates,
        updates,
        passwordResets: passwordResetPayload
      });

      invalidateWorkspaceCache(USER_WORKSPACE_KEY);
      invalidateWorkspaceCache("configuration/roles/workspace");
      invalidateWorkspaceCache("monitoring/dashboard/workspace");
      setWorkspaceCache(USER_WORKSPACE_KEY, result);
      applyWorkspace(result);
      setMessage(`${result.changedCount} change${result.changedCount === 1 ? "" : "s"} successfully executed.`);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to execute user changes");
      return false;
    } finally {
      setSaving(false);
    }
  }

  return {
    users,
    allUsers: workingUsers,
    roles: serverWorkspace.roles,
    summary,
    dirty,
    search,
    setSearch,
    statusFilter,
    setStatusFilter,
    mode,
    changeMode,
    loading,
    saving,
    error,
    message,
    refresh,
    updateCell,
    addDraft,
    removeDraft,
    stagePasswordReset,
    hasPasswordReset,
    clearChanges,
    prepareExecute,
    executeChanges
  };
}
