import { createHash } from "node:crypto";

export type StatementContentRow = {
  rowNo: number | null;
  transactionDate: Date | null;
  transactionType: string | null;
  referenceNo: string | null;
  senderName: string | null;
  description: string | null;
  originalAmount: string | { toString(): string };
};

export function signedAmountCents(value: StatementContentRow["originalAmount"]) {
  const raw = typeof value === "string" ? value : value.toString();
  const negative = raw.startsWith("-");
  const normalized = negative ? raw.slice(1) : raw;
  const [whole = "0", fraction = ""] = normalized.split(".");
  const cents = BigInt(whole || "0") * 100n + BigInt((fraction + "00").slice(0, 2));
  return negative ? -cents : cents;
}

/** Conservative normalization: case, Unicode width and whitespace only. */
function normalize(value: string | null) {
  return value?.normalize("NFKC").replace(/\s+/g, " ").trim().toUpperCase() || null;
}

function rowSignature(row: StatementContentRow) {
  return JSON.stringify([row.rowNo, row.transactionDate?.toISOString().slice(0, 10) ?? null,
    normalize(row.transactionType), normalize(row.referenceNo), normalize(row.senderName), normalize(row.description),
    signedAmountCents(row.originalAmount).toString()]);
}

export function statementsHaveIdenticalContent(incoming: ReadonlyArray<StatementContentRow>, stored: ReadonlyArray<StatementContentRow>) {
  return incoming.length === stored.length && incoming.every((row, index) => rowSignature(row) === rowSignature(stored[index]!));
}

export type BankEvidenceSignatureInput = Omit<StatementContentRow, "rowNo">;
export type DuplicateEvidenceRow = BankEvidenceSignatureInput & { id: string; statementUploadId: string };

/**
 * Strong identity. A BCA reference is not assumed to be unique: sender and
 * description remain part of the identity, so two legitimate transfers with the
 * same reference/date/amount/type do not become EXACT duplicates.
 */
function strongIdentity(row: BankEvidenceSignatureInput) {
  const amount = signedAmountCents(row.originalAmount);
  const direction = amount < 0n ? "DB" : "CR";
  return [
    row.transactionDate?.toISOString().slice(0, 10) ?? null,
    direction,
    amount.toString(),
    normalize(row.transactionType),
    normalize(row.referenceNo),
    normalize(row.senderName),
    normalize(row.description)
  ];
}

/**
 * Candidate identity for POSSIBLE review. Equal references (or, without a
 * reference, equal senders) plus the same date/direction/amount/type mean the
 * rows deserve review. Different references remain distinct transactions.
 */
function possibleIdentity(row: BankEvidenceSignatureInput) {
  const amount = signedAmountCents(row.originalAmount);
  const direction = amount < 0n ? "DB" : "CR";
  const reference = normalize(row.referenceNo);
  const sender = normalize(row.senderName);
  return JSON.stringify([
    row.transactionDate?.toISOString().slice(0, 10) ?? null,
    direction,
    amount.toString(),
    normalize(row.transactionType),
    reference ? "REF" : "TEXT",
    reference ?? sender
  ]);
}

export function canonicalDuplicateSignature(row: BankEvidenceSignatureInput) {
  return createHash("sha256").update(JSON.stringify(strongIdentity(row))).digest("hex");
}

export function canonicalDatabaseFingerprint(bankAccountId: string, row: BankEvidenceSignatureInput) {
  return createHash("sha256").update(`${bankAccountId}:${canonicalDuplicateSignature(row)}`).digest("hex");
}

export type DuplicateMatch<T> = { kind: "EXISTING"; row: DuplicateEvidenceRow } | { kind: "INCOMING"; row: T };

/**
 * Multiset matching. Existing rows are consumed one occurrence at a time, so a
 * re-upload of a file containing N identical rows does not keep importing the
 * same evidence again. An extra occurrence beyond the stored cardinality is
 * imported and flagged POSSIBLE instead of being silently skipped.
 */
export function matchDuplicateTransactions<T extends BankEvidenceSignatureInput>(incoming: ReadonlyArray<T>, existing: ReadonlyArray<DuplicateEvidenceRow>) {
  const exactQueues = new Map<string, DuplicateEvidenceRow[]>();
  const possible = new Map<string, DuplicateMatch<T>[]>();
  const addPossible = (match: DuplicateMatch<T>) => {
    const key = possibleIdentity(match.row);
    possible.set(key, [...(possible.get(key) ?? []), match]);
  };

  for (const row of existing) {
    const signature = canonicalDuplicateSignature(row);
    const queue = exactQueues.get(signature) ?? [];
    queue.push(row);
    exactQueues.set(signature, queue);
    addPossible({ kind: "EXISTING", row });
  }

  const exactDuplicates: Array<{ incoming: T; matched: DuplicateMatch<T> }> = [];
  const possibleDuplicates: Array<{ incoming: T; matched: DuplicateMatch<T> }> = [];
  const newRows: T[] = [];

  for (const row of incoming) {
    const signature = canonicalDuplicateSignature(row);
    const exact = exactQueues.get(signature)?.shift();
    if (exact) {
      exactDuplicates.push({ incoming: row, matched: { kind: "EXISTING", row: exact } });
      continue;
    }

    const possibleMatch = (possible.get(possibleIdentity(row)) ?? [])[0];
    if (possibleMatch) possibleDuplicates.push({ incoming: row, matched: possibleMatch });

    newRows.push(row);
    addPossible({ kind: "INCOMING", row });
  }

  return { exactDuplicates, possibleDuplicates, newRows };
}
