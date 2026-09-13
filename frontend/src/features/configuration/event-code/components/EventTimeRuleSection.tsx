"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { invalidateWorkspaceCache } from "@/lib/workspace-cache";
import { executeTimeRuleChange, getTimeRules } from "../api/event-code.api";
import type { EventCode, EventTimeRule, TimeRuleInput } from "../types";
import styles from "../styles/event-code.module.css";

function inputOf(rule: EventTimeRule): TimeRuleInput { return { unitAmount: rule.unitAmount, durationMonths: rule.durationMonths, activeFlag: rule.activeFlag, remark: rule.remark }; }

export function EventTimeRuleSection({ eventCodes }: { eventCodes: EventCode[] }) {
  const [rules, setRules] = useState<EventTimeRule[]>([]);
  const [selected, setSelected] = useState("");
  const [draft, setDraft] = useState<TimeRuleInput>({ unitAmount: "", durationMonths: 1, activeFlag: true, remark: null });
  const [mode, setMode] = useState<"INQUIRY" | "EDIT">("INQUIRY");
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [message, setMessage] = useState(""); const [confirm, setConfirm] = useState(false);
  const codes = useMemo(() => eventCodes.filter(item => item.eventType === "TIME_BASED" && item.activeFlag && !item.isDraft), [eventCodes]);
  const ruleByCode = useMemo(() => new Map(rules.map(rule => [rule.eventCodeId, rule])), [rules]);
  const load = useCallback(async () => { setBusy(true); try { const next = await getTimeRules(); setRules(next); const first = selected && codes.some(code => code.id === selected) ? selected : codes[0]?.id ?? ""; setSelected(first); const current = next.find(rule => rule.eventCodeId === first); setDraft(current ? inputOf(current) : { unitAmount: "", durationMonths: 1, activeFlag: true, remark: null }); } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to load Time Rules."); } finally { setBusy(false); } }, [codes, selected]);
  useEffect(() => { void load(); }, [load]);
  const chosen = codes.find(code => code.id === selected);
  function choose(eventCodeId: string) { setSelected(eventCodeId); setError(""); const current = ruleByCode.get(eventCodeId); setDraft(current ? inputOf(current) : { unitAmount: "", durationMonths: 1, activeFlag: true, remark: null }); }
  function prepare() { if (!selected || !/^\d{1,18}(?:\.\d{1,2})?$/.test(draft.unitAmount) || Number(draft.unitAmount) <= 0 || !Number.isInteger(draft.durationMonths) || draft.durationMonths < 1) { setError("Set a positive unit amount and a whole duration in months."); return; } setConfirm(true); }
  async function execute() { setBusy(true); setError(""); try { const next = await executeTimeRuleChange({ eventCodeId: selected, input: { ...draft, unitAmount: draft.unitAmount.trim(), remark: draft.remark?.trim() || null } }); setRules(next); setMode("INQUIRY"); setMessage("Time Rule saved. Existing coverage keeps its recorded rule snapshot."); invalidateWorkspaceCache("monitoring/dashboard/workspace"); invalidateWorkspaceCache("reconciliation/statement-upload/workspace"); invalidateWorkspaceCache("reconciliation/edit-income/workspace"); setConfirm(false); } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to save Time Rule."); } finally { setBusy(false); } }
  return <CollapsibleSection title="Rupang Time Rules" description="One current entitlement rule for each active Time-Based Event Code. Existing coverage remains unchanged." summary={`${rules.length} rules`} defaultExpanded={false}>
    <div className={styles.campaignActions}><Button size="sm" variant={mode === "INQUIRY" ? "primary" : "secondary"} onClick={() => setMode("INQUIRY")} disabled={busy}>Inquiry</Button><Button size="sm" variant={mode === "EDIT" ? "primary" : "secondary"} onClick={() => setMode("EDIT")} disabled={busy || !codes.length}>Edit rule</Button><Button size="sm" disabled={busy || mode !== "EDIT" || !selected} onClick={prepare}>Execute</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => void load()}>Reload</Button></div>
    {message ? <div className="ui-alert ui-alert-success">{message}</div> : null}{error ? <div className="ui-alert ui-alert-error">{error}</div> : null}
    {!codes.length ? <p>No active TIME_BASED Event Code yet.</p> : <div className={styles.campaignFields}>
      <label>Event Code<select value={selected} disabled={busy || mode !== "EDIT"} onChange={event => choose(event.target.value)}>{codes.map(code => <option key={code.id} value={code.id}>{code.code} - {code.eventName}{ruleByCode.has(code.id) ? "" : " (rule needed)"}</option>)}</select></label>
      <label>Unit amount (IDR)<input type="number" min="0.01" step="0.01" value={draft.unitAmount} disabled={busy || mode !== "EDIT"} onChange={event => setDraft(value => ({ ...value, unitAmount: event.target.value }))} /></label>
      <label>Duration (months)<input type="number" min="1" max="1200" value={draft.durationMonths} disabled={busy || mode !== "EDIT"} onChange={event => setDraft(value => ({ ...value, durationMonths: Number(event.target.value) }))} /></label>
      <label>Status<select value={draft.activeFlag ? "ACTIVE" : "INACTIVE"} disabled={busy || mode !== "EDIT"} onChange={event => setDraft(value => ({ ...value, activeFlag: event.target.value === "ACTIVE" }))}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></label>
      <label className={styles.campaignRemark}>Remark<input maxLength={1000} value={draft.remark ?? ""} disabled={busy || mode !== "EDIT"} onChange={event => setDraft(value => ({ ...value, remark: event.target.value || null }))} /></label>
      {chosen && draft.unitAmount ? <p className={styles.campaignProgress}>{chosen.eventName}: Rp{Number(draft.unitAmount || 0).toLocaleString("id-ID")} = {draft.durationMonths} month{draft.durationMonths === 1 ? "" : "s"}</p> : null}
    </div>}
    <ConfirmDialog open={confirm} title="Confirm Time Rule Execute" message="Save this current Time Rule? Historical coverage will keep its recorded snapshots." loading={busy} onCancel={() => setConfirm(false)} onConfirm={execute} />
  </CollapsibleSection>;
}
