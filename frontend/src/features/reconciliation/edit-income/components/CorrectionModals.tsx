"use client";

import { useEffect, useState } from "react";
import { Plus, ShieldMinus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { MoneyInput } from "@/components/ui/MoneyInput";
import { formatMoney } from "@/lib/format";
import type { EditIncomeCampaign, EditIncomeEventCode, EditIncomeEventCodeChild, EditIncomeTransaction, ManualAdjustmentInput } from "../types";
import styles from "../styles/edit-income.module.css";

type AddAdjustmentModalProps = {
  open: boolean;
  defaultDate: string;
  eventCodes: EditIncomeEventCode[];
  eventCodeChildren: EditIncomeEventCodeChild[];
  campaigns: EditIncomeCampaign[];
  disabled: boolean;
  onClose: () => void;
  onSubmit: (input: ManualAdjustmentInput) => void;
};

export function AddAdjustmentModal(props: AddAdjustmentModalProps) {
  const [direction, setDirection] = useState<"INCOMING" | "OUTGOING">("INCOMING");
  const [transactionDate, setTransactionDate] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [eventCodeId, setEventCodeId] = useState("");
  const [eventCodeChildId, setEventCodeChildId] = useState("");
  const [eventCampaignId, setEventCampaignId] = useState("");
  const [itemSaleQuantity, setItemSaleQuantity] = useState("");
  const [remark, setRemark] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!props.open) return;
    setDirection("INCOMING");
    setTransactionDate(props.defaultDate);
    setDescription("");
    setAmount("");
    setEventCodeId("");
    setEventCodeChildId("");
    setEventCampaignId("");
    setItemSaleQuantity("");
    setRemark("");
    setReason("");
    setError("");
  }, [props.defaultDate, props.open]);

  const eligibleChildren = props.eventCodeChildren.filter((child) => child.eventCodeId === eventCodeId && child.activeFlag);

  function submit() {
    if (!transactionDate || !description.trim() || !/^\d{1,18}(?:\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) {
      setError("Date, description, and a positive amount with at most 2 decimals are required.");
      return;
    }
    if (direction === "INCOMING" && !eventCodeId) {
      setError("Final Event is required for an incoming adjustment.");
      return;
    }
    if (direction === "INCOMING" && eligibleChildren.length > 1 && !eventCodeChildId) {
      setError("Child selection is required for this Final Event.");
      return;
    }
    if (direction === "INCOMING" && props.eventCodes.find((item) => item.id === eventCodeId)?.eventType === "CAMPAIGN" && !eventCampaignId) { setError("Campaign is required for this Event Code."); return; }
    const selectedEvent = props.eventCodes.find((item) => item.id === eventCodeId);
    const selectedChildId = eventCodeChildId || (eligibleChildren.length === 1 ? eligibleChildren[0].id : "");
    const selectedChild = eligibleChildren.find(item => item.id === selectedChildId);
    if (direction === "INCOMING" && selectedEvent?.eventType === "ITEM_SALE") {
      const quantity = Number(itemSaleQuantity);
      if (!Number.isInteger(quantity) || quantity <= 0 || !selectedChild?.itemSaleUnitPrice) { setError("ITEM_SALE requires a configured item and positive whole quantity."); return; }
      if (Number(amount) !== Number(selectedChild.itemSaleUnitPrice) * quantity) { setError("ITEM_SALE amount must equal quantity × unit price."); return; }
    }
    if (!reason.trim()) {
      setError("Correction Reason is required.");
      return;
    }
    props.onSubmit({
      direction,
      transactionDate,
      description: description.trim(),
      amount,
      eventCodeId: direction === "INCOMING" ? eventCodeId : null,
      eventCodeChildId: direction === "INCOMING" ? (eventCodeChildId || (eligibleChildren.length === 1 ? eligibleChildren[0].id : null)) : null,
      eventCampaignId: direction === "INCOMING" && props.eventCodes.find((item) => item.id === eventCodeId)?.eventType === "CAMPAIGN" ? eventCampaignId : null,
      itemSaleQuantity: direction === "INCOMING" && selectedEvent?.eventType === "ITEM_SALE" ? Number(itemSaleQuantity) : null,
      remark: remark.trim() || null,
      reason: reason.trim()
    });
    props.onClose();
  }

  return (
    <Modal open={props.open} title="Add Adjustment" description="Create a clearly identified manual proposal; no raw bank evidence is fabricated." onClose={props.onClose}>
      <div className={styles.modalBody}>
        {error ? <div className="ui-alert ui-alert-error">{error}</div> : null}
        <div className={styles.formGrid}>
          <label className={styles.field}><span>Direction</span><select value={direction} disabled={props.disabled} onChange={(event) => { setDirection(event.target.value as "INCOMING" | "OUTGOING"); setEventCodeId(""); }}><option value="INCOMING">Incoming</option><option value="OUTGOING">Outgoing</option></select></label>
          <label className={styles.field}><span>Date</span><input type="date" value={transactionDate} disabled={props.disabled} onChange={(event) => setTransactionDate(event.target.value)} /></label>
          <label className={styles.field}><span>Amount</span><MoneyInput value={amount} disabled={props.disabled} placeholder="500000" onValueChange={setAmount} /></label>
          <label className={styles.field}><span>Final Event</span><select value={eventCodeId} disabled={props.disabled || direction === "OUTGOING"} onChange={(event) => { setEventCodeId(event.target.value); setEventCodeChildId(""); setEventCampaignId(""); }}><option value="">{direction === "OUTGOING" ? "Not applicable" : "Select Event..."}</option>{props.eventCodes.map((eventCode) => <option value={eventCode.id} key={eventCode.id}>{eventCode.code} - {eventCode.eventName}{eventCode.activeFlag ? "" : " (Inactive)"}</option>)}</select></label>
          {direction === "INCOMING" && eligibleChildren.length > 1 && <label className={styles.field}><span>Child</span><select value={eventCodeChildId} disabled={props.disabled} onChange={(event) => setEventCodeChildId(event.target.value)}><option value="">Select Child...</option>{eligibleChildren.map((child) => <option key={child.id} value={child.id}>{child.childCode} - {child.childName}</option>)}</select></label>}
          {direction === "INCOMING" && eligibleChildren.length === 1 && <label className={styles.field}><span>Child</span><input value={`${eligibleChildren[0].childCode} - ${eligibleChildren[0].childName} (auto)`} disabled readOnly /></label>}
          {direction === "INCOMING" && props.eventCodes.find((item) => item.id === eventCodeId)?.eventType === "CAMPAIGN" && <label className={styles.field}><span>Campaign</span><select value={eventCampaignId} disabled={props.disabled} onChange={(event) => setEventCampaignId(event.target.value)}><option value="">Select Campaign...</option>{props.campaigns.filter((item) => item.eventCodeId === eventCodeId && item.activeFlag && (!item.startDate || transactionDate >= item.startDate) && (!item.endDate || transactionDate <= item.endDate)).map((item) => <option key={item.id} value={item.id}>{item.campaignName}</option>)}</select></label>}
          {direction === "INCOMING" && props.eventCodes.find((item) => item.id === eventCodeId)?.eventType === "ITEM_SALE" && <label className={styles.field}><span>Quantity</span><input type="number" min={1} step={1} value={itemSaleQuantity} disabled={props.disabled} onChange={event => setItemSaleQuantity(event.target.value)} /></label>}
        </div>
        {direction === "INCOMING" ? <p className={styles.modalHint}>TIME_BASED programs are unavailable for manual adjustments because they require a verified payment identity for sponsorship allocation.</p> : null}
        <label className={styles.field}><span>Description</span><input value={description} maxLength={2000} disabled={props.disabled} placeholder="Manual adjustment description" onChange={(event) => setDescription(event.target.value)} /></label>
        <label className={styles.field}><span>Remark</span><input value={remark} maxLength={1000} disabled={props.disabled} placeholder="Optional business remark" onChange={(event) => setRemark(event.target.value)} /></label>
        <label className={styles.field}><span>Correction Reason</span><textarea value={reason} maxLength={1000} disabled={props.disabled} placeholder="Required audit reason" onChange={(event) => setReason(event.target.value)} /></label>
        <div className={styles.provenanceNote}><strong>Source: MANUAL</strong><span>Added By and Added At are recorded by the backend when this proposal is approved.</span></div>
      </div>
      <div className={styles.modalFooter}><Button type="button" variant="secondary" disabled={props.disabled} onClick={props.onClose}>Cancel</Button><Button type="button" icon={<Plus size={15} />} disabled={props.disabled} onClick={submit}>Add Adjustment</Button></div>
    </Modal>
  );
}

export function ExcludeTransactionModal(props: {
  transaction: EditIncomeTransaction | null;
  disabled: boolean;
  onClose: () => void;
  onSubmit: (transactionId: string, reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { if (props.transaction) { setReason(""); setError(""); } }, [props.transaction]);
  function submit() {
    if (!props.transaction) return;
    if (!reason.trim()) { setError("Correction Reason is required."); return; }
    props.onSubmit(props.transaction.id, reason.trim());
    props.onClose();
  }
  return (
    <Modal open={Boolean(props.transaction)} title="Exclude from reconciliation" description="The imported bank transaction remains preserved as raw statement evidence." onClose={props.onClose}>
      <div className={styles.modalBody}>
        {error ? <div className="ui-alert ui-alert-error">{error}</div> : null}
        <div className={styles.excludeEvidence}><strong>{props.transaction?.description || "Bank transaction"}</strong><span>{props.transaction ? formatMoney(props.transaction.originalAmount) : ""}</span></div>
        <label className={styles.field}><span>Correction Reason</span><textarea autoFocus value={reason} maxLength={1000} disabled={props.disabled} placeholder="Duplicate import, imported incorrectly, or another operator reason" onChange={(event) => setReason(event.target.value)} /></label>
      </div>
      <div className={styles.modalFooter}><Button type="button" variant="secondary" disabled={props.disabled} onClick={props.onClose}>Cancel</Button><Button type="button" variant="danger" icon={<ShieldMinus size={15} />} disabled={props.disabled} onClick={submit}>Exclude</Button></div>
    </Modal>
  );
}
