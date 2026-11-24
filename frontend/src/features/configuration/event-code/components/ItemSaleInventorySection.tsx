"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Boxes, History, PackageOpen, Pencil, PlusCircle, Scale } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { Modal } from "@/components/ui/Modal";
import { MoneyInput } from "@/components/ui/MoneyInput";
import { formatMoney } from "@/lib/format";
import { adjustItemSaleStock, configureItemSale, getEventCodeChildren, getItemSaleConfig, updateItemSalePrice } from "../api/event-code.api";
import { ItemSaleWalletSection } from "./ItemSaleWalletSection";
import type { EventCode, EventCodeChild, ItemSaleConfigDetail } from "../types";
import styles from "../styles/event-code.module.css";

const requestKey = () => `ITEM-SALE-${crypto.randomUUID()}`;

type ItemSaleModalKind = "CONFIGURE" | "PRICE" | "STOCK_IN" | "ADJUST";

function itemStatus(item: EventCodeChild) {
  if (!item.activeFlag) return "INACTIVE";
  return item.itemSaleUnitPrice == null ? "UNCONFIGURED" : "ACTIVE";
}

export function ItemSaleInventorySection({ eventCodes, masterDirty }: { eventCodes: EventCode[]; masterDirty: boolean }) {
  const itemParents = useMemo(() => new Set(eventCodes.filter(item => item.eventType === "ITEM_SALE").map(item => item.id)), [eventCodes]);
  const [items, setItems] = useState<EventCodeChild[]>([]);
  const [modal, setModal] = useState<{ kind: ItemSaleModalKind; item: EventCodeChild } | null>(null);
  const [historyItem, setHistoryItem] = useState<EventCodeChild | null>(null);
  const [history, setHistory] = useState<ItemSaleConfigDetail | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [unitPrice, setUnitPrice] = useState("");
  const [quantity, setQuantity] = useState(0);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadItems = useCallback(async () => {
    const rows = (await getEventCodeChildren()).filter(item => itemParents.has(item.eventCodeId));
    setItems(rows);
  }, [itemParents]);

  useEffect(() => { void loadItems().catch(caught => setError(caught instanceof Error ? caught.message : "Failed to load items.")); }, [loadItems]);

  function openModal(kind: ItemSaleModalKind, item: EventCodeChild) {
    setError(""); setMessage("");
    setUnitPrice(item.itemSaleUnitPrice ?? "");
    setQuantity(0);
    setReason("");
    setModal({ kind, item });
  }

  function closeModal() {
    if (busy) return;
    setModal(null);
    setError("");
  }

  function openHistory(item: EventCodeChild) {
    setError(""); setMessage("");
    setHistoryItem(item);
    setHistory(null);
    setHistoryLoading(true);
    getItemSaleConfig(item.id)
      .then(setHistory)
      .catch(caught => setError(caught instanceof Error ? caught.message : "Failed to load inventory history."))
      .finally(() => setHistoryLoading(false));
  }

  function closeHistory() {
    setHistoryItem(null);
    setHistory(null);
    setHistoryLoading(false);
  }

  async function submit() {
    if (!modal) return;
    const item = modal.item;
    const reasonText = reason.trim();
    if (reasonText.length < 3) { setError("A reason of at least 3 characters is required for every inventory change."); return; }
    if (modal.kind === "PRICE" && (!unitPrice || Number(unitPrice) <= 0)) { setError("Enter a positive unit price."); return; }
    if (modal.kind === "CONFIGURE" && (!unitPrice || Number(unitPrice) <= 0 || quantity < 0)) { setError("Enter a unit price and a non-negative opening stock."); return; }
    if (modal.kind === "STOCK_IN" && quantity <= 0) { setError("Stock received must be a positive quantity."); return; }
    if (modal.kind === "ADJUST" && quantity === 0) { setError("Adjustment delta must not be zero."); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      if (modal.kind === "CONFIGURE") await configureItemSale(item.id, { unitPrice, openingStock: quantity, reason: reasonText, idempotencyKey: requestKey() });
      else if (modal.kind === "PRICE") await updateItemSalePrice(item.id, { unitPrice, expectedVersion: item.itemSaleVersion!, reason: reasonText });
      else await adjustItemSaleStock(item.id, {
        movementType: modal.kind === "STOCK_IN" ? "STOCK_IN" : "MANUAL_ADJUSTMENT",
        quantityDelta: quantity,
        expectedVersion: item.itemSaleVersion!,
        reason: reasonText,
        idempotencyKey: requestKey()
      });
      setMessage(modal.kind === "PRICE" ? "Unit price updated." : modal.kind === "CONFIGURE" ? "Item inventory configured." : "Stock movement recorded.");
      setModal(null);
      await loadItems();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Inventory change failed."); }
    finally { setBusy(false); }
  }

  const modalTitles: Record<ItemSaleModalKind, string> = {
    CONFIGURE: "Konfigurasi Item",
    PRICE: "Edit Harga",
    STOCK_IN: "Tambah Stok",
    ADJUST: "Sesuaikan Stok"
  };

  return <>
    <CollapsibleSection className={styles.sectionPanel} title="Item Sale" description="Configure physical item price and append-only inventory movements. Inventory is separate from subscription capacity." summary={`${items.length} items`} defaultExpanded={false}>
    <div className={styles.campaignBody}>
      {message ? <div className="ui-alert ui-alert-success">{message}</div> : null}
      {error ? <div className="ui-alert ui-alert-error">{error}</div> : null}
      {masterDirty ? <div className="ui-alert ui-alert-error">Execute Event Code changes before editing item inventory.</div> : null}
      {!items.length ? <p>No ITEM_SALE Child is available. Create and execute an ITEM_SALE Event Code and Child first.</p> : (
        <div className={styles.itemSaleList}>
          {items.map(item => {
            const configured = item.itemSaleUnitPrice != null;
            const status = itemStatus(item);
            return <article className={styles.itemSaleCard} key={item.id}>
              <div className={styles.itemSaleHead}>
                <div className={styles.itemSaleIdentity}><span className={styles.itemSaleCode}><PackageOpen size={13} />{item.childCode}</span><strong>{item.childName}</strong></div>
                <span className={`${styles.itemSaleStatus} ${styles[`itemSaleStatus${status}`]}`}>{status === "UNCONFIGURED" ? "Belum dikonfigurasi" : status === "ACTIVE" ? "Active" : "Inactive"}</span>
              </div>
              <div className={styles.itemSaleFacts}>
                <div><span>Unit price</span><strong>{configured ? formatMoney(item.itemSaleUnitPrice!) : "—"}</strong></div>
                <div><span>Stock on hand</span><strong>{configured ? item.itemSaleStockOnHand : "—"}</strong></div>
              </div>
              <div className={styles.itemSaleActions}>
                {configured ? <>
                  <Button type="button" variant="secondary" size="sm" icon={<Pencil size={14} />} disabled={busy || masterDirty} onClick={() => openModal("PRICE", item)}>Edit Harga</Button>
                  <Button type="button" variant="outline" size="sm" icon={<PlusCircle size={14} />} disabled={busy || masterDirty} onClick={() => openModal("STOCK_IN", item)}>Tambah Stok</Button>
                  <Button type="button" variant="outline" size="sm" icon={<Scale size={14} />} disabled={busy || masterDirty} onClick={() => openModal("ADJUST", item)}>Sesuaikan Stok</Button>
                </> : <Button type="button" size="sm" icon={<Boxes size={14} />} disabled={busy || masterDirty} onClick={() => openModal("CONFIGURE", item)}>Konfigurasi</Button>}
                <Button type="button" variant="ghost" size="sm" icon={<History size={14} />} disabled={busy} onClick={() => openHistory(item)}>Riwayat</Button>
              </div>
            </article>;
          })}
        </div>
      )}
    </div>

    <Modal open={modal !== null} title={modal ? modalTitles[modal.kind] : ""} description={modal ? `Item ${modal.item.childCode} - ${modal.item.childName}` : ""} onClose={closeModal}>
      <div className={styles.itemSaleModalBody}>
        {error ? <div className="ui-alert ui-alert-error">{error}</div> : null}
        {modal?.kind === "PRICE" || modal?.kind === "CONFIGURE" ? <label className={styles.itemSaleField}><span>Unit price (IDR)</span><MoneyInput value={unitPrice} disabled={busy} placeholder="e.g. 150000" onValueChange={setUnitPrice} /></label> : null}
        {modal?.kind === "CONFIGURE" || modal?.kind === "STOCK_IN" || modal?.kind === "ADJUST" ? <label className={styles.itemSaleField}><span>{modal.kind === "CONFIGURE" ? "Opening stock" : modal.kind === "STOCK_IN" ? "Quantity received" : "Adjustment delta (negative = decrease)"}</span><input type="number" value={quantity} min={modal.kind === "STOCK_IN" ? 1 : undefined} step={1} disabled={busy} onChange={event => setQuantity(Number(event.target.value) || 0)} /></label> : null}
        <label className={styles.itemSaleField}><span>Reason</span><textarea rows={3} maxLength={1000} value={reason} disabled={busy} placeholder="Required audit reason" onChange={event => setReason(event.target.value)} /></label>
        <div className={styles.itemSaleModalFooter}>
          <Button type="button" variant="secondary" disabled={busy} onClick={closeModal}>Batal</Button>
          <Button type="button" disabled={busy} onClick={() => void submit()}>{busy ? "Menyimpan…" : "Simpan"}</Button>
        </div>
      </div>
    </Modal>

    <Modal open={historyItem !== null} title="Riwayat Inventory" description={historyItem ? `Item ${historyItem.childCode} - ${historyItem.childName}` : ""} onClose={closeHistory}>
      <div className={styles.itemSaleModalBody}>
        {historyLoading ? <p className={styles.itemSaleEmpty}>Memuat riwayat…</p>
          : !history?.itemSaleInventoryMovements.length ? <p className={styles.itemSaleEmpty}>Belum ada movement.</p>
          : <div className="ui-table-wrap"><table className="ui-table"><thead><tr><th>Date</th><th>Type</th><th>Delta</th><th>Before</th><th>After</th><th>Reason</th><th>Actor</th></tr></thead><tbody>{history.itemSaleInventoryMovements.map(row => <tr key={row.id}>
            <td>{new Date(row.createdAt).toLocaleString("en-GB")}</td>
            <td>{row.movementType}</td>
            <td className={row.quantityDelta > 0 ? styles.itemSaleDeltaIn : styles.itemSaleDeltaOut}>{row.quantityDelta > 0 ? `+${row.quantityDelta}` : row.quantityDelta}</td>
            <td>{row.stockBefore}</td><td>{row.stockAfter}</td><td>{row.reason}</td><td>{row.createdBy.fullName}</td>
          </tr>)}</tbody></table></div>}
      </div>
    </Modal>
  </CollapsibleSection>
  <ItemSaleWalletSection />
  </>;
}
