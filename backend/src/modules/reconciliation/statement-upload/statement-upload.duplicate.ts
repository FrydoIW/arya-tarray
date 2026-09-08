export type StatementContentRow = {
  rowNo: number | null;
  transactionDate: Date | null;
  transactionType: string | null;
  referenceNo: string | null;
  senderName: string | null;
  description: string | null;
  originalAmount: string | { toString(): string };
};

function amountSignature(value: StatementContentRow["originalAmount"]) {
  const raw = typeof value === "string" ? value : value.toString();
  const negative = raw.startsWith("-");
  const normalized = negative ? raw.slice(1) : raw;
  const [whole = "0", fraction = ""] = normalized.split(".");
  const cents = BigInt(whole || "0") * 100n + BigInt((fraction + "00").slice(0, 2));
  return (negative ? -cents : cents).toString();
}

function rowSignature(row: StatementContentRow) {
  return JSON.stringify([
    row.rowNo,
    row.transactionDate?.toISOString().slice(0, 10) ?? null,
    row.transactionType,
    row.referenceNo,
    row.senderName,
    row.description,
    amountSignature(row.originalAmount)
  ]);
}

export function statementsHaveIdenticalContent(
  incoming: ReadonlyArray<StatementContentRow>,
  stored: ReadonlyArray<StatementContentRow>
) {
  return incoming.length === stored.length
    && incoming.every((row, index) => rowSignature(row) === rowSignature(stored[index]!));
}
