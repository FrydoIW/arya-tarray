"use client";

import { useState } from "react";
import { RotateCcw, Play } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { PageHeader } from "@/components/ui/PageHeader";
import { EventCodeMatchingRule } from "./EventCodeMatchingRule";
import { EventCodeSummary } from "./EventCodeSummary";
import { EventCodeTable } from "./EventCodeTable";
import { useEventCodes } from "../hooks/useEventCodes";
import styles from "../styles/event-code.module.css";

export function EventCodeScreen() {
  const eventCodes = useEventCodes();
  const [executeOpen, setExecuteOpen] = useState(false);

  function addRow() {
    eventCodes.setSearch("");
    eventCodes.setStatusFilter("ALL");
    eventCodes.addDraft();
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

      <EventCodeSummary {...eventCodes.summary} />
      <EventCodeMatchingRule />

      <EventCodeTable
        items={eventCodes.items}
        search={eventCodes.search}
        statusFilter={eventCodes.statusFilter}
        loading={eventCodes.loading}
        disabled={eventCodes.saving}
        onSearchChange={eventCodes.setSearch}
        onStatusFilterChange={eventCodes.setStatusFilter}
        onReload={() => void eventCodes.refresh()}
        onCellChange={eventCodes.updateCell}
        onDelete={eventCodes.removeRow}
        totalCount={eventCodes.allItems.length}
        onAdd={addRow}
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
