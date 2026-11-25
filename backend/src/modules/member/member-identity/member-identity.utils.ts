import { storedTransactionRequiresClassification } from "../../reconciliation/reconciliation-classification.js";

export function normalizeIdentityName(value: string) {
  return value.normalize("NFC").trim().replace(/\s+/gu, " ").toUpperCase();
}

export function observedIdentity(row: { id: string; senderName: string | null; transactionType: string | null; originalAmount: { toString(): string } }) {
  if (!storedTransactionRequiresClassification(row) || !row.senderName) return null;
  const accountName = row.senderName.trim();
  const normalizedName = normalizeIdentityName(accountName);
  // Preserve evidence: do not truncate or guess an identity from unusable names.
  if (!/\p{L}/u.test(normalizedName) || ["N/A", "UNKNOWN", "NULL"].includes(normalizedName)
    || accountName.length > 200 || normalizedName.length > 200) return null;
  // The parser has no reliable payer account identifier. A transaction reference
  // identifies a payment, not a person. Only manual review may join their owners.
  const identityKey = `TX|${row.id}`;
  return { accountName, normalizedName, identityKey };
}
