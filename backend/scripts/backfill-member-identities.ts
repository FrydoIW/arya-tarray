import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";
import { collectIdentityObservations, discoverMemberIdentities } from "../src/modules/member/member-identity/member-identity.service.js";
import { memberTransaction } from "../src/modules/member/member-identity/member-transaction.js";

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== "--dry-run")) throw new Error("Usage: npm run member:backfill -- [--dry-run]");
  const dryRun = args.includes("--dry-run");
  const counts = { scanned: 0, eligible: 0, skipped: 0, existingIdentitiesReused: 0, newCandidates: 0, linkedTransactions: 0 };
  const knownKeys = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const rows = await prisma.bankTransaction.findMany({
      where: { memberIdentityId: null, status: { in: ["CHECK", "FINALIZED"] }, statementUpload: { status: { in: ["CHECK", "FINALIZED"] } } },
      orderBy: { id: "asc" }, take: 500, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, senderName: true, statementUploadId: true, createdAt: true,
        memberIdentityId: true, originalAmount: true, transactionType: true }
    });
    if (!rows.length) break;
    cursor = rows[rows.length - 1].id;
    if (dryRun) {
      const { observations, eligible, skipped } = collectIdentityObservations(rows);
      counts.scanned += rows.length; counts.eligible += eligible; counts.skipped += skipped;
      const existing = await prisma.memberIdentity.findMany({
        where: { identityKey: { in: observations.map(item => item.identityKey) } }, select: { identityKey: true }
      });
      existing.forEach(item => knownKeys.add(item.identityKey));
      for (const item of observations) {
        if (knownKeys.has(item.identityKey)) counts.existingIdentitiesReused++;
        else { counts.newCandidates++; knownKeys.add(item.identityKey); }
      }
      counts.linkedTransactions += eligible;
    } else {
      const result = await memberTransaction(tx => discoverMemberIdentities(tx, rows, null));
      for (const key of Object.keys(counts) as Array<keyof typeof counts>) counts[key] += result[key];
    }
  }
  console.log(dryRun ? "DRY RUN: projected counts; no changes written" : "Backfill completed");
  console.log(JSON.stringify(counts, null, 2));
}
main().catch(() => { console.error("Member backfill failed. Check database connectivity/schema; rerun safely after resolving the issue."); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
