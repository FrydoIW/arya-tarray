import assert from "node:assert/strict";
import test from "node:test";
import { buildTransactionInquiryPdf, sanitizeReportDisplayText } from "../src/modules/reconciliation/transaction-inquiry/transaction-inquiry.pdf.js";
import { formatIdr } from "../src/modules/reconciliation/transaction-inquiry/transaction-inquiry.service.js";

test("report display sanitizer normalizes separators without rewriting content", () => {
  assert.equal(sanitizeReportDisplayText("500001.00\nDana Rupang Buddha Shakyamuni"), "500001.00 Dana Rupang Buddha Shakyamuni");
  assert.equal(sanitizeReportDisplayText("line1\r\nline2\tline3"), "line1 line2 line3");
  assert.equal(sanitizeReportDisplayText("  spaced   text  "), "spaced text");
  assert.equal(sanitizeReportDisplayText("Campaign - September 2026"), "Campaign - September 2026");
});

test("report money formatter uses Indonesian IDR without forced decimals", () => {
  assert.equal(formatIdr("8950064.00"), "Rp8.950.064");
  assert.equal(formatIdr("450007.00"), "Rp450.007");
  assert.equal(formatIdr("1234.50"), "Rp1.234,5");
  assert.equal(formatIdr("1234.05"), "Rp1.234,05");
  assert.equal(formatIdr("-100000.00"), "-Rp100.000");
  assert.equal(formatIdr("0.00"), "Rp0");
});

function buildReport(description: string) {
  return buildTransactionInquiryPdf({
    periodLabel: "September 2026",
    bankAccountLabel: "All Bank Accounts",
    statusLabel: "All Status",
    finalEventLabel: "All Final Events",
    memberLabel: "All Members",
    memberLinkStatusLabel: "All",
    searchLabel: null,
    generatedBy: "Operator",
    generatedAt: "05 Sep 2026",
    summary: {
      totalTransactions: 1,
      totalCredit: "Rp8.950.064",
      totalDebit: "Rp0",
      netMovement: "Rp8.950.064",
      incomingTransactions: 1,
      outgoingTransactions: 0,
      completeTransactions: 1
    },
    classifications: [],
    transactions: [{
      date: "05 Sep 2026",
      description,
      referenceNo: "REF-1",
      type: "Incoming",
      amount: "Rp450.007",
      finalEvent: "017 - Kebutuhan Kesehatan",
      campaign: "Makan Bhikkhu Sept 2026",
      member: "Belum Terhubung",
      status: "Complete"
    }],
    includeFinancialSummary: true,
    includeClassificationSummary: false,
    includeTransactionDetail: true
  }).toString("latin1");
}

test("report detail renders sanitized description and campaign program without artifacts", () => {
  const content = buildReport("500001.00\nDana Rupang Buddha Shakyamuni");
  assert.match(content, /500001\.00 Dana Rupang Buddha Shakyamuni/);
  assert.doesNotMatch(content, /500001\.00\?/);
  assert.match(content, /Program/);
  assert.match(content, /Makan Bhikkhu Sept 2026/);
  assert.match(content, /Rp450\.007/);
  assert.match(content, /Rp8\.950\.064/);
  assert.match(content, /Arya Tarray Nusantara - Internal Use Only/);
  assert.match(content, /Page 1 of 2/);
});
