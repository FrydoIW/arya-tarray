"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { invalidateWorkspaceCache } from "@/lib/workspace-cache";
import { executeCampaignChanges, getCampaigns } from "../api/event-code.api";
import type { CampaignInput, EventCampaign, EventCode } from "../types";
import styles from "../styles/event-code.module.css";

type Draft = CampaignInput & { id: string; isNew?: boolean };

function toDraft(item: EventCampaign): Draft {
  return { id: item.id, eventCodeId: item.eventCodeId, campaignName: item.campaignName, startDate: item.startDate, endDate: item.endDate, targetAmount: item.targetAmount, activeFlag: item.activeFlag, remark: item.remark };
}

function inputOf(item: Draft): CampaignInput {
  return { eventCodeId: item.eventCodeId, campaignName: item.campaignName.trim(), startDate: item.startDate || null, endDate: item.endDate || null, targetAmount: item.targetAmount || null, activeFlag: item.activeFlag, remark: item.remark?.trim() || null };
}

export function EventCampaignSection({ eventCodes }: { eventCodes: EventCode[] }) {
  const [server, setServer] = useState<EventCampaign[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [mode, setMode] = useState<"INQUIRY" | "EDIT">("INQUIRY");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const campaignCodes = eventCodes.filter((item) => item.eventType === "CAMPAIGN" && !item.isDraft);

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const items = await getCampaigns();
      setServer(items);
      setDrafts(items.map(toDraft));
      setMode("INQUIRY");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to load Campaigns.");
    } finally { setBusy(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const dirty = useMemo(() => {
    const old = new Map(server.map((item) => [item.id, JSON.stringify(inputOf(toDraft(item)))]));
    return drafts.some((item) => item.isNew || JSON.stringify(inputOf(item)) !== old.get(item.id));
  }, [drafts, server]);

  function change(id: string, field: keyof CampaignInput, value: string | boolean | null) {
    setDrafts((current) => current.map((item) => item.id === id ? { ...item, [field]: value } : item));
    setError("");
  }

  function prepare() {
    if (!dirty) { setMessage("No Campaign changes to execute."); return; }
    for (const item of drafts) {
      const input = inputOf(item);
      if (!input.eventCodeId || !input.campaignName) { setError("Event Code and Campaign name are required."); return; }
      if (input.targetAmount !== null && (!/^\d{1,18}(?:\.\d{1,2})?$/.test(input.targetAmount) || Number(input.targetAmount) <= 0)) { setError("Target must be a positive amount."); return; }
      if (input.startDate && input.endDate && input.startDate > input.endDate) { setError("End date cannot precede start date."); return; }
    }
    setConfirmOpen(true);
  }

  async function execute() {
    setBusy(true);
    setError("");
    try {
      const old = new Map(server.map((item) => [item.id, JSON.stringify(inputOf(toDraft(item)))]));
      const result = await executeCampaignChanges({
        creates: drafts.filter((item) => item.isNew).map(inputOf),
        updates: drafts.filter((item) => !item.isNew && JSON.stringify(inputOf(item)) !== old.get(item.id)).map((item) => ({ id: item.id, input: inputOf(item) }))
      });
      setServer(result.items);
      setDrafts(result.items.map(toDraft));
      setMode("INQUIRY");
      setMessage(`${result.changedCount} Campaign change${result.changedCount === 1 ? "" : "s"} executed.`);
      invalidateWorkspaceCache("monitoring/dashboard/workspace");
      invalidateWorkspaceCache("reconciliation/statement-upload/workspace");
      invalidateWorkspaceCache("reconciliation/edit-income/workspace");
      invalidateWorkspaceCache("reconciliation/transaction-inquiry/workspace");
      setConfirmOpen(false);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Failed to execute Campaign changes."); }
    finally { setBusy(false); }
  }

  return <CollapsibleSection title="Campaigns" description="Manage Campaign instances for Campaign Event Codes. Changes are saved on Execute." summary={`${server.length} campaigns`} defaultExpanded={false}>
    <div className={styles.campaignActions}>
      <Button type="button" variant={mode === "INQUIRY" ? "primary" : "secondary"} size="sm" disabled={busy} onClick={() => { if (dirty) { setError("Clear unsaved Campaign changes first."); return; } setMode("INQUIRY"); }}>Inquiry</Button>
      <Button type="button" variant={mode === "EDIT" ? "primary" : "secondary"} size="sm" disabled={busy} onClick={() => setMode("EDIT")}>Edit Campaigns</Button>
      <Button type="button" variant="outline" size="sm" disabled={busy || mode !== "EDIT" || campaignCodes.length === 0} onClick={() => setDrafts((current) => [...current, { id: crypto.randomUUID(), isNew: true, eventCodeId: campaignCodes.find((item) => item.activeFlag)?.id ?? campaignCodes[0].id, campaignName: "", startDate: null, endDate: null, targetAmount: null, activeFlag: true, remark: null }])}>Add Campaign</Button>
      <Button type="button" variant="outline" size="sm" disabled={busy || !dirty} onClick={() => { setDrafts(server.map(toDraft)); setMode("INQUIRY"); setError(""); }}>Clear</Button>
      <Button type="button" size="sm" disabled={busy || mode !== "EDIT" || !dirty} onClick={prepare}>Execute</Button>
      <Button type="button" variant="outline" size="sm" disabled={busy || dirty} onClick={() => void load()}>Reload</Button>
    </div>
    {message && <div className="ui-alert ui-alert-success">{message}</div>}
    {error && <div className="ui-alert ui-alert-error">{error}</div>}
    {drafts.length === 0 ? <p>No Campaigns yet. Set an Event Code to Campaign and add one here.</p> : <div className={styles.campaignList}>{drafts.map((item) => {
      const saved = server.find((value) => value.id === item.id);
      return <div className={styles.campaignCard} key={item.id}>
        <div className={styles.campaignCardHead}><strong>{item.campaignName || "New Campaign"}</strong><span>{saved?.displayStatus ?? "DRAFT"}</span></div>
        <div className={styles.campaignFields}>
          <label>Event Code<select value={item.eventCodeId} disabled={mode !== "EDIT" || busy || !item.isNew} onChange={(event) => change(item.id, "eventCodeId", event.target.value)}>{campaignCodes.map((code) => <option value={code.id} key={code.id}>{code.code} - {code.eventName}</option>)}</select></label>
          <label>Name<input value={item.campaignName} disabled={mode !== "EDIT" || busy} maxLength={200} onChange={(event) => change(item.id, "campaignName", event.target.value)} /></label>
          <label>Start date<input type="date" value={item.startDate ?? ""} disabled={mode !== "EDIT" || busy} onChange={(event) => change(item.id, "startDate", event.target.value || null)} /></label>
          <label>End date<input type="date" value={item.endDate ?? ""} disabled={mode !== "EDIT" || busy} onChange={(event) => change(item.id, "endDate", event.target.value || null)} /></label>
          <label>Target (IDR)<input type="number" min="0.01" step="0.01" value={item.targetAmount ?? ""} disabled={mode !== "EDIT" || busy} onChange={(event) => change(item.id, "targetAmount", event.target.value || null)} /></label>
          <label>Status<select value={item.activeFlag ? "ACTIVE" : "CLOSED"} disabled={mode !== "EDIT" || busy} onChange={(event) => change(item.id, "activeFlag", event.target.value === "ACTIVE")}><option value="ACTIVE">Active</option><option value="CLOSED">Closed</option></select></label>
          <label className={styles.campaignRemark}>Remark<input value={item.remark ?? ""} disabled={mode !== "EDIT" || busy} maxLength={1000} onChange={(event) => change(item.id, "remark", event.target.value || null)} /></label>
        </div>
        {saved && <div className={styles.campaignProgress}>Collected Rp{Number(saved.collectedAmount).toLocaleString("id-ID")} {saved.targetAmount ? ` / Rp${Number(saved.targetAmount).toLocaleString("id-ID")} (${Math.round(saved.progressPercent ?? 0)}%)` : ""}{saved.targetReached ? " · Target reached" : ""}</div>}
      </div>;
    })}</div>}
    <ConfirmDialog open={confirmOpen} title="Confirm Campaign Execute" message="Save the staged Campaign changes?" loading={busy} onCancel={() => setConfirmOpen(false)} onConfirm={execute} />
  </CollapsibleSection>;
}
