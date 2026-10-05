import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { parseBcaStatementWorkbook } from "../src/modules/reconciliation/statement-upload/statement-upload.parser.js";

async function buildMergedCellFixture() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("BCA Mei 2026");
  sheet.getCell("A1").value = "Informasi Rekening - Mutasi Rekening";
  sheet.getCell("A2").value = "No. rekening";
  sheet.getCell("B2").value = "084-9999127";
  sheet.getCell("A3").value = "Nama";
  sheet.getCell("B3").value = "ARYA TARRAY NUSANTARA";
  sheet.getCell("A4").value = "Periode";
  sheet.getCell("B4").value = "01/05/2026 - 31/05/2026";
  sheet.getCell("A5").value = "Tgl";
  sheet.getCell("B5").value = "Keterangan";
  sheet.getCell("C5").value = "Jumlah";

  sheet.getCell("A6").value = "01/05";
  sheet.getCell("B6").value = "TRSF E-BANKING CR";
  sheet.getCell("C6").value = "108,017.00 CR";
  sheet.getCell("B7").value = "0105/FTSCY/WS95051";
  sheet.getCell("B8").value = "ANGGRAENI H OR J D";
  sheet.mergeCells("A6:A8");
  sheet.mergeCells("C6:C8");

  sheet.getCell("A9").value = "02/05";
  sheet.getCell("B9").value = "TRSF E-BANKING DB";
  sheet.getCell("C9").value = "50,000.00 DB";

  const auxiliary = workbook.addWorksheet("Sheet1");
  auxiliary.getCell("A1").value = "manual annotation only";

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function buildNullDateFixture() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("BCA Sep 2026");
  sheet.getCell("A1").value = "Informasi Rekening - Mutasi Rekening";
  sheet.getCell("A2").value = "No. rekening";
  sheet.getCell("B2").value = "084-9999127";
  sheet.getCell("A3").value = "Periode";
  sheet.getCell("B3").value = "01/09/2026 - 30/09/2026";
  sheet.getCell("A4").value = "Tgl";
  sheet.getCell("B4").value = "Keterangan";
  sheet.getCell("C4").value = "Jumlah";

  sheet.getCell("B5").value = "TRSF E-BANKING CR";
  sheet.getCell("C5").value = "100,000.00 CR";

  sheet.getCell("A6").value = "02/09";
  sheet.getCell("B6").value = "TRSF E-BANKING CR";
  sheet.getCell("C6").value = "200,000.00 CR";

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function buildSyntheticMalformedMergeFixture() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("BCA Okt 2026");
  sheet.getCell("A1").value = "Informasi Rekening - Mutasi Rekening";
  sheet.getCell("A2").value = "No. rekening";
  sheet.getCell("B2").value = "091-0000123";
  sheet.getCell("A3").value = "Nama";
  sheet.getCell("B3").value = "SYNTHETIC TEST ORGANIZATION";
  sheet.getCell("A4").value = "Periode";
  sheet.getCell("B4").value = "01/10/2026 - 31/10/2026";
  sheet.getCell("A5").value = "Tgl";
  sheet.getCell("B5").value = "Keterangan";
  sheet.getCell("C5").value = "Jumlah";

  sheet.getCell("A6").value = "01/10";
  sheet.getCell("B6").value = "TRSF E-BANKING CR";
  sheet.getCell("C6").value = "123,456.70 CR";
  sheet.getCell("B7").value = "0110/FTSCY/TEST001";
  sheet.getCell("B8").value = "SYNTHETIC SENDER ALPHA";
  sheet.mergeCells("A6:A8");
  sheet.mergeCells("C6:C8");

  // These values are intentionally covered by the malformed ranges below.
  // The parser must recover this transaction from the following reference line.
  sheet.getCell("A9").value = "02/10";
  sheet.getCell("B9").value = "TRSF E-BANKING CR";
  sheet.getCell("C9").value = "200,000.20 CR";
  sheet.getCell("B10").value = "0210/FTSCY/TEST002 200000.20";
  sheet.getCell("B11").value = "SYNTHETIC SENDER BETA";

  const archive = await JSZip.loadAsync(await workbook.xlsx.writeBuffer());
  const worksheetPath = "xl/worksheets/sheet1.xml";
  const worksheet = await archive.file(worksheetPath)!.async("string");
  const malformed = worksheet
    .replace('ref="A6:A8"', 'ref="A6:A10"')
    .replace('ref="C6:C8"', 'ref="C6:C10"')
    .replace(
      'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"',
      'xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    )
    .replace(/(<\/?)(?!x:)([A-Za-z][A-Za-z0-9]*)(?=[\s/>])/g, "$1x:$2");
  archive.file(worksheetPath, malformed);

  return Buffer.from(await archive.generateAsync({ type: "nodebuffer" }));
}

test("BCA parser never yields a transaction without a transaction date", async () => {
  const parsed = await parseBcaStatementWorkbook(await buildNullDateFixture());

  assert.equal(parsed.transactions.length, 1);
  assert.equal(parsed.transactions[0].sourceRowNo, 6);
  assert.equal(parsed.transactions[0].transactionDate.toISOString().slice(0, 10), "2026-09-02");
  assert.ok(parsed.transactions.every((item) =>
    item.transactionDate instanceof Date && Number.isFinite(item.transactionDate.getTime())
  ));
});

test("BCA parser ignores merged continuation rows as transaction starts", async () => {
  const parsed = await parseBcaStatementWorkbook(await buildMergedCellFixture());

  assert.deepEqual(parsed.validSheets, ["BCA Mei 2026"]);
  assert.equal(parsed.accountNo, "084-9999127");
  assert.equal(parsed.transactions.length, 2);

  const first = parsed.transactions[0];
  assert.equal(first.sourceRowNo, 6);
  assert.equal(first.direction, "CR");
  assert.equal(first.amountCents, 10_801_700n);
  assert.equal(first.referenceNo, "0105/FTSCY/WS95051");
  assert.equal(first.senderName, "ANGGRAENI H OR J D");
  assert.equal(first.description, "0105/FTSCY/WS95051\nANGGRAENI H OR J D");

  const second = parsed.transactions[1];
  assert.equal(second.sourceRowNo, 9);
  assert.equal(second.direction, "DB");
  assert.equal(second.amountCents, -5_000_000n);
});


test("BCA parser recovers synthetic transaction boundaries from malformed overlapping merge ranges", async () => {
  const parsed = await parseBcaStatementWorkbook(await buildSyntheticMalformedMergeFixture());

  assert.deepEqual(parsed.validSheets, ["BCA Okt 2026"]);
  assert.equal(parsed.accountNo, "091-0000123");
  assert.equal(parsed.transactions.length, 2);

  const first = parsed.transactions[0];
  assert.equal(first.sourceRowNo, 6);
  assert.equal(first.amountCents, 12_345_670n);
  assert.equal(first.senderName, "SYNTHETIC SENDER ALPHA");

  const recovered = parsed.transactions[1];
  assert.equal(recovered.sourceRowNo, 9);
  assert.equal(recovered.amountCents, 20_000_020n);
  assert.equal(recovered.referenceNo, "0210/FTSCY/TEST002");
  assert.equal(recovered.senderName, "SYNTHETIC SENDER BETA");
});
