import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import {
  createEventCodeTemplate,
  parseEventCodeBulkWorkbook
} from "../src/modules/configuration/event-code/event-code.workbook.js";

type FixtureCell = string | number | null;

async function buildWorkbook(rows: FixtureCell[][], headers: string[] = [
  "Event Code",
  "Event Name",
  "Category",
  "Description",
  "Status"
]) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Event Codes");
  sheet.addRow(headers);
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

test("Event Code template provides a styled input sheet and clear instructions", async () => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(new Uint8Array(await createEventCodeTemplate()).buffer);

  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ["Event Codes", "Instructions"]);
  const sheet = workbook.getWorksheet("Event Codes")!;
  assert.deepEqual(Array.from(sheet.getRow(1).values).slice(1), ["Event Code", "Event Name", "Category", "Description", "Status"]);
  assert.equal(sheet.views[0]?.ySplit, 1);
  assert.ok(sheet.autoFilter);
  assert.equal(sheet.getCell("E2").dataValidation.type, "list");
  assert.match(workbook.getWorksheet("Instructions")!.getCell("B11").text, /Execute/);
});

test("Event Code bulk parser preserves text codes and pads numeric codes to three digits", async () => {
  const preview = await parseEventCodeBulkWorkbook(await buildWorkbook([
    [1, " Dana Harian ", " DONASI ", null, "Active"],
    ["010", "Dana Bulanan", null, "Keterangan", "inactive"]
  ]), { existingCodes: [], stagedCodes: [] });

  assert.equal(preview.rowsDetected, 2);
  assert.equal(preview.readyCount, 2);
  assert.equal(preview.invalidCount, 0);
  assert.deepEqual(preview.rows.map((row) => ({
    code: row.code,
    eventName: row.eventName,
    category: row.category,
    description: row.description,
    activeFlag: row.activeFlag
  })), [
    { code: "001", eventName: "Dana Harian", category: "DONASI", description: null, activeFlag: true },
    { code: "010", eventName: "Dana Bulanan", category: null, description: "Keterangan", activeFlag: false }
  ]);
});

test("Event Code bulk parser reports all row conflicts without staging partial data", async () => {
  const preview = await parseEventCodeBulkWorkbook(await buildWorkbook([
    ["091", "Duplicate A", null, null, "Active"],
    ["091", "Duplicate B", null, null, "Active"],
    ["001", "Persisted", null, null, "Active"],
    ["092", "Staged", null, null, "Active"],
    ["093", "", null, null, "Unknown"]
  ]), { existingCodes: ["001"], stagedCodes: ["092"] });

  assert.equal(preview.rowsDetected, 5);
  assert.equal(preview.readyCount, 0);
  assert.equal(preview.invalidCount, 5);
  assert.match(preview.rows[0].errors.join(" "), /Duplicate Event Code 091 found on rows 2 and 3/);
  assert.match(preview.rows[2].errors.join(" "), /already exists/);
  assert.match(preview.rows[3].errors.join(" "), /already staged/);
  assert.match(preview.rows[4].errors.join(" "), /Event Name is required/);
  assert.match(preview.rows[4].errors.join(" "), /Status must be Active or Inactive/);
});

test("Event Code bulk parser rejects wrong headers, empty data, and unreadable workbooks", async () => {
  await assert.rejects(
    async () => parseEventCodeBulkWorkbook(await buildWorkbook([], ["Wrong Header"]), { existingCodes: [], stagedCodes: [] }),
    /Required column 'Event Code' was not found/
  );
  await assert.rejects(
    async () => parseEventCodeBulkWorkbook(await buildWorkbook([]), { existingCodes: [], stagedCodes: [] }),
    /does not contain any Event Code rows/
  );
  await assert.rejects(
    () => parseEventCodeBulkWorkbook(Buffer.from("not an xlsx"), { existingCodes: [], stagedCodes: [] }),
    /Unable to read the workbook/
  );
});
