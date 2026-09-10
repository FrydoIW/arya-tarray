"use client";

import { useEffect, useState } from "react";
import { FileDown } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import type { TransactionInquiryBankAccount, TransactionInquiryEvent, TransactionInquiryMember, TransactionInquiryMemberLinkStatus, TransactionInquiryPeriodMode, TransactionInquiryStatus, TransactionReportOptions } from "../types";
import { formatPeriodLabel, getLifecycleLabel } from "../utils/transaction-inquiry.utils";
import styles from "../styles/transaction-inquiry.module.css";

export function GenerateReportModal(props: {
  open: boolean;
  period: { mode: TransactionInquiryPeriodMode; month: string; date: string };
  search: string;
  status: TransactionInquiryStatus;
  bankAccountId: string;
  finalEventId: string;
  member: TransactionInquiryMember | null;
  memberLinkStatus: TransactionInquiryMemberLinkStatus;
  bankAccounts: TransactionInquiryBankAccount[];
  eventOptions: TransactionInquiryEvent[];
  loading: boolean;
  onClose: () => void;
  onGenerate: (options: TransactionReportOptions) => Promise<boolean>;
}) {
  const [options, setOptions] = useState<TransactionReportOptions>({ includeFinancialSummary: true, includeClassificationSummary: true, includeTransactionDetail: true });
  useEffect(() => { if (props.open) setOptions({ includeFinancialSummary: true, includeClassificationSummary: true, includeTransactionDetail: true }); }, [props.open]);
  const selectedBank = props.bankAccounts.find((item) => item.id === props.bankAccountId);
  const selectedEvent = props.eventOptions.find((item) => item.id === props.finalEventId);
  const valid = options.includeFinancialSummary || options.includeClassificationSummary || options.includeTransactionDetail;

  async function generate() {
    if (!valid) return;
    if (await props.onGenerate(options)) props.onClose();
  }

  return (
    <Modal open={props.open} title="Generate Transaction Report" description="Generate a proper PDF reconciliation report using the current inquiry filters." onClose={props.onClose}>
      <div className={styles.reportModalBody}>
        <div className={styles.reportFilters}>
          <div><span>Period</span><strong>{formatPeriodLabel(props.period.mode, props.period.month, props.period.date)}</strong></div>
          <div><span>Bank Account</span><strong>{selectedBank ? `${selectedBank.bankCode} - ${selectedBank.accountNo}` : "All Bank Accounts"}</strong></div>
          <div><span>Status</span><strong>{props.status === "ALL" ? "All Status" : getLifecycleLabel(props.status)}</strong></div>
          <div><span>Final Event</span><strong>{selectedEvent ? `${selectedEvent.code} - ${selectedEvent.eventName}${selectedEvent.activeFlag ? "" : " (Inactive)"}` : "All Final Events"}</strong></div>
          <div><span>Member</span><strong>{props.member ? `${props.member.memberCode} - ${props.member.memberName}${props.member.activeFlag ? "" : " · Inactive"}` : "All Members"}</strong></div>
          <div><span>Member Link</span><strong>{props.memberLinkStatus === "LINKED" ? "Linked" : props.memberLinkStatus === "UNLINKED" ? "Unlinked" : "All"}</strong></div>
          <div><span>Search</span><strong>{props.search || "No search filter"}</strong></div>
        </div>
        <div className={styles.reportSections}>
          <h3>Report sections</h3>
          <label><input type="checkbox" checked={options.includeFinancialSummary} onChange={(event) => setOptions((current) => ({ ...current, includeFinancialSummary: event.target.checked }))} /><span><strong>Financial Summary</strong><small>Total credit, total debit, net movement, and transaction counts.</small></span></label>
          <label><input type="checkbox" checked={options.includeClassificationSummary} onChange={(event) => setOptions((current) => ({ ...current, includeClassificationSummary: event.target.checked }))} /><span><strong>Income Classification Summary</strong><small>Incoming amounts grouped by current Final Event.</small></span></label>
          <label><input type="checkbox" checked={options.includeTransactionDetail} onChange={(event) => setOptions((current) => ({ ...current, includeTransactionDetail: event.target.checked }))} /><span><strong>Transaction Detail</strong><small>All filtered transaction rows, independent of the current table page.</small></span></label>
        </div>
        {!valid ? <div className="ui-alert ui-alert-error">Select at least one report section.</div> : null}
        <div className={styles.reportActions}>
          <Button type="button" variant="secondary" disabled={props.loading} onClick={props.onClose}>Cancel</Button>
          <Button type="button" icon={<FileDown size={15} />} disabled={!valid || props.loading} onClick={() => void generate()}>{props.loading ? "Generating…" : "Generate PDF"}</Button>
        </div>
      </div>
    </Modal>
  );
}
