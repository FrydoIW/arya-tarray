"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { invalidateWorkspaceCache } from "@/lib/workspace-cache";
import { executeTimeRuleChange, getTimeRules } from "../api/event-code.api";
import type { EventCode, EventTimeRule, TimeRuleInput } from "../types";
import styles from "../styles/event-code.module.css";

const emptyRule: TimeRuleInput = { unitAmount: "", durationMonths: 1, activeFlag: true, remark: null };
function inputOf(rule: EventTimeRule): TimeRuleInput {
  return { unitAmount: rule.unitAmount, durationMonths: rule.durationMonths, activeFlag: rule.activeFlag, remark: rule.remark };
}
function normalized(input: TimeRuleInput) {
  return { ...input, unitAmount: input.unitAmount.trim(), remark: input.remark?.trim() || null };
}
function valid(input: TimeRuleInput) {
  return /^\d{1,18}(?:\.\d{1,2})?$/.test(input.unitAmount.trim())
    && Number(input.unitAmount) > 0 && Number.isInteger(input.durationMonths)
    && input.durationMonths >= 1 && input.durationMonths <= 1200;
}

export function EventTimeRuleSection({ eventCodes, masterDirty }: { eventCodes: EventCode[]; masterDirty: boolean }) {
  const [rules, setRules] = useState<EventTimeRule[]>([]);
  const [selected, setSelected] = useState("");
  const [draft, setDraft] = useState<TimeRuleInput | null>(null);
  const [mode, setMode] = useState<"INQUIRY" | "EDIT">("INQUIRY");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [confirm, setConfirm] = useState(false);

  const codes = useMemo(() => {
    const persisted = eventCodes.filter(item => item.eventType === "TIME_BASED" && !item.isDraft);
    const known = new Set(persisted.map(item => item.id));
    return [...persisted, ...rules.filter(rule => !known.has(rule.eventCodeId)).map(rule => ({
      id: rule.eventCodeId, code: rule.eventCode.code, eventName: rule.eventCode.eventName,
      eventType: rule.eventCode.eventType, activeFlag: rule.eventCode.activeFlag
    }))];
  }, [eventCodes, rules]);
  const ruleByCode = useMemo(() => new Map(rules.map(rule => [rule.eventCodeId, rule])), [rules]);
  const selectedId = codes.some(code => code.id === selected) ? selected : codes[0]?.id ?? "";
  const chosen = codes.find(code => code.id === selectedId);
  const persisted = ruleByCode.get(selectedId);
  const current = draft ?? (persisted ? inputOf(persisted) : emptyRule);
  const dirty = draft !== null && JSON.stringify(normalized(current)) !== JSON.stringify(normalized(persisted ? inputOf(persisted) : emptyRule));
  const canEdit = chosen?.eventType === "TIME_BASED" && chosen.activeFlag && !masterDirty;

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      setRules(await getTimeRules());
      setDraft(null);
      setMode("INQUIRY");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load Time Rules.");
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  function choose(eventCodeId: string) {
    if (dirty) { setError("Clear unsaved Time Rule changes first."); return; }
    setSelected(eventCodeId);
    setDraft(null);
    setMode("INQUIRY");
    setError("");
  }
  function change(field: keyof TimeRuleInput, value: string | number | boolean | null) {
    setDraft({ ...current, [field]: value });
    setError("");
    setMessage("");
  }
  function clear() {
    setDraft(null);
    setMode("INQUIRY");
    setError("");
  }
  function prepare() {
    if (!canEdit || mode !== "EDIT" || !dirty || !valid(current)) {
      setError("Set a positive unit amount and a whole duration in months before executing a change.");
      return;
    }
    setConfirm(true);
  }
  async function execute() {
    if (!canEdit || !dirty || !valid(current)) return;
    setBusy(true);
    setError("");
    try {
      setRules(await executeTimeRuleChange({ eventCodeId: selectedId, input: normalized(current) }));
      clear();
      setMessage("Time Rule saved. Existing coverage keeps its recorded rule snapshot.");
      invalidateWorkspaceCache("monitoring/dashboard/workspace");
      invalidateWorkspaceCache("reconciliation/statement-upload/workspace");
      invalidateWorkspaceCache("reconciliation/edit-income/workspace");
      setConfirm(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save Time Rule.");
    } finally {
      setBusy(false);
    }
  }

  return <CollapsibleSection title="Rupang Time Rules" description="One current entitlement rule for each active Time-Based Event Code. Existing coverage remains unchanged." summary={`${rules.length} rules`} defaultExpanded={false}>
    <div className={styles.campaignActions}>
      <Button size="sm" variant={mode === "INQUIRY" ? "primary" : "secondary"} disabled={busy} onClick={() => dirty ? setError("Clear unsaved Time Rule changes first.") : setMode("INQUIRY")}>Inquiry</Button>
      <Button size="sm" variant={mode === "EDIT" ? "primary" : "secondary"} disabled={busy || !canEdit} onClick={() => setMode("EDIT")}>Edit Time Rule</Button>
      <Button size="sm" variant="outline" disabled={busy || !dirty} onClick={clear}>Clear</Button>
      <Button size="sm" disabled={busy || !canEdit || mode !== "EDIT" || !dirty || !valid(current)} onClick={prepare}>Execute Time Rule</Button>
      <Button size="sm" variant="outline" disabled={busy || dirty} onClick={() => void load()}>Reload</Button>
    </div>
    {message ? <div className="ui-alert ui-alert-success">{message}</div> : null}
    {error ? <div className="ui-alert ui-alert-error">{error}</div> : null}
    {masterDirty ? <p>Execute Event Code changes first.</p> : null}
    {!codes.some(code => code.eventType === "TIME_BASED") ? <p>No Time-Based Event Code is available. Change an Event Code Type to TIME_BASED and execute the Event Code changes first.</p> : null}
    {codes.length > 0 ? <div className={styles.campaignFields}>
      <label>Event Code<select value={selectedId} disabled={busy} onChange={event => choose(event.target.value)}>{codes.map(code => <option key={code.id} value={code.id}>{code.code} - {code.eventName}{code.activeFlag && code.eventType === "TIME_BASED" ? ruleByCode.has(code.id) ? "" : " (rule needed)" : " (historical)"}</option>)}</select></label>
      <label>Unit amount (IDR)<input type="number" min="0.01" step="0.01" value={current.unitAmount} disabled={busy || mode !== "EDIT" || !canEdit} onChange={event => change("unitAmount", event.target.value)} /></label>
      <label>Duration (months)<input type="number" min="1" max="1200" value={current.durationMonths} disabled={busy || mode !== "EDIT" || !canEdit} onChange={event => change("durationMonths", Number(event.target.value))} /></label>
      <label>Status<select value={current.activeFlag ? "ACTIVE" : "INACTIVE"} disabled={busy || mode !== "EDIT" || !canEdit} onChange={event => change("activeFlag", event.target.value === "ACTIVE")}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></label>
      <label className={styles.campaignRemark}>Remark<input maxLength={1000} value={current.remark ?? ""} disabled={busy || mode !== "EDIT" || !canEdit} onChange={event => change("remark", event.target.value || null)} /></label>
      {chosen && current.unitAmount ? <p className={styles.campaignProgress}>{chosen.eventName}: Rp{Number(current.unitAmount).toLocaleString("id-ID")} = {current.durationMonths} month{current.durationMonths === 1 ? "" : "s"}</p> : null}
    </div> : null}
    <ConfirmDialog open={confirm} title="Confirm Time Rule Execute" message="Save this current Time Rule? Historical coverage will keep its recorded snapshots." loading={busy} confirmLabel="Execute Time Rule" onCancel={() => setConfirm(false)} onConfirm={execute} />
  </CollapsibleSection>;
}
