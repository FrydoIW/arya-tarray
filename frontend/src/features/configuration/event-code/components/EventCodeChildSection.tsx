"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { invalidateWorkspaceCache } from "@/lib/workspace-cache";
import { invalidateMonitoringWorkspaces } from "@/lib/monitoring-cache";
import { executeChildChanges, getEventCodeChildren } from "../api/event-code.api";
import type { ChildInput, EventCode, EventCodeChild } from "../types";
import styles from "../styles/event-code.module.css";

type Draft = ChildInput & { id: string; isNew?: boolean };

function toDraft(item: EventCodeChild): Draft {
  return {
    id: item.id,
    eventCodeId: item.eventCodeId,
    childCode: item.childCode,
    childName: item.childName,
    description: item.description,
    displayOrder: item.displayOrder,
    activeFlag: item.activeFlag
  };
}

function inputOf(item: Draft): ChildInput {
  return {
    eventCodeId: item.eventCodeId,
    childCode: item.childCode.trim(),
    childName: item.childName.trim(),
    description: item.description?.trim() || null,
    displayOrder: item.displayOrder,
    activeFlag: item.activeFlag
  };
}

export function EventCodeChildSection({ eventCodes, masterDirty }: { eventCodes: EventCode[]; masterDirty: boolean }) {
  const [server, setServer] = useState<EventCodeChild[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [mode, setMode] = useState<"INQUIRY" | "EDIT">("INQUIRY");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const persistedCodes = eventCodes.filter((item) => !item.isDraft);
  const activeCodes = persistedCodes.filter((item) => item.activeFlag);

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const items = await getEventCodeChildren();
      setServer(items);
      setDrafts(items.map(toDraft));
      setMode("INQUIRY");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to load Children.");
    } finally { setBusy(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const dirty = useMemo(() => {
    const old = new Map(server.map((item) => [item.id, JSON.stringify(inputOf(toDraft(item)))]));
    return drafts.some((item) => item.isNew || JSON.stringify(inputOf(item)) !== old.get(item.id));
  }, [drafts, server]);

  const parentLabel = useCallback((eventCodeId: string) => {
    const parent = persistedCodes.find((item) => item.id === eventCodeId);
    return parent ? `${parent.code} - ${parent.eventName}` : "?";
  }, [persistedCodes]);

  function change(id: string, field: keyof ChildInput, value: string | boolean | number | null) {
    setDrafts((current) => current.map((item) => item.id === id ? { ...item, [field]: value } : item));
    setError("");
  }

  function remove(id: string) {
    const target = drafts.find((item) => item.id === id);
    if (!target) return;
    if (!target.isNew) {
      const saved = server.find((item) => item.id === id);
      if (saved && (saved.transactionCount > 0 || saved.correctionCount > 0)) {
        setError(`Child ${saved.childCode} sudah dipakai transaksi atau koreksi. Ubah status menjadi Inactive daripada menghapusnya.`);
        return;
      }
    }
    setError("");
    setDrafts((current) => current.filter((item) => item.id !== id));
    setMessage("Child row removed. Execute to save or Clear to restore.");
  }

  function prepare() {
    if (masterDirty) { setError("Execute Event Code changes first."); return; }
    if (!dirty) { setMessage("No Child changes to execute."); return; }
    for (const item of drafts) {
      const input = inputOf(item);
      if (!input.eventCodeId) { setError("Event Code is required for every Child."); return; }
      if (!input.childCode || !input.childName) { setError("Child Code and Child name are required."); return; }
    }
    const owners = new Map<string, string>();
    for (const item of drafts) {
      const key = `${item.eventCodeId}:${item.childCode.trim()}`;
      const owner = owners.get(key);
      if (owner && owner !== item.id) {
        setError(`Child Code ${item.childCode.trim()} muncul lebih dari satu kali untuk Event Code yang sama.`);
        return;
      }
      owners.set(key, item.id);
    }
    setConfirmOpen(true);
  }

  async function execute() {
    setBusy(true);
    setError("");
    try {
      const old = new Map(server.map((item) => [item.id, JSON.stringify(inputOf(toDraft(item)))]));
      const previous = new Map(server.map((item) => [item.id, item]));
      const result = await executeChildChanges({
        creates: drafts.filter((item) => item.isNew).map(inputOf),
        updates: drafts.filter((item) => !item.isNew && JSON.stringify(inputOf(item)) !== old.get(item.id)).map((item) => ({ id: item.id, input: inputOf(item) })),
        deletes: server.filter((item) => !drafts.some((draft) => draft.id === item.id)).map((item) => item.id)
      });
      setServer(result.items);
      setDrafts(result.items.map(toDraft));
      setMode("INQUIRY");
      setMessage(`${result.changedCount} Child change${result.changedCount === 1 ? "" : "s"} executed.`);
      invalidateMonitoringWorkspaces(["timeBased", "campaign"]);
      invalidateWorkspaceCache("reconciliation/statement-upload/workspace");
      invalidateWorkspaceCache("reconciliation/edit-income/workspace");
      invalidateWorkspaceCache("reconciliation/transaction-inquiry/workspace");
      invalidateWorkspaceCache("member/data/workspace");
      void previous;
      setConfirmOpen(false);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Failed to execute Child changes."); }
    finally { setBusy(false); }
  }

  return <CollapsibleSection
    className={styles.sectionPanel}
    title="Event Code Children"
    description="Manage the generic Child classification dimension for each Event Code. Children are transaction classification details - not Campaigns and not subscription items."
    summary={`${server.length} children`}
    defaultExpanded={false}
    actions={<div className={styles.campaignActions}>
      <Button type="button" variant={mode === "INQUIRY" ? "primary" : "secondary"} size="sm" disabled={busy} onClick={() => { if (dirty) { setError("Clear unsaved Child changes first."); return; } setMode("INQUIRY"); }}>Inquiry</Button>
      <Button type="button" variant={mode === "EDIT" ? "primary" : "secondary"} size="sm" disabled={busy || masterDirty || persistedCodes.length === 0} onClick={() => setMode("EDIT")}>Edit Children</Button>
      <Button type="button" variant="outline" size="sm" disabled={busy || masterDirty || mode !== "EDIT" || activeCodes.length === 0} onClick={() => setDrafts((current) => [...current, { id: crypto.randomUUID(), isNew: true, eventCodeId: activeCodes[0].id, childCode: "", childName: "", description: null, displayOrder: 0, activeFlag: true }])}>Add Child</Button>
      <Button type="button" variant="outline" size="sm" disabled={busy || !dirty} onClick={() => { setDrafts(server.map(toDraft)); setMode("INQUIRY"); setError(""); }}>Clear</Button>
      <Button type="button" size="sm" disabled={busy || masterDirty || mode !== "EDIT" || !dirty} onClick={prepare}>Execute Children</Button>
      <Button type="button" variant="outline" size="sm" disabled={busy || dirty} onClick={() => void load()}>Reload</Button>
    </div>}
  >
    <div className={styles.campaignBody}>
    {message && <div className="ui-alert ui-alert-success">{message}</div>}
    {error && <div className="ui-alert ui-alert-error">{error}</div>}
    {masterDirty ? <p>Execute Event Code changes first.</p> : null}
    {persistedCodes.length === 0 ? <p>No persisted Event Code is available. Create and execute an Event Code first.</p> : drafts.length === 0 ? <p>No Children yet.</p> : <div className={styles.campaignList}>{drafts.map((item) => {
      const saved = server.find((value) => value.id === item.id);
      const deletable = !item.isNew && saved && saved.transactionCount === 0 && saved.correctionCount === 0;
      return <div className={styles.campaignCard} key={item.id}>
        <div className={styles.campaignCardHead}><strong>{item.childName || "New Child"}</strong><span className={item.activeFlag ? styles.statusBadge : `${styles.statusBadge} ${styles.inactive}`}>{item.activeFlag ? "ACTIVE" : "INACTIVE"}</span></div>
        <div className={styles.campaignFields}>
          <label>Event Code<select value={item.eventCodeId} disabled={mode !== "EDIT" || busy || masterDirty || !item.isNew} onChange={(event) => change(item.id, "eventCodeId", event.target.value)}>{(item.isNew ? activeCodes : persistedCodes).map((code) => <option value={code.id} key={code.id}>{code.code} - {code.eventName}</option>)}</select></label>
          <label>Child Code<input value={item.childCode} disabled={mode !== "EDIT" || busy || masterDirty} maxLength={30} placeholder="e.g. AMITABHA" onChange={(event) => change(item.id, "childCode", event.target.value)} /></label>
          <label>Name<input value={item.childName} disabled={mode !== "EDIT" || busy || masterDirty} maxLength={150} onChange={(event) => change(item.id, "childName", event.target.value)} /></label>
          <label>Display Order<input type="number" min={0} max={9999} value={item.displayOrder} disabled={mode !== "EDIT" || busy || masterDirty} onChange={(event) => change(item.id, "displayOrder", Number(event.target.value) || 0)} /></label>
          <label>Status<select value={item.activeFlag ? "ACTIVE" : "INACTIVE"} disabled={mode !== "EDIT" || busy || masterDirty} onChange={(event) => change(item.id, "activeFlag", event.target.value === "ACTIVE")}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></label>
          <label className={styles.campaignRemark}>Description<input value={item.description ?? ""} disabled={mode !== "EDIT" || busy || masterDirty} maxLength={500} onChange={(event) => change(item.id, "description", event.target.value || null)} /></label>
        </div>
        <div className={styles.childFooter}>
          {saved ? <span className={styles.childUsage}>{saved.transactionCount} transaction{saved.transactionCount === 1 ? "" : "s"} · {saved.correctionCount} correction{saved.correctionCount === 1 ? "" : "s"} · Parent: {parentLabel(item.eventCodeId)}</span> : <span className={styles.childUsage}>New Child · Parent: {parentLabel(item.eventCodeId)}</span>}
          {mode === "EDIT" && !busy && !masterDirty ? <Button type="button" variant="outline" size="sm" icon={<Trash2 size={14} />} disabled={item.isNew ? false : !deletable} title={deletable || item.isNew ? "Delete Child" : "Referenced children cannot be deleted. Deactivate instead."} onClick={() => remove(item.id)}>Delete</Button> : null}
        </div>
      </div>;
    })}</div>}
    </div>
    <ConfirmDialog open={confirmOpen} title="Confirm Child Execute" message="Save the staged Child changes? Children are transaction classification details; they never replace Campaigns." confirmLabel="Execute Children" loading={busy} onCancel={() => setConfirmOpen(false)} onConfirm={execute} />
  </CollapsibleSection>;
}
