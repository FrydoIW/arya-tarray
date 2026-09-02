"use client";

import { ClipboardCheck, Inbox } from "lucide-react";
import styles from "../styles/sign-approval.module.css";

type ApprovalTab = "QUEUE" | "DETAIL";

type ApprovalTabsProps = {
  activeTab: ApprovalTab;
  detailEnabled: boolean;
  onChange: (tab: ApprovalTab) => void;
};

export function ApprovalTabs({ activeTab, detailEnabled, onChange }: ApprovalTabsProps) {
  return (
    <div className={styles.tabs} role="tablist" aria-label="Sign Approval views">
      <button
        type="button"
        role="tab"
        aria-selected={activeTab === "QUEUE"}
        className={activeTab === "QUEUE" ? styles.activeTab : ""}
        onClick={() => onChange("QUEUE")}
      >
        <Inbox size={15} />
        Approval Queue
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={activeTab === "DETAIL"}
        className={activeTab === "DETAIL" ? styles.activeTab : ""}
        disabled={!detailEnabled}
        onClick={() => onChange("DETAIL")}
      >
        <ClipboardCheck size={15} />
        Approval Detail
      </button>
    </div>
  );
}
