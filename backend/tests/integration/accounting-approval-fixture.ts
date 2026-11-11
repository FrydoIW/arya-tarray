import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../../src/lib/prisma.js";
import { FinancialFixture } from "./financial-fixture.js";
import { ACCOUNTING_APPROVE, ACCOUNTING_MANAGE, ACCOUNTING_POST } from "../../src/modules/accounting/approval/approval.repository.js";
import { assertConnectedTestDatabase, requireSafeTestDatabaseUrl } from "./test-database.js";

export class AccountingApprovalFixture {
  readonly base = new FinancialFixture();
  readonly reviewerId = randomUUID();
  readonly posterId = randomUUID();
  readonly outsiderId = randomUUID();
  readonly configId = randomUUID();
  readonly roleIds: string[] = [];
  readonly menuIds: string[] = [];
  get requesterId() { return this.base.userId; }
  get actorIds() { return [this.requesterId, this.reviewerId, this.posterId, this.outsiderId]; }
  async setup() {
    await this.base.setup();
    for (const id of this.actorIds.slice(1)) await prisma.user.create({ data: { id,
      fullName: "Accounting TEST actor", email: `${id}@example.invalid`, passwordHash: "not-a-login-account", status: "ACTIVE" } });
    const report = await prisma.menu.findFirstOrThrow({ where: { menuCode: "ACCOUNTING_REPORT" } });
    const menus = new Map<string, string>([["ACCOUNTING_REPORT", report.id]]);
    for (const code of [ACCOUNTING_MANAGE, ACCOUNTING_APPROVE, ACCOUNTING_POST, "CONFIG_APPROVAL"]) {
      const id = randomUUID(); this.menuIds.push(id);
      await prisma.menu.create({ data: { id, menuCode: code, menuName: `TEST ${code}`, menuType: "PAGE", route: "/accounting", activeFlag: true } });
      menus.set(code, id);
    }
    const grants = [
      [this.requesterId, ["ACCOUNTING_REPORT", ACCOUNTING_MANAGE, ACCOUNTING_APPROVE, "CONFIG_APPROVAL"]],
      [this.reviewerId, ["ACCOUNTING_REPORT", ACCOUNTING_APPROVE]],
      [this.posterId, ["ACCOUNTING_REPORT", ACCOUNTING_POST]],
      [this.outsiderId, ["ACCOUNTING_REPORT"]]
    ] as const;
    for (const [userId, codes] of grants) {
      const id = randomUUID(); this.roleIds.push(id);
      await prisma.role.create({ data: { id, roleCode: `T-${id}`, roleName: "Accounting TEST role",
        roleMenus: { create: codes.map(code => { const menuId = menus.get(code); assert.ok(menuId); return { menuId }; }) },
        userRoles: { create: { userId } } } });
    }
    const approvalMenu = menus.get(ACCOUNTING_APPROVE); assert.ok(approvalMenu);
    await prisma.approvalConfig.create({ data: { id: this.configId, menuId: approvalMenu, activeFlag: true,
      approvers: { create: [{ approverUserId: this.requesterId }, { approverUserId: this.reviewerId }] } } });
  }
  async input(reference = randomUUID(), amount = "100.25") {
    const bank = await prisma.accountingAccount.findUniqueOrThrow({ where: { code: "1110" } });
    const revenue = await prisma.accountingAccount.findUniqueOrThrow({ where: { code: "4110" } });
    return { journalType: "MANUAL" as const, accountingDate: "2026-11-02", sourceReference: reference,
      description: "Synthetic Accounting approval integration", lines: [
        { accountId: bank.id, debit: amount, credit: "0.00", bankAccountId: this.base.bankAccountId },
        { accountId: revenue.id, debit: "0.00", credit: amount }
      ] };
  }
  async cleanup() {
    requireSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL,
      { aryaEnv: process.env.ARYA_ENV, allowWrites: process.env.ALLOW_TEST_INTEGRATION_WRITES });
    const selected = await prisma.$queryRaw<Array<{ name: string }>>`SELECT DATABASE() AS name`;
    assertConnectedTestDatabase(selected[0]?.name);
    const actor = { in: this.actorIds };
    const request = { requestedById: actor };
    const draft = { createdById: actor };
    const journal = { postedById: actor };
    await prisma.$transaction(async tx => {
      await tx.accountingApprovalHistory.deleteMany({ where: { request: { is: request } } });
      await tx.accountingApprovalApprover.deleteMany({ where: { request: { is: request } } });
      await tx.accountingApprovalRequest.deleteMany({ where: request });
      await tx.accountingJournalDraftLine.deleteMany({ where: { draft: { is: draft } } });
      await tx.accountingJournalDraft.deleteMany({ where: draft });
      await tx.accountingJournalLine.deleteMany({ where: { journal: { is: journal } } });
      await tx.accountingJournal.deleteMany({ where: { ...journal, reversalOfJournalId: { not: null } } });
      await tx.accountingJournal.deleteMany({ where: { ...journal, relatedJournalId: { not: null } } });
      await tx.accountingJournal.deleteMany({ where: journal });
      await tx.approvalConfigApprover.deleteMany({ where: { approvalConfigId: this.configId } });
      await tx.approvalConfig.deleteMany({ where: { id: this.configId } });
      await tx.roleMenu.deleteMany({ where: { roleId: { in: this.roleIds } } });
      await tx.userRole.deleteMany({ where: { roleId: { in: this.roleIds } } });
      await tx.role.deleteMany({ where: { id: { in: this.roleIds } } });
      await tx.menu.deleteMany({ where: { id: { in: this.menuIds } } });
      await tx.user.deleteMany({ where: { id: { in: this.actorIds.slice(1) } } });
    });
    await this.base.cleanup();
    assert.equal(await prisma.accountingApprovalRequest.count({ where: request }), 0);
    assert.equal(await prisma.accountingJournalDraft.count({ where: draft }), 0);
    assert.equal(await prisma.accountingJournal.count({ where: journal }), 0);
    assert.equal(await prisma.user.count({ where: { id: actor } }), 0);
  }
}
export async function approvalScenario(work: (fixture: AccountingApprovalFixture) => Promise<void>) {
  const fixture = new AccountingApprovalFixture();
  try { await fixture.setup(); await work(fixture); } finally { await fixture.cleanup(); }
}
