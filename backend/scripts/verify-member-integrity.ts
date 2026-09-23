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
      take => Prisma.sql`SELECT 'member_identity_id missing or duplicated' AS example FROM DUAL WHERE (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='arya_bank_transaction' AND COLUMN_NAME='member_identity_id')<>1 LIMIT ${take}`, limit),
    check("ledger_posting_sequence_missing_or_duplicate",
      Prisma.sql`SELECT (SELECT COUNT(*) FROM arya_member_event_balance_ledger WHERE posting_sequence IS NULL) + (SELECT COUNT(*) FROM (SELECT member_event_subscription_id, posting_sequence FROM arya_member_event_balance_ledger GROUP BY member_event_subscription_id, posting_sequence HAVING COUNT(*)>1) duplicates) AS violationCount`,
      take => Prisma.sql`SELECT CONCAT(member_event_subscription_id, ':', posting_sequence) AS example FROM arya_member_event_balance_ledger GROUP BY member_event_subscription_id, posting_sequence HAVING COUNT(*)>1 LIMIT ${take}`, limit),
    check("carry_transfer_orphan_ledger_leg",
      Prisma.sql`SELECT COUNT(*) AS violationCount FROM arya_member_event_balance_ledger ledger LEFT JOIN arya_member_event_carry_transfer transfer_row ON transfer_row.member_event_carry_transfer_id=ledger.member_event_carry_transfer_id WHERE ledger.member_event_carry_transfer_id IS NOT NULL AND transfer_row.member_event_carry_transfer_id IS NULL`,
      take => Prisma.sql`SELECT ledger.member_event_balance_ledger_id AS example FROM arya_member_event_balance_ledger ledger LEFT JOIN arya_member_event_carry_transfer transfer_row ON transfer_row.member_event_carry_transfer_id=ledger.member_event_carry_transfer_id WHERE ledger.member_event_carry_transfer_id IS NOT NULL AND transfer_row.member_event_carry_transfer_id IS NULL LIMIT ${take}`, limit),
    check("carry_transfer_pair_integrity",
      Prisma.sql`SELECT COUNT(*) AS violationCount FROM (SELECT transfer_row.member_event_carry_transfer_id FROM arya_member_event_carry_transfer transfer_row LEFT JOIN arya_member_event_balance_ledger ledger ON ledger.member_event_carry_transfer_id=transfer_row.member_event_carry_transfer_id AND ledger.entry_status='ACTIVE' GROUP BY transfer_row.member_event_carry_transfer_id, transfer_row.source_subscription_id, transfer_row.destination_subscription_id, transfer_row.amount HAVING COALESCE(SUM(ledger.entry_type='TRANSFER_OUT'),0)<>1 OR COALESCE(SUM(ledger.entry_type='TRANSFER_IN'),0)<>1 OR COALESCE(SUM(CASE WHEN ledger.entry_type='TRANSFER_OUT' AND (ledger.member_event_subscription_id<>transfer_row.source_subscription_id OR ledger.amount_delta<>-transfer_row.amount) THEN 1 ELSE 0 END),0)>0 OR COALESCE(SUM(CASE WHEN ledger.entry_type='TRANSFER_IN' AND (ledger.member_event_subscription_id<>transfer_row.destination_subscription_id OR ledger.amount_delta<>transfer_row.amount) THEN 1 ELSE 0 END),0)>0 OR COALESCE(SUM(CASE WHEN ledger.entry_type IN ('TRANSFER_OUT','TRANSFER_IN') THEN ledger.amount_delta ELSE 0 END),0)<>0) invalid_pairs`,
      take => Prisma.sql`SELECT transfer_row.member_event_carry_transfer_id AS example FROM arya_member_event_carry_transfer transfer_row LEFT JOIN arya_member_event_balance_ledger ledger ON ledger.member_event_carry_transfer_id=transfer_row.member_event_carry_transfer_id AND ledger.entry_status='ACTIVE' GROUP BY transfer_row.member_event_carry_transfer_id, transfer_row.source_subscription_id, transfer_row.destination_subscription_id, transfer_row.amount HAVING COALESCE(SUM(ledger.entry_type='TRANSFER_OUT'),0)<>1 OR COALESCE(SUM(ledger.entry_type='TRANSFER_IN'),0)<>1 OR COALESCE(SUM(CASE WHEN ledger.entry_type='TRANSFER_OUT' AND (ledger.member_event_subscription_id<>transfer_row.source_subscription_id OR ledger.amount_delta<>-transfer_row.amount) THEN 1 ELSE 0 END),0)>0 OR COALESCE(SUM(CASE WHEN ledger.entry_type='TRANSFER_IN' AND (ledger.member_event_subscription_id<>transfer_row.destination_subscription_id OR ledger.amount_delta<>transfer_row.amount) THEN 1 ELSE 0 END),0)>0 OR COALESCE(SUM(CASE WHEN ledger.entry_type IN ('TRANSFER_OUT','TRANSFER_IN') THEN ledger.amount_delta ELSE 0 END),0)<>0 LIMIT ${take}`, limit),
    check("carry_transfer_member_subscription_mismatch",
      Prisma.sql`SELECT COUNT(*) AS violationCount FROM arya_member_event_carry_transfer transfer_row LEFT JOIN arya_member_event_subscription source_sub ON source_sub.member_event_subscription_id=transfer_row.source_subscription_id LEFT JOIN arya_member_event_subscription destination_sub ON destination_sub.member_event_subscription_id=transfer_row.destination_subscription_id WHERE source_sub.member_id<>transfer_row.member_id OR destination_sub.member_id<>transfer_row.member_id OR transfer_row.source_subscription_id=transfer_row.destination_subscription_id`,
      take => Prisma.sql`SELECT transfer_row.member_event_carry_transfer_id AS example FROM arya_member_event_carry_transfer transfer_row LEFT JOIN arya_member_event_subscription source_sub ON source_sub.member_event_subscription_id=transfer_row.source_subscription_id LEFT JOIN arya_member_event_subscription destination_sub ON destination_sub.member_event_subscription_id=transfer_row.destination_subscription_id WHERE source_sub.member_id<>transfer_row.member_id OR destination_sub.member_id<>transfer_row.member_id OR transfer_row.source_subscription_id=transfer_row.destination_subscription_id LIMIT ${take}`, limit),
    check("carry_transfer_reversal_integrity",
      Prisma.sql`SELECT COUNT(*) AS violationCount FROM arya_member_event_carry_transfer reversal LEFT JOIN arya_member_event_carry_transfer original ON original.member_event_carry_transfer_id=reversal.reversal_of_transfer_id WHERE reversal.reversal_of_transfer_id IS NOT NULL AND (original.member_event_carry_transfer_id IS NULL OR original.amount<>reversal.amount OR NOT ((reversal.source_subscription_id <=> original.destination_subscription_id) AND (reversal.destination_subscription_id <=> original.source_subscription_id) AND (reversal.source_campaign_id <=> original.destination_campaign_id) AND (reversal.destination_campaign_id <=> original.source_campaign_id)))`,
      take => Prisma.sql`SELECT reversal.member_event_carry_transfer_id AS example FROM arya_member_event_carry_transfer reversal LEFT JOIN arya_member_event_carry_transfer original ON original.member_event_carry_transfer_id=reversal.reversal_of_transfer_id WHERE reversal.reversal_of_transfer_id IS NOT NULL AND (original.member_event_carry_transfer_id IS NULL OR original.amount<>reversal.amount OR NOT ((reversal.source_subscription_id <=> original.destination_subscription_id) AND (reversal.destination_subscription_id <=> original.source_subscription_id) AND (reversal.source_campaign_id <=> original.destination_campaign_id) AND (reversal.destination_campaign_id <=> original.source_campaign_id))) LIMIT ${take}`, limit),
    check("carry_transfer_duplicate_reversal",
      Prisma.sql`SELECT COUNT(*) AS violationCount FROM (SELECT reversal_of_transfer_id FROM arya_member_event_carry_transfer WHERE reversal_of_transfer_id IS NOT NULL GROUP BY reversal_of_transfer_id HAVING COUNT(*)>1) duplicates`,
      take => Prisma.sql`SELECT reversal_of_transfer_id AS example FROM arya_member_event_carry_transfer WHERE reversal_of_transfer_id IS NOT NULL GROUP BY reversal_of_transfer_id HAVING COUNT(*)>1 LIMIT ${take}`, limit),
    check("carry_transfer_status_reversal_mismatch",
      Prisma.sql`SELECT COUNT(*) AS violationCount FROM arya_member_event_carry_transfer transfer_row LEFT JOIN arya_member_event_carry_transfer reversal ON reversal.reversal_of_transfer_id=transfer_row.member_event_carry_transfer_id WHERE (reversal.member_event_carry_transfer_id IS NOT NULL AND transfer_row.status<>'REVERSED') OR (reversal.member_event_carry_transfer_id IS NULL AND transfer_row.status<>'ACTIVE') OR (transfer_row.status='REVERSED' AND (transfer_row.reversed_at IS NULL OR transfer_row.reversed_by IS NULL)) OR (transfer_row.status='ACTIVE' AND (transfer_row.reversed_at IS NOT NULL OR transfer_row.reversed_by IS NOT NULL))`,
      take => Prisma.sql`SELECT transfer_row.member_event_carry_transfer_id AS example FROM arya_member_event_carry_transfer transfer_row LEFT JOIN arya_member_event_carry_transfer reversal ON reversal.reversal_of_transfer_id=transfer_row.member_event_carry_transfer_id WHERE (reversal.member_event_carry_transfer_id IS NOT NULL AND transfer_row.status<>'REVERSED') OR (reversal.member_event_carry_transfer_id IS NULL AND transfer_row.status<>'ACTIVE') OR (transfer_row.status='REVERSED' AND (transfer_row.reversed_at IS NULL OR transfer_row.reversed_by IS NULL)) OR (transfer_row.status='ACTIVE' AND (transfer_row.reversed_at IS NOT NULL OR transfer_row.reversed_by IS NOT NULL)) LIMIT ${take}`, limit),
    check("active_transfer_negative_subscription_balance",
      Prisma.sql`SELECT COUNT(*) AS violationCount FROM (SELECT ledger.member_event_subscription_id FROM arya_member_event_balance_ledger ledger WHERE ledger.entry_status='ACTIVE' AND EXISTS (SELECT 1 FROM arya_member_event_balance_ledger leg WHERE leg.member_event_subscription_id=ledger.member_event_subscription_id AND leg.carry_transfer_id IS NOT NULL) GROUP BY ledger.member_event_subscription_id HAVING SUM(ledger.amount_delta)<0) negative_balances`,
      take => Prisma.sql`SELECT ledger.member_event_subscription_id AS example FROM arya_member_event_balance_ledger ledger WHERE ledger.entry_status='ACTIVE' AND EXISTS (SELECT 1 FROM arya_member_event_balance_ledger leg WHERE leg.member_event_subscription_id=ledger.member_event_subscription_id AND leg.carry_transfer_id IS NOT NULL) GROUP BY ledger.member_event_subscription_id HAVING SUM(ledger.amount_delta)<0 LIMIT ${take}`, limit),
    check("carry_transfer_source_shape_invalid",
      Prisma.sql`SELECT COUNT(*) AS violationCount FROM arya_member_event_carry_transfer WHERE (source_subscription_id IS NOT NULL) = (source_campaign_id IS NOT NULL)`,
      take => Prisma.sql`SELECT member_event_carry_transfer_id AS example FROM arya_member_event_carry_transfer WHERE (source_subscription_id IS NOT NULL) = (source_campaign_id IS NOT NULL) LIMIT ${take}`, limit,
      "Exactly one of source_subscription_id and source_campaign_id must be present."),
    check("campaign_allocation_evidence_invalid",
      Prisma.sql`SELECT COUNT(*) AS violationCount FROM arya_member_event_campaign_allocation WHERE (member_event_carry_transfer_id IS NOT NULL) = (bank_transaction_id IS NOT NULL)`,
      take => Prisma.sql`SELECT member_event_campaign_allocation_id AS example FROM arya_member_event_campaign_allocation WHERE (member_event_carry_transfer_id IS NOT NULL) = (bank_transaction_id IS NOT NULL) LIMIT ${take}`, limit),
    check("campaign_wallet_evidence_invalid",
      Prisma.sql`SELECT COUNT(*) AS violationCount FROM arya_member_event_campaign_wallet_ledger WHERE (bank_transaction_id IS NOT NULL) = (member_event_carry_transfer_id IS NOT NULL) OR amount_delta = 0`,
      take => Prisma.sql`SELECT member_event_campaign_wallet_ledger_id AS example FROM arya_member_event_campaign_wallet_ledger WHERE (bank_transaction_id IS NOT NULL) = (member_event_carry_transfer_id IS NOT NULL) OR amount_delta = 0 LIMIT ${take}`, limit),
    check("campaign_wallet_orphan",
      Prisma.sql`SELECT COUNT(*) AS violationCount FROM arya_member_event_campaign_wallet_ledger wallet LEFT JOIN arya_member member ON member.member_id=wallet.member_id LEFT JOIN arya_event_campaign campaign ON campaign.event_campaign_id=wallet.event_campaign_id LEFT JOIN arya_user creator ON creator.user_id=wallet.created_by WHERE member.member_id IS NULL OR campaign.event_campaign_id IS NULL OR creator.user_id IS NULL`,
      take => Prisma.sql`SELECT wallet.member_event_campaign_wallet_ledger_id AS example FROM arya_member_event_campaign_wallet_ledger wallet LEFT JOIN arya_member member ON member.member_id=wallet.member_id LEFT JOIN arya_event_campaign campaign ON campaign.event_campaign_id=wallet.event_campaign_id LEFT JOIN arya_user creator ON creator.user_id=wallet.created_by WHERE member.member_id IS NULL OR campaign.event_campaign_id IS NULL OR creator.user_id IS NULL LIMIT ${take}`, limit),
    check("campaign_wallet_active_negative",
      Prisma.sql`SELECT COUNT(*) AS violationCount FROM (SELECT member_id, event_campaign_id FROM arya_member_event_campaign_wallet_ledger WHERE entry_status='ACTIVE' GROUP BY member_id, event_campaign_id HAVING SUM(amount_delta)<0) negative_wallets`,
      take => Prisma.sql`SELECT CONCAT(member_id, ':', event_campaign_id) AS example FROM arya_member_event_campaign_wallet_ledger WHERE entry_status='ACTIVE' GROUP BY member_id, event_campaign_id HAVING SUM(amount_delta)<0 LIMIT ${take}`, limit),
    check("campaign_transfer_missing_wallet_leg",
      Prisma.sql`SELECT COUNT(*) AS violationCount FROM arya_member_event_carry_transfer transfer_row WHERE transfer_row.source_campaign_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM arya_member_event_campaign_wallet_ledger wallet WHERE wallet.member_event_carry_transfer_id=transfer_row.member_event_carry_transfer_id)`,
      take => Prisma.sql`SELECT transfer_row.member_event_carry_transfer_id AS example FROM arya_member_event_carry_transfer transfer_row WHERE transfer_row.source_campaign_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM arya_member_event_campaign_wallet_ledger wallet WHERE wallet.member_event_carry_transfer_id=transfer_row.member_event_carry_transfer_id) LIMIT ${take}`, limit),
    check("campaign_destination_missing_allocation",
      Prisma.sql`SELECT COUNT(*) AS violationCount FROM arya_member_event_carry_transfer transfer_row WHERE transfer_row.destination_campaign_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM arya_member_event_campaign_allocation allocation WHERE allocation.member_event_carry_transfer_id=transfer_row.member_event_carry_transfer_id)`,
      take => Prisma.sql`SELECT transfer_row.member_event_carry_transfer_id AS example FROM arya_member_event_carry_transfer transfer_row WHERE transfer_row.destination_campaign_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM arya_member_event_campaign_allocation allocation WHERE allocation.member_event_carry_transfer_id=transfer_row.member_event_carry_transfer_id) LIMIT ${take}`, limit)
  ]);
  const summary = summarizeIntegrityChecks(checks);
  console.log(`${summary.status}: ${summary.totalChecks - summary.failedChecks}/${summary.totalChecks} Member integrity checks passed.`);
  for (const item of checks) console.log(`${item.violationCount ? "FAIL" : "PASS"} ${item.name}: ${item.violationCount}${item.examples.length ? ` examples=${item.examples.join(",")}` : ""}${item.note ? ` (${item.note})` : ""}`);
  console.log(JSON.stringify({ ...summary, durationMs: Math.round(performance.now() - started) }, null, 2));
  if (summary.status === "FAIL") process.exitCode = 1;
}

main().catch(error => { console.error(error instanceof Error ? error.message : "Member integrity verification failed."); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
