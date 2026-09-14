import ExcelJS from "exceljs";
import { HttpError } from "../../../lib/http.js";
import { eventCodeExecuteValueSchema } from "./event-code.schema.js";

const SHEET_NAME = "Event Codes";
const REQUIRED_HEADERS = ["Event Code", "Event Name", "Category", "Description", "Status"] as const;
const OPTIONAL_HEADERS = ["Type"] as const;

type HeaderName = typeof REQUIRED_HEADERS[number] | typeof OPTIONAL_HEADERS[number];

export type EventCodeBulkPreviewRow = {
  rowNumber: number;
  code: string;
  eventName: string;
  category: string | null;
  description: string | null;
  eventType: string;
  status: string;
  activeFlag: boolean | null;
  errors: string[];
};

export type EventCodeBulkPreview = {
  rowsDetected: number;
  readyCount: number;
  invalidCount: number;
  rows: EventCodeBulkPreviewRow[];
};

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function rawCellText(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value).trim();
  if (value instanceof Date) return value.toISOString();
  if ("richText" in value) return value.richText.map((part) => part.text).join("").trim();
  if ("text" in value && typeof value.text === "string") return value.text.trim();
  if ("result" in value && value.result !== undefined && value.result !== null) return String(value.result).trim();
  return cell.text.trim();
}

function eventCodeCellText(cell: ExcelJS.Cell) {
  if (typeof cell.value === "number" && Number.isInteger(cell.value) && cell.value >= 0) {
    return String(cell.value).padStart(3, "0");
  }
  return rawCellText(cell);
}

function findHeaderColumns(sheet: ExcelJS.Worksheet) {
  const headerRow = sheet.getRow(1);
  const columns = new Map<HeaderName, number>();
  const expectedByKey = new Map([...REQUIRED_HEADERS, ...OPTIONAL_HEADERS].map((header) => [normalizeHeader(header), header]));

  headerRow.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
    const header = expectedByKey.get(normalizeHeader(rawCellText(cell)));
    if (header) columns.set(header, columnNumber);
  });

  for (const header of REQUIRED_HEADERS) {
    if (!columns.has(header)) {
      throw new HttpError(400, `Required column '${header}' was not found.`);
    }
  }

  return columns;
}

function schemaErrors(row: EventCodeBulkPreviewRow) {
  const result = eventCodeExecuteValueSchema.safeParse({
    code: row.code,
    eventName: row.eventName,
    category: row.category,
    eventType: row.eventType,
    description: row.description,
    activeFlag: row.activeFlag ?? false
  });
  if (result.success) return [];

  return result.error.issues.map((issue) => {
    const field = issue.path[0];
    if (field === "code") return row.code ? "Event Code must contain exactly 3 digits." : "Event Code is required.";
    if (field === "eventName") return row.eventName ? "Event Name must not exceed 150 characters." : "Event Name is required.";
    if (field === "category") return "Category must not exceed 50 characters.";
    if (field === "eventType") return "Type must be STANDARD, CAMPAIGN, or TIME_BASED.";
    if (field === "description") return "Description must not exceed 500 characters.";
    return issue.message;
  });
}

export async function createEventCodeTemplate() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Arya Tarray";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(SHEET_NAME, {
    views: [{ state: "frozen", ySplit: 1 }]
  });
  sheet.columns = [
    { header: "Event Code", key: "code", width: 16 },
    { header: "Event Name", key: "eventName", width: 32 },
    { header: "Category", key: "category", width: 22 },
    { header: "Description", key: "description", width: 46 },
    { header: "Status", key: "status", width: 16 },
    { header: "Type", key: "eventType", width: 18 }
  ];
  sheet.autoFilter = "A1:F1";
  sheet.getRow(1).height = 24;
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).alignment = { vertical: "middle" };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF7A1F2B" } };
  sheet.getColumn(1).numFmt = "000";
  for (let rowNumber = 2; rowNumber <= 1000; rowNumber += 1) {
    sheet.getCell(`E${rowNumber}`).dataValidation = {
      type: "list",
      allowBlank: false,
      formulae: ['"Active,Inactive"'],
      showErrorMessage: true,
      errorTitle: "Invalid status",
      error: "Choose Active or Inactive."
    };
    sheet.getCell(`F${rowNumber}`).dataValidation = { type: "list", allowBlank: true,
      formulae: ['"STANDARD,CAMPAIGN,TIME_BASED"'], showErrorMessage: true,
      errorTitle: "Invalid type", error: "Choose STANDARD, CAMPAIGN, or TIME_BASED." };
  }

  const instructions = workbook.addWorksheet("Instructions");
  instructions.columns = [{ width: 24 }, { width: 88 }];
  instructions.addRow(["Event Code Bulk Upload", "Complete the Event Codes sheet, then upload it from Configuration > Event Code."]);
  instructions.addRow([]);
  instructions.addRow(["Field", "Requirement"]);
  instructions.addRow(["Event Code", "Required. Exactly 3 digits and unique. Enter leading zeroes explicitly, for example 091."]);
  instructions.addRow(["Event Name", "Required. Maximum 150 characters."]);
  instructions.addRow(["Category", "Optional. Maximum 50 characters. Values are imported exactly as supplied; no mapping is inferred."]);
  instructions.addRow(["Description", "Optional. Maximum 500 characters."]);
  instructions.addRow(["Status", "Required. Choose Active or Inactive."]);
  instructions.addRow(["Type", "Optional. Choose STANDARD, CAMPAIGN, or TIME_BASED. Blank defaults to STANDARD."]);
  instructions.addRow([]);
  instructions.addRow(["Important", "Blank rows are ignored. Existing or already-staged Event Codes are rejected and never overwritten."]);
  instructions.addRow(["Saving", "Upload validates and stages rows only. Nothing is saved until Execute is confirmed."]);
  instructions.addRow(["Example", "091 | Dana Kegiatan | DONASI | Optional description | Active | CAMPAIGN"]);
  instructions.getRow(1).font = { bold: true, size: 14, color: { argb: "FF7A1F2B" } };
  instructions.getRow(3).font = { bold: true, color: { argb: "FFFFFFFF" } };
  instructions.getRow(3).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF7A1F2B" } };
  instructions.getColumn(2).alignment = { wrapText: true, vertical: "top" };

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export async function parseEventCodeBulkWorkbook(
  buffer: Buffer,
  conflicts: { existingCodes: Iterable<string>; stagedCodes: Iterable<string> }
): Promise<EventCodeBulkPreview> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(new Uint8Array(buffer).buffer);
  } catch {
    throw new HttpError(400, "Unable to read the workbook.");
  }

  const sheet = workbook.worksheets.find((candidate) => candidate.name.trim().toLowerCase() === SHEET_NAME.toLowerCase());
  if (!sheet) throw new HttpError(400, `Worksheet '${SHEET_NAME}' was not found.`);
  const columns = findHeaderColumns(sheet);
  const existingCodes = new Set(Array.from(conflicts.existingCodes, (code) => code.trim()));
  const stagedCodes = new Set(Array.from(conflicts.stagedCodes, (code) => code.trim()).filter(Boolean));
  const rows: EventCodeBulkPreviewRow[] = [];

  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const source = sheet.getRow(rowNumber);
    const code = eventCodeCellText(source.getCell(columns.get("Event Code")!));
    const eventName = rawCellText(source.getCell(columns.get("Event Name")!));
    const categoryText = rawCellText(source.getCell(columns.get("Category")!));
    const descriptionText = rawCellText(source.getCell(columns.get("Description")!));
    const statusText = rawCellText(source.getCell(columns.get("Status")!));
    const typeText = columns.has("Type") ? rawCellText(source.getCell(columns.get("Type")!)) : "";
    if (![code, eventName, categoryText, descriptionText, statusText, typeText].some(Boolean)) continue;

    const normalizedStatus = statusText.trim().toLowerCase();
    const activeFlag = normalizedStatus === "active" ? true : normalizedStatus === "inactive" ? false : null;
    const row: EventCodeBulkPreviewRow = {
      rowNumber,
      code: code.trim(),
      eventName: eventName.trim(),
      category: categoryText.trim() || null,
      description: descriptionText.trim() || null,
      eventType: typeText.trim().toUpperCase() || "STANDARD",
      status: activeFlag === true ? "Active" : activeFlag === false ? "Inactive" : statusText.trim(),
      activeFlag,
      errors: []
    };

    if (activeFlag === null) {
      row.errors.push(statusText.trim() ? "Status must be Active or Inactive." : "Status is required.");
    }
    row.errors.push(...schemaErrors(row));
    if (existingCodes.has(row.code)) row.errors.push(`Event Code ${row.code} already exists.`);
    if (stagedCodes.has(row.code)) row.errors.push(`Event Code ${row.code} is already staged.`);
    rows.push(row);
  }

  if (rows.length === 0) throw new HttpError(400, "The workbook does not contain any Event Code rows.");

  const rowsByCode = new Map<string, EventCodeBulkPreviewRow[]>();
  for (const row of rows) {
    if (!row.code) continue;
    const matches = rowsByCode.get(row.code) ?? [];
    matches.push(row);
    rowsByCode.set(row.code, matches);
  }
  for (const [code, matches] of rowsByCode) {
    if (matches.length < 2) continue;
    const rowNumbers = matches.map((row) => row.rowNumber).join(" and ");
    for (const row of matches) row.errors.push(`Duplicate Event Code ${code} found on rows ${rowNumbers}.`);
  }

  const invalidCount = rows.filter((row) => row.errors.length > 0).length;
  return {
    rowsDetected: rows.length,
    readyCount: rows.length - invalidCount,
    invalidCount,
    rows
  };
}
