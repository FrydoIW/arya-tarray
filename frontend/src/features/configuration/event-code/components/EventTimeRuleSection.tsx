"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { MoneyInput } from "@/components/ui/MoneyInput";
import { invalidateWorkspaceCache } from "@/lib/workspace-cache";
import { invalidateMonitoringWorkspaces } from "@/lib/monitoring-cache";
import { executeTimeRules, getTimeRules } from "../api/event-code.api";
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
function sameRule(left: TimeRuleInput, right: TimeRuleInput) {
  return JSON.stringify(normalized(left)) === JSON.stringify(normalized(right));
}

export function EventTimeRuleSection({ eventCodes, masterDirty }: { eventCodes: EventCode[]; masterDirty: boolean }) {
  const [rules, setRules] = useState<EventTimeRule[]>([]);
  const [selected, setSelected] = useState("");
  const [drafts, setDrafts] = useState<Record<string, TimeRuleInput>>({});
  const [mode, setMode] = useState<"INQUIRY" | "EDIT">("INQUIRY");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [clearConfirm, setClearConfirm] = useState(false);

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
  const canEdit = chosen?.eventType === "TIME_BASED" && chosen.activeFlag && !masterDirty;

  const baselineFor = useCallback((eventCodeId: string): TimeRuleInput => {
    const persistedRule = ruleByCode.get(eventCodeId);
    return persistedRule ? inputOf(persistedRule) : emptyRule;
  }, [ruleByCode]);

  const dirtyEntries = useMemo(
    () => Object.entries(drafts).filter(([eventCodeId, draft]) => !sameRule(draft, baselineFor(eventCodeId))),
    [drafts, baselineFor]
  );
  const dirtyCount = dirtyEntries.length;
  const allDirtyValid = dirtyEntries.every(([, draft]) => valid(draft));
  const current = drafts[selectedId] ?? baselineFor(selectedId);

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      setRules(await getTimeRules());
      setDrafts({});
      setMode("INQUIRY");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load Time Rules.");
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  function choose(eventCodeId: string) {
    setSelected(eventCodeId);
    setError("");
  }
  function change(field: keyof TimeRuleInput, value: string | number | boolean | null) {
    setDrafts(currentDrafts => ({
      ...currentDrafts,
      [selectedId]: { ...(currentDrafts[selectedId] ?? baselineFor(selectedId)), [field]: value }
    }));
    setError("");
    setMessage("");
  }
  function clear() {
    setDrafts({});
    setMode("INQUIRY");
    setError("");
    setClearConfirm(false);
  }
  function requestClear() {
    if (dirtyCount > 1) {
      setClearConfirm(true);
      return;
    }
    clear();
  }
  function prepare() {
    if (masterDirty) { setError("Execute Event Code changes first."); return; }
    if (!allDirtyValid) {
      setError("Set a positive unit amount and a whole duration in months for every staged Time Rule.");
      return;
    }
    setConfirm(true);
  }
  async function execute() {
    if (dirtyCount === 0 || !allDirtyValid) return;
    setBusy(true);
    setError("");
    try {
      const updates = dirtyEntries.map(([eventCodeId, draft]) => ({ eventCodeId, input: normalized(draft) }));
      setRules(await executeTimeRules({ updates }));
      setDrafts({});
      setMode("INQUIRY");
      setMessage(`${updates.length} Time Rule change${updates.length === 1 ? "" : "s"} executed. Existing coverage keeps its recorded rule snapshot.`);
      invalidateMonitoringWorkspaces(["timeBased"]);
      invalidateWorkspaceCache("reconciliation/statement-upload/workspace");
      invalidateWorkspaceCache("reconciliation/edit-income/workspace");
      setConfirm(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save Time Rules.");
    } finally {
      setBusy(false);
    }
  }

  function optionLabel(code: { id: string; eventType: string; activeFlag: boolean }) {
    if (!(code.activeFlag && code.eventType === "TIME_BASED")) return " (historical)";
    const draft = drafts[code.id];
    if (draft && !sameRule(draft, baselineFor(code.id))) return " (modified)";
    return ruleByCode.has(code.id) ? "" : " (rule needed)";
  }

  return <CollapsibleSection
    className={styles.sectionPanel}
    title="Rupang Time Rules"
    description="One current entitlement rule for each active Time-Based Event Code. Existing coverage remains unchanged."
    summary={`${rules.length} rules`}
    defaultExpanded={false}
    actions={<div className={styles.campaignActions}>
      <Button size="sm" variant={mode === "INQUIRY" ? "primary" : "secondary"} disabled={busy} onClick={() => dirtyCount > 0 ? setError("Clear unsaved Time Rule changes first.") : setMode("INQUIRY")}>Inquiry</Button>
      <Button size="sm" variant={mode === "EDIT" ? "primary" : "secondary"} disabled={busy || !canEdit} onClick={() => setMode("EDIT")}>Edit Time Rules</Button>
      <Button size="sm" variant="outline" disabled={busy || dirtyCount === 0} onClick={requestClear}>Clear</Button>
      <Button size="sm" disabled={busy || masterDirty || mode !== "EDIT" || dirtyCount === 0 || !allDirtyValid} onClick={prepare}>{dirtyCount > 0 ? `Execute Time Rules (${dirtyCount})` : "Execute Time Rules"}</Button>
      <Button size="sm" variant="outline" disabled={busy || dirtyCount > 0} onClick={() => void load()}>Reload</Button>
    </div>}
  >
    <div className={styles.timeRuleBody}>
    {message ? <div className="ui-alert ui-alert-success">{message}</div> : null}
    {error ? <div className="ui-alert ui-alert-error">{error}</div> : null}
    {masterDirty ? <p>Execute Event Code changes first.</p> : null}
    {!codes.some(code => code.eventType === "TIME_BASED") ? <p>No Time-Based Event Code is available. Change an Event Code Type to TIME_BASED and execute the Event Code changes first.</p> : null}
    {codes.length > 0 ? <div className={`${styles.campaignFields} ${styles.timeRuleFields}`}>
      <label>Event Code<select value={selectedId} disabled={busy} onChange={event => choose(event.target.value)}>{codes.map(code => <option key={code.id} value={code.id}>{code.code} - {code.eventName}{optionLabel(code)}</option>)}</select></label>
      <label>Unit amount (IDR)<MoneyInput value={current.unitAmount} disabled={busy || mode !== "EDIT" || !canEdit} onValueChange={value => change("unitAmount", value)} /></label>
      <label>Duration (months)<input type="number" min="1" max="1200" value={current.durationMonths} disabled={busy || mode !== "EDIT" || !canEdit} onChange={event => change("durationMonths", Number(event.target.value))} /></label>
      <label>Status<select value={current.activeFlag ? "ACTIVE" : "INACTIVE"} disabled={busy || mode !== "EDIT" || !canEdit} onChange={event => change("activeFlag", event.target.value === "ACTIVE")}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></label>
      <label className={styles.campaignRemark}>Remark<input maxLength={1000} value={current.remark ?? ""} disabled={busy || mode !== "EDIT" || !canEdit} onChange={event => change("remark", event.target.value || null)} /></label>
    </div> : null}
    </div>
    <ConfirmDialog open={confirm} title="Confirm Time Rule Execute" message={`Save ${dirtyCount} staged Time Rule change${dirtyCount === 1 ? "" : "s"}? Historical coverage will keep its recorded snapshots.`} loading={busy} confirmLabel="Execute Time Rules" onCancel={() => setConfirm(false)} onConfirm={execute} />
    <ConfirmDialog open={clearConfirm} title="Discard staged Time Rules" message={`Discard ${dirtyCount} staged Time Rule change${dirtyCount === 1 ? "" : "s"}?`} confirmLabel="Clear staged changes" onCancel={() => setClearConfirm(false)} onConfirm={clear} />
  </CollapsibleSection>;
}
