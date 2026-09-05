import "dotenv/config";
import { performance } from "node:perf_hooks";
import { prisma } from "../src/lib/prisma.js";
import { discoverMemberIdentities } from "../src/modules/member/member-identity/member-identity.service.js";
import { memberTransaction } from "../src/modules/member/member-identity/member-transaction.js";
import { BackfillDryRunAnalyzer, parseBackfillOptions } from "../src/modules/member/member-identity/member-backfill.js";

const usage = `Member identity historical backfill

Usage:
  npm run member:backfill -- --dry-run [--batch-size=500] [--limit=N]
  npm run member:backfill -- --apply [--batch-size=500] [--limit=N]
  npm run member:backfill -- --help

--dry-run  Read-only analysis. Never inserts, updates, deletes, or links data.
--apply    Explicitly enable bounded write batches. Requires prior backup and human approval.
--limit    Stop after scanning at most N deterministically ordered transactions.`;

async function main() {
  const options = parseBackfillOptions(process.argv.slice(2));
  if (options.mode === "help") { console.log(usage); return; }
  const started = performance.now();
  const analyzer = new BackfillDryRunAnalyzer();
  const applied = { scannedTransactions: 0, eligibleIncomingTransactions: 0, skippedTransactions: 0,
    identitiesCreated: 0, identitiesReused: 0, transactionsLinked: 0 };
  let cursor: string | undefined;
  let batchNumber = 0;

  for (;;) {
    const scanned = options.mode === "dry-run" ? analyzer.counts.scannedTransactions : applied.scannedTransactions;
    const remaining = options.limit === undefined ? options.batchSize : options.limit - scanned;
    if (remaining <= 0) break;
    const rows = await prisma.bankTransaction.findMany({
      where: {
        ...(options.mode === "apply" ? { memberIdentityId: null } : {}),
        status: { in: ["CHECK", "FINALIZED"] }, statementUpload: { status: { in: ["CHECK", "FINALIZED"] } }
      },
      orderBy: { id: "asc" }, take: Math.min(options.batchSize, remaining),
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, senderName: true, statementUploadId: true, createdAt: true,
        memberIdentityId: true, originalAmount: true, transactionType: true }
    });
    if (!rows.length) break;
    batchNumber++;
    cursor = rows[rows.length - 1].id;
    try {
      if (options.mode === "dry-run") {
        const before = { ...analyzer.counts };
        const totals = await analyzer.analyzeBatch(rows, keys => prisma.memberIdentity.findMany({
          where: { identityKey: { in: keys } }, select: { identityKey: true, verificationStatus: true, memberId: true }
        }));
        console.log(`Batch ${batchNumber}: scanned=${rows.length}, eligible=${totals.eligibleIncomingTransactions - before.eligibleIncomingTransactions}, wouldCreate=${totals.identitiesWouldBeCreated - before.identitiesWouldBeCreated}, wouldReuse=${totals.identitiesWouldBeReused - before.identitiesWouldBeReused}, wouldLink=${totals.transactionsWouldBeLinked - before.transactionsWouldBeLinked}`);
      } else {
        const result = await memberTransaction(tx => discoverMemberIdentities(tx, rows, null));
        applied.scannedTransactions += result.scanned;
        applied.eligibleIncomingTransactions += result.eligible;
        applied.skippedTransactions += result.skipped;
        applied.identitiesCreated += result.newCandidates;
        applied.identitiesReused += result.existingIdentitiesReused;
        applied.transactionsLinked += result.linkedTransactions;
        console.log(`Batch ${batchNumber}: scanned=${result.scanned}, eligible=${result.eligible}, created=${result.newCandidates}, reused=${result.existingIdentitiesReused}, linked=${result.linkedTransactions}`);
      }
    } catch (error) {
      throw new Error(`Batch ${batchNumber} failed near cursor ${cursor}; prior committed batches are safe and rerun is idempotent.`, { cause: error });
    }
  }

  const durationMs = Math.round(performance.now() - started);
  if (options.mode === "dry-run") {
    console.log("DRY RUN PASS: read-only analysis completed; no mutation path was invoked.");
    console.log(JSON.stringify({ ...analyzer.counts, batches: batchNumber, durationMs }, null, 2));
  } else {
    console.log("APPLY completed. Canonical Members were not created; review UNVERIFIED candidates manually.");
    console.log(JSON.stringify({ ...applied, batches: batchNumber, durationMs }, null, 2));
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Member backfill failed.");
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
