import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { readFile } from "node:fs/promises";
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


test("BCA parser recovers real transaction boundaries from malformed overlapping merge ranges", async () => {
  const fixture = await readFile(new URL("./fixtures/malformed-merge-statement.xlsx", import.meta.url));
  const parsed = await parseBcaStatementWorkbook(fixture);

  assert.equal(parsed.transactions.length, 40);
  const tony = parsed.transactions.find((item) => item.sourceRowNo === 137);
  const vivian = parsed.transactions.find((item) => item.sourceRowNo === 141);
  const wendy = parsed.transactions.find((item) => item.sourceRowNo === 145);

  assert.equal(tony?.amountCents, 145_000_300n);
  assert.equal(tony?.senderName, "TONY HALIM");
  assert.equal(tony?.description, "0505/FTSCY/WS95031 1450003.00\nDana Rupang Guru Rinpoche\nTONY HALIM");
  assert.equal(vivian?.amountCents, 70_000_400n);
  assert.equal(vivian?.senderName, "VIVIAN LEE");
  assert.equal(wendy?.amountCents, 105_000_500n);
  assert.equal(wendy?.senderName, "WENDY TAN");
});
