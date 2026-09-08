"use client";

import { useState } from "react";
import { RotateCcw, Play } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { PageHeader } from "@/components/ui/PageHeader";
import { EventCodeMatchingRule } from "./EventCodeMatchingRule";
import { EventCodeSummary } from "./EventCodeSummary";
import { EventCodeTable } from "./EventCodeTable";
import { BulkUploadEventCodesModal } from "./BulkUploadEventCodesModal";
import { getEventCodeTemplate } from "../api/event-code.api";
import { useEventCodes } from "../hooks/useEventCodes";
import type { EventCodeInput } from "../types";
import styles from "../styles/event-code.module.css";

export function EventCodeScreen() {
  const eventCodes = useEventCodes();
  const [executeOpen, setExecuteOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [templateDownloading, setTemplateDownloading] = useState(false);
  const [templateError, setTemplateError] = useState("");

  function addRow() {
    eventCodes.setSearch("");
    eventCodes.setStatusFilter("ALL");
    eventCodes.addDraft();
  }

  async function downloadTemplate() {
    setTemplateDownloading(true);
    setTemplateError("");
    try {
      const result = await getEventCodeTemplate();
      const url = URL.createObjectURL(result.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setTemplateError(error instanceof Error ? error.message : "Unable to download the Event Code template.");
      throw error;
    } finally {
      setTemplateDownloading(false);
    }
  }

  function stageBulkDrafts(inputs: EventCodeInput[]) {
    eventCodes.setSearch("");
    eventCodes.setStatusFilter("ALL");
    return eventCodes.addBulkDrafts(inputs);
  }

  return (
    <div className={`${styles.page} page-stack`}>
      <PageHeader
        breadcrumb={["Configuration", "Event Code"]}
        title="Event Code"
        description="Maintain the editable 3-digit codes used to automatically classify incoming bank statement transactions."
        actions={(
          <>
            <Button
              type="button"
              variant="secondary"
              icon={<RotateCcw size={16} />}
              onClick={eventCodes.clearChanges}
              disabled={eventCodes.loading || eventCodes.saving}
            >
              Clear
            </Button>
            <Button
              type="button"
              icon={<Play size={16} />}
              onClick={() => {
                if (eventCodes.prepareExecute()) setExecuteOpen(true);
              }}
              disabled={eventCodes.loading || eventCodes.saving}
            >
              {eventCodes.saving ? "Executing..." : "Execute"}
            </Button>
          </>
        )}
      />

      {eventCodes.message ? <div className="ui-alert ui-alert-success">{eventCodes.message}</div> : null}
      {eventCodes.error ? <div className="ui-alert ui-alert-error">{eventCodes.error}</div> : null}
      {templateError ? <div className="ui-alert ui-alert-error">{templateError}</div> : null}

      <EventCodeSummary {...eventCodes.summary} />
      <EventCodeMatchingRule />

      <EventCodeTable
        items={eventCodes.items}
        search={eventCodes.search}
        statusFilter={eventCodes.statusFilter}
        mode={eventCodes.mode}
        loading={eventCodes.loading}
        disabled={eventCodes.saving}
        templateDownloading={templateDownloading}
        onSearchChange={eventCodes.setSearch}
        onStatusFilterChange={eventCodes.setStatusFilter}
        onModeChange={eventCodes.changeMode}
        onDownloadTemplate={() => void downloadTemplate().catch(() => undefined)}
        onBulkUpload={() => setBulkOpen(true)}
        onReload={() => void eventCodes.refresh()}
        onCellChange={eventCodes.updateCell}
        onDelete={eventCodes.removeRow}
        totalCount={eventCodes.allItems.length}
        onAdd={addRow}
      />
      <BulkUploadEventCodesModal
        open={bulkOpen}
        stagedCodes={eventCodes.allItems.filter((item) => item.isDraft).map((item) => item.code)}
        onClose={() => setBulkOpen(false)}
        onDownloadTemplate={downloadTemplate}
        onStage={stageBulkDrafts}
      />
      <ConfirmDialog
        open={executeOpen}
        title="Confirm Execute"
        message="Are you sure you want to execute these changes?"
        confirmLabel="Execute"
        loading={eventCodes.saving}
        onCancel={() => setExecuteOpen(false)}
        onConfirm={async () => {
          await eventCodes.executeChanges();
          setExecuteOpen(false);
        }}
      />
    </div>
  );
}
