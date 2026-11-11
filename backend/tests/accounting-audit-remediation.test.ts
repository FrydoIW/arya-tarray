import assert from "node:assert/strict";
import test from "node:test";
import { csvText, csvDecimal, escapeCsvCell, serializeCsv } from "../src/lib/csv.js";
import { closingApprovalDate, type ClosingApprovalSource } from "../src/modules/accounting/finalization/closing-approval.repository.js";
import { verifyLedgerAuditBatches, LEDGER_AUDIT_BATCH_SIZE, type LedgerAuditReader } from "../src/modules/accounting/ledger/ledger-audit.js";
import { digest } from "../src/modules/accounting/funds/fund.repository.js";
import { syntheticAuditJournal } from "./helpers/audit-journal.js";
import { readCsv } from "./helpers/read-csv.js";

for (const text of ["=SUM(1,2)", "+SUM(1,2)", "-SUM(1,2)", "@SUM(1,2)", "   =SUM(1,2)", "\t=SUM(1,2)", "\r=SUM(1,2)", "\n=SUM(1,2)", " \t\r\n=SUM(1,2)", "\u0001=SUM(1,2)", "\uFEFF=SUM(1,2)", "\u200b=SUM(1,2)", "\u00ad=SUM(1,2)", "\u061c=SUM(1,2)"]) {
  test(`AT-AUD-02 CSV protects every text column including hidden formula prefix ${JSON.stringify(text)}`, () => {
    const csv = serializeCsv([[csvText(text), csvText(text), csvText(text)]]);
    assert.deepEqual(readCsv(csv), [["'" + text, "'" + text, "'" + text]]);
  });
}
for (const text of ['Normal text', ' spaced normal text ', 'comma,inside', 'a "quoted" value', 'line1\r\nline2', '', '00123']) {
  test(`AT-AUD-02 CSV round-trips ordinary text without data loss ${JSON.stringify(text)}`, () => assert.deepEqual(readCsv(serializeCsv([[csvText(text)]])), [[text]]));
}
for (const amount of ["-1234.50", "+1234.50", "0.00", "999999999999999999.99", "-0.000000000000000001"]) {
  test(`AT-AUD-02 CSV explicit financial decimal is unchanged ${amount}`, () => assert.deepEqual(readCsv(serializeCsv([[csvDecimal(amount)]])), [[amount]]));
}
test("AT-AUD-02 rejects formula expressions in numeric cells instead of coercing/rounding", () => {
  for (const value of ["-SUM(1,2)", "=1+1", " 12.00", "1e10", "NaN"]) assert.throws(() => escapeCsvCell(csvDecimal(value)), /exact numeric/);
  assert.equal(readCsv(serializeCsv([[csvText("-123.00"), csvDecimal("-123.00")]]))[0][0], "'-123.00");
});
function approval(kind: string): ClosingApprovalSource {
  return { id: "request", requestKind: kind, sourceDocumentId: "source", status: "PENDING", requestPayload: null,
    journalDraft: null, document: null, settlement: null, originalJournal: null, period: null, final26_fiscalYearId: null,
    schedule: null, schedulePeriod: null, fixedAsset: null, depreciationRun: null, fund25_accountingFundId: null,
    restriction: null, fund25_fundDesignationId: null, final26_bankReconciliationId: null };
}
const date = new Date("2026-10-20"), period = { id: "source", startDate: new Date("2026-10-01"), endDate: new Date("2026-10-31") };
const sources: ClosingApprovalSource[] = [];
for (const k of ["MANUAL_JOURNAL", "ADJUSTING_JOURNAL", "ACCRUAL_DOCUMENT", "ACCRUAL_ADJUSTMENT", "ASSET_CHANGE", "ASSET_JOURNAL", "FUND_COMMAND", "FUND_JOURNAL", "REPORTING_POLICY", "REPORT_SNAPSHOT"]) sources.push({ ...approval(k), journalDraft: { id: "source", sourceKind: k, accountingDate: date } });
for (const k of ["AP_INVOICE", "AR_DOCUMENT", "AR_ADJUSTMENT"]) sources.push({ ...approval(k), document: { id: "source", documentKind: k === "AP_INVOICE" ? "PAYABLE" : "RECEIVABLE", accountingDate: new Date("2026-12-01") }, requestPayload: k === "AR_ADJUSTMENT" ? { accountingDate: "2026-10-20" } : null });
sources.push({ ...approval("SETTLEMENT"), settlement: { id: "source", settlementDate: date } }, { ...approval("JOURNAL_REVERSAL"), originalJournal: { id: "source" }, requestPayload: { accountingDate: "2026-10-20" } });
for (const k of ["PERIOD_CLOSE", "PERIOD_REOPEN"]) sources.push({ ...approval(k), period });
for (const k of ["YEAR_CLOSE", "YEAR_REOPEN"]) sources.push({ ...approval(k), final26_fiscalYearId: period });
for (const action of ["SETUP", "CHANGE", "CANCEL", "TERMINATE"]) sources.push({ ...approval(`SCHEDULE_${action}`), schedule: { id: "source", startDate: date }, requestPayload: { command: { action, accountingDate: "2026-10-20" } } });
sources.push({ ...approval("SCHEDULE_PERIOD"), schedulePeriod: { id: "source", recognitionDate: date, relFkAccSchedulePeriodPeriod: period } },
  { ...approval("ASSET_ACTIVATE"), fixedAsset: { id: "source", relFkAccFixedAssetSource: { journal: { accountingDate: date } } } },
  { ...approval("DEPRECIATION_RUN"), depreciationRun: { id: "source", runDate: date, relFkAccDepRunPeriod: period } },
  { ...approval("FUND_SETUP"), fund25_accountingFundId: { id: "source", effectiveOn: date } },
  { ...approval("FUND_RESTRICTION"), restriction: { id: "source", effectiveOn: null, fund25_sourceJournalLineId: { journal: { accountingDate: date } } } },
  { ...approval("FUND_RELEASE"), restriction: { id: "source", effectiveOn: new Date("2026-12-01"), fund25_sourceJournalLineId: { journal: { accountingDate: date } } }, requestPayload: { release: { accountingDate: "2026-10-20" } } },
  { ...approval("FUND_DESIGNATION"), fund25_fundDesignationId: { id: "source", effectiveOn: date } },
  { ...approval("BANK_RECONCILIATION"), final26_bankReconciliationId: { id: "source", reconciliationDate: date, relFkAccBankReconPeriod: period } });
for (const source of sources) test(`AT-AUD-01 resolves existing ${source.requestKind} from its typed source accounting date`, () => {
  const expected = ["AP_INVOICE", "AR_DOCUMENT"].includes(source.requestKind) ? "2026-12-01" : /^(PERIOD|YEAR)_/.test(source.requestKind) ? "2026-10-31" : "2026-10-20";
  assert.equal(closingApprovalDate(source), expected);
});
test("AT-AUD-01 missing source, mismatched kind/link, invalid payload and period mismatch never infer a date", () => {
  assert.equal(closingApprovalDate(approval("NEW_UNKNOWN_KIND")), null);
  assert.equal(closingApprovalDate(approval("MANUAL_JOURNAL")), null);
  assert.equal(closingApprovalDate({ ...sources[0], journalDraft: { id: "other", sourceKind: "MANUAL_JOURNAL", accountingDate: date } }), null);
  assert.equal(closingApprovalDate({ ...sources[0], journalDraft: { id: "source", sourceKind: "ADJUSTING_JOURNAL", accountingDate: date } }), null);
  for (const bad of ["2026-02-30", "not-a-date", "2026-10-20T00:00:00Z", null]) assert.equal(closingApprovalDate({ ...approval("JOURNAL_REVERSAL"), originalJournal: { id: "source" }, requestPayload: { accountingDate: bad } }), null);
  assert.equal(closingApprovalDate({ ...approval("SCHEDULE_PERIOD"), schedulePeriod: { id: "source", recognitionDate: new Date("2026-12-01"), relFkAccSchedulePeriodPeriod: period } }), null);
});
function reader(count: number) {
  const rows = Array.from({ length: count }, (_, i) => syntheticAuditJournal(i + 1));
  const seals = new Map(rows.map(r => [r.id, { sourceReference: `JRNAUDIT-${r.id}`, finalizationMetadata: { sha256: digest(r) } }]));
  const sizes: number[] = [];
  const api: LedgerAuditReader = { count: async () => rows.length, journalsAfter: async (cursor, take) => { sizes.push(take); return rows.filter(r => !cursor || r.id > cursor).slice(0, take); }, sealsFor: async ids => ids.flatMap(id => { const s = seals.get(id); return s ? [s] : []; }) };
  return { rows, seals, api, sizes };
}
for (const count of [0, 1, 5000, 5001]) test(`AT-AUD-03 audit covers all ${count} journals with bounded deterministic batches`, async () => {
  const f = reader(count), result = await verifyLedgerAuditBatches(f.api);
  assert.equal(result.valid, true); assert.equal(result.checked, count); assert.equal(result.total, count);
  assert.ok(f.sizes.every(n => n === LEDGER_AUDIT_BATCH_SIZE)); assert.deepEqual(await verifyLedgerAuditBatches(f.api), result);
});
for (const index of [0, 5000]) test(`AT-AUD-03 detects tamper across batch boundary at journal ${index + 1}`, async () => {
  const f = reader(5001); f.rows[index].descriptionSnapshot = "Synthetic tampered evidence";
  const result = await verifyLedgerAuditBatches(f.api); assert.equal(result.valid, false); assert.equal(result.checked, 5001); assert.ok(result.exceptions.some(e => e.reason === "POSTED_JOURNAL_CONTENT_CHANGED" && e.id === f.rows[index].id));
});
test("AT-AUD-03 missing seals and duplicate seals cannot pass", async () => {
  const f = reader(201); f.seals.delete(f.rows[200].id); assert.equal((await verifyLedgerAuditBatches(f.api)).valid, false);
  const g = reader(1), original = g.api.sealsFor; g.api.sealsFor = async ids => { const s = await original(ids); return [...s, ...s]; };
  assert.ok((await verifyLedgerAuditBatches(g.api)).exceptions.some(e => e.reason === "POSTED_JOURNAL_SEAL_DUPLICATE"));
});
test("AT-AUD-03 missing or duplicated keyset boundaries cannot produce partial PASS", async () => {
  const f = reader(401), original = f.api.journalsAfter; f.api.journalsAfter = async (cursor, take) => (await original(cursor, take)).filter(r => r.id !== f.rows[200].id);
  assert.ok((await verifyLedgerAuditBatches(f.api)).exceptions.some(e => e.reason === "AUDIT_COVERAGE_COUNT_MISMATCH"));
  const g = reader(201), next = g.api.journalsAfter; g.api.journalsAfter = async (cursor, take) => cursor ? [g.rows[199], ...await next(cursor, take)] : next(cursor, take);
  assert.ok((await verifyLedgerAuditBatches(g.api)).exceptions.some(e => e.reason === "AUDIT_KEYSET_BOUNDARY_INVALID"));
});
test("AT-AUD-03 inconsistent concurrent counts and bounded error evidence fail closed", async () => {
  const f = reader(1); let calls = 0; f.api.count = async () => ++calls === 1 ? 1 : 2;
  assert.equal((await verifyLedgerAuditBatches(f.api)).valid, false);
  const g = reader(501); g.seals.clear(); const result = await verifyLedgerAuditBatches(g.api);
  assert.equal(result.valid, false); assert.equal(result.checked, 501); assert.equal(result.exceptionCount, 501); assert.equal(result.exceptions.length, 100); assert.equal(result.exceptionsTruncated, true);
});
