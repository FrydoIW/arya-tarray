import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { requireSafeTestDatabaseUrl } from "./test-database.js";

const TEST_DATABASE = "arya_tarray_test";
const schemaPath = fileURLToPath(new URL("./current-schema.mysql.sql", import.meta.url));
const prismaPath = fileURLToPath(new URL("../../prisma/schema.prisma", import.meta.url));
const testUrl = new URL(requireSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL));
const mysqlBinary = process.env.MYSQL_CLIENT_BIN || "mysql";

function reviewedSchema(): { sql: string; tables: string[] } {
  const sql = readFileSync(schemaPath, "utf8");
  const prisma = readFileSync(prismaPath, "utf8");
  const tables = [...sql.matchAll(/^CREATE TABLE `([^`]+)`/gm)].map(match => match[1]!);
  const models = [...prisma.matchAll(/@@map\("(arya_[^"]+)"\)/g)].map(match => match[1]!);

  if (tables.length !== 32 || models.length !== 32 ||
      tables.some((table, index) => table !== [...models].sort()[index]) ||
      /^\s*(?:INSERT|REPLACE|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE DATABASE|USE|GRANT|CREATE USER|LOAD DATA)\b/im.test(sql)) {
    throw new Error("The reviewed schema-only baseline no longer matches the Prisma table set or contains forbidden SQL.");
  }
  return { sql, tables };
}

function mysql(input: string, database = "information_schema", query = false): Promise<string> {
  const args = [
    "--no-defaults",
    "--protocol=TCP",
    `--host=${testUrl.hostname.replace(/^\[|\]$/g, "")}`,
    `--port=${testUrl.port || "3306"}`,
    `--user=${decodeURIComponent(testUrl.username)}`,
    "--default-character-set=utf8mb4",
    "--batch",
    "--skip-column-names",
    `--database=${database}`,
    ...(query ? ["-e", input] : [])
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(mysqlBinary, args, {
      shell: false,
      env: { ...process.env, MYSQL_PWD: decodeURIComponent(testUrl.password) },
      stdio: ["pipe", "pipe", "pipe"]
    });
    let output = "";
    let error = "";
    child.stdout.setEncoding("utf8").on("data", chunk => { output += chunk; });
    child.stderr.setEncoding("utf8").on("data", chunk => { error += chunk; });
    child.on("error", reject);
    child.stdin.on("error", reject);
    child.on("close", code => code === 0 ? resolve(output.trim())
      : reject(new Error(`MySQL client exited with code ${code}: ${error.trim()}`)));
    child.stdin.end(query ? "" : input);
  });
}

function count(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("Unexpected MySQL metadata response.");
  return parsed;
}

async function main() {
  const { sql, tables } = reviewedSchema();
  const existing = count(await mysql(`SELECT COUNT(*) FROM SCHEMATA WHERE SCHEMA_NAME='${TEST_DATABASE}'`, undefined, true));
  if (existing > 1) throw new Error("Unexpected duplicate test schema metadata.");
  if (existing === 1) {
    const objects = count(await mysql(`SELECT (SELECT COUNT(*) FROM TABLES WHERE TABLE_SCHEMA='${TEST_DATABASE}') +
      (SELECT COUNT(*) FROM ROUTINES WHERE ROUTINE_SCHEMA='${TEST_DATABASE}') +
      (SELECT COUNT(*) FROM EVENTS WHERE EVENT_SCHEMA='${TEST_DATABASE}')` , undefined, true));
    if (objects !== 0) throw new Error("arya_tarray_test already contains objects; refusing to overwrite or reset it.");
    const collation = await mysql(`SELECT CONCAT(DEFAULT_CHARACTER_SET_NAME, '/', DEFAULT_COLLATION_NAME)
      FROM SCHEMATA WHERE SCHEMA_NAME='${TEST_DATABASE}'`, undefined, true);
    if (collation !== "utf8mb4/utf8mb4_0900_ai_ci") {
      throw new Error("Existing empty test database has a different charset/collation; review it manually.");
    }
  } else {
    await mysql(`CREATE DATABASE \`${TEST_DATABASE}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`, undefined, true);
  }

  // No drop/reset path: a failed import leaves its partial test schema for manual review.
  await mysql(sql, TEST_DATABASE);
  const created = (await mysql(`SELECT TABLE_NAME FROM TABLES WHERE TABLE_SCHEMA='${TEST_DATABASE}' ORDER BY TABLE_NAME`, undefined, true))
    .split(/\r?\n/).filter(Boolean);
  if (created.length !== tables.length || created.some((table, index) => table !== tables[index])) {
    throw new Error("Test schema import completed but its table set does not match the reviewed baseline.");
  }
  process.stdout.write(`Created ${TEST_DATABASE} with ${created.length} empty application tables.\n`);
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : "Test database bootstrap failed."}\n`);
  process.exitCode = 1;
});
