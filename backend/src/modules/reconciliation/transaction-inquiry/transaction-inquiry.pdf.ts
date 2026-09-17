type PdfReportEventSummary = {
  code: string;
  eventName: string;
  transactions: number;
  amount: string;
};

type PdfReportTransaction = {
  date: string;
  description: string;
  referenceNo: string;
  type: string;
  amount: string;
  finalEvent: string;
  campaign: string;
  member: string;
  status: string;
};

export type TransactionInquiryPdfInput = {
  periodLabel: string;
  bankAccountLabel: string;
  statusLabel: string;
  finalEventLabel: string;
  campaignLabel?: string;
  memberLabel: string;
  memberLinkStatusLabel: string;
  searchLabel: string | null;
  generatedBy: string;
  generatedAt: string;
  summary: {
    totalTransactions: number;
    totalCredit: string;
    totalDebit: string;
    netMovement: string;
    incomingTransactions: number;
    outgoingTransactions: number;
    completeTransactions: number;
  };
  classifications: PdfReportEventSummary[];
  transactions: PdfReportTransaction[];
  includeFinancialSummary: boolean;
  includeClassificationSummary: boolean;
  includeTransactionDetail: boolean;
};

const PAGE_WIDTH = 842;
const PAGE_HEIGHT = 595;
const MARGIN = 36;

export function sanitizeReportDisplayText(value: string) {
  return value
    .replace(/[\u0000-\u001F\u007F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function ascii(value: string) {
  return sanitizeReportDisplayText(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[–—]/g, "-")
    .replace(/[^\x20-\x7E]/g, "?");
}

function escapePdf(value: string) {
  return ascii(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function estimateWidth(text: string, size: number) {
  return ascii(text).length * size * 0.52;
}

function truncate(text: string, maxWidth: number, size: number) {
  const clean = ascii(text);
  if (estimateWidth(clean, size) <= maxWidth) return clean;
  let result = clean;
  while (result.length > 1 && estimateWidth(`${result}...`, size) > maxWidth) result = result.slice(0, -1);
  return `${result}...`;
}

class PdfPage {
  commands: string[] = [];

  text(x: number, top: number, value: string, size = 9, bold = false) {
    const y = PAGE_HEIGHT - top;
    this.commands.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${escapePdf(value)}) Tj ET`);
  }

  line(x1: number, top1: number, x2: number, top2: number, width = 0.5) {
    this.commands.push(`${width} w ${x1} ${PAGE_HEIGHT - top1} m ${x2} ${PAGE_HEIGHT - top2} l S`);
  }

  rect(x: number, top: number, width: number, height: number, fillGray?: number, strokeGray = 0.86) {
    const y = PAGE_HEIGHT - top - height;
    if (fillGray !== undefined) this.commands.push(`${fillGray} g ${x} ${y} ${width} ${height} re f 0 g`);
    this.commands.push(`${strokeGray} G 0.6 w ${x} ${y} ${width} ${height} re S 0 G`);
  }

  content() {
    return this.commands.join("\n");
  }
}

class PdfDocument {
  pages: PdfPage[] = [];
  addPage() { const page = new PdfPage(); this.pages.push(page); return page; }

  build() {
    const objects: string[] = [];
    const pageRefs: number[] = [];
    const contentRefs: number[] = [];
    let next = 5;
    for (let i = 0; i < this.pages.length; i += 1) {
      pageRefs.push(next++);
      contentRefs.push(next++);
    }
    objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
    objects[2] = `<< /Type /Pages /Kids [${pageRefs.map((ref) => `${ref} 0 R`).join(" ")}] /Count ${pageRefs.length} >>`;
    objects[3] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`;
    objects[4] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`;

    this.pages.forEach((page, index) => {
      const content = page.content();
      objects[pageRefs[index]] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentRefs[index]} 0 R >>`;
      objects[contentRefs[index]] = `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`;
    });

    let output = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
    const offsets: number[] = [0];
    for (let id = 1; id < objects.length; id += 1) {
      offsets[id] = Buffer.byteLength(output, "latin1");
      output += `${id} 0 obj\n${objects[id]}\nendobj\n`;
    }
    const xref = Buffer.byteLength(output, "latin1");
    output += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
    for (let id = 1; id < objects.length; id += 1) output += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
    output += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return Buffer.from(output, "latin1");
  }
}

function footer(page: PdfPage, pageNo: number, totalPages: number) {
  page.line(MARGIN, 562, PAGE_WIDTH - MARGIN, 562, 0.4);
  page.text(MARGIN, 577, "Arya Tarray Nusantara - Internal Use Only", 7);
  page.text(PAGE_WIDTH - MARGIN - 62, 577, `Page ${pageNo} of ${totalPages}`, 7);
}

function sectionTitle(page: PdfPage, top: number, title: string) {
  page.text(MARGIN, top, title, 12, true);
  page.line(MARGIN, top + 7, PAGE_WIDTH - MARGIN, top + 7, 0.5);
}

function drawReportHeader(page: PdfPage, input: TransactionInquiryPdfInput) {
  page.text(MARGIN, 39, "ARYA TARRAY NUSANTARA", 11, true);
  page.text(MARGIN, 66, "TRANSACTION INQUIRY REPORT", 20, true);
  page.line(MARGIN, 80, PAGE_WIDTH - MARGIN, 80, 0.7);

  const labels = [
    ["Report Period", input.periodLabel],
    ["Bank Account", input.bankAccountLabel],
    ["Status", input.statusLabel],
    ["Final Event", input.finalEventLabel],
    ["Generated By", input.generatedBy],
    ["Generated At", input.generatedAt]
  ];
  const cellWidth = (PAGE_WIDTH - MARGIN * 2) / labels.length;
  labels.forEach(([label, value], index) => {
    const x = MARGIN + index * cellWidth;
    page.text(x, 99, label, 7, true);
    page.text(x, 116, truncate(value, cellWidth - 10, 8), 8);
  });
  page.text(MARGIN, 134, `Member: ${truncate(input.memberLabel, 350, 8)}`, 8);
  page.text(MARGIN + 390, 134, `Member Link: ${input.memberLinkStatusLabel}`, 8);
  page.text(MARGIN, 148, `Campaign: ${truncate(input.campaignLabel ?? "All Campaigns", 350, 8)}`, 8);
  if (input.searchLabel) page.text(MARGIN + 390, 148, `Search: ${truncate(input.searchLabel, 330, 8)}`, 8);
}

function drawFinancialSummary(page: PdfPage, input: TransactionInquiryPdfInput, top: number) {
  sectionTitle(page, top, "Financial Summary");
  const cards = [
    ["Total Transactions", String(input.summary.totalTransactions)],
    ["Total Credit", input.summary.totalCredit],
    ["Total Debit", input.summary.totalDebit],
    ["Net Movement", input.summary.netMovement]
  ];
  const gap = 10;
  const width = (PAGE_WIDTH - MARGIN * 2 - gap * 3) / 4;
  cards.forEach(([label, value], index) => {
    const x = MARGIN + index * (width + gap);
    page.rect(x, top + 18, width, 54, 0.975);
    page.text(x + 10, top + 35, label, 7, true);
    page.text(x + 10, top + 57, truncate(value, width - 20, 12), 12, true);
  });
  page.text(MARGIN, top + 92, `Incoming transactions: ${input.summary.incomingTransactions}`, 8);
  page.text(MARGIN + 190, top + 92, `Outgoing transactions: ${input.summary.outgoingTransactions}`, 8);
  page.text(MARGIN + 385, top + 92, `Complete transactions: ${input.summary.completeTransactions}`, 8);
}

function drawClassification(page: PdfPage, rows: PdfReportEventSummary[], top: number, title = "Income Classification Summary") {
  sectionTitle(page, top, title);
  const columns = [MARGIN, MARGIN + 80, MARGIN + 340, MARGIN + 520, PAGE_WIDTH - MARGIN];
  const headerTop = top + 18;
  page.rect(MARGIN, headerTop, PAGE_WIDTH - MARGIN * 2, 22, 0.96);
  ["Event Code", "Final Event", "Transactions", "Total Amount (IDR)"].forEach((label, i) => page.text(columns[i] + 6, headerTop + 14, label, 7, true));
  rows.forEach((row, index) => {
    const rowTop = headerTop + 22 + index * 22;
    page.line(MARGIN, rowTop + 22, PAGE_WIDTH - MARGIN, rowTop + 22, 0.25);
    const totalRow = row.code === "TOTAL";
    page.text(columns[0] + 6, rowTop + 14, row.code, 7.5, totalRow);
    page.text(columns[1] + 6, rowTop + 14, truncate(row.eventName, 245, 7.5), 7.5, totalRow);
    page.text(columns[2] + 6, rowTop + 14, String(row.transactions), 7.5, totalRow);
    page.text(columns[3] + 6, rowTop + 14, row.amount, 7.5, totalRow);
  });
  return headerTop + 22 + rows.length * 22;
}

const DETAIL_COLUMNS = [
  { start: 36, width: 52, header: "Date" },
  { start: 88, width: 166, header: "Description" },
  { start: 254, width: 64, header: "Reference" },
  { start: 318, width: 38, header: "Type" },
  { start: 356, width: 74, header: "Amount (IDR)" },
  { start: 430, width: 90, header: "Member" },
  { start: 520, width: 114, header: "Final Event" },
  { start: 634, width: 104, header: "Program" },
  { start: 738, width: 68, header: "Status" }
] as const;

const AMOUNT_COLUMN_INDEX = 4;

function transactionHeader(page: PdfPage, top: number) {
  sectionTitle(page, top, "Transaction Detail");
  const headerTop = top + 18;
  page.rect(MARGIN, headerTop, PAGE_WIDTH - MARGIN * 2, 22, 0.96);
  DETAIL_COLUMNS.forEach((column, index) => {
    const x = index === AMOUNT_COLUMN_INDEX
      ? column.start + column.width - 4 - estimateWidth(column.header, 6.5)
      : column.start + 4;
    page.text(x, headerTop + 14, column.header, 6.5, true);
  });
  return headerTop + 22;
}

function drawTransactionRow(page: PdfPage, row: PdfReportTransaction, top: number) {
  const values = [row.date, row.description, row.referenceNo, row.type, row.amount, row.member, row.finalEvent, row.campaign, row.status];
  DETAIL_COLUMNS.forEach((column, index) => {
    const maxWidth = column.width - 8;
    const value = truncate(values[index], maxWidth, 6.5);
    const x = index === AMOUNT_COLUMN_INDEX
      ? column.start + column.width - 4 - estimateWidth(value, 6.5)
      : column.start + 4;
    page.text(x, top + 14, value, 6.5);
  });
  page.line(MARGIN, top + 22, PAGE_WIDTH - MARGIN, top + 22, 0.2);
}

export function buildTransactionInquiryPdf(input: TransactionInquiryPdfInput) {
  const document = new PdfDocument();
  const first = document.addPage();
  drawReportHeader(first, input);
  let top = 169;

  if (input.includeFinancialSummary) {
    drawFinancialSummary(first, input, top);
    top += 112;
  }

  if (input.includeClassificationSummary) {
    const firstCapacity = Math.max(0, Math.floor((540 - (top + 40)) / 22));
    const firstRows = input.classifications.slice(0, firstCapacity);
    drawClassification(first, firstRows, top);
    let offset = firstRows.length;
    while (offset < input.classifications.length) {
      const page = document.addPage();
      const chunk = input.classifications.slice(offset, offset + 18);
      drawClassification(page, chunk, 44, offset === 0 ? "Income Classification Summary" : "Income Classification Summary - Continued");
      offset += chunk.length;
    }
  }

  if (input.includeTransactionDetail && input.transactions.length > 0) {
    let page = document.addPage();
    let rowTop = transactionHeader(page, 42);
    for (const row of input.transactions) {
      if (rowTop + 24 > 548) {
        page = document.addPage();
        rowTop = transactionHeader(page, 42);
      }
      drawTransactionRow(page, row, rowTop);
      rowTop += 22;
    }
  }

  document.pages.forEach((page, index) => footer(page, index + 1, document.pages.length));
  return document.build();
}
