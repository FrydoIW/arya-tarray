"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { invalidateWorkspaceCache } from "@/lib/workspace-cache";
import { executeEventCodeChanges, getEventCodes } from "../api/event-code.api";
import type { EventCode, EventCodeInput, EventCodeStatusFilter } from "../types";

function normalizeInput(item: EventCode): EventCodeInput {
  return {
    code: item.code.trim(),
    eventName: item.eventName.trim(),
    category: item.category?.trim() || null,
    description: item.description?.trim() || null,
    activeFlag: item.activeFlag
  };
}

function sameInput(a: EventCodeInput, b: EventCodeInput) {
  return a.code === b.code
    && a.eventName === b.eventName
    && a.category === b.category
    && a.description === b.description
    && a.activeFlag === b.activeFlag;
}

function validateRows(rows: EventCode[]) {
  const usedCodes = new Set<string>();

  for (const [index, row] of rows.entries()) {
    const code = row.code.trim();
    const eventName = row.eventName.trim();
    const category = row.category?.trim() ?? "";

    if (!/^\d{3}$/.test(code)) {
      return `Row ${index + 1}: Event Code harus tepat 3 digit.`;
    }
    if (!eventName) {
      return `Row ${index + 1}: Event Name wajib diisi.`;
    }
    if (category.length > 50) {
      return `Row ${index + 1}: Category maksimal 50 karakter.`;
    }
    if (usedCodes.has(code)) {
      return `Event Code ${code} muncul lebih dari satu kali.`;
    }
    usedCodes.add(code);
  }

  return "";
}

export function useEventCodes() {
  const [serverItems, setServerItems] = useState<EventCode[]>([]);
  const [workingItems, setWorkingItems] = useState<EventCode[]>([]);
  const [deletedIds, setDeletedIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<EventCodeStatusFilter>("ALL");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const items = await getEventCodes();
      setServerItems(items);
      setWorkingItems(items);
      setDeletedIds([]);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load event codes");
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    return workingItems.filter((item) => {
      const statusMatch = statusFilter === "ALL"
        || (statusFilter === "ACTIVE" && item.activeFlag)
        || (statusFilter === "INACTIVE" && !item.activeFlag);

      if (!statusMatch) return false;
      if (!query) return true;

      return item.code.toLowerCase().includes(query)
        || item.eventName.toLowerCase().includes(query)
        || (item.category ?? "").toLowerCase().includes(query)
        || (item.description ?? "").toLowerCase().includes(query)
        || (item.updatedBy?.fullName ?? "").toLowerCase().includes(query);
    });
  }, [workingItems, search, statusFilter]);

  const summary = useMemo(() => ({
    total: workingItems.length,
    active: workingItems.filter((item) => item.activeFlag).length,
    inactive: workingItems.filter((item) => !item.activeFlag).length
  }), [workingItems]);

  const dirty = useMemo(() => {
    if (deletedIds.length > 0) return true;
    if (workingItems.length !== serverItems.length) return true;
    const serverMap = new Map(serverItems.map((item) => [item.id, item]));

    return workingItems.some((item) => {
      if (item.isDraft) return true;
      const original = serverMap.get(item.id);
      return !original || !sameInput(normalizeInput(item), normalizeInput(original));
    });
  }, [deletedIds.length, serverItems, workingItems]);


  async function reloadFromDatabase() {
    setMessage("");
    const success = await load();
    if (success) {
      setMessage("Event codes reloaded from database.");
    }
    return success;
  }

  function updateCell(id: string, field: string, value: unknown) {
    setMessage("");
    setError("");
    setWorkingItems((current) => current.map((item) => {
      if (item.id !== id) return item;
      if (field === "code") return { ...item, code: String(value).replace(/\D/g, "").slice(0, 3) };
      if (field === "eventName") return { ...item, eventName: String(value) };
      if (field === "category") return { ...item, category: String(value).slice(0, 50) };
      if (field === "description") return { ...item, description: String(value) };
      if (field === "activeFlag") return { ...item, activeFlag: Boolean(value) };
      return item;
    }));
  }

  function addDraft() {
    const id = `draft-${crypto.randomUUID()}`;
    setMessage("");
    setError("");
    setWorkingItems((current) => [
      ...current,
      {
        id,
        code: "",
        eventName: "",
        category: "",
        description: "",
        activeFlag: true,
        updatedBy: null,
        isDraft: true
      }
    ]);
    return id;
  }

  function removeRow(id: string) {
    const target = workingItems.find((item) => item.id === id);
    if (!target) return;

    setError("");
    setWorkingItems((current) => current.filter((item) => item.id !== id));

    if (target.isDraft) {
      setMessage("Draft row removed.");
      return;
    }

    setDeletedIds((ids) => ids.includes(id) ? ids : [...ids, id]);
    setMessage(`Event Code ${target.code} marked for deletion. Execute to save or Clear to restore.`);
  }

  function clearChanges() {
    setWorkingItems(serverItems);
    setDeletedIds([]);
    setMessage("Unsaved changes cleared.");
    setError("");
  }

  async function executeChanges() {
    const validationError = validateRows(workingItems);
    if (validationError) {
      setError(validationError);
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
      const serverMap = new Map(serverItems.map((item) => [item.id, item]));
      const creates: EventCodeInput[] = [];
      const updates: Array<{ id: string; input: EventCodeInput }> = [];

      for (const item of workingItems) {
        const input = normalizeInput(item);
        if (item.isDraft) {
          creates.push(input);
          continue;
        }

        const original = serverMap.get(item.id);
        if (!original || !sameInput(input, normalizeInput(original))) {
          updates.push({ id: item.id, input });
        }
      }

      const result = await executeEventCodeChanges({
        creates,
        updates,
        deletes: deletedIds
      });

      invalidateWorkspaceCache("monitoring/dashboard/workspace");
      invalidateWorkspaceCache("member/data/workspace");
      invalidateWorkspaceCache("reconciliation/statement-upload/workspace");
      invalidateWorkspaceCache("reconciliation/edit-income/workspace");
      invalidateWorkspaceCache("reconciliation/transaction-inquiry/workspace");
      setServerItems(result.items);
      setWorkingItems(result.items);
      setDeletedIds([]);
      setMessage(`${result.changedCount} change${result.changedCount === 1 ? "" : "s"} successfully executed.`);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to execute event code changes");
      return false;
    } finally {
      setSaving(false);
    }
  }

  return {
    items: filteredItems,
    allItems: workingItems,
    summary,
    dirty,
    search,
    setSearch,
    statusFilter,
    setStatusFilter,
    loading,
    saving,
    error,
    message,
    refresh: reloadFromDatabase,
    updateCell,
    addDraft,
    removeRow,
    clearChanges,
    executeChanges
  };
}
