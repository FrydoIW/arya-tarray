import { readFileSync } from "node:fs";
import type { PrismaClient } from "@prisma/client";
import { assertConnectedDevDatabase, assertConnectedTestDatabase } from "./test-database.js";
import { parseAccountingCutover } from "../../src/modules/accounting/accounting.domain.js";
import { requireOpenAccountingPeriod } from "../../src/modules/accounting/period/period-control.service.js";

/** Read-only verification. No creation, patching, reset, seeding or fixture cleanup. */
export async function verifyDevDatabase(prisma: PrismaClient): Promise<void> {
  return verifyAccountingSchema(prisma, assertConnectedDevDatabase);
}

export async function verifyTestDatabase(prisma: PrismaClient): Promise<void> {
  await verifyAccountingSchema(prisma, assertConnectedTestDatabase);
  const cutover = parseAccountingCutover(process.env.ACCOUNTING_CUTOVER_DATE);
  if (cutover <= new Date("2026-09-30") || cutover > new Date("2026-11-01")) {
    throw new Error("Integration fixtures require an explicit TEST cutover after 2026-09-30 and no later than 2026-11-01.");
  }
  await requireOpenAccountingPeriod(prisma, new Date("2026-11-01T00:00:00.000Z"));
}

async function verifyAccountingSchema(prisma: PrismaClient,
  assertTarget: (name: string | null | undefined) => void): Promise<void> {
  const selected = await prisma.$queryRaw<Array<{ name: string | null }>>`SELECT DATABASE() AS name`;
  assertTarget(selected[0]?.name);
  const sql = readFileSync(new URL("./current-schema.mysql.sql", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../../../database/accounting-full-accrual-stage1.mysql.sql", import.meta.url), "utf8");
  const approvalSql = readFileSync(new URL("../../../database/accounting-stage2-approval-proposal.mysql.sql", import.meta.url), "utf8");
  const aparSql = readFileSync(new URL("../../../database/accounting-stage2.2-apar.mysql.sql", import.meta.url), "utf8");
  const scheduleSql = readFileSync(new URL("../../../database/accounting-stage2.3-schedules.mysql.sql", import.meta.url), "utf8");
  const assetSql = readFileSync(new URL("../../../database/accounting-stage2.4-assets.mysql.sql", import.meta.url), "utf8");
  const fundSql = readFileSync(new URL("../../../database/accounting-stage2.5-funds.mysql.sql", import.meta.url), "utf8");
  const finalSql = readFileSync(new URL("../../../database/accounting-stage2.6-finalization.mysql.sql", import.meta.url), "utf8");
  const models = readFileSync(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
  const baseline = [...sql.matchAll(/CREATE TABLE `([^`]+)` \(([\s\S]*?)\) ENGINE=/g)];
  const added = [...migration.matchAll(/CREATE TABLE `([^`]+)` \(([\s\S]*?)\) ENGINE=/g)];
  const approval = [...approvalSql.matchAll(/CREATE TABLE `([^`]+)` \(([\s\S]*?)\) ENGINE=/g)];
  const modelTables = [...models.matchAll(/@@map\("(arya_[^"]+)"\)/g)].map(m => m[1]).sort();
  const approvalModelCount = approval.filter(match => modelTables.includes(match[1])).length;
  if (approvalModelCount !== 0 && approvalModelCount !== approval.length) {
    throw new Error("Partial Accounting approval Prisma contract; operational review required.");
  }
  const expected = [...baseline, ...added, ...(approvalModelCount ? approval : [])];
  if (baseline.length !== 35 || added.length !== 21 || approval.length !== 5
    || JSON.stringify(expected.map(m => m[1]).sort()) !== JSON.stringify(modelTables)) {
    throw new Error("Reviewed physical schema table set differs from Prisma; operational review required.");
  }
  const columns = await prisma.$queryRaw<Array<{ tableName: string; columnName: string }>>`
    SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()`;
  const tables = await prisma.$queryRaw<Array<{ name: string }>>`
    SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE'`;
  if (JSON.stringify(tables.map(table => table.name).sort()) !== JSON.stringify(modelTables)) {
    throw new Error("Physical table set differs from the current Prisma contract; no fixtures were written.");
  }
  const indexes = await prisma.$queryRaw<Array<{ tableName: string; indexName: string }>>`
    SELECT DISTINCT TABLE_NAME AS tableName, INDEX_NAME AS indexName FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE()`;
  const constraints = await prisma.$queryRaw<Array<{ tableName: string; constraintName: string; enforced: string }>>`
    SELECT TABLE_NAME AS tableName, CONSTRAINT_NAME AS constraintName, ENFORCED AS enforced
    FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE()`;
  const foreignSchemas = await prisma.$queryRaw<Array<{ name: string }>>`
    SELECT DISTINCT REFERENCED_TABLE_SCHEMA AS name FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_SCHEMA IS NOT NULL AND REFERENCED_TABLE_SCHEMA <> DATABASE()`;
  if (foreignSchemas.length) throw new Error("Accounting schema has cross-database foreign keys; operational review required.");
  for (const [, table, definition] of expected) {
    for (const [, column] of definition!.matchAll(/^  `([^`]+)` /gm)) {
      if (!columns.some(c => c.tableName === table && c.columnName === column)) throw new Error(`Missing required column in ${table}.`);
    }
    const keys = [...definition!.matchAll(/(?:UNIQUE )?KEY `([^`]+)`/g)].map(m => m[1]);
    if (definition!.includes("PRIMARY KEY")) keys.push("PRIMARY");
    for (const key of keys) {
      if (!indexes.some(i => i.tableName === table && i.indexName === key)) throw new Error(`Missing required index in ${table}.`);
    }
    for (const [, name, kind] of definition!.matchAll(/CONSTRAINT `([^`]+)` (CHECK|FOREIGN KEY)/g)) {
      if (name === "ck_accounting_account_type" || name === "ck_accounting_journal_type") continue;
      if (!constraints.some(c => c.tableName === table && c.constraintName === name && (kind !== "CHECK" || c.enforced === "YES"))) {
        throw new Error(`Missing/unenforced required constraint in ${table}.`);
      }
    }
  }
  for (const [, name] of migration.matchAll(/\bCONSTRAINT `([^`]+)`/g)) {
    if (!constraints.some(c => c.constraintName === name && c.enforced !== "NO")) {
      throw new Error(`Missing/unenforced Accounting migration constraint ${name}.`);
    }
  }
  for (const [, table, patch] of (aparSql + "\n" + scheduleSql + "\n" + assetSql + "\n" + fundSql + "\n" + finalSql).matchAll(/ALTER TABLE `([^`]+)`([\s\S]*?);/g)) {
    for (const [, column] of patch.matchAll(/ADD COLUMN `([^`]+)`/g)) {
      if (!columns.some(c => c.tableName === table && c.columnName === column)) throw new Error(`Missing Stage 2.2 column in ${table}.`);
    }
    for (const [, key] of patch.matchAll(/ADD (?:UNIQUE )?KEY `([^`]+)`/g)) {
      if (!indexes.some(i => i.tableName === table && i.indexName === key)) throw new Error(`Missing Stage 2.2 index in ${table}.`);
    }
    for (const [, name, kind] of patch.matchAll(/ADD CONSTRAINT `([^`]+)` (CHECK|FOREIGN KEY)/g)) {
      if (!constraints.some(c => c.tableName === table && c.constraintName === name && (kind !== "CHECK" || c.enforced === "YES"))) {
        throw new Error(`Missing/unenforced Stage 2.2 constraint in ${table}.`);
      }
    }
  }
  const approvalKind = await prisma.$queryRaw<Array<{ clause: string }>>`
    SELECT CHECK_CLAUSE AS clause FROM information_schema.CHECK_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME='ck_acc_approval_kind_source'`;
  if (!approvalKind[0]?.clause.includes("AR_DOCUMENT")) throw new Error("Stage 2.2 AR approval kind is missing.");
  const accounts = await prisma.accountingAccount.findMany({ where: { code: { in: ["1110", "4110"] } }, orderBy: { code: "asc" } });
  if (accounts.length !== 2 || accounts[0]?.name !== "Bank" || accounts[0].accountType !== "ASSET" || accounts[0].normalBalance !== "DEBIT"
    || accounts[1]?.name !== "Contribution Revenue" || accounts[1].accountType !== "REVENUE" || accounts[1].normalBalance !== "CREDIT"
    || accounts.some(a => !a.activeFlag || !a.postingFlag)) throw new Error("Phase 1 posting accounts are missing or invalid.");
  const menu = await prisma.menu.findFirst({ where: { menuCode: "ACCOUNTING_REPORT", activeFlag: true, menuType: "PAGE", route: "/accounting" } });
  if (!menu) throw new Error("Accounting PAGE configuration is missing.");
}
