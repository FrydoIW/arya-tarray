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

function rowSignature(row: StatementContentRow) {
  return JSON.stringify([
    row.rowNo,
    row.transactionDate?.toISOString().slice(0, 10) ?? null,
    row.transactionType,
    row.referenceNo,
    row.senderName,
    row.description,
    signedAmountCents(row.originalAmount).toString()
  ]);
}

export function statementsHaveIdenticalContent(
  incoming: ReadonlyArray<StatementContentRow>,
  stored: ReadonlyArray<StatementContentRow>
) {
  return incoming.length === stored.length
    && incoming.every((row, index) => rowSignature(row) === rowSignature(stored[index]!));
}

export type BankEvidenceSignatureInput = {
  transactionDate: Date | null;
  transactionType: string | null;
  referenceNo: string | null;
  senderName: string | null;
  description: string | null;
  originalAmount: string | { toString(): string };
};

export type DuplicateEvidenceRow = BankEvidenceSignatureInput & {
  id: string;
  statementUploadId: string;
};

export function canonicalDuplicateSignature(row: BankEvidenceSignatureInput) {
  const payload = JSON.stringify([
    row.transactionDate ? row.transactionDate.toISOString().slice(0, 10) : null,
    row.transactionType ?? null,
    row.referenceNo ?? null,
    row.senderName ?? null,
    row.description ?? null,
    signedAmountCents(row.originalAmount).toString()
  ]);
  return createHash("sha256").update(payload).digest("hex");
}

export function matchDuplicateTransactions<T extends BankEvidenceSignatureInput>(
  incoming: ReadonlyArray<T>,
  existing: ReadonlyArray<DuplicateEvidenceRow>
) {
  const queues = new Map<string, DuplicateEvidenceRow[]>();
  for (const row of existing) {
    const signature = canonicalDuplicateSignature(row);
    const queue = queues.get(signature);
    if (queue) queue.push(row);
    else queues.set(signature, [row]);
  }

  const duplicates: Array<{ incoming: T; matched: DuplicateEvidenceRow }> = [];
  const newRows: T[] = [];
  for (const row of incoming) {
    const queue = queues.get(canonicalDuplicateSignature(row));
    const matched = queue?.shift();
    if (matched) duplicates.push({ incoming: row, matched });
    else newRows.push(row);
  }

  return { duplicates, newRows };
}
