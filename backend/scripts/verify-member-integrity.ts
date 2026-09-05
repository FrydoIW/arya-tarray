import "dotenv/config";
import { performance } from "node:perf_hooks";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma.js";
import { parseVerifyOptions, summarizeIntegrityChecks, type IntegrityCheck } from "../src/modules/member/member-identity/member-integrity.js";

const usage = `Read-only Member integrity verification

Usage: npm run member:verify -- [--limit=5]

--limit controls the maximum example IDs shown per failed check (1-50).`;
type CountRow = { violationCount: bigint | number };
type ExampleRow = { example: string };

async function check(name: string, countSql: Prisma.Sql, exampleSql: (limit: number) => Prisma.Sql, limit: number, note?: string): Promise<IntegrityCheck> {
  const [countRows, examples] = await Promise.all([
    prisma.$queryRaw<CountRow[]>(countSql), prisma.$queryRaw<ExampleRow[]>(exampleSql(limit))
  ]);
  return { name, violationCount: Number(countRows[0]?.violationCount ?? 0), examples: examples.map(row => row.example), ...(note ? { note } : {}) };
}

async function main() {
  const options = parseVerifyOptions(process.argv.slice(2));
  if (options.help) { console.log(usage); return; }
  const started = performance.now();
  const limit = options.exampleLimit;
  const checks = await Promise.all([
    check("transaction_identity_orphan",
      Prisma.sql`SELECT COUNT(*) AS violationCount FROM arya_bank_transaction bt LEFT JOIN arya_member_identity mi ON mi.member_identity_id=bt.member_identity_id WHERE bt.member_identity_id IS NOT NULL AND mi.member_identity_id IS NULL`,
      take => Prisma.sql`SELECT bt.bank_transaction_id AS example FROM arya_bank_transaction bt LEFT JOIN arya_member_identity mi ON mi.member_identity_id=bt.member_identity_id WHERE bt.member_identity_id IS NOT NULL AND mi.member_identity_id IS NULL LIMIT ${take}`, limit),
    check("verified_identity_incomplete",
      Prisma.sql`SELECT COUNT(*) AS violationCount FROM arya_member_identity WHERE verification_status='VERIFIED' AND (member_id IS NULL OR verified_at IS NULL OR verified_by IS NULL)`,
      take => Prisma.sql`SELECT member_identity_id AS example FROM arya_member_identity WHERE verification_status='VERIFIED' AND (member_id IS NULL OR verified_at IS NULL OR verified_by IS NULL) LIMIT ${take}`, limit),
    check("unverified_identity_inconsistent",
      Prisma.sql`SELECT COUNT(*) AS violationCount FROM arya_member_identity WHERE verification_status='UNVERIFIED' AND (member_id IS NOT NULL OR verified_at IS NOT NULL OR verified_by IS NOT NULL)`,
      take => Prisma.sql`SELECT member_identity_id AS example FROM arya_member_identity WHERE verification_status='UNVERIFIED' AND (member_id IS NOT NULL OR verified_at IS NOT NULL OR verified_by IS NOT NULL) LIMIT ${take}`, limit),
    check("ignored_identity_has_member",
      Prisma.sql`SELECT COUNT(*) AS violationCount FROM arya_member_identity WHERE verification_status='IGNORED' AND member_id IS NOT NULL`,
      take => Prisma.sql`SELECT member_identity_id AS example FROM arya_member_identity WHERE verification_status='IGNORED' AND member_id IS NOT NULL LIMIT ${take}`, limit,
      "IGNORED verified_at/verified_by are valid audit evidence; only member ownership is forbidden."),
    check("unknown_identity_verification_status",
      Prisma.sql`SELECT COUNT(*) AS violationCount FROM arya_member_identity WHERE verification_status NOT IN ('UNVERIFIED','VERIFIED','IGNORED')`,
      take => Prisma.sql`SELECT member_identity_id AS example FROM arya_member_identity WHERE verification_status NOT IN ('UNVERIFIED','VERIFIED','IGNORED') LIMIT ${take}`, limit),
    check("identity_member_orphan",
      Prisma.sql`SELECT COUNT(*) AS violationCount FROM arya_member_identity mi LEFT JOIN arya_member m ON m.member_id=mi.member_id WHERE mi.member_id IS NOT NULL AND m.member_id IS NULL`,
      take => Prisma.sql`SELECT mi.member_identity_id AS example FROM arya_member_identity mi LEFT JOIN arya_member m ON m.member_id=mi.member_id WHERE mi.member_id IS NOT NULL AND m.member_id IS NULL LIMIT ${take}`, limit),
    check("duplicate_identity_key",
      Prisma.sql`SELECT COUNT(*) AS violationCount FROM (SELECT identity_key FROM arya_member_identity GROUP BY identity_key HAVING COUNT(*)>1) duplicates`,
      take => Prisma.sql`SELECT identity_key AS example FROM arya_member_identity GROUP BY identity_key HAVING COUNT(*)>1 LIMIT ${take}`, limit),
    check("duplicate_member_code",
      Prisma.sql`SELECT COUNT(*) AS violationCount FROM (SELECT member_code FROM arya_member GROUP BY member_code HAVING COUNT(*)>1) duplicates`,
      take => Prisma.sql`SELECT member_code AS example FROM arya_member GROUP BY member_code HAVING COUNT(*)>1 LIMIT ${take}`, limit),
    check("direct_member_transaction_column",
      Prisma.sql`SELECT COUNT(*) AS violationCount FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='arya_bank_transaction' AND COLUMN_NAME='member_id'`,
      take => Prisma.sql`SELECT COLUMN_NAME AS example FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='arya_bank_transaction' AND COLUMN_NAME='member_id' LIMIT ${take}`, limit,
      "BankTransaction must resolve Member only through member_identity_id."),
    check("member_identity_relation_column_missing",
      Prisma.sql`SELECT IF(COUNT(*)=1,0,1) AS violationCount FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='arya_bank_transaction' AND COLUMN_NAME='member_identity_id'`,
      take => Prisma.sql`SELECT 'member_identity_id missing or duplicated' AS example FROM DUAL WHERE (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='arya_bank_transaction' AND COLUMN_NAME='member_identity_id')<>1 LIMIT ${take}`, limit)
  ]);
  const summary = summarizeIntegrityChecks(checks);
  console.log(`${summary.status}: ${summary.totalChecks - summary.failedChecks}/${summary.totalChecks} Member integrity checks passed.`);
  for (const item of checks) console.log(`${item.violationCount ? "FAIL" : "PASS"} ${item.name}: ${item.violationCount}${item.examples.length ? ` examples=${item.examples.join(",")}` : ""}${item.note ? ` (${item.note})` : ""}`);
  console.log(JSON.stringify({ ...summary, durationMs: Math.round(performance.now() - started) }, null, 2));
  if (summary.status === "FAIL") process.exitCode = 1;
}

main().catch(error => { console.error(error instanceof Error ? error.message : "Member integrity verification failed."); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
