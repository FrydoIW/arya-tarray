"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import { AlertCircle, CheckCircle2, Download, FileSpreadsheet, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { previewEventCodeBulkUpload } from "../api/event-code.api";
import type { EventCodeBulkPreview, EventCodeInput } from "../types";
import styles from "../styles/event-code.module.css";

type BulkUploadEventCodesModalProps = {
  open: boolean;
  stagedCodes: string[];
  onClose: () => void;
  onDownloadTemplate: () => Promise<void>;
  onStage: (inputs: EventCodeInput[]) => boolean;
};

export function BulkUploadEventCodesModal({
  open,
  stagedCodes,
  onClose,
  onDownloadTemplate,
  onStage
}: BulkUploadEventCodesModalProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<EventCodeBulkPreview | null>(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [processing, setProcessing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const canStage = Boolean(
    preview
    && preview.rowsDetected > 0
    && preview.readyCount === preview.rowsDetected
    && preview.invalidCount === 0
    && preview.rows.every((row) => row.activeFlag !== null && row.errors.length === 0)
  );

  useEffect(() => {
    if (open) return;
    setPreview(null);
    setFileName("");
    setError("");
    setProcessing(false);
    setDragging(false);
    if (inputRef.current) inputRef.current.value = "";
  }, [open]);

  async function processFile(file?: File) {
    if (!file || processing) return;
    setPreview(null);
    setFileName(file.name);
    setError("");
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      setError("Unsupported file type. Please upload an .xlsx workbook.");
      return;
    }

    setProcessing(true);
    try {
      setPreview(await previewEventCodeBulkUpload(file, stagedCodes));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to read the workbook.");
    } finally {
      setProcessing(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (!processing) void processFile(event.dataTransfer.files[0]);
  }

  async function handleTemplateDownload() {
    setDownloading(true);
    try {
      await onDownloadTemplate();
    } catch {
      setError("Unable to download the Event Code template.");
    } finally {
      setDownloading(false);
    }
  }

  function addDrafts() {
    if (!preview || !canStage) return;
    const inputs = preview.rows.flatMap<EventCodeInput>((row) => row.activeFlag === null ? [] : [{
      code: row.code,
      eventName: row.eventName,
      category: row.category,
      description: row.description,
      activeFlag: row.activeFlag
    }]);
    if (inputs.length !== preview.rows.length) return;
    if (!onStage(inputs)) {
      setError("The Event Code workspace changed after validation. Upload the workbook again to refresh its checks.");
      return;
    }
    onClose();
  }

  return (
    <Modal
      open={open}
      title="Bulk Upload Event Codes"
      description="Upload the completed Event Code template. Rows are staged first and saved only after Execute."
      onClose={() => { if (!processing) onClose(); }}
    >
      <div className={styles.bulkModalBody}>
        <div
          className={`${styles.bulkDropZone} ${dragging ? styles.dragging : ""} ${processing ? styles.processing : ""}`}
          onDragEnter={(event) => { event.preventDefault(); if (!processing) setDragging(true); }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
          onDrop={handleDrop}
        >
          <input
            ref={inputRef}
            className={styles.fileInput}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            disabled={processing}
            onChange={(event) => void processFile(event.target.files?.[0])}
          />
          <span className={styles.bulkUploadIcon}><UploadCloud size={24} /></span>
          <strong>{processing ? "Reading and validating workbook..." : "Drop .xlsx file here"}</strong>
          <span>{fileName || "or choose the completed Event Code template"}</span>
          <Button type="button" variant="outline" size="sm" icon={<FileSpreadsheet size={15} />} disabled={processing} onClick={() => inputRef.current?.click()}>
            Choose Excel File
          </Button>
          <small>Supported format: .xlsx · Maximum file size: 5MB</small>
        </div>

        <div className={styles.templateHint}>
          <span>Need a clean copy of the workbook?</span>
          <Button type="button" variant="ghost" size="sm" icon={<Download size={15} />} disabled={processing || downloading} onClick={() => void handleTemplateDownload()}>
            {downloading ? "Downloading..." : "Download Template"}
          </Button>
        </div>

        {error ? <div className={`${styles.bulkNotice} ${styles.bulkError}`} role="alert"><AlertCircle size={17} /> <span>{error}</span></div> : null}

        {preview ? (
          <div className={styles.previewArea} aria-live="polite">
            <div className={styles.previewSummary}>
              <div><span>Rows detected</span><strong>{preview.rowsDetected}</strong></div>
              <div className={styles.readyMetric}><span>Ready to add</span><strong>{preview.readyCount}</strong></div>
              <div className={preview.invalidCount ? styles.invalidMetric : ""}><span>Invalid rows</span><strong>{preview.invalidCount}</strong></div>
            </div>
            <div className={styles.previewFile}><FileSpreadsheet size={16} /><span>{preview.fileName}</span></div>
            {preview.invalidCount > 0 ? (
              <div className={`${styles.bulkNotice} ${styles.bulkError}`}><AlertCircle size={17} /><span>Fix every invalid row in the workbook, then upload it again. No drafts have been added.</span></div>
            ) : (
              <div className={`${styles.bulkNotice} ${styles.bulkReady}`}><CheckCircle2 size={17} /><span>All rows are valid and ready to be added as drafts.</span></div>
            )}
            <div className={styles.previewTableWrap}>
              <table className={styles.previewTable}>
                <thead><tr><th>Row</th><th>Event Code</th><th>Event Name</th><th>Category</th><th>Status</th><th>Result</th></tr></thead>
                <tbody>
                  {preview.rows.map((row) => (
                    <tr key={row.rowNumber}>
                      <td>{row.rowNumber}</td>
                      <td><strong className={styles.previewCode}>{row.code || "—"}</strong></td>
                      <td>{row.eventName || "—"}</td>
                      <td>{row.category || "—"}</td>
                      <td>{row.status || "—"}</td>
                      <td>{row.errors.length > 0
                        ? <ul className={styles.previewErrors}>{row.errors.map((message) => <li key={message}>{message}</li>)}</ul>
                        : <span className={styles.readyBadge}>Ready</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>
      <footer className={styles.bulkModalFooter}>
        <Button type="button" variant="secondary" disabled={processing} onClick={onClose}>Cancel</Button>
        <Button type="button" disabled={processing || !canStage} onClick={addDrafts}>
          {preview ? `Add ${preview.readyCount} Draft${preview.readyCount === 1 ? "" : "s"}` : "Add Drafts"}
        </Button>
      </footer>
    </Modal>
  );
}
