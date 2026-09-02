import ExcelJS from "exceljs";
import type { BankDirection } from "../reconciliation-classification.js";

export type ParsedStatementTransaction = {
  sourceSheetName: string;
  sourceRowNo: number;
  transactionDate: Date;
  transactionType: string;
  direction: BankDirection;
  referenceNo: string | null;
  senderName: string | null;
  description: string | null;
  amountCents: bigint;
};

export type ParsedStatementSheet = {
  sheetName: string;
  accountNo: string;
  accountName: string | null;
  periodFrom: Date;
  periodTo: Date;
  transactions: ParsedStatementTransaction[];
};

export type ParsedStatementWorkbook = {
  accountNo: string;
  accountName: string | null;
  periodFrom: Date;
  periodTo: Date;
  validSheets: string[];
  transactions: ParsedStatementTransaction[];
};

const BCA_SIGNATURE = "informasi rekening - mutasi rekening";
const MAX_SIGNATURE_ROWS = 20;
const MAX_METADATA_ROWS = 20;
const MAX_METADATA_COLUMNS = 6;

function cleanText(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return String(value).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim() || null;
}

function cellText(cell: ExcelJS.Cell) {
  const value = cell.value;
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object") {
    if ("result" in value && value.result !== undefined && value.result !== null) {
      return cleanText(value.result);
    }
    if ("richText" in value && Array.isArray(value.richText)) {
      return cleanText(value.richText.map((part) => part.text).join(""));
    }
    if ("text" in value && typeof value.text === "string") {
      return cleanText(value.text);
    }
  }
  return cleanText(cell.text || value);
}

function utcDate(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day));
}

function validDate(year: number, month: number, day: number) {
  const value = utcDate(year, month, day);
  return value.getUTCFullYear() === year && value.getUTCMonth() === month - 1 && value.getUTCDate() === day
    ? value
    : null;
}

function excelSerialToDate(value: number) {
  if (!Number.isFinite(value) || value <= 0 || value > 100000) return null;
  const millis = Math.round(value * 86400000);
  const valueDate = new Date(Date.UTC(1899, 11, 30) + millis);
  return utcDate(valueDate.getUTCFullYear(), valueDate.getUTCMonth() + 1, valueDate.getUTCDate());
}

function parseFullDate(raw: string | null) {
  if (!raw) return null;
  const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  return validDate(Number(match[3]), Number(match[2]), Number(match[1]));
}

function parseDateCell(cell: ExcelJS.Cell, periodFrom: Date, periodTo: Date) {
  if (cell.value instanceof Date) {
    return utcDate(cell.value.getFullYear(), cell.value.getMonth() + 1, cell.value.getDate());
  }
  if (typeof cell.value === "number") return excelSerialToDate(cell.value);

  const raw = cellText(cell);
  const full = parseFullDate(raw);
  if (full) return full;
  if (!raw) return null;

  const short = raw.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!short) return null;
  const day = Number(short[1]);
  const month = Number(short[2]);
  const candidateYears = [...new Set([periodFrom.getUTCFullYear(), periodTo.getUTCFullYear()])];

  for (const year of candidateYears) {
    const candidate = validDate(year, month, day);
    if (candidate && candidate >= periodFrom && candidate <= periodTo) return candidate;
  }

  return validDate(periodFrom.getUTCFullYear(), month, day);
}

function parsePeriod(raw: string | null) {
  if (!raw) return null;
  const normalized = raw.replace(/^:\s*/, "").trim();
  const match = normalized.match(/(\d{1,2}\/\d{1,2}\/\d{4})\s*-\s*(\d{1,2}\/\d{1,2}\/\d{4})/);
  if (!match) return null;
  const from = parseFullDate(match[1]);
  const to = parseFullDate(match[2]);
  return from && to ? { from, to } : null;
}

function parseAmount(raw: string | null, transactionType: string | null) {
  if (!raw) return null;
  const rawDirection = raw.match(/\b(CR|DB)\b/i)?.[1]?.toUpperCase() as BankDirection | undefined;
  const typeDirection = transactionType?.match(/\b(CR|DB)\b/i)?.[1]?.toUpperCase() as BankDirection | undefined;
  const direction = rawDirection ?? typeDirection;
  if (direction !== "CR" && direction !== "DB") return null;

  const numberMatch = raw.match(/[-+]?\d[\d,]*(?:\.\d{1,2})?/);
  if (!numberMatch) return null;
  const normalized = numberMatch[0].replace(/,/g, "");
  const decimalMatch = normalized.match(/^([-+]?)(\d+)(?:\.(\d{1,2}))?$/);
  if (!decimalMatch) return null;
  const whole = BigInt(decimalMatch[2]);
  const fraction = BigInt(((decimalMatch[3] ?? "") + "00").slice(0, 2));
  const absoluteCents = whole * 100n + fraction;
  return {
    direction,
    amountCents: direction === "DB" ? -absoluteCents : absoluteCents
  };
}

function hasBcaSignature(sheet: ExcelJS.Worksheet) {
  const rowLimit = Math.min(sheet.actualRowCount, MAX_SIGNATURE_ROWS);
  for (let rowNo = 1; rowNo <= rowLimit; rowNo += 1) {
    const row = sheet.getRow(rowNo);
    for (let col = 1; col <= MAX_METADATA_COLUMNS; col += 1) {
      const value = cellText(row.getCell(col))?.toLowerCase();
      if (value?.includes(BCA_SIGNATURE)) return true;
    }
  }
  return false;
}

function findMetadataValue(sheet: ExcelJS.Worksheet, labels: string[]) {
  const targets = labels.map((label) => label.toLowerCase());
  const rowLimit = Math.min(sheet.actualRowCount, MAX_METADATA_ROWS);
  for (let rowNo = 1; rowNo <= rowLimit; rowNo += 1) {
    const row = sheet.getRow(rowNo);
    for (let col = 1; col <= MAX_METADATA_COLUMNS; col += 1) {
      const current = cellText(row.getCell(col))?.toLowerCase();
      if (!current || !targets.some((label) => current === label || current.startsWith(`${label}:`))) continue;
      for (let nextCol = col + 1; nextCol <= MAX_METADATA_COLUMNS; nextCol += 1) {
        const next = cellText(row.getCell(nextCol));
        if (next) return next.replace(/^:\s*/, "").trim();
      }
    }
  }
  return null;
}

function findTransactionColumns(sheet: ExcelJS.Worksheet) {
  const rowLimit = Math.min(sheet.actualRowCount, 30);
  for (let rowNo = 1; rowNo <= rowLimit; rowNo += 1) {
    const row = sheet.getRow(rowNo);
    const cells = Array.from({ length: Math.min(sheet.actualColumnCount || 8, 8) }, (_, index) => ({
      col: index + 1,
      text: cellText(row.getCell(index + 1))?.toLowerCase() ?? ""
    }));
    const date = cells.find((item) => item.text === "tgl" || item.text === "tanggal");
    const description = cells.find((item) => item.text === "keterangan");
    const amount = cells.find((item) => item.text === "jumlah" || item.text === "amount");
    if (date && description && amount) {
      return { headerRow: rowNo, dateCol: date.col, descriptionCol: description.col, amountCol: amount.col };
    }
  }
  return null;
}

function extractReferenceNo(lines: string[]) {
  for (const line of lines) {
    const ftscy = line.match(/^([0-9]{4}\/FTSCY\/[A-Z0-9]+)/i);
    if (ftscy) return ftscy[1];
    const longReference = line.match(/\b(\d{12,})\b/);
    if (longReference) return longReference[1];
  }
  return null;
}

function extractSenderName(lines: string[], referenceNo: string | null) {
  const candidates = lines.filter((line) => {
    if (referenceNo && line.includes(referenceNo)) return false;
    if (/^TRANSFER\s+(DR|KE)\b/i.test(line)) return false;
    if (/^LLG-/i.test(line)) return false;
    if (/^\(\d+\)/.test(line)) return false;
    return /[A-Za-z]/.test(line);
  });
  return candidates.length > 0 ? candidates[candidates.length - 1] : null;
}

function isMergedChildCell(cell: ExcelJS.Cell) {
  if (!cell.isMerged) return false;
  return cell.master.address !== cell.address;
}

function parseTransactionStart(
  row: ExcelJS.Row,
  columns: { dateCol: number; descriptionCol: number; amountCol: number },
  period: { from: Date; to: Date }
) {
  const dateCell = row.getCell(columns.dateCol);
  const amountCell = row.getCell(columns.amountCol);

  // ExcelJS resolves merged child cells to their master values. BCA statements
  // merge Date/Amount across continuation rows, so a continuation row can look
  // like a complete transaction unless we explicitly reject merged children.
  if (isMergedChildCell(dateCell) || isMergedChildCell(amountCell)) return null;

  const transactionType = cellText(row.getCell(columns.descriptionCol));
  const date = parseDateCell(dateCell, period.from, period.to);
  const amount = parseAmount(cellText(amountCell), transactionType);

  if (!date || !transactionType || !amount) return null;
  return { transactionType, date, amount };
}

function parseStatementSheet(sheet: ExcelJS.Worksheet): ParsedStatementSheet | null {
  if (!hasBcaSignature(sheet)) return null;

  const accountNo = findMetadataValue(sheet, ["No. rekening", "No rekening", "Nomor rekening"]);
  const accountName = findMetadataValue(sheet, ["Nama"]);
  const periodRaw = findMetadataValue(sheet, ["Periode"]);
  const period = parsePeriod(periodRaw);
  const columns = findTransactionColumns(sheet);

  if (!accountNo || !period || !columns) return null;

  const transactions: ParsedStatementTransaction[] = [];
  let rowNo = columns.headerRow + 1;

  while (rowNo <= sheet.actualRowCount) {
    const row = sheet.getRow(rowNo);
    const start = parseTransactionStart(row, columns, period);

    if (!start) {
      rowNo += 1;
      continue;
    }

    const { transactionType, date, amount } = start;

    const continuationLines: string[] = [];
    let cursor = rowNo + 1;
    while (cursor <= sheet.actualRowCount) {
      const nextRow = sheet.getRow(cursor);
      if (parseTransactionStart(nextRow, columns, period)) break;

      const continuation = cellText(nextRow.getCell(columns.descriptionCol));
      if (continuation) continuationLines.push(continuation);
      cursor += 1;
    }

    const referenceNo = extractReferenceNo(continuationLines);
    const senderName = extractSenderName(continuationLines, referenceNo);

    transactions.push({
      sourceSheetName: sheet.name,
      sourceRowNo: rowNo,
      transactionDate: date,
      transactionType,
      direction: amount.direction,
      referenceNo,
      senderName,
      description: continuationLines.length > 0 ? continuationLines.join("\n") : null,
      amountCents: amount.amountCents
    });

    rowNo = cursor;
  }

  return {
    sheetName: sheet.name,
    accountNo,
    accountName,
    periodFrom: period.from,
    periodTo: period.to,
    transactions
  };
}

export function normalizeAccountNumber(value: string) {
  return value.replace(/\D/g, "");
}

export async function parseBcaStatementWorkbook(buffer: Buffer): Promise<ParsedStatementWorkbook> {
  const workbook = new ExcelJS.Workbook();
  try {
    // ExcelJS currently declares an ArrayBuffer-compatible input while Node's
    // Buffer is generic over ArrayBufferLike. Copying into a plain Uint8Array
    // keeps the uploaded workbook bytes intact and satisfies both libraries.
    await workbook.xlsx.load(new Uint8Array(buffer).buffer);
  } catch {
    throw new Error("The uploaded file is not a readable XLSX workbook.");
  }

  const validSheets = workbook.worksheets
    .map(parseStatementSheet)
    .filter((item): item is ParsedStatementSheet => item !== null);

  if (validSheets.length === 0) {
    throw new Error('No valid BCA statement sheet was found. Expected content signature "Informasi Rekening - Mutasi Rekening".');
  }

  const normalizedAccounts = new Set(validSheets.map((sheet) => normalizeAccountNumber(sheet.accountNo)));
  if (normalizedAccounts.size !== 1) {
    throw new Error("The workbook contains BCA statement sheets for different account numbers.");
  }

  const transactions = validSheets.flatMap((sheet) => sheet.transactions);
  if (transactions.length === 0) {
    throw new Error("No bank transactions were found in the valid BCA statement sheets.");
  }

  const periodFrom = validSheets.reduce(
    (minimum, sheet) => sheet.periodFrom < minimum ? sheet.periodFrom : minimum,
    validSheets[0].periodFrom
  );
  const periodTo = validSheets.reduce(
    (maximum, sheet) => sheet.periodTo > maximum ? sheet.periodTo : maximum,
    validSheets[0].periodTo
  );

  return {
    accountNo: validSheets[0].accountNo,
    accountName: validSheets[0].accountName,
    periodFrom,
    periodTo,
    validSheets: validSheets.map((sheet) => sheet.sheetName),
    transactions
  };
}
