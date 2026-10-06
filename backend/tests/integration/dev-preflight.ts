import { readFileSync } from "node:fs";
import type { PrismaClient } from "@prisma/client";
import { assertConnectedDevDatabase } from "./test-database.js";

/** Read-only verification. No creation, patching, reset, seeding or fixture cleanup. */
export async function verifyDevDatabase(prisma: PrismaClient): Promise<void> {
  const selected = await prisma.$queryRaw<Array<{ name: string | null }>>`SELECT DATABASE() AS name`;
  assertConnectedDevDatabase(selected[0]?.name);
  const sql = readFileSync(new URL("./current-schema.mysql.sql", import.meta.url), "utf8");
  const models = readFileSync(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
  const expected = [...sql.matchAll(/CREATE TABLE `([^`]+)` \(([\s\S]*?)\) ENGINE=/g)];
  const modelTables = [...models.matchAll(/@@map\("(arya_[^"]+)"\)/g)].map(m => m[1]).sort();
  if (expected.length !== 35 || JSON.stringify(expected.map(m => m[1]).sort()) !== JSON.stringify(modelTables)) {
    throw new Error("Reviewed physical schema table set differs from Prisma; operational review required.");
  }
  const columns = await prisma.$queryRaw<Array<{ tableName: string; columnName: string }>>`
    SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()`;
  const indexes = await prisma.$queryRaw<Array<{ tableName: string; indexName: string }>>`
    SELECT DISTINCT TABLE_NAME AS tableName, INDEX_NAME AS indexName FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE()`;
  const constraints = await prisma.$queryRaw<Array<{ tableName: string; constraintName: string; enforced: string }>>`
    SELECT TABLE_NAME AS tableName, CONSTRAINT_NAME AS constraintName, ENFORCED AS enforced
    FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE()`;
  const foreignSchemas = await prisma.$queryRaw<Array<{ name: string }>>`
    SELECT DISTINCT REFERENCED_TABLE_SCHEMA AS name FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_SCHEMA IS NOT NULL AND REFERENCED_TABLE_SCHEMA <> DATABASE()`;
  if (foreignSchemas.length) throw new Error("DEV schema has cross-database foreign keys; operational review required.");
  for (const [, table, definition] of expected) {
    for (const [, column] of definition!.matchAll(/^  `([^`]+)` /gm)) {
      if (!columns.some(c => c.tableName === table && c.columnName === column)) throw new Error(`Missing required DEV column in ${table}.`);
    }
    const keys = [...definition!.matchAll(/(?:UNIQUE )?KEY `([^`]+)`/g)].map(m => m[1]);
    if (definition!.includes("PRIMARY KEY")) keys.push("PRIMARY");
    for (const key of keys) {
      if (!indexes.some(i => i.tableName === table && i.indexName === key)) throw new Error(`Missing required DEV index in ${table}.`);
    }
    for (const [, name, kind] of definition!.matchAll(/CONSTRAINT `([^`]+)` (CHECK|FOREIGN KEY)/g)) {
      if (!constraints.some(c => c.tableName === table && c.constraintName === name && (kind !== "CHECK" || c.enforced === "YES"))) {
        throw new Error(`Missing/unenforced required DEV constraint in ${table}.`);
      }
    }
  }
  const accounts = await prisma.accountingAccount.findMany({ where: { code: { in: ["1110", "4110"] } }, orderBy: { code: "asc" } });
  if (accounts.length !== 2 || accounts[0]?.name !== "Bank" || accounts[0].accountType !== "ASSET" || accounts[0].normalBalance !== "DEBIT"
    || accounts[1]?.name !== "Contribution Revenue" || accounts[1].accountType !== "REVENUE" || accounts[1].normalBalance !== "CREDIT"
    || accounts.some(a => !a.activeFlag || !a.postingFlag)) throw new Error("DEV Phase 1 posting accounts are missing or invalid.");
  const menu = await prisma.menu.findFirst({ where: { menuCode: "ACCOUNTING_REPORT", activeFlag: true, menuType: "PAGE", route: "/accounting" } });
  if (!menu) throw new Error("DEV Accounting PAGE configuration is missing.");
}
