"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { MoneyInput } from "@/components/ui/MoneyInput";
import { formatMoney } from "@/lib/format";
import { invalidateWorkspaceCache } from "@/lib/workspace-cache";
import { invalidateMonitoringWorkspaces } from "@/lib/monitoring-cache";
import { executeChildChanges, executeTimeRules, getEventCodeChildren, getTimeRules } from "../api/event-code.api";
import type { ChildInput, EventCode, EventCodeChild, EventTimeRule, TimeRuleInput } from "../types";
import styles from "../styles/event-code.module.css";

const emptyRule: TimeRuleInput = { unitAmount: "", durationMonths: 1, activeFlag: true, remark: null };
function parentInputOf(rule: EventTimeRule): TimeRuleInput {
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

type ChildRuleInput = { unitAmount: string; durationMonths: number; capacity: number | null };

function childRuleOf(item: EventCodeChild): ChildRuleInput {
  return { unitAmount: item.unitAmount ?? "", durationMonths: item.durationMonths ?? 1, capacity: item.capacity };
}
function childRuleValid(item: EventCodeChild, input: ChildRuleInput) {
  return /^\d{1,18}(?:\.\d{1,2})?$/.test(input.unitAmount.trim()) && Number(input.unitAmount) > 0
    && Number.isInteger(input.durationMonths) && input.durationMonths >= 1 && input.durationMonths <= 1200
    && input.capacity !== null && Number.isInteger(input.capacity) && input.capacity >= 1
    && input.capacity >= item.occupiedSlots;
}
function childRuleChanged(item: EventCodeChild, input: ChildRuleInput) {
  return (item.unitAmount ?? "") !== input.unitAmount.trim()
    || (item.durationMonths ?? null) !== input.durationMonths
    || item.capacity !== input.capacity;
}
function childFullInput(item: EventCodeChild, rule: ChildRuleInput): ChildInput {
  return {
    eventCodeId: item.eventCodeId,
    childCode: item.childCode,
    childName: item.childName,
    description: item.description,
    displayOrder: item.displayOrder,
    activeFlag: item.activeFlag,
    capacity: rule.capacity,
    unitAmount: rule.unitAmount.trim(),
    durationMonths: rule.durationMonths
  };
}

export function EventTimeRuleSection({ eventCodes, masterDirty }: { eventCodes: EventCode[]; masterDirty: boolean }) {
  const [rules, setRules] = useState<EventTimeRule[]>([]);
  const [children, setChildren] = useState<EventCodeChild[]>([]);
  const [selected, setSelected] = useState("");
  const [drafts, setDrafts] = useState<Record<string, TimeRuleInput>>({});
  const [mode, setMode] = useState<"INQUIRY" | "EDIT">("INQUIRY");
  const [childMode, setChildMode] = useState<"INQUIRY" | "EDIT">("INQUIRY");
  const [childDrafts, setChildDrafts] = useState<Record<string, ChildRuleInput>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [childConfirm, setChildConfirm] = useState(false);
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

  const childItems = useMemo(() => children.filter(item => item.eventCodeId === selectedId), [children, selectedId]);
  const childCount = childItems.length;

  const baselineFor = useCallback((eventCodeId: string): TimeRuleInput => {
    const persistedRule = ruleByCode.get(eventCodeId);
    return persistedRule ? parentInputOf(persistedRule) : emptyRule;
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
      const [timeRules, childRows] = await Promise.all([getTimeRules(), getEventCodeChildren()]);
      setRules(timeRules);
      setChildren(childRows);
      setDrafts({});
      setChildDrafts({});
      setMode("INQUIRY");
      setChildMode("INQUIRY");
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
    setMessage("");
    setChildDrafts({});
    setChildMode("INQUIRY");
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
      setMessage(`${updates.length} Parent Time Rule change${updates.length === 1 ? "" : "s"} executed. Existing coverage keeps its recorded rule snapshot.`);
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

  // Child subscription rules (Area 2)
  function changeChild(childId: string, field: keyof ChildRuleInput, value: string | number | null) {
    const item = childItems.find(child => child.id === childId);
    if (!item) return;
    setChildDrafts(current => ({
      ...current,
      [childId]: { ...(current[childId] ?? childRuleOf(item)), [field]: value }
    }));
    setError("");
    setMessage("");
  }
  function childDraftOf(item: EventCodeChild) {
    return childDrafts[item.id] ?? childRuleOf(item);
  }
  const changedChildren = useMemo(
    () => childItems.filter(item => childRuleChanged(item, childDraftOf(item))),
    [childItems, childDrafts]
  );
  const changedChildrenValid = changedChildren.every(item => childRuleValid(item, childDraftOf(item)));
  function prepareChildRules() {
    if (masterDirty) { setError("Execute Event Code changes first."); return; }
    if (changedChildren.length === 0) { setMessage("No Child rule changes to execute."); return; }
    const invalid = changedChildren.find(item => !childRuleValid(item, childDraftOf(item)));
    if (invalid) {
      setError(`Child ${invalid.childCode}: pastikan harga positif, durasi 1-1200 bulan, dan kapasitas tidak di bawah slot terpakai (${invalid.occupiedSlots}).`);
      return;
    }
    setChildConfirm(true);
  }
  async function executeChildRules() {
    if (changedChildren.length === 0 || !changedChildrenValid) return;
    setBusy(true);
    setError("");
    try {
      const updates = changedChildren.map(item => ({ id: item.id, input: childFullInput(item, childDraftOf(item)) }));
      const result = await executeChildChanges({ creates: [], updates, deletes: [] });
      setChildren(result.items);
      setChildDrafts({});
      setChildMode("INQUIRY");
      setMessage(`${updates.length} Child rule change${updates.length === 1 ? "" : "s"} executed. Existing coverage keeps its recorded snapshot.`);
      invalidateMonitoringWorkspaces(["timeBased"]);
      invalidateWorkspaceCache("reconciliation/statement-upload/workspace");
      invalidateWorkspaceCache("reconciliation/edit-income/workspace");
      invalidateWorkspaceCache("reconciliation/transaction-inquiry/workspace");
      invalidateWorkspaceCache("member/data/workspace");
      setChildConfirm(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save Child rules.");
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

  const childEditing = childMode === "EDIT";

  return <CollapsibleSection
    className={styles.sectionPanel}
    title="Rupang Time Rules"
    description="Satu tempat untuk Parent Default Rule dan konfigurasi subscription tiap TIME_BASED Child (harga, durasi, kapasitas)."
    summary={`${rules.length} parent rules · ${childCount} child subscriptions`}
    defaultExpanded={false}
    actions={<div className={styles.campaignActions}>
      <Button size="sm" variant="outline" disabled={busy || dirtyCount > 0 || changedChildren.length > 0} onClick={() => void load()}>Reload</Button>
    </div>}
  >
    <div className={styles.timeRuleBody}>
      {message ? <div className="ui-alert ui-alert-success">{message}</div> : null}
      {error ? <div className="ui-alert ui-alert-error">{error}</div> : null}
      {masterDirty ? <p>Execute Event Code changes first.</p> : null}
      {!codes.some(code => code.eventType === "TIME_BASED") ? <p>No Time-Based Event Code is available. Change an Event Code Type to TIME_BASED and execute the Event Code changes first.</p> : null}

      {codes.length > 0 ? <>
        <div className={`${styles.campaignFields} ${styles.timeRuleFields}`}>
          <label>Event Code<select value={selectedId} disabled={busy} onChange={event => choose(event.target.value)}>{codes.map(code => <option key={code.id} value={code.id}>{code.code} - {code.eventName}{optionLabel(code)}</option>)}</select></label>
        </div>

        <div className={styles.timeArea}>
          <div className={styles.timeAreaHead}>
            <div><h3>Parent Default / Legacy Rule</h3><p>Berlaku untuk kompatibilitas transaksi dan subscription parent-only yang sah. Bukan nilai live untuk child — tiap child memakai harga dan durasinya sendiri.</p></div>
            <div className={styles.campaignActions}>
              <Button size="sm" variant={mode === "INQUIRY" ? "primary" : "secondary"} disabled={busy} onClick={() => dirtyCount > 0 ? setError("Clear unsaved Parent Rule changes first.") : setMode("INQUIRY")}>Inquiry</Button>
              <Button size="sm" variant={mode === "EDIT" ? "primary" : "secondary"} disabled={busy || !canEdit} onClick={() => setMode("EDIT")}>Edit Parent Rule</Button>
              <Button size="sm" variant="outline" disabled={busy || dirtyCount === 0} onClick={requestClear}>Clear</Button>
              <Button size="sm" disabled={busy || masterDirty || mode !== "EDIT" || dirtyCount === 0 || !allDirtyValid} onClick={prepare}>Execute Parent Rule{dirtyCount > 0 ? ` (${dirtyCount})` : ""}</Button>
            </div>
          </div>
          <div className={`${styles.campaignFields} ${styles.timeRuleFields}`}>
            <label>Unit amount (IDR)<MoneyInput value={current.unitAmount} disabled={busy || mode !== "EDIT" || !canEdit} onValueChange={value => change("unitAmount", value)} /></label>
            <label>Duration (months)<input type="number" min="1" max="1200" value={current.durationMonths} disabled={busy || mode !== "EDIT" || !canEdit} onChange={event => change("durationMonths", Number(event.target.value))} /></label>
            <label>Status<select value={current.activeFlag ? "ACTIVE" : "INACTIVE"} disabled={busy || mode !== "EDIT" || !canEdit} onChange={event => change("activeFlag", event.target.value === "ACTIVE")}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></label>
            <label className={styles.campaignRemark}>Remark<input maxLength={1000} value={current.remark ?? ""} disabled={busy || mode !== "EDIT" || !canEdit} onChange={event => change("remark", event.target.value || null)} /></label>
          </div>
        </div>

        <div className={styles.timeArea}>
          <div className={styles.timeAreaHead}>
            <div><h3>Child Subscription Rules</h3><p>Harga, durasi, dan kapasitas slot tiap child subscription. Terpakai dan tersedia dihitung oleh sistem (read-only).</p></div>
            <div className={styles.campaignActions}>
              <Button size="sm" variant={childMode === "INQUIRY" ? "primary" : "secondary"} disabled={busy || childCount === 0} onClick={() => changedChildren.length > 0 ? setError("Clear unsaved Child rule changes first.") : setChildMode("INQUIRY")}>Inquiry</Button>
              <Button size="sm" variant={childMode === "EDIT" ? "primary" : "secondary"} disabled={busy || masterDirty || childCount === 0} onClick={() => setChildMode("EDIT")}>Edit Rules</Button>
              <Button size="sm" variant="outline" disabled={busy || changedChildren.length === 0} onClick={() => { setChildDrafts({}); setChildMode("INQUIRY"); setError(""); }}>Clear</Button>
              <Button size="sm" disabled={busy || masterDirty || childMode !== "EDIT" || changedChildren.length === 0 || !changedChildrenValid} onClick={prepareChildRules}>Execute Child Rules{changedChildren.length > 0 ? ` (${changedChildren.length})` : ""}</Button>
            </div>
          </div>
          {childCount === 0 ? <p className={styles.timeChildEmpty}>Parent ini belum memiliki Child TIME_BASED. Buat Child melalui Event Code Children, lalu konfigurasikan di sini.</p> : (
            <div className={styles.timeChildList}>
              {childItems.map(item => {
                const draft = childDraftOf(item);
                const changed = childRuleChanged(item, draft);
                const configured = item.unitAmount != null && item.durationMonths != null && item.capacity != null;
                return <article className={`${styles.timeChildCard} ${changed ? styles.timeChildCardModified : ""}`} key={item.id}>
                  <div className={styles.timeChildHead}>
                    <span className={styles.timeChildCode}>{item.childCode}</span>
                    <strong>{item.childName}</strong>
                    <span className={item.activeFlag ? styles.statusBadge : `${styles.statusBadge} ${styles.inactive}`}>{item.activeFlag ? "ACTIVE" : "INACTIVE"}</span>
                    {!configured ? <span className={styles.timeChildIncomplete}>Incomplete</span> : null}
                  </div>
                  <div className={styles.timeChildFacts}>
                    <div><span>Harga / Unit Amount</span>{childEditing ? <MoneyInput value={draft.unitAmount} disabled={busy} placeholder="100000" onValueChange={value => changeChild(item.id, "unitAmount", value)} /> : <strong>{item.unitAmount != null ? formatMoney(item.unitAmount) : "—"}</strong>}</div>
                    <div><span>Durasi</span>{childEditing ? <input type="number" min="1" max="1200" value={draft.durationMonths} disabled={busy} onChange={event => changeChild(item.id, "durationMonths", Number(event.target.value))} /> : <strong>{item.durationMonths != null ? `${item.durationMonths} bulan` : "—"}</strong>}</div>
                    <div><span>Kapasitas</span>{childEditing ? <input type="number" min="1" max="1000000000" value={draft.capacity ?? ""} disabled={busy} onChange={event => changeChild(item.id, "capacity", event.target.value ? Number(event.target.value) : null)} /> : <strong>{item.capacity ?? "—"}</strong>}</div>
                    <div><span>Terpakai</span><strong>{item.occupiedSlots}</strong></div>
                    <div><span>Tersedia</span><strong>{item.availableSlots ?? "—"}</strong></div>
                  </div>
                </article>;
              })}
            </div>
          )}
        </div>
      </> : null}
    </div>
    <ConfirmDialog open={confirm} title="Confirm Parent Rule Execute" message={`Save ${dirtyCount} staged Parent Time Rule change${dirtyCount === 1 ? "" : "s"}? Historical coverage will keep its recorded snapshots.`} loading={busy} confirmLabel="Execute Parent Rule" onCancel={() => setConfirm(false)} onConfirm={execute} />
    <ConfirmDialog open={childConfirm} title="Confirm Child Rules Execute" message={`Save ${changedChildren.length} staged Child rule change${changedChildren.length === 1 ? "" : "s"}? Semua perubahan child disimpan atomic; coverage historis tetap memakai snapshot-nya.`} loading={busy} confirmLabel="Execute Child Rules" onCancel={() => setChildConfirm(false)} onConfirm={executeChildRules} />
    <ConfirmDialog open={clearConfirm} title="Discard staged Parent Rules" message={`Discard ${dirtyCount} staged Parent Time Rule change${dirtyCount === 1 ? "" : "s"}?`} confirmLabel="Clear staged changes" onCancel={() => setClearConfirm(false)} onConfirm={clear} />
  </CollapsibleSection>;
}
