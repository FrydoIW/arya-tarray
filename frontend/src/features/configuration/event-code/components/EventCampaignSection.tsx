"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { MoneyInput } from "@/components/ui/MoneyInput";
import { invalidateWorkspaceCache } from "@/lib/workspace-cache";
import { invalidateMonitoringWorkspaces } from "@/features/monitoring/monitoring-cache";
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

export function EventCampaignSection({ eventCodes, masterDirty }: { eventCodes: EventCode[]; masterDirty: boolean }) {
  const [server, setServer] = useState<EventCampaign[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [mode, setMode] = useState<"INQUIRY" | "EDIT">("INQUIRY");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const campaignCodes = eventCodes.filter((item) => item.eventType === "CAMPAIGN" && !item.isDraft);
  const eligibleCodes = campaignCodes.filter((item) => item.activeFlag);

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
    if (masterDirty) { setError("Execute Event Code changes first."); return; }
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
      invalidateMonitoringWorkspaces(["campaign"]);
      invalidateWorkspaceCache("reconciliation/statement-upload/workspace");
      invalidateWorkspaceCache("reconciliation/edit-income/workspace");
      invalidateWorkspaceCache("reconciliation/transaction-inquiry/workspace");
      setConfirmOpen(false);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Failed to execute Campaign changes."); }
    finally { setBusy(false); }
  }

  return <CollapsibleSection
    className={styles.sectionPanel}
    title="Campaigns"
    description="Manage Campaign instances for persisted Campaign Event Codes. Execute Campaigns saves this section only."
    summary={`${server.length} campaigns`}
    defaultExpanded={false}
    actions={<div className={styles.campaignActions}>
      <Button type="button" variant={mode === "INQUIRY" ? "primary" : "secondary"} size="sm" disabled={busy} onClick={() => { if (dirty) { setError("Clear unsaved Campaign changes first."); return; } setMode("INQUIRY"); }}>Inquiry</Button>
      <Button type="button" variant={mode === "EDIT" ? "primary" : "secondary"} size="sm" disabled={busy || masterDirty || campaignCodes.length === 0} onClick={() => setMode("EDIT")}>Edit Campaigns</Button>
      <Button type="button" variant="outline" size="sm" disabled={busy || masterDirty || mode !== "EDIT" || eligibleCodes.length === 0} onClick={() => setDrafts((current) => [...current, { id: crypto.randomUUID(), isNew: true, eventCodeId: eligibleCodes[0].id, campaignName: "", startDate: null, endDate: null, targetAmount: null, activeFlag: true, remark: null }])}>Add Campaign</Button>
      <Button type="button" variant="outline" size="sm" disabled={busy || !dirty} onClick={() => { setDrafts(server.map(toDraft)); setMode("INQUIRY"); setError(""); }}>Clear</Button>
      <Button type="button" size="sm" disabled={busy || masterDirty || mode !== "EDIT" || !dirty} onClick={prepare}>Execute Campaigns</Button>
      <Button type="button" variant="outline" size="sm" disabled={busy || dirty} onClick={() => void load()}>Reload</Button>
    </div>}
  >
    <div className={styles.campaignBody}>
    {message && <div className="ui-alert ui-alert-success">{message}</div>}
    {error && <div className="ui-alert ui-alert-error">{error}</div>}
    {masterDirty ? <p>Execute Event Code changes first.</p> : null}
    {campaignCodes.length === 0 ? <p>No Campaign Event Code is available. Change an Event Code Type to CAMPAIGN and execute the Event Code changes first.</p> : eligibleCodes.length === 0 ? <p>No active Campaign Event Code is available for new Campaigns. Existing Campaigns remain readable.</p> : null}
    {drafts.length === 0 && campaignCodes.length > 0 ? <p>No Campaigns yet.</p> : <div className={styles.campaignList}>{drafts.map((item) => {
      const saved = server.find((value) => value.id === item.id);
      return <div className={styles.campaignCard} key={item.id}>
        <div className={styles.campaignCardHead}><strong>{item.campaignName || "New Campaign"}</strong><span>{saved?.displayStatus ?? "DRAFT"}</span></div>
        <div className={styles.campaignFields}>
          <label>Event Code<select value={item.eventCodeId} disabled={mode !== "EDIT" || busy || masterDirty || !item.isNew} onChange={(event) => change(item.id, "eventCodeId", event.target.value)}>{(item.isNew ? eligibleCodes : campaignCodes).map((code) => <option value={code.id} key={code.id}>{code.code} - {code.eventName}</option>)}</select></label>
          <label>Name<input value={item.campaignName} disabled={mode !== "EDIT" || busy || masterDirty} maxLength={200} onChange={(event) => change(item.id, "campaignName", event.target.value)} /></label>
          <label>Start date<input type="date" value={item.startDate ?? ""} disabled={mode !== "EDIT" || busy || masterDirty} onChange={(event) => change(item.id, "startDate", event.target.value || null)} /></label>
          <label>End date<input type="date" value={item.endDate ?? ""} disabled={mode !== "EDIT" || busy || masterDirty} onChange={(event) => change(item.id, "endDate", event.target.value || null)} /></label>
          <label>Target (IDR)<MoneyInput value={item.targetAmount ?? ""} disabled={mode !== "EDIT" || busy || masterDirty} onValueChange={(value) => change(item.id, "targetAmount", value || null)} /></label>
          <label>Status<select value={item.activeFlag ? "ACTIVE" : "CLOSED"} disabled={mode !== "EDIT" || busy || masterDirty} onChange={(event) => change(item.id, "activeFlag", event.target.value === "ACTIVE")}><option value="ACTIVE">Active</option><option value="CLOSED">Closed</option></select></label>
          <label className={styles.campaignRemark}>Remark<input value={item.remark ?? ""} disabled={mode !== "EDIT" || busy || masterDirty} maxLength={1000} onChange={(event) => change(item.id, "remark", event.target.value || null)} /></label>
        </div>
        {saved && <div className={styles.campaignProgress}>Target applied Rp{Number(saved.targetApplied).toLocaleString("id-ID")} {saved.targetAmount ? ` / Rp${Number(saved.targetAmount).toLocaleString("id-ID")} (${Math.round(saved.progressPercent ?? 0)}%)` : ""}{saved.targetReached ? " · Target reached" : ""}</div>}
      </div>;
    })}</div>}
    </div>
    <ConfirmDialog open={confirmOpen} title="Confirm Campaign Execute" message="Save the staged Campaign changes?" confirmLabel="Execute Campaigns" loading={busy} onCancel={() => setConfirmOpen(false)} onConfirm={execute} />
  </CollapsibleSection>;
}
