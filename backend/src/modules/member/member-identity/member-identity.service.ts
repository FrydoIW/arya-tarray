import type { Prisma } from "@prisma/client";
import { observedIdentity } from "./member-identity.utils.js";
import { persistIdentityObservations, type IdentityObservation } from "./member-identity.repository.js";

export type DiscoveryTransaction = {
  id: string; statementUploadId: string; senderName: string | null;
  transactionType: string | null; originalAmount: { toString(): string };
  createdAt: Date; memberIdentityId: string | null;
};

export function collectIdentityObservations(rows: DiscoveryTransaction[]) {
  const byKey = new Map<string, IdentityObservation>();
  let eligible = 0;
  for (const row of rows) {
    if (row.memberIdentityId) continue;
    const identity = observedIdentity(row);
    if (!identity) continue;
    eligible++;
    const existing = byKey.get(identity.identityKey);
    if (existing) {
      existing.transactionIds.push(row.id);
      if (row.createdAt < existing.firstSeenAt) {
        existing.firstSeenAt = row.createdAt;
        existing.statementId = row.statementUploadId;
      }
      if (row.createdAt > existing.lastSeenAt) existing.lastSeenAt = row.createdAt;
    } else byKey.set(identity.identityKey, { ...identity, firstSeenAt: row.createdAt, lastSeenAt: row.createdAt,
      statementId: row.statementUploadId, transactionIds: [row.id] });
  }
  return { observations: [...byKey.values()], eligible, skipped: rows.length - eligible };
}

export async function discoverMemberIdentities(tx: Prisma.TransactionClient, rows: DiscoveryTransaction[], userId: string | null) {
  const { observations, eligible, skipped } = collectIdentityObservations(rows);
  const result = await persistIdentityObservations(tx, observations, userId);
  return { scanned: rows.length, eligible, skipped, ...result };
}
