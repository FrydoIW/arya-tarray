import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { day, generateSchedulePlan } from "../src/modules/accounting/schedules/schedule.domain.js";
import { accountingCents } from "../src/modules/accounting/accounting.domain.js";
import { stage23Identity } from "../src/modules/accounting/schedules/schedule-approval.service.js";
import { validateScheduleCommand } from "../src/modules/accounting/schedules/schedule.service.js";
import { closingApprovalDate, pendingClosingApprovals, type ClosingApprovalSource } from "../src/modules/accounting/finalization/closing-approval.repository.js";
import type { ScheduleCommand } from "../src/modules/accounting/schedules/schedule.schema.js";
const periods = [
  { id: "oct", startDate: day("2026-10-01"), endDate: day("2026-10-31") },
  { id: "nov", startDate: day("2026-11-01"), endDate: day("2026-11-30") },
  { id: "dec", startDate: day("2026-12-01"), endDate: day("2026-12-31") }
];
test("Schedule equal allocation preserves exact original cents with stable chronological residual", () => {
  const rows = generateSchedulePlan({ amount: "100.00", startDate: "2026-10-01", endDate: "2026-12-31", allocationMethod: "MONTHLY_EQUAL" }, periods);
  assert.deepEqual(rows.map(r => r.plannedAmount), ["33.34", "33.33", "33.33"]);
  assert.equal(rows.reduce((sum, row) => sum + accountingCents(row.plannedAmount), 0n), 10000n);
});
test("Schedule actual days explicitly prorates partial periods and leap days", () => {
  const rows = generateSchedulePlan({ amount: "47.00", startDate: "2026-11-15", endDate: "2026-12-31", allocationMethod: "ACTUAL_DAYS" }, periods);
  assert.deepEqual(rows.map(r => r.plannedAmount), ["16.00", "31.00"]);
  const leap = generateSchedulePlan({ amount: "60.00", startDate: "2028-02-01", endDate: "2028-03-31", allocationMethod: "ACTUAL_DAYS" },
    [{ id: "feb", startDate: day("2028-02-01"), endDate: day("2028-02-29") }, { id: "mar", startDate: day("2028-03-01"), endDate: day("2028-03-31") }]);
  assert.deepEqual(leap.map(r => r.plannedAmount), ["29.00", "31.00"]);
});
test("Schedule generation rejects missing/overlapping periods, zero installments and mismatched custom allocations", () => {
  assert.throws(() => generateSchedulePlan({ amount: "1.00", startDate: "2026-11-01", endDate: "2027-01-31", allocationMethod: "MONTHLY_EQUAL" }, periods));
  assert.throws(() => generateSchedulePlan({ amount: "0.01", startDate: "2026-11-01", endDate: "2026-12-31", allocationMethod: "MONTHLY_EQUAL" }, periods));
  assert.throws(() => generateSchedulePlan({ amount: "1.00", startDate: "2026-11-01", endDate: "2026-12-31", allocationMethod: "MONTHLY_EQUAL" }, [periods[1], periods[1], periods[2]]));
  assert.throws(() => generateSchedulePlan({ amount: "1.00", startDate: "2026-11-01", endDate: "2026-12-31", allocationMethod: "CUSTOM",
    customPeriods: [{ accountingPeriodId: "nov", recognitionDate: "2026-11-30", plannedAmount: "0.99" }] }, periods));
});
test("Schedule custom dates and amounts remain explicit and deterministic beyond Number precision", () => {
  const input = { amount: "9007199254740993.01", startDate: "2026-11-01", endDate: "2026-12-31", allocationMethod: "ACTUAL_DAYS" as const };
  const a = generateSchedulePlan(input, periods), b = generateSchedulePlan(input, [...periods].reverse());
  assert.deepEqual(a, b); assert.equal(a.reduce((sum, row) => sum + accountingCents(row.plannedAmount), 0n), 900719925474099301n);
});

const scheduleIds = {
  schedule: "10000000-0000-4000-8000-000000000001",
  oct: "10000000-0000-4000-8000-000000000010",
  nov: "10000000-0000-4000-8000-000000000011",
  dec: "10000000-0000-4000-8000-000000000012"
};
const ledgerPeriod = (id: string, start: string, end: string, status = "OPEN") =>
  ({ id, startDate: day(start), endDate: day(end), status, relFkAccPeriodFy: { status: "OPEN" } });
const configuredPeriods = [
  ledgerPeriod(scheduleIds.oct, "2026-10-01", "2026-10-31"),
  ledgerPeriod(scheduleIds.nov, "2026-11-01", "2026-11-30"),
  ledgerPeriod(scheduleIds.dec, "2026-12-01", "2026-12-31")
];
const plan = (id: string, accountingPeriodId: string, recognitionDate: string, plannedAmount: string, recognitionJournalId: string | null = null) => ({
  id, accountingPeriodId, recognitionDate: day(recognitionDate), plannedAmount: new Prisma.Decimal(plannedAmount), recognitionJournalId,
  relFkAccSchedulePeriodJournal: recognitionJournalId ? { revFkAccJournalReversal: null } : null
});
function activeSchedule(overrides: Record<string, unknown> = {}) {
  return {
    id: scheduleIds.schedule, revision: 2, status: "ACTIVE", scheduleKind: "PREPAYMENT",
    sourceJournalLineId: "10000000-0000-4000-8000-000000000020",
    accountingDocumentId: "10000000-0000-4000-8000-000000000021",
    recognitionAccountId: "10000000-0000-4000-8000-000000000022",
    balanceAccountId: "10000000-0000-4000-8000-000000000023",
    plannedAmount: new Prisma.Decimal("12000000.00"), allocationMethod: "MONTHLY_EQUAL",
    startDate: day("2026-10-01"), endDate: day("2026-12-31"), policyEvidence: "Synthetic policy evidence for schedule approval",
    recognitionBasis: "Synthetic recognition basis for schedule approval", createdById: "10000000-0000-4000-8000-000000000024",
    terminationJournal: null,
    relFkAccScheduleSource: { journal: { accountingDate: day("2026-10-02") } },
    revFkAccSchedulePeriodParent: [
      plan("10000000-0000-4000-8000-000000000030", scheduleIds.oct, "2026-10-31", "4000000.00", "10000000-0000-4000-8000-000000000040"),
      plan("10000000-0000-4000-8000-000000000031", scheduleIds.nov, "2026-11-30", "4000000.00"),
      plan("10000000-0000-4000-8000-000000000032", scheduleIds.dec, "2026-12-31", "4000000.00")
    ],
    ...overrides
  };
}
const change: ScheduleCommand = { action: "CHANGE", periods: [
  { accountingPeriodId: scheduleIds.nov, recognitionDate: "2026-11-30", plannedAmount: "4000000.00" },
  { accountingPeriodId: scheduleIds.dec, recognitionDate: "2026-12-31", plannedAmount: "4000000.00" }
], reason: "Synthetic prospective schedule reallocation evidence" };
const cancel: ScheduleCommand = { action: "CANCEL", reason: "Synthetic prospective cancellation evidence" };
const setup: ScheduleCommand = { action: "SETUP" };
const terminate: ScheduleCommand = { action: "TERMINATE", accountingDate: "2026-12-15", reason: "Synthetic termination evidence" };
const identityTx = (schedule: unknown) => ({ accountingSchedule: { findUnique: async () => schedule } }) as unknown as Prisma.TransactionClient;
const validationTx = (schedule: unknown, statuses: Record<string, string>) => ({
  accountingSchedule: { findUnique: async () => schedule },
  accountingPeriod: { findMany: async (args: { where?: { id?: { in?: string[] } } }) => {
    let rows = configuredPeriods.map(period => ({ ...period, status: statuses[period.id] ?? "OPEN" }));
    if (args.where?.id?.in) rows = rows.filter(period => args.where?.id?.in?.includes(period.id));
    return rows;
  } }
}) as unknown as Prisma.TransactionClient;
function closingSource(requestKind: string, command: unknown, schedule: ReturnType<typeof activeSchedule>): ClosingApprovalSource {
  return { id: "10000000-0000-4000-8000-000000000050", requestKind, sourceDocumentId: schedule.id, status: "PENDING",
    requestPayload: { command }, journalDraft: null, document: null, settlement: null, originalJournal: null, period: null,
    final26_fiscalYearId: null, schedule: { id: schedule.id, startDate: schedule.startDate,
      revFkAccSchedulePeriodParent: schedule.revFkAccSchedulePeriodParent.map(period => ({ recognitionDate: period.recognitionDate, recognitionJournalId: period.recognitionJournalId })) },
    schedulePeriod: null, fixedAsset: null, depreciationRun: null, fund25_accountingFundId: null, restriction: null,
    fund25_fundDesignationId: null, final26_bankReconciliationId: null } as unknown as ClosingApprovalSource;
}

test("Schedule approval date uses the earliest unposted period for prospective CHANGE/CANCEL and preserves SETUP/TERMINATE semantics", async () => {
  const active = activeSchedule();
  const changed = await stage23Identity(identityTx(active), { requestKind: "SCHEDULE_CHANGE", sourceDocumentId: active.id, requestPayload: { command: change } });
  assert.equal(changed.accountingDate.toISOString().slice(0, 10), "2026-11-30");
  const cancelled = await stage23Identity(identityTx(active), { requestKind: "SCHEDULE_CANCEL", sourceDocumentId: active.id, requestPayload: { command: cancel } });
  assert.equal(cancelled.accountingDate.toISOString().slice(0, 10), "2026-11-30");
  const draft = activeSchedule({ status: "DRAFT", revFkAccSchedulePeriodParent: active.revFkAccSchedulePeriodParent.map(period => ({ ...period, recognitionJournalId: null, relFkAccSchedulePeriodJournal: null })) });
  const activated = await stage23Identity(identityTx(draft), { requestKind: "SCHEDULE_SETUP", sourceDocumentId: draft.id, requestPayload: { command: setup } });
  assert.equal(activated.accountingDate.toISOString().slice(0, 10), "2026-10-01");
  const terminated = await stage23Identity(identityTx(active), { requestKind: "SCHEDULE_TERMINATE", sourceDocumentId: active.id, requestPayload: { command: terminate } });
  assert.equal(terminated.accountingDate.toISOString().slice(0, 10), "2026-12-15");
});

test("Closing scope follows the first affected open period and excludes a future-only schedule change from an earlier close", async () => {
  const active = activeSchedule();
  assert.equal(closingApprovalDate(closingSource("SCHEDULE_CHANGE", change, active)), "2026-11-30");
  assert.equal(closingApprovalDate(closingSource("SCHEDULE_CANCEL", cancel, active)), "2026-11-30");
  const draft = activeSchedule({ status: "DRAFT", revFkAccSchedulePeriodParent: active.revFkAccSchedulePeriodParent.map(period => ({ ...period, recognitionJournalId: null, relFkAccSchedulePeriodJournal: null })) });
  assert.equal(closingApprovalDate(closingSource("SCHEDULE_SETUP", setup, draft)), "2026-10-01");
  assert.equal(closingApprovalDate(closingSource("SCHEDULE_TERMINATE", terminate, active)), "2026-12-15");
  const future = activeSchedule({ revFkAccSchedulePeriodParent: [
    plan("10000000-0000-4000-8000-000000000033", scheduleIds.oct, "2026-10-31", "4000000.00", "10000000-0000-4000-8000-000000000041"),
    plan("10000000-0000-4000-8000-000000000034", scheduleIds.nov, "2026-11-30", "4000000.00", "10000000-0000-4000-8000-000000000042"),
    plan("10000000-0000-4000-8000-000000000035", scheduleIds.dec, "2026-12-31", "4000000.00")
  ] });
  const futureChange: ScheduleCommand = { action: "CHANGE", periods: [
    { accountingPeriodId: scheduleIds.dec, recognitionDate: "2026-12-31", plannedAmount: "4000000.00" }
  ], reason: "Synthetic future-only reallocation evidence" };
  const row = closingSource("SCHEDULE_CHANGE", futureChange, future);
  assert.equal(closingApprovalDate(row), "2026-12-31");
  let calls = 0;
  const tx = { accountingApprovalRequest: { findMany: async () => (++calls === 1 ? [row] : []) } } as unknown as Prisma.TransactionClient;
  const report = await pendingClosingApprovals(tx, { type: "PERIOD", id: scheduleIds.oct, from: "2026-10-01", to: "2026-10-31" });
  assert.equal(report.count, 0);
});

test("Schedule CHANGE/CANCEL require every affected unposted period OPEN and reject retroactive posted changes", async () => {
  const active = activeSchedule();
  await assert.doesNotReject(() => validateScheduleCommand(validationTx(active, { [scheduleIds.oct]: "CLOSED", [scheduleIds.nov]: "OPEN", [scheduleIds.dec]: "OPEN" }), active.id, change));
  await assert.rejects(() => validateScheduleCommand(validationTx(active, { [scheduleIds.nov]: "CLOSED", [scheduleIds.dec]: "OPEN" }), active.id, change), /must be OPEN/);
  const retroactive: ScheduleCommand = { action: "CHANGE", periods: [
    { accountingPeriodId: scheduleIds.oct, recognitionDate: "2026-10-31", plannedAmount: "4000000.00" },
    { accountingPeriodId: scheduleIds.nov, recognitionDate: "2026-11-30", plannedAmount: "4000000.00" },
    { accountingPeriodId: scheduleIds.dec, recognitionDate: "2026-12-31", plannedAmount: "4000000.00" }
  ], reason: "Synthetic retroactive schedule change evidence" };
  await assert.rejects(() => validateScheduleCommand(validationTx(active, { [scheduleIds.oct]: "CLOSED", [scheduleIds.nov]: "OPEN", [scheduleIds.dec]: "OPEN" }), active.id, retroactive), /existing unposted periods/);
  await assert.doesNotReject(() => validateScheduleCommand(validationTx(active, { [scheduleIds.nov]: "OPEN", [scheduleIds.dec]: "OPEN" }), active.id, cancel));
  await assert.rejects(() => validateScheduleCommand(validationTx(active, { [scheduleIds.nov]: "OPEN", [scheduleIds.dec]: "CLOSED" }), active.id, cancel), /must be OPEN/);
});
