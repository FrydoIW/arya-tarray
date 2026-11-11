import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { postLedgerJournalInTransaction } from "../../src/modules/accounting/ledger/ledger.service.js";
import { reverseLedgerJournalInTransaction } from "../../src/modules/accounting/ledger/ledger-reversal.service.js";
import { postOpeningBalanceInTransaction } from "../../src/modules/accounting/ledger/opening-balance.service.js";
import { createAccountInTransaction, updateAccountInTransaction } from "../../src/modules/accounting/coa/coa.service.js";
import { createFiscalYearInTransaction, createPeriodInTransaction } from "../../src/modules/accounting/period/period.service.js";
import { requireSafeTestDatabaseUrl, TEST_DATABASE } from "./test-database.js";

function isolatedTestUrl(): { url: string; database: string } | null {
  if (!process.env.TEST_DATABASE_URL && !process.env.ALLOW_TEST_INTEGRATION_WRITES) return null;
  const url = requireSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL,
    { aryaEnv: process.env.ARYA_ENV, allowWrites: process.env.ALLOW_TEST_INTEGRATION_WRITES });
  return { url, database: TEST_DATABASE };
}
const target = isolatedTestUrl();

test("central ledger posts atomically, rejects duplicate source and closed period, then rolls back fixtures",
  { skip: target ? false : "A separately provisioned Accounting TEST database is required." }, async () => {
  if (!target) return;
  const prisma = new PrismaClient({ datasources: { db: { url: target.url } } });
  const marker = randomUUID();
  const actorId = randomUUID();
  let yearId = "";
  let periodId = "";
  let accountId = "";
  let openingBatchId = "";
  const rollback = new Error("Intentional integration rollback");
  const priorCutover = process.env.ACCOUNTING_CUTOVER_DATE;
  try {
    const selected = await prisma.$queryRaw<Array<{ selected: string }>>`SELECT DATABASE() AS selected`;
    assert.equal(selected[0]?.selected, target.database);
    process.env.ACCOUNTING_CUTOVER_DATE = "3000-01-01";
    const accounts = await prisma.accountingAccount.findMany({ where: { code: { in: ["1110", "4110"] } },
      select: { id: true, code: true, activeFlag: true, postingFlag: true } });
    const revenue = accounts.find(a => a.code === "4110");
    const bank = accounts.find(a => a.code === "1110");
    assert.ok(revenue?.activeFlag && revenue.postingFlag && bank?.activeFlag && bank.postingFlag);
    const accountingDate = new Date("3000-01-15T00:00:00.000Z");
    await assert.rejects(prisma.$transaction(async tx => {
      await tx.user.create({ data: { id: actorId, fullName: "Rollback test actor",
        email: `${actorId}@example.invalid`, passwordHash: "not-a-login-account", status: "ACTIVE" } });
      const year = await createFiscalYearInTransaction(tx, { yearCode: `TEST-${marker.slice(0, 8)}`,
        startDate: "3000-01-01", endDate: "3000-12-31" });
      yearId = year.id;
      const period = await createPeriodInTransaction(tx, { fiscalYearId: year.id, periodNo: 1,
        periodCode: `TEST-${marker.slice(0, 8)}`, startDate: "3000-01-01", endDate: "3000-01-31" });
      periodId = period.id;
      const header = await createAccountInTransaction(tx, { code: `T${marker.slice(0, 7)}`, name: "Test expense header",
        parentAccountId: null, accountType: "EXPENSE", accountClassification: null, reportSection: null,
        normalBalance: "DEBIT", contraFlag: false, postingFlag: false, activeFlag: true });
      const expense = await createAccountInTransaction(tx, { code: `T${marker.slice(0, 7)}1`, name: "Test expense line",
        parentAccountId: header.id, accountType: "EXPENSE", accountClassification: null, reportSection: null,
        normalBalance: "DEBIT", contraFlag: false, postingFlag: true, activeFlag: true });
      accountId = expense.id;
      const netAsset = await createAccountInTransaction(tx, { code: `N${marker.slice(0, 7)}`, name: "Test opening net assets",
        parentAccountId: null, accountType: "NET_ASSET", accountClassification: null, reportSection: null,
        normalBalance: "CREDIT", contraFlag: false, postingFlag: true, activeFlag: true });
      await assert.rejects(createAccountInTransaction(tx, { code: `T${marker.slice(0, 7)}2`, name: "Invalid child",
        parentAccountId: expense.id, accountType: "EXPENSE", accountClassification: null, reportSection: null,
        normalBalance: "DEBIT", contraFlag: false, postingFlag: true, activeFlag: true }), /active header/);
      const input = {
        journalType: "ACCRUAL" as const, sourceKind: "TEST_ROLLBACK", sourceReference: marker,
        accountingDate, descriptionSnapshot: "Rolled-back Accounting test", postedById: actorId,
        lines: [
          { accountId: expense.id, debit: "100.00", credit: "0.00" },
          { accountId: revenue.id, debit: "0.00", credit: "100.00" }
        ]
      };
      const journal = await postLedgerJournalInTransaction(tx, input);
      assert.equal(journal.lines.length, 2);
      assert.equal(journal.accountingPeriodId, periodId);
      assert.equal(journal.lines[0]?.debit.toFixed(2), "100.00");
      assert.equal(journal.lines[1]?.credit.toFixed(2), "100.00");
      assert.equal(journal.bankTransactionId, null);
      await assert.rejects(reverseLedgerJournalInTransaction(tx, {
        originalJournalId: journal.id, accountingDate, postedById: actorId
      }), /persisted Accounting approval/);
      const originalFirstLine = journal.lines[0];
      assert.ok(originalFirstLine);
      assert.equal((await tx.accountingJournalLine.findUniqueOrThrow({ where: { id: originalFirstLine.id } })).debit.toFixed(2), "100.00");
      await assert.rejects(postLedgerJournalInTransaction(tx, { ...input, journalType: "MANUAL",
        sourceReference: `${marker}-manual` }), /persisted Accounting approval/);
      await assert.rejects(reverseLedgerJournalInTransaction(tx, {
        originalJournalId: journal.id, accountingDate: new Date("3000-01-15T12:00:00.000Z"), postedById: actorId
      }), /date-only UTC/);
      const openingInput = { fiscalYearId: year.id, batchReference: `TEST-${marker}`,
        sourceReference: "Rollback opening source evidence", effectiveOn: accountingDate, createdById: actorId,
        lines: [
          { accountId: bank.id, debit: "200.00", credit: "0.00" },
          { accountId: netAsset.id, debit: "0.00", credit: "200.00" }
        ] };
      const opening = await postOpeningBalanceInTransaction(tx, openingInput);
      openingBatchId = opening.batch.id;
      assert.equal(opening.journal.journalType, "OPENING");
      assert.equal(opening.batch.journalId, opening.journal.id);
      await assert.rejects(postOpeningBalanceInTransaction(tx, openingInput), /already been posted/);
      await assert.rejects(postOpeningBalanceInTransaction(tx, { ...openingInput, batchReference: `BAD-${marker}`,
        lines: [
          { accountId: expense.id, debit: "200.00", credit: "0.00" },
          { accountId: netAsset.id, debit: "0.00", credit: "200.00" }
        ] }), /balance-sheet accounts/);
      await assert.rejects(updateAccountInTransaction(tx, expense.id, { name: "Changed after posting" }),
        /posted account/);
      await assert.rejects(createPeriodInTransaction(tx, { fiscalYearId: year.id, periodNo: 2,
        periodCode: `OVERLAP-${marker.slice(0, 8)}`, startDate: "3000-01-15", endDate: "3000-02-15" }), /overlap/);
      await assert.rejects(postLedgerJournalInTransaction(tx, input), /already been posted/);
      await tx.accountingPeriod.update({ where: { id: periodId }, data: { status: "CLOSED", closedAt: new Date() } });
      await assert.rejects(postLedgerJournalInTransaction(tx, { ...input, sourceReference: `${marker}-closed` }),
        /open accounting period/);
      throw rollback;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 }),
    error => error === rollback);
    assert.equal(await prisma.accountingJournal.count({ where: { sourceKind: "TEST_ROLLBACK", sourceReference: marker } }), 0);
    assert.equal(await prisma.accountingPeriod.count({ where: { id: periodId } }), 0);
    assert.equal(await prisma.accountingFiscalYear.count({ where: { id: yearId } }), 0);
    assert.equal(await prisma.accountingAccount.count({ where: { id: accountId } }), 0);
    assert.equal(await prisma.accountingOpeningBatch.count({ where: { id: openingBatchId } }), 0);
    assert.equal(await prisma.user.count({ where: { id: actorId } }), 0);
  } finally {
    if (priorCutover === undefined) delete process.env.ACCOUNTING_CUTOVER_DATE;
    else process.env.ACCOUNTING_CUTOVER_DATE = priorCutover;
    await prisma.$disconnect();
  }
});
