import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../../src/lib/prisma.js";
import { AparFixture } from "./apar-fixture.js";
import { createAccrual } from "../../src/modules/accounting/schedules/accrual.service.js";
import { createSchedule } from "../../src/modules/accounting/schedules/schedule.service.js";
import { submitAccrual, submitScheduleCommand, submitSchedulePeriod } from "../../src/modules/accounting/schedules/schedule.workflow.js";
import { applyApprovedAction, postApprovedJournal } from "../../src/modules/accounting/approval/approval.service.js";
import { createDocument, postSource, submitSource } from "../../src/modules/accounting/apar/apar.service.js";
import type { AccrualInput, ScheduleCommand, ScheduleInput } from "../../src/modules/accounting/schedules/schedule.schema.js";
import { requireSafeTestDatabaseUrl, assertConnectedTestDatabase } from "./test-database.js";
export class ScheduleFixture extends AparFixture {
  async setup() {
    await super.setup(); const roleId = this.approval.roleIds[0]; assert.ok(roleId);
    const menu = await prisma.menu.findFirstOrThrow({ where: { menuCode: "ACCOUNTING_JOURNAL_MANAGE" } });
    await prisma.roleMenu.create({ data: { roleId, menuId: menu.id } });
  }
  async extraAccount(type: "ASSET" | "LIABILITY") {
    const id = randomUUID(); this.accountIds.push(id);
    await prisma.accountingAccount.create({ data: { id, code: `T${id.replaceAll("-", "").slice(0, 8)}`, name: `TEST ${type}`, accountType: type,
      normalBalance: type === "ASSET" ? "DEBIT" : "CREDIT", activeFlag: true, postingFlag: true } }); return id;
  }
  accrualInput(kind: "ACCRUED_EXPENSE" | "ACCRUED_INCOME" = "ACCRUED_EXPENSE", amount = "1000000.00"): AccrualInput {
    return { sourceReference: `TEST-${randomUUID()}`, accountingDate: "2026-11-02", amount,
      recognitionAccountId: kind === "ACCRUED_EXPENSE" ? this.expense : this.revenue,
      balanceAccountId: kind === "ACCRUED_EXPENSE" ? this.apControl : this.arControl, counterpartyId: null,
      metadata: { kind, serviceStart: "2026-11-01", serviceEnd: "2026-11-30", supportingEvidence: "Synthetic TEST executed service/earned claim evidence",
        policyReference: "Synthetic TEST adopted policy and independent review", recognitionBasis: "Synthetic TEST incurred service or enforceable earned right", scheduledReversalOn: null } };
  }
  async accrual(input = this.accrualInput(), post = true) {
    const doc = await createAccrual(this.actor, input), request = await submitAccrual(this.actor, doc.id, doc.revision);
    await this.approve(request.id); const journal = post ? await postApprovedJournal(this.poster, request.id) : null;
    return { input, doc, request, journal };
  }
  async source(kind: "PREPAYMENT" | "DEFERRED_INCOME", amount = "12000000.00") {
    const side = kind === "PREPAYMENT" ? "PAYABLE" : "RECEIVABLE", cp = await this.counterparty(side);
    const input = this.documentInput(side, cp, amount); input.lines[0].accountingAccountId = kind === "PREPAYMENT" ? this.arControl : this.apControl;
    const doc = await createDocument(this.actor, side, input), req = await submitSource(this.actor, side, "DOCUMENT", doc.id, doc.revision);
    await this.approve(req.id); const journal = await postSource(this.poster, side, "DOCUMENT", doc.id, req.id);
    const line = journal.lines.find(row => row.accountId === input.lines[0].accountingAccountId); assert.ok(line);
    return { cp, doc, journal, line };
  }
  scheduleInput(kind: "PREPAYMENT" | "DEFERRED_INCOME", sourceLine: string, amount = "12000000.00"): ScheduleInput {
    return { scheduleReference: `TEST-${randomUUID()}`, scheduleKind: kind, sourceJournalLineId: sourceLine,
      recognitionAccountId: kind === "PREPAYMENT" ? this.expense : this.revenue,
      amount, startDate: "2026-11-15", endDate: "2026-12-31", allocationMethod: "MONTHLY_EQUAL",
      policyEvidence: "Synthetic TEST approved substantive contract obligation", recognitionBasis: "Synthetic TEST service coverage or performance completion" };
  }
  async command(id: string, revision: number, command: ScheduleCommand, apply = true) {
    const req = await submitScheduleCommand(this.actor, id, revision, command); await this.approve(req.id);
    if (apply) await applyApprovedAction(this.poster, req.id); return req;
  }
  async schedule(input: ScheduleInput, active = true) {
    const row = await createSchedule(this.actor, input); if (active) await this.command(row.id, row.revision, { action: "SETUP" }); return row;
  }
  async recognize(id: string, revision = 1, post = true) {
    const req = await submitSchedulePeriod(this.actor, id, revision, "Synthetic TEST actual period performance confirmed by signed service evidence"); await this.approve(req.id);
    const journal = post ? await postApprovedJournal(this.poster, req.id) : null; return { req, journal };
  }
  async cleanup() {
    requireSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL,
      { aryaEnv: process.env.ARYA_ENV, allowWrites: process.env.ALLOW_TEST_INTEGRATION_WRITES });
    const selected = await prisma.$queryRaw<Array<{ name: string }>>`SELECT DATABASE() AS name`; assertConnectedTestDatabase(selected[0]?.name);
    const actor = { in: this.approval.actorIds };
    await prisma.$transaction(async tx => {
      await tx.accountingApprovalHistory.deleteMany({ where: { request: { is: { requestedById: actor } } } });
      await tx.accountingApprovalApprover.deleteMany({ where: { request: { is: { requestedById: actor } } } });
      await tx.accountingApprovalRequest.deleteMany({ where: { requestedById: actor } });
      await tx.accountingSchedulePeriod.deleteMany({ where: { relFkAccSchedulePeriodParent: { is: { createdById: actor } } } });
      await tx.accountingSchedule.deleteMany({ where: { createdById: actor } });
      await tx.accountingDocument.updateMany({ where: { createdById: actor }, data: { accrualDraftId: null } });
      await tx.accountingJournalDraftLine.deleteMany({ where: { draft: { is: { createdById: actor, parentAccrualDraftId: { not: null } } } } });
      await tx.accountingJournalDraft.deleteMany({ where: { createdById: actor, parentAccrualDraftId: { not: null } } });
    });
    await super.cleanup();
    assert.equal(await prisma.accountingSchedule.count({ where: { createdById: actor } }), 0);
  }
}
export async function scheduleScenario(work: (f: ScheduleFixture) => Promise<void>) {
  const f = new ScheduleFixture(); try { await f.setup(); await work(f); } finally { await f.cleanup(); }
}
