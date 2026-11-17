"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { MoneyInput } from "@/components/ui/MoneyInput";
import { formatMoney } from "@/lib/format";
import { adjustItemSaleStock, configureItemSale, getEventCodeChildren, getItemSaleConfig, updateItemSalePrice } from "../api/event-code.api";
import type { EventCode, EventCodeChild, ItemSaleConfigDetail } from "../types";
import styles from "../styles/event-code.module.css";

const requestKey = () => `ITEM-SALE-${crypto.randomUUID()}`;

export function ItemSaleInventorySection({ eventCodes, masterDirty }: { eventCodes: EventCode[]; masterDirty: boolean }) {
  const itemParents = useMemo(() => new Set(eventCodes.filter(item => item.eventType === "ITEM_SALE").map(item => item.id)), [eventCodes]);
  const [items, setItems] = useState<EventCodeChild[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<ItemSaleConfigDetail | null>(null);
  const [unitPrice, setUnitPrice] = useState("");
  const [quantity, setQuantity] = useState(0);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadItems = useCallback(async () => {
    const rows = (await getEventCodeChildren()).filter(item => itemParents.has(item.eventCodeId));
    setItems(rows);
    setSelectedId(current => rows.some(item => item.id === current) ? current : rows[0]?.id ?? "");
  }, [itemParents]);
  const loadDetail = useCallback(async (childId: string) => {
    if (!childId) { setDetail(null); return; }
    setBusy(true); setError("");
    try { const value = await getItemSaleConfig(childId); setDetail(value); setUnitPrice(value.itemSaleConfig?.unitPrice ?? ""); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Failed to load item inventory."); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void loadItems().catch(caught => setError(caught instanceof Error ? caught.message : "Failed to load items.")); }, [loadItems]);
  useEffect(() => { void loadDetail(selectedId); }, [loadDetail, selectedId]);

  async function submit(kind: "CONFIGURE" | "PRICE" | "STOCK_IN" | "ADJUST") {
    if (!selectedId || !reason.trim()) { setError("A reason is required for every inventory change."); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      if (kind === "CONFIGURE") await configureItemSale(selectedId, { unitPrice, openingStock: quantity, reason: reason.trim(), idempotencyKey: requestKey() });
      else if (kind === "PRICE") await updateItemSalePrice(selectedId, { unitPrice, expectedVersion: detail!.itemSaleConfig!.version, reason: reason.trim() });
      else await adjustItemSaleStock(selectedId, { movementType: kind === "STOCK_IN" ? "STOCK_IN" : "MANUAL_ADJUSTMENT", quantityDelta: quantity, expectedVersion: detail!.itemSaleConfig!.version, reason: reason.trim(), idempotencyKey: requestKey() });
      setMessage(kind === "PRICE" ? "Unit price updated." : kind === "CONFIGURE" ? "Item inventory configured." : "Stock movement recorded.");
      setQuantity(0); setReason(""); await loadDetail(selectedId); await loadItems();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Inventory change failed."); }
    finally { setBusy(false); }
  }

  return <CollapsibleSection className={styles.sectionPanel} title="ITEM_SALE inventory" description="Configure physical item price and append-only inventory movements. Inventory is separate from subscription capacity." summary={`${items.length} items`} defaultExpanded={false}>
    <div className={styles.campaignBody}>
      {message ? <div className="ui-alert ui-alert-success">{message}</div> : null}
      {error ? <div className="ui-alert ui-alert-error">{error}</div> : null}
      {masterDirty ? <div className="ui-alert ui-alert-error">Execute Event Code changes before editing item inventory.</div> : null}
      {!items.length ? <p>No ITEM_SALE Child is available. Create and execute an ITEM_SALE Event Code and Child first.</p> : <>
        <div className={styles.campaignFields}>
          <label>Physical item<select value={selectedId} disabled={busy || masterDirty} onChange={event => setSelectedId(event.target.value)}>{items.map(item => <option key={item.id} value={item.id}>{item.childCode} - {item.childName}</option>)}</select></label>
          <label>Unit price (IDR)<MoneyInput value={unitPrice} disabled={busy || masterDirty} onValueChange={setUnitPrice} /></label>
          <label>{detail?.itemSaleConfig ? "Quantity delta" : "Opening stock"}<input type="number" value={quantity} disabled={busy || masterDirty} onChange={event => setQuantity(Number(event.target.value) || 0)} /></label>
          <label className={styles.campaignRemark}>Reason<input value={reason} maxLength={1000} disabled={busy || masterDirty} onChange={event => setReason(event.target.value)} /></label>
        </div>
        <div className={styles.campaignActions}>
          {!detail?.itemSaleConfig ? <Button disabled={busy || masterDirty || !unitPrice || quantity < 0} onClick={() => void submit("CONFIGURE")}>Configure item</Button> : <>
            <Button variant="secondary" disabled={busy || masterDirty || !unitPrice} onClick={() => void submit("PRICE")}>Update price</Button>
            <Button disabled={busy || masterDirty || quantity <= 0} onClick={() => void submit("STOCK_IN")}>Receive stock</Button>
            <Button variant="outline" disabled={busy || masterDirty || quantity === 0} onClick={() => void submit("ADJUST")}>Manual adjustment</Button>
          </>}
          <Button variant="outline" disabled={busy || !selectedId} onClick={() => void loadDetail(selectedId)}>Reload</Button>
        </div>
        {detail?.itemSaleConfig ? <div className={styles.campaignProgress}>On hand: {detail.itemSaleConfig.stockOnHand} · Unit price: {formatMoney(detail.itemSaleConfig.unitPrice)} · Version: {detail.itemSaleConfig.version}</div> : <p>This item has no price or opening stock configuration yet.</p>}
        {detail?.itemSaleInventoryMovements.length ? <div className="ui-table-wrap"><table className="ui-table"><thead><tr><th>Date</th><th>Type</th><th>Delta</th><th>Before</th><th>After</th><th>Reason</th><th>Actor</th></tr></thead><tbody>{detail.itemSaleInventoryMovements.map(row => <tr key={row.id}><td>{new Date(row.createdAt).toLocaleString("en-GB")}</td><td>{row.movementType}</td><td>{row.quantityDelta > 0 ? `+${row.quantityDelta}` : row.quantityDelta}</td><td>{row.stockBefore}</td><td>{row.stockAfter}</td><td>{row.reason}</td><td>{row.createdBy.fullName}</td></tr>)}</tbody></table></div> : null}
      </>}
    </div>
  </CollapsibleSection>;
}
