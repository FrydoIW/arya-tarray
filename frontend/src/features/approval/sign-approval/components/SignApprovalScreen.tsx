"use client";

import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { useSignApprovalWorkspace } from "../hooks/useSignApprovalWorkspace";
import { ApprovalDetailView } from "./ApprovalDetailView";
import { ApprovalQueueTable } from "./ApprovalQueueTable";
import { ApprovalTabs } from "./ApprovalTabs";
import { SignApprovalFlow } from "./SignApprovalFlow";
import { SignApprovalSummary } from "./SignApprovalSummary";
import styles from "../styles/sign-approval.module.css";

type ApprovalTab = "QUEUE" | "DETAIL";

export function SignApprovalScreen() {
  const queue = useSignApprovalWorkspace();
  const [activeTab, setActiveTab] = useState<ApprovalTab>("QUEUE");
  const [selectedApprovalId, setSelectedApprovalId] = useState<string | null>(null);

  function review(approvalId: string) {
    setSelectedApprovalId(approvalId);
    setActiveTab("DETAIL");
  }

  function backToQueue() {
    setActiveTab("QUEUE");
  }

  async function afterDecision() {
    await queue.refresh();
    setSelectedApprovalId(null);
    setActiveTab("QUEUE");
  }

  return (
    <div className={`${styles.page} page-stack`}>
      <PageHeader
        breadcrumb={["Approval Line", "Sign Approval"]}
        title="Sign Approval"
        description="Review and decide statement uploads awaiting your approval."
      />

      <ApprovalTabs
        activeTab={activeTab}
        detailEnabled={Boolean(selectedApprovalId)}
        onChange={setActiveTab}
      />

      {activeTab === "QUEUE" ? (
        <>
          {queue.error ? <div className="ui-alert ui-alert-error">{queue.error}</div> : null}
          {!queue.loading && queue.workspace.summary.legacyPendingApproval > 0 ? (
            <div className="ui-alert ui-alert-error">
              {queue.workspace.summary.legacyPendingApproval} legacy pending approval request(s) have no approver snapshot and cannot be actioned. Resolve them operationally before deploying this feature; no current-configuration fallback is used.
            </div>
          ) : null}
          <SignApprovalSummary summary={queue.workspace.summary} />
          <SignApprovalFlow />
          <ApprovalQueueTable
            items={queue.filteredApprovals}
            search={queue.search}
            statusFilter={queue.statusFilter}
            loading={queue.loading}
            disabled={queue.loading}
            onSearchChange={queue.setSearch}
            onStatusFilterChange={queue.setStatusFilter}
            onReload={() => void queue.refresh()}
            onReview={review}
          />
        </>
      ) : (
        <ApprovalDetailView
          approvalId={selectedApprovalId}
          onBack={backToQueue}
          onDecided={afterDecision}
        />
      )}
    </div>
  );
}
