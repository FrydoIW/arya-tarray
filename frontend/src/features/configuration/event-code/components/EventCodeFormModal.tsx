"use client";

import { FormEvent, useEffect, useState } from "react";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import type { EventCode, EventCodeInput } from "../types";

interface EventCodeFormModalProps {
  open: boolean;
  item: EventCode | null;
  saving: boolean;
  onClose: () => void;
  onSubmit: (input: EventCodeInput) => Promise<void>;
}

export function EventCodeFormModal({ open, item, saving, onClose, onSubmit }: EventCodeFormModalProps) {
  const [code, setCode] = useState("");
  const [eventName, setEventName] = useState("");
  const [description, setDescription] = useState("");
  const [activeFlag, setActiveFlag] = useState(true);
  const [validation, setValidation] = useState("");

  useEffect(() => {
    if (!open) return;
    setCode(item?.code ?? "");
    setEventName(item?.eventName ?? "");
    setDescription(item?.description ?? "");
    setActiveFlag(item?.activeFlag ?? true);
    setValidation("");
  }, [item, open]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!/^\d{3}$/.test(code)) {
      setValidation("Event Code must contain exactly 3 digits.");
      return;
    }

    if (!eventName.trim()) {
      setValidation("Event Name is required.");
      return;
    }

    setValidation("");

    try {
      await onSubmit({
        code,
        eventName: eventName.trim(),
        description: description.trim() || null,
        activeFlag
      });
      onClose();
    } catch {
      // The feature hook owns the API error banner.
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={item ? "Edit Event Code" : "Add Event Code"}
      description="Maintain the 3-digit code used to classify incoming bank statement transactions."
    >
      <form className="event-code-form" onSubmit={submit}>
        <div className="event-code-form-grid">
          <label className="event-code-field event-code-code-field">
            <span>3-digit Event Code</span>
            <input
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 3))}
              inputMode="numeric"
              maxLength={3}
              placeholder="045"
              autoFocus
            />
            <small>Example: 017, 058, 075</small>
          </label>

          <label className="event-code-field">
            <span>Event Name</span>
            <input
              value={eventName}
              onChange={(event) => setEventName(event.target.value)}
              maxLength={150}
              placeholder="Waisak"
            />
            <small>Donation or event allocation name.</small>
          </label>

          <label className="event-code-field event-code-field-full">
            <span>Description</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={4}
              maxLength={500}
              placeholder="Optional description for this event code"
            />
          </label>

          <label className="event-code-switch-row event-code-field-full">
            <span>
              <strong>Active Status</strong>
              <small>Only active codes are available for automatic matching.</small>
            </span>
            <input type="checkbox" checked={activeFlag} onChange={(event) => setActiveFlag(event.target.checked)} />
          </label>
        </div>

        {validation ? <div className="ui-alert ui-alert-error">{validation}</div> : null}

        <footer className="event-code-form-actions">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving} icon={<Save size={16} />}>
            {saving ? "Saving…" : item ? "Save Changes" : "Add Event Code"}
          </Button>
        </footer>
      </form>
    </Modal>
  );
}
