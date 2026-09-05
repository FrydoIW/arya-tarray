import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { observedIdentity } from "./member-identity.utils.js";

export type IdentityObservation = NonNullable<ReturnType<typeof observedIdentity>> & {
  firstSeenAt: Date; lastSeenAt: Date; statementId: string; transactionIds: string[];
};

export async function persistIdentityObservations(tx: Prisma.TransactionClient, observations: IdentityObservation[], userId: string | null) {
  let created = 0;
  let linked = 0;
  // Each batch bounds placeholders and locks. Unique keys are processed in consistent order.
  observations.sort((a, b) => a.identityKey.localeCompare(b.identityKey));
  for (let offset = 0; offset < observations.length; offset += 200) {
    const batch = observations.slice(offset, offset + 200);
    const result = await tx.memberIdentity.createMany({
      data: batch.map(item => ({
        id: randomUUID(), accountName: item.accountName, normalizedName: item.normalizedName,
        identityKey: item.identityKey, firstSeenAt: item.firstSeenAt, lastSeenAt: item.lastSeenAt,
        firstSeenStatementUploadId: item.statementId, createdById: userId, updatedById: userId
      })),
      skipDuplicates: true
    });
    created += result.count;
    // Locking/current read sees winners of concurrent unique inserts, including under repeatable read.
    const identities = await tx.$queryRaw<Array<{ id: string; identityKey: string }>>(Prisma.sql`
      SELECT member_identity_id AS id, identity_key AS identityKey FROM arya_member_identity
      WHERE identity_key IN (${Prisma.join(batch.map(item => item.identityKey))}) FOR UPDATE
    `);
    const ids = new Map(identities.map(item => [item.identityKey, item.id]));
    const observationsById = batch.map(item => ({ ...item, id: ids.get(item.identityKey)! }));
    if (observationsById.some(item => !item.id)) throw new Error("Identity resolution failed");
    await tx.$executeRaw(Prisma.sql`
      UPDATE arya_member_identity SET
        first_seen_statement_upload_id = CASE member_identity_id
          ${Prisma.join(observationsById.map(item => Prisma.sql`WHEN ${item.id} THEN IF(first_seen_at > ${item.firstSeenAt}, ${item.statementId}, first_seen_statement_upload_id)`), " ")}
          ELSE first_seen_statement_upload_id END,
        first_seen_at = CASE member_identity_id
          ${Prisma.join(observationsById.map(item => Prisma.sql`WHEN ${item.id} THEN LEAST(first_seen_at, ${item.firstSeenAt})`), " ")} ELSE first_seen_at END,
        last_seen_at = CASE member_identity_id
          ${Prisma.join(observationsById.map(item => Prisma.sql`WHEN ${item.id} THEN GREATEST(last_seen_at, ${item.lastSeenAt})`), " ")} ELSE last_seen_at END,
        updated_at = CURRENT_TIMESTAMP(3), updated_by = COALESCE(${userId}, updated_by)
      WHERE member_identity_id IN (${Prisma.join(observationsById.map(item => item.id))})
    `);
    const links = observationsById.flatMap(item => item.transactionIds.map(transactionId => ({ transactionId, identityId: item.id })));
    for (let i = 0; i < links.length; i += 250) {
      const chunk = links.slice(i, i + 250);
      linked += await tx.$executeRaw(Prisma.sql`
        UPDATE arya_bank_transaction SET member_identity_id = CASE bank_transaction_id
        ${Prisma.join(chunk.map(item => Prisma.sql`WHEN ${item.transactionId} THEN ${item.identityId}`), " ")}
        ELSE member_identity_id END
        WHERE member_identity_id IS NULL AND bank_transaction_id IN (${Prisma.join(chunk.map(item => item.transactionId))})
      `);
    }
  }
  return { newCandidates: created, existingIdentitiesReused: observations.length - created, linkedTransactions: linked };
}
