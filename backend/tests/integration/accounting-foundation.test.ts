import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { prisma } from "../../src/lib/prisma.js";
import { FinancialFixture } from "./financial-fixture.js";

test("Accounting Foundation has the three tables and two approved posting accounts", async () => {
  const tables = await prisma.$queryRaw<Array<{ name: string }>>`SELECT TABLE_NAME AS name
    FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME LIKE 'arya_accounting_%' ORDER BY TABLE_NAME`;
  assert.equal(tables.length, 3);
  const accounts = await prisma.accountingAccount.findMany({ orderBy: { code: "asc" } });
  assert.deepEqual(accounts.map(a => [a.code, a.accountType, a.normalBalance, a.postingFlag, a.activeFlag]),
    [["1110", "ASSET", "DEBIT", true, true], ["4110", "REVENUE", "CREDIT", true, true]]);
});

test("Accounting MySQL enforces uniqueness, FKs, one-sided lines and exact decimals", async () => {
  const bank = await prisma.accountingAccount.findUniqueOrThrow({ where: { code: "1110" } });
  const fixture = new FinancialFixture();
  const journalId = randomUUID();
  try {
    await fixture.setup();
    const identityId = await fixture.identity();
    const campaign = await fixture.campaign("Accounting Foundation");
    const { transactionId } = await fixture.transaction({ identityId, ...campaign });
    const header = { id: journalId, journalNumber: `JRN-20261101-${journalId}`, journalType: "RECOGNITION",
      sourceEventKey: `FINALIZED_BANK_TRANSACTION:${transactionId}`, accountingDate: new Date("2026-11-01"),
      postedAt: new Date(), bankTransactionId: transactionId, postedById: fixture.userId };
    await prisma.accountingJournal.create({ data: header });
    await assert.rejects(prisma.accountingJournal.create({ data: { ...header, id: randomUUID(), journalNumber: randomUUID() } }), { code: "P2002" });
    await assert.rejects(prisma.accountingJournal.create({ data: { ...header, id: randomUUID(), sourceEventKey: randomUUID() } }), { code: "P2002" });
    await assert.rejects(prisma.accountingJournal.create({ data: { ...header, id: randomUUID(), sourceEventKey: randomUUID(), journalNumber: randomUUID(), bankTransactionId: randomUUID() } }), { code: "P2003" });
    const line = { journalId, lineNo: 1, accountId: bank.id, accountCodeSnapshot: bank.code, accountNameSnapshot: bank.name,
      bankAccountId: fixture.bankAccountId, bankNameSnapshot: "Synthetic Bank", bankAccountNoSnapshot: fixture.bankAccountId,
      bankAccountNameSnapshot: "Synthetic Account", debit: "999999999999999999.99", credit: "0.00" };
    assert.equal((await prisma.accountingJournalLine.create({ data: line })).debit.toFixed(2), line.debit);
    await assert.rejects(prisma.accountingJournalLine.create({ data: line }), { code: "P2002" });
    for (const sides of [{ debit: "0.00", credit: "0.00" }, { debit: "1.00", credit: "1.00" }, { debit: "-1.00", credit: "0.00" }]) {
      await assert.rejects(prisma.accountingJournalLine.create({ data: { ...line, lineNo: 2, ...sides } }));
    }
    await assert.rejects(prisma.accountingJournalLine.create({ data: { ...line, lineNo: 2, accountId: randomUUID() } }), { code: "P2003" });
  } finally {
    await prisma.accountingJournalLine.deleteMany({ where: { journalId } });
    await prisma.accountingJournal.deleteMany({ where: { id: journalId } });
    await fixture.cleanup();
  }
});
