"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { History, RefreshCw, WalletCards } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { Modal } from "@/components/ui/Modal";
import { MoneyInput } from "@/components/ui/MoneyInput";
import { formatMoney } from "@/lib/format";
import { allocateItemSaleWallet, getItemSaleWallet, reverseItemSaleWalletAllocation } from "../api/event-code.api";
import type { ItemSaleWalletFund, ItemSaleWalletSummary } from "../types";
import styles from "../styles/event-code.module.css";

const requestKey = () => `ITEM-SALE-WALLET-${crypto.randomUUID()}`;
const amount = (value: string) => Number(value || 0);

export function ItemSaleWalletSection() {
  const [wallet, setWallet] = useState<ItemSaleWalletSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [allocation, setAllocation] = useState<{ sourceFundId: string; purchaseId: string; amount: string; reason: string; key: string } | null>(null);
  const [detail, setDetail] = useState<ItemSaleWalletFund | null>(null);
  const [reversal, setReversal] = useState<{ allocationId: string; reason: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try { setWallet(await getItemSaleWallet()); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Failed to load ITEM_SALE wallet."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const pending = wallet?.pendingPurchases ?? [];
  const funds = wallet?.funds ?? [];
  const eligibleFunds = useMemo(() => (purchaseId: string) => {
    const purchase = pending.find(row => row.purchaseId === purchaseId);
    return funds.filter(fund => fund.status !== "REVERSED" && amount(fund.unallocatedAmount) > 0
      && (!purchase?.buyerMember || fund.ownerMember?.id === purchase.buyerMember.id));
  }, [funds, pending]);

  function openAllocation(purchaseId: string) {
    const purchase = pending.find(row => row.purchaseId === purchaseId);
    const candidates = eligibleFunds(purchaseId);
    setError(""); setMessage("");
    setAllocation({ sourceFundId: candidates[0]?.id ?? "", purchaseId, amount: purchase?.shortfall ?? "", reason: "", key: requestKey() });
  }

  async function submitAllocation() {
    if (!allocation) return;
    if (!allocation.sourceFundId) { setError("Select a wallet source fund."); return; }
    if (!allocation.purchaseId) { setError("Select a pending purchase."); return; }
    if (amount(allocation.amount) <= 0) { setError("Allocation amount must be positive."); return; }
    if (allocation.reason.trim().length < 3) { setError("A reason of at least 3 characters is required."); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      await allocateItemSaleWallet({ sourceFundId: allocation.sourceFundId, purchaseId: allocation.purchaseId, amount: allocation.amount, reason: allocation.reason.trim(), idempotencyKey: allocation.key });
      setMessage("Wallet allocation recorded. The purchase was retried against stock and buyer validation.");
      setAllocation(null);
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Wallet allocation failed."); }
    finally { setBusy(false); }
  }

  async function submitReversal() {
    if (!reversal) return;
    if (reversal.reason.trim().length < 3) { setError("A reversal reason of at least 3 characters is required."); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      await reverseItemSaleWalletAllocation(reversal.allocationId, reversal.reason.trim());
      setMessage("Wallet allocation reversed.");
      setReversal(null); setDetail(null);
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Wallet reversal failed."); }
    finally { setBusy(false); }
  }

  return <CollapsibleSection className={styles.sectionPanel} title="Item Sale Wallet" description="Customer liability, SUSPENSE ownership, pending purchases, and authorized wallet allocation. Bank amounts never change."
    summary={wallet ? `${formatMoney(wallet.summary.totalUnallocated)} unallocated · ${wallet.summary.pendingCount} pending` : "Loading"} defaultExpanded={false}>
    <div className={styles.campaignBody}>
      {message ? <div className="ui-alert ui-alert-success">{message}</div> : null}
      {error ? <div className="ui-alert ui-alert-error">{error}</div> : null}
      <div className={styles.itemSaleActions} style={{ marginBottom: 12 }}>
        <Button type="button" variant="secondary" size="sm" icon={<RefreshCw size={14} />} disabled={loading || busy} onClick={() => void load()}>{loading ? "Memuat…" : "Reload wallet"}</Button>
      </div>
      {loading && !wallet ? <p className={styles.itemSaleEmpty}>Memuat wallet…</p> : null}
      {wallet ? <>
        <div className={styles.itemSaleFacts}>
          <div><span>Original bank funds</span><strong>{formatMoney(wallet.summary.totalOriginal)}</strong></div>
          <div><span>Confirmed sale allocation</span><strong>{formatMoney(wallet.summary.totalSaleAllocated)}</strong></div>
          <div><span>Wallet unallocated</span><strong>{formatMoney(wallet.summary.totalUnallocated)}</strong></div>
          <div><span>Allocated to purchases</span><strong>{formatMoney(wallet.summary.totalOtherAllocated)}</strong></div>
          <div><span>SUSPENSE liability</span><strong>{formatMoney(wallet.summary.suspenseUnallocated)}</strong></div>
          <div><span>Pending purchases</span><strong>{wallet.summary.pendingCount} ({wallet.summary.pendingStockCount} stock / {wallet.summary.pendingBuyerCount} buyer)</strong></div>
        </div>

        <h4>Pending purchases and funding shortfall</h4>
        {!pending.length ? <p className={styles.itemSaleEmpty}>Tidak ada purchase pending.</p> : <div className="ui-table-wrap"><table className="ui-table"><thead><tr><th>Buyer</th><th>Item</th><th>Status</th><th>Total</th><th>Bank</th><th>Wallet</th><th>Shortfall</th><th>Stock</th><th>Source</th><th>Action</th></tr></thead><tbody>
          {pending.map(row => <tr key={row.purchaseId}>
            <td>{row.buyerMember ? `${row.buyerMember.memberCode} - ${row.buyerMember.memberName}` : "Unverified / unlinked"}</td>
            <td>{row.item ? `${row.item.childCode} - ${row.item.childName}` : "—"}</td>
            <td>{row.status}{row.reason ? <small>{row.reason}</small> : null}</td>
            <td>{formatMoney(row.totalAmount)}</td><td>{formatMoney(row.bankAmount)}</td><td>{formatMoney(row.walletAppliedAmount)}</td>
            <td>{amount(row.shortfall) > 0 ? formatMoney(row.shortfall) : "—"}</td>
            <td>{row.stockOnHand ?? "—"}</td>
            <td>{row.sourceBankTransaction.referenceNo ?? row.sourceBankTransaction.id}</td>
            <td>{amount(row.shortfall) > 0 && row.buyerVerified ? <Button type="button" size="sm" disabled={busy || !eligibleFunds(row.purchaseId).length} onClick={() => openAllocation(row.purchaseId)}>Allocate wallet</Button> : <span>—</span>}</td>
          </tr>)}
        </tbody></table></div>}

        <h4>Wallet by verified member</h4>
        {!wallet.members.length ? <p className={styles.itemSaleEmpty}>Belum ada saldo wallet.</p> : <div className="ui-table-wrap"><table className="ui-table"><thead><tr><th>Member</th><th>Status</th><th>Wallet balance</th></tr></thead><tbody>
          {wallet.members.map(member => <tr key={member.memberId || "SUSPENSE"}><td>{member.suspense ? "SUSPENSE — belum terverifikasi" : `${member.memberCode} - ${member.memberName}`}</td><td>{member.suspense ? "SUSPENSE" : "VERIFIED"}</td><td>{formatMoney(member.walletBalance)}</td></tr>)}
        </tbody></table></div>}

        <h4>Wallet funds / source receipts</h4>
        {!funds.length ? <p className={styles.itemSaleEmpty}>Belum ada ITEM_SALE fund.</p> : <div className="ui-table-wrap"><table className="ui-table"><thead><tr><th>Source bank</th><th>Owner</th><th>Fund</th><th>Original</th><th>Sale</th><th>Wallet allocated</th><th>Unallocated</th><th>Purchase</th><th></th></tr></thead><tbody>
          {funds.map(fund => <tr key={fund.id}>
            <td>{fund.bankTransaction.referenceNo ?? fund.bankTransaction.id}<small>{fund.bankTransaction.statementUpload.fileName}</small></td>
            <td>{fund.ownerMember ? `${fund.ownerMember.memberCode} - ${fund.ownerMember.memberName}` : "SUSPENSE"}</td>
            <td>{fund.status} / {fund.ownershipStatus}</td>
            <td>{formatMoney(fund.originalAmount)}</td><td>{formatMoney(fund.allocatedSaleAmount)}</td><td>{formatMoney(fund.otherAllocatedAmount)}</td><td>{formatMoney(fund.unallocatedAmount)}</td>
            <td>{fund.purchase ? `${fund.purchase.status} · ${fund.purchase.quantity} unit` : "—"}</td>
            <td><Button type="button" variant="ghost" size="sm" icon={<History size={14} />} onClick={() => setDetail(fund)}>Ledger</Button></td>
          </tr>)}
        </tbody></table></div>}
      </> : null}
    </div>

    <Modal open={allocation !== null} title="Allocate wallet to pending purchase" description="Only the same verified buyer's unallocated funds can fund a pending ITEM_SALE purchase. Bank records are never changed." onClose={() => !busy && setAllocation(null)}>
      {allocation ? <div className={styles.itemSaleModalBody}>
        {error ? <div className="ui-alert ui-alert-error">{error}</div> : null}
        <label className={styles.itemSaleField}><span>Source wallet fund</span><select value={allocation.sourceFundId} disabled={busy} onChange={event => setAllocation({ ...allocation, sourceFundId: event.target.value })}>
          <option value="">Select source…</option>{eligibleFunds(allocation.purchaseId).map(fund => <option key={fund.id} value={fund.id}>{fund.bankTransaction.referenceNo ?? fund.id} · {formatMoney(fund.unallocatedAmount)} available</option>)}
        </select></label>
        <label className={styles.itemSaleField}><span>Pending purchase</span><select value={allocation.purchaseId} disabled={busy} onChange={event => { const purchase = pending.find(row => row.purchaseId === event.target.value); setAllocation({ ...allocation, purchaseId: event.target.value, sourceFundId: eligibleFunds(event.target.value)[0]?.id ?? "", amount: purchase?.shortfall ?? "" }); }}>
          <option value="">Select purchase…</option>{pending.filter(row => amount(row.shortfall) > 0 && row.buyerVerified).map(row => <option key={row.purchaseId} value={row.purchaseId}>{row.item?.childCode ?? "ITEM"} · shortfall {formatMoney(row.shortfall)} · {row.buyerMember?.memberCode ?? "buyer"}</option>)}
        </select></label>
        <label className={styles.itemSaleField}><span>Amount</span><MoneyInput value={allocation.amount} disabled={busy} placeholder="Shortfall amount" onValueChange={value => setAllocation({ ...allocation, amount: value })} /></label>
        <label className={styles.itemSaleField}><span>Reason / customer decision</span><textarea rows={3} maxLength={1000} value={allocation.reason} disabled={busy} placeholder="Required audit reason and customer instruction" onChange={event => setAllocation({ ...allocation, reason: event.target.value })} /></label>
        <div className={styles.itemSaleModalFooter}><Button type="button" variant="secondary" disabled={busy} onClick={() => setAllocation(null)}>Cancel</Button><Button type="button" icon={<WalletCards size={14} />} disabled={busy} onClick={() => void submitAllocation()}>{busy ? "Menyimpan…" : "Allocate"}</Button></div>
      </div> : null}
    </Modal>

    <Modal open={detail !== null} title="Wallet ledger" description="Append-only customer liability, allocation, and reversal history." onClose={() => !busy && setDetail(null)}>
      {detail ? <div className={styles.itemSaleModalBody}>
        <div className={styles.itemSaleFacts}><div><span>Original</span><strong>{formatMoney(detail.originalAmount)}</strong></div><div><span>Sale allocation</span><strong>{formatMoney(detail.allocatedSaleAmount)}</strong></div><div><span>Wallet allocated</span><strong>{formatMoney(detail.otherAllocatedAmount)}</strong></div><div><span>Unallocated</span><strong>{formatMoney(detail.unallocatedAmount)}</strong></div></div>
        <div className="ui-table-wrap"><table className="ui-table"><thead><tr><th>Type</th><th>Delta</th><th>Balance</th><th>Reason</th><th>Actor</th><th>Date</th></tr></thead><tbody>
          {detail.entries.map(entry => <tr key={entry.id}><td>{entry.entryType}</td><td>{formatMoney(entry.amountDelta)}</td><td>{formatMoney(entry.balanceAfter)}</td><td>{entry.reason}</td><td>{entry.createdBy.fullName}</td><td>{new Date(entry.createdAt).toLocaleString("en-GB")}</td></tr>)}
        </tbody></table></div>
        {detail.allocations.length ? <div className="ui-table-wrap"><table className="ui-table"><thead><tr><th>Allocation</th><th>Status</th><th>Purchase</th><th>Reason</th><th>Actor</th><th>Action</th></tr></thead><tbody>
          {detail.allocations.map(item => <tr key={item.id}><td>{formatMoney(item.amount)}</td><td>{item.status}{item.reversalReason ? ` · ${item.reversalReason}` : ""}</td><td>{item.purchase ? `${item.purchase.status} · ${item.purchase.id}` : "—"}</td><td>{item.reason}</td><td>{item.createdBy.fullName}</td><td>{item.status === "ACTIVE" && item.purchase?.status !== "CONFIRMED" ? <Button type="button" size="sm" variant="danger" disabled={busy} onClick={() => { setReversal({ allocationId: item.id, reason: "" }); }}>Reverse</Button> : "—"}</td></tr>)}
        </tbody></table></div> : null}
      </div> : null}
    </Modal>

    <Modal open={reversal !== null} title="Reverse wallet allocation" description="The source wallet balance is restored and the destination purchase returns to its funding validation." onClose={() => !busy && setReversal(null)}>
      {reversal ? <div className={styles.itemSaleModalBody}>
        {error ? <div className="ui-alert ui-alert-error">{error}</div> : null}
        <label className={styles.itemSaleField}><span>Reversal reason</span><textarea rows={3} maxLength={1000} value={reversal.reason} disabled={busy} onChange={event => setReversal({ ...reversal, reason: event.target.value })} /></label>
        <div className={styles.itemSaleModalFooter}><Button type="button" variant="secondary" disabled={busy} onClick={() => setReversal(null)}>Cancel</Button><Button type="button" variant="danger" disabled={busy} onClick={() => void submitReversal()}>{busy ? "Memproses…" : "Reverse allocation"}</Button></div>
      </div> : null}
    </Modal>
  </CollapsibleSection>;
}
