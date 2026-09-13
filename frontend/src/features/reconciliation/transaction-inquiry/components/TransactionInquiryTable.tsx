"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Eye, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { PeriodPicker } from "@/components/ui/PeriodPicker";
import { SearchInput } from "@/components/ui/SearchInput";
import { Select } from "@/components/ui/Select";
import { formatDate, formatMoney } from "@/lib/format";
import type { TransactionInquiryBankAccount, TransactionInquiryEvent, TransactionInquiryMember, TransactionInquiryMemberLinkStatus, TransactionInquiryPeriodMode, TransactionInquiryRow, TransactionInquiryStatus } from "../types";
import { eventLabel, formatPeriodLabel, getLifecycleLabel, periodContext } from "../utils/transaction-inquiry.utils";
import styles from "../styles/transaction-inquiry.module.css";

type Props = {
  rows: TransactionInquiryRow[];
  bankAccounts: TransactionInquiryBankAccount[];
  periodMode: TransactionInquiryPeriodMode;
  month: string;
  date: string;
  maxMonth: string;
  maxDate: string;
  search: string;
  status: TransactionInquiryStatus;
  bankAccountId: string;
  finalEventId: string;
  memberId: string;
  memberLinkStatus: TransactionInquiryMemberLinkStatus;
  memberSearch: string;
  memberOptions: TransactionInquiryMember[];
  selectedMember: TransactionInquiryMember | null;
  memberOptionsLoading: boolean;
  canViewMemberData: boolean;
  eventOptions: TransactionInquiryEvent[];
  page: number;
  pageSize: number;
  total: number;
  loading: boolean;
  detailLoading: boolean;
  onPeriodChange: (value: { mode: TransactionInquiryPeriodMode; month: string; date: string }) => void;
  onSearchChange: (value: string) => void;
  onStatusChange: (value: TransactionInquiryStatus) => void;
  onBankAccountChange: (value: string) => void;
  onFinalEventChange: (value: string) => void;
  onMemberSearchChange: (value: string) => void;
  onMemberOptionsRequest: () => void;
  onMemberChange: (value: string) => void;
  onMemberLinkStatusChange: (value: TransactionInquiryMemberLinkStatus) => void;
  onPageChange: (value: number) => void;
  onPageSizeChange: (value: number) => void;
  onReload: () => void;
  onView: (transactionId: string) => void;
};

function typeOf(row: TransactionInquiryRow) {
  return row.originalAmount.trim().startsWith("-") ? "Outgoing" : "Incoming";
}

function eventDisplay(row: TransactionInquiryRow, event: TransactionInquiryRow["finalEvent"]) {
  return typeOf(row) === "Outgoing" ? "Outgoing" : eventLabel(event);
}

function memberLabel(member: TransactionInquiryMember) {
  return `${member.memberCode} - ${member.memberName}${member.activeFlag ? "" : " · Inactive"}`;
}

export function TransactionInquiryTable(props: Props) {
  const columns = useMemo<DataTableColumn<TransactionInquiryRow>[]>(() => [
    { key: "transactionDate", header: "Date", minWidth: "110px", sticky: "left", render: (row) => <span className={styles.primaryCell}>{formatDate(row.transactionDate)}</span> },
    { key: "bankAccount", header: "Bank Account", minWidth: "180px", render: (row) => <span className={styles.primaryCell}>{row.bankAccount.bankCode} - {row.bankAccount.accountNo}</span> },
    { key: "description", header: "Description", minWidth: "245px", render: (row) => <div className={styles.descriptionCell}><strong>{row.description || row.senderName || "-"}</strong><small>{[row.sourceType === "MANUAL" ? "MANUAL" : null, row.referenceNo || row.senderName || null].filter(Boolean).join(" · ")}</small></div> },
    { key: "member", header: "Member", minWidth: "175px", render: (row) => row.member ? (
      <div className={styles.memberCell}>
        {props.canViewMemberData ? <Link href={`/member/data/${row.member.memberId}`}>{row.member.memberCode}</Link> : <strong>{row.member.memberCode}</strong>}
        <small>{row.member.memberName}{row.member.activeFlag ? "" : " · Inactive"}</small>
      </div>
    ) : <span className={styles.unlinkedMember}>Belum Terhubung</span> },
    { key: "originalAmount", header: "Amount", minWidth: "130px", align: "right", render: (row) => <span className={`${styles.amountCell} ${Number(row.originalAmount) < 0 ? styles.debitAmount : ""}`}>{formatMoney(Math.abs(Number(row.originalAmount)))}</span> },
    { key: "type", header: "Type", minWidth: "96px", render: (row) => <span className={`${styles.typeBadge} ${typeOf(row) === "Incoming" ? styles.credit : styles.debit}`}>{typeOf(row)}</span> },
    { key: "suggestedEvent", header: "Suggested Event", minWidth: "160px", render: (row) => <span className={styles.eventText}>{eventDisplay(row, row.suggestedEvent)}</span> },
    { key: "finalEvent", header: "Final Event", minWidth: "160px", render: (row) => <span className={styles.eventText}>{eventDisplay(row, row.finalEvent)}</span> },
    { key: "status", header: "Status", minWidth: "135px", render: (row) => <span className={`${styles.statusBadge} ${styles[`status${row.status}`]}`}>{getLifecycleLabel(row.status)}</span> },
    { key: "action", header: "Action", minWidth: "90px", sticky: "right", align: "center", render: (row) => <Button type="button" variant="outline" size="sm" icon={<Eye size={13} />} disabled={props.detailLoading} onClick={() => props.onView(row.id)}>View</Button> }
  ], [props.canViewMemberData, props.detailLoading, props.onView]);

  const selectableMembers = props.selectedMember && !props.memberOptions.some((member) => member.memberId === props.selectedMember?.memberId)
    ? [props.selectedMember, ...props.memberOptions]
    : props.memberOptions;

  return (
    <CollapsibleSection
      className={styles.tablePanel}
      title="Transaction Inquiry"
      description={`Search and review reconciliation transactions ${periodContext(props.periodMode, props.month, props.date)}.`}
      summary={`${props.total} transactions`}
      defaultExpanded={false}
      actions={<div className={styles.toolbar}>
          <PeriodPicker className={styles.periodFilter} value={{ mode: props.periodMode, month: props.month, date: props.date }} maxMonth={props.maxMonth} maxDate={props.maxDate} disabled={props.loading} ariaLabel="Transaction Inquiry period" onChange={props.onPeriodChange} />
          <SearchInput className={styles.searchFilter} value={props.search} disabled={props.loading} placeholder="Search description or reference" onChange={(event) => props.onSearchChange(event.target.value)} />
          <Select className={styles.statusFilter} value={props.status} disabled={props.loading} onChange={(event) => props.onStatusChange(event.target.value as TransactionInquiryStatus)} aria-label="Transaction status">
            <option value="ALL">All Status</option><option value="RAW">Draft</option><option value="CHECK">Pending Approval</option><option value="FINALIZED">Complete</option>
          </Select>
          <Select className={styles.bankFilter} value={props.bankAccountId} disabled={props.loading} onChange={(event) => props.onBankAccountChange(event.target.value)} aria-label="Bank account">
            <option value="ALL">All Bank Accounts</option>
            {props.bankAccounts.map((account) => <option key={account.id} value={account.id}>{account.bankCode} - {account.accountNo}</option>)}
          </Select>
          <Select className={styles.eventFilter} value={props.finalEventId} disabled={props.loading} onChange={(event) => props.onFinalEventChange(event.target.value)} aria-label="Final Event">
            <option value="ALL">All Events</option>
            {props.eventOptions.map((event) => <option key={event.id} value={event.id}>{event.code} - {event.eventName}{event.activeFlag ? "" : " (Inactive)"}</option>)}
          </Select>
          <div className={styles.memberFilterGroup}>
            <SearchInput value={props.memberSearch} placeholder="Find Member" aria-label="Search Member options" aria-busy={props.memberOptionsLoading} onFocus={props.onMemberOptionsRequest} onChange={(event) => { props.onMemberOptionsRequest(); props.onMemberSearchChange(event.target.value); }} />
            <Select value={props.memberId} disabled={props.loading || props.memberOptionsLoading} onFocus={props.onMemberOptionsRequest} onChange={(event) => props.onMemberChange(event.target.value)} aria-label="Member">
              <option value="ALL">All Members</option>
              {selectableMembers.map((member) => <option key={member.memberId} value={member.memberId}>{memberLabel(member)}</option>)}
            </Select>
          </div>
          <Select className={styles.memberLinkFilter} value={props.memberLinkStatus} disabled={props.loading} onChange={(event) => props.onMemberLinkStatusChange(event.target.value as TransactionInquiryMemberLinkStatus)} aria-label="Member link status">
            <option value="ALL">All Member Links</option><option value="LINKED">Linked</option><option value="UNLINKED">Unlinked</option>
          </Select>
          <Button className={styles.reloadButton} type="button" variant="secondary" size="md" icon={<RotateCw size={14} className={props.loading ? "spin" : ""} />} disabled={props.loading} onClick={props.onReload}>Reload</Button>
        </div>}
    >
      <DataTable
        rows={props.rows}
        columns={columns}
        rowKey={(row) => row.id}
        loading={props.loading}
        minWidth="1475px"
        emptyState={{ title: `No transactions ${periodContext(props.periodMode, props.month, props.date)}`, description: "Choose another period or adjust the search and filters." }}
        pagination={{ mode: "server", page: props.page, pageSize: props.pageSize, total: props.total, pageSizeOptions: [10, 25, 50, 100], onPageChange: props.onPageChange, onPageSizeChange: props.onPageSizeChange }}
      />
    </CollapsibleSection>
  );
}
