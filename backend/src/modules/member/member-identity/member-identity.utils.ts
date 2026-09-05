import { createHash } from "node:crypto";
import { storedTransactionRequiresClassification } from "../../reconciliation/reconciliation-classification.js";

export function normalizeIdentityName(value: string) {
  return value.normalize("NFC").trim().replace(/\s+/gu, " ").toUpperCase();
}

export function observedIdentity(row: { senderName: string | null; transactionType: string | null; originalAmount: { toString(): string } }) {
  if (!storedTransactionRequiresClassification(row) || !row.senderName) return null;
  const accountName = row.senderName.trim();
  const normalizedName = normalizeIdentityName(accountName);
  // Preserve evidence: do not truncate or guess an identity from unusable names.
  if (!/\p{L}/u.test(normalizedName) || ["N/A", "UNKNOWN", "NULL"].includes(normalizedName)
    || accountName.length > 200 || normalizedName.length > 200) return null;
  // Fixed-size digest preserves exact Unicode identity despite MySQL's accent-insensitive collation.
  const identityKey = "NAME|" + createHash("sha256").update(normalizedName).digest("hex");
  return { accountName, normalizedName, identityKey };
}
